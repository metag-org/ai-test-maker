"""Embedded portable PostgreSQL lifecycle manager for macOS and Windows."""

from __future__ import annotations

import json
import logging
import os
import socket
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path

import psycopg
from psycopg import sql

from desktop.paths import AppPaths, DB_NAME, DB_USER

logger = logging.getLogger("desktop.postgres")


def _no_window_kwargs() -> dict:
    """Prevent flashing console windows on Windows when spawning PG binaries."""
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {}


def is_windows_admin() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import ctypes

        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def is_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            import ctypes

            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            handle = ctypes.windll.kernel32.OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION, False, pid
            )
            if not handle:
                return False
            try:
                exit_code = ctypes.c_ulong()
                if ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                    return exit_code.value == STILL_ACTIVE
                return False
            finally:
                ctypes.windll.kernel32.CloseHandle(handle)
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def find_free_port(preferred: int, host: str = "127.0.0.1", max_tries: int = 50) -> int:
    for offset in range(max_tries):
        port = preferred + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


class EmbeddedPostgresManager:
    """Manages initdb, start, database creation, backup, and graceful stop."""

    def __init__(self, paths: AppPaths, preferred_port: int = 54329) -> None:
        self.paths = paths
        self.preferred_port = preferred_port
        self.port: int = preferred_port
        self._started = False

    def _bin(self, name: str) -> Path:
        suffix = ".exe" if sys.platform == "win32" else ""
        exe = self.paths.postgres_dir / "bin" / f"{name}{suffix}"
        if not exe.is_file():
            raise FileNotFoundError(
                f"Embedded PostgreSQL binary not found: {exe}\n"
                "Please run desktop/scripts/fetch_postgres.py before packaging or running."
            )
        return exe

    def _pg_env(self) -> dict[str, str]:
        env = os.environ.copy()
        pg_bin = str(self.paths.postgres_dir / "bin")
        pg_lib = str(self.paths.postgres_dir / "lib")
        env["PATH"] = pg_bin + os.pathsep + env.get("PATH", "")
        if sys.platform == "darwin":
            existing = env.get("DYLD_LIBRARY_PATH", "")
            env["DYLD_LIBRARY_PATH"] = f"{pg_lib}:{existing}" if existing else pg_lib
        elif sys.platform != "win32":
            existing = env.get("LD_LIBRARY_PATH", "")
            env["LD_LIBRARY_PATH"] = f"{pg_lib}:{existing}" if existing else pg_lib
        env["LC_ALL"] = "C"
        env["LANG"] = "C"
        env["PGCLIENTENCODING"] = "UTF8"
        return env

    @property
    def database_url(self) -> str:
        return f"postgresql+psycopg://{DB_USER}@127.0.0.1:{self.port}/{DB_NAME}"

    def _run(self, args: list[str], check: bool = True, timeout: int = 120) -> subprocess.CompletedProcess:
        """Run a PostgreSQL CLI command using file-backed output redirection.

        IMPORTANT: On Windows, `pg_ctl start` spawns background `postgres.exe` which
        inherits stdout/stderr PIPE handles. Using `capture_output=True` (PIPE) causes
        Python's `subprocess.run()` to block forever waiting for pipe EOF even after
        `pg_ctl.exe` exits. Redirecting to regular files avoids pipe deadlocks completely.
        """
        logger.debug("Running PG command: %s", " ".join(args))
        self.paths.logs_dir.mkdir(parents=True, exist_ok=True)
        out_fd, out_path = tempfile.mkstemp(prefix="pg_out_", suffix=".log", dir=str(self.paths.logs_dir))
        err_fd, err_path = tempfile.mkstemp(prefix="pg_err_", suffix=".log", dir=str(self.paths.logs_dir))
        stdout_text = ""
        stderr_text = ""
        try:
            with os.fdopen(out_fd, "wb") as out_fp, os.fdopen(err_fd, "wb") as err_fp:
                proc = subprocess.run(
                    args,
                    env=self._pg_env(),
                    stdin=subprocess.DEVNULL,
                    stdout=out_fp,
                    stderr=err_fp,
                    timeout=timeout,
                    close_fds=True,
                    **_no_window_kwargs(),
                )
            stdout_text = Path(out_path).read_text(encoding="utf-8", errors="replace")
            stderr_text = Path(err_path).read_text(encoding="utf-8", errors="replace")
        finally:
            for p in (out_path, err_path):
                try:
                    Path(p).unlink(missing_ok=True)
                except OSError:
                    # On Windows, background postgres.exe may briefly keep the handle open
                    pass

        result = subprocess.CompletedProcess(args, proc.returncode, stdout_text, stderr_text)
        if check and result.returncode != 0:
            raise RuntimeError(
                f"PostgreSQL command failed ({result.returncode}): {' '.join(args)}\n"
                f"STDOUT: {stdout_text.strip()}\nSTDERR: {stderr_text.strip()}"
            )
        return result

    def _cleanup_stale_pid(self) -> None:
        pid_file = self.paths.pgdata_dir / "postmaster.pid"
        if not pid_file.is_file():
            return
        try:
            first_line = pid_file.read_text(encoding="utf-8", errors="ignore").splitlines()[0].strip()
            pid = int(first_line)
        except Exception:
            logger.warning("Corrupted postmaster.pid found; removing it.")
            pid_file.unlink(missing_ok=True)
            return

        if is_pid_alive(pid):
            logger.info("Existing PostgreSQL process (PID %s) is running; stopping it cleanly first.", pid)
            self._run(
                [str(self._bin("pg_ctl")), "-D", str(self.paths.pgdata_dir), "-m", "fast", "stop"],
                check=False,
                timeout=30,
            )
            time.sleep(0.5)
        else:
            logger.warning("Removing stale postmaster.pid (dead PID %s).", pid)
            pid_file.unlink(missing_ok=True)

    def _ensure_windows_acl_for_restricted_token(self) -> None:
        """When running elevated on Windows (e.g. CI or UAC-off PC), initdb/pg_ctl drop
        admin privileges via CreateRestrictedToken(). Ensure the non-elevated user token
        still has full read/write access to data_root and pgdata_dir."""
        if not is_windows_admin():
            return
        logger.warning(
            "Running with Windows Administrator privileges; granting Authenticated Users "
            "access to data directories so PostgreSQL's restricted token can start cleanly."
        )
        targets = {self.paths.data_root, self.paths.logs_dir, self.paths.pgdata_dir.parent}
        if self.paths.pgdata_dir.exists():
            targets.add(self.paths.pgdata_dir)
        for target in targets:
            target.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                ["icacls", str(target), "/grant", "*S-1-5-11:(OI)(CI)F", "/Q"],
                capture_output=True,
                check=False,
                timeout=15,
                **_no_window_kwargs(),
            )

    def _ensure_initialized(self) -> None:
        pg_version_file = self.paths.pgdata_dir / "PG_VERSION"
        if pg_version_file.is_file():
            return

        logger.info("Initializing embedded PostgreSQL data directory at %s", self.paths.pgdata_dir)
        self.paths.pgdata_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_windows_acl_for_restricted_token()
        self._run(
            [
                str(self._bin("initdb")),
                "-D",
                str(self.paths.pgdata_dir),
                "-U",
                DB_USER,
                "--encoding=UTF8",
                "--locale=C",
                "--auth=trust",
                "--no-instructions",
            ]
        )

    def _wait_until_ready(self, timeout_seconds: float = 30.0) -> None:
        deadline = time.monotonic() + timeout_seconds
        last_err: Exception | None = None
        while time.monotonic() < deadline:
            try:
                with psycopg.connect(
                    host="127.0.0.1",
                    port=self.port,
                    user=DB_USER,
                    dbname="postgres",
                    connect_timeout=3,
                ) as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1")
                return
            except Exception as exc:
                last_err = exc
                time.sleep(0.25)
        raise TimeoutError(
            f"Embedded PostgreSQL did not become ready on port {self.port} within {timeout_seconds}s: {last_err}"
        )

    def _ensure_database(self) -> None:
        with psycopg.connect(
            host="127.0.0.1",
            port=self.port,
            user=DB_USER,
            dbname="postgres",
            autocommit=True,
            connect_timeout=10,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DB_NAME,))
                if cur.fetchone():
                    return
                logger.info("Creating database '%s'...", DB_NAME)
                cur.execute(
                    sql.SQL("CREATE DATABASE {} ENCODING 'UTF8'").format(sql.Identifier(DB_NAME))
                )

    def start(self) -> str:
        """Initialize (if needed) and start embedded PostgreSQL. Returns SQLAlchemy URL."""
        self._ensure_windows_acl_for_restricted_token()
        self._ensure_initialized()
        self._cleanup_stale_pid()
        self.port = find_free_port(self.preferred_port)

        pg_log = self.paths.logs_dir / "postgres.log"
        pg_opts = ["-h 127.0.0.1", f"-p {self.port}"]
        if sys.platform != "win32":
            pg_opts.append(f"-k '{self.paths.pg_socket_dir}'")

        logger.info("Starting embedded PostgreSQL on 127.0.0.1:%s ...", self.port)
        try:
            self._run(
                [
                    str(self._bin("pg_ctl")),
                    "-D",
                    str(self.paths.pgdata_dir),
                    "-l",
                    str(pg_log),
                    "-o",
                    " ".join(pg_opts),
                    "-w",
                    "-t",
                    "30",
                    "start",
                ]
            )
        except Exception as exc:
            pg_tail = ""
            if pg_log.is_file():
                try:
                    lines = pg_log.read_text(encoding="utf-8", errors="replace").splitlines()
                    pg_tail = "\n".join(lines[-20:]).strip()
                except Exception:
                    pass
            if pg_tail:
                raise RuntimeError(f"{exc}\n\n--- postgres.log ---\n{pg_tail}") from exc
            raise
        self._started = True
        self._wait_until_ready()
        self._ensure_database()
        logger.info("Embedded PostgreSQL ready at %s", self.database_url)
        return self.database_url

    def backup(self) -> Path:
        """Create a complete backup archive (.zip) containing all PostgreSQL tables and uploads."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = self.paths.backups_dir / f"{DB_NAME}_backup_{timestamp}.zip"

        tables_dump: dict[str, list[dict]] = {}
        with psycopg.connect(
            host="127.0.0.1",
            port=self.port,
            user=DB_USER,
            dbname=DB_NAME,
            connect_timeout=10,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT tablename FROM pg_tables
                    WHERE schemaname = 'public'
                    ORDER BY tablename
                    """
                )
                table_names = [row[0] for row in cur.fetchall()]
                for table in table_names:
                    cur.execute(sql.SQL("SELECT * FROM {}").format(sql.Identifier(table)))
                    cols = [desc.name for desc in cur.description or []]
                    rows = []
                    for row in cur.fetchall():
                        rows.append(dict(zip(cols, row)))
                    tables_dump[table] = rows

        with zipfile.ZipFile(backup_file, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "database.json",
                json.dumps(
                    {
                        "database": DB_NAME,
                        "exported_at": datetime.now().isoformat(),
                        "tables": tables_dump,
                    },
                    ensure_ascii=False,
                    indent=2,
                    default=str,
                ),
            )
            if self.paths.uploads_dir.is_dir():
                for file_path in self.paths.uploads_dir.rglob("*"):
                    if file_path.is_file():
                        rel = file_path.relative_to(self.paths.uploads_dir)
                        zf.write(file_path, arcname=str(Path("uploads") / rel))

        logger.info("Full backup saved to %s", backup_file)
        return backup_file

    def stop(self) -> None:
        if not self._started:
            return
        logger.info("Stopping embedded PostgreSQL cleanly...")
        try:
            self._run(
                [
                    str(self._bin("pg_ctl")),
                    "-D",
                    str(self.paths.pgdata_dir),
                    "-m",
                    "fast",
                    "-w",
                    "-t",
                    "20",
                    "stop",
                ],
                check=False,
                timeout=25,
            )
        except Exception as exc:
            logger.warning("Error while stopping PostgreSQL: %s", exc)
        finally:
            self._started = False
