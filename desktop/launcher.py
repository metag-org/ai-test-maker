"""Main desktop entry point for Review Test Maker (macOS & Windows).

Starts embedded PostgreSQL -> applies Alembic migrations -> starts FastAPI ->
opens browser & system tray -> stops everything cleanly on exit.
"""

from __future__ import annotations

import argparse
import atexit
import json
import logging
import os
import signal
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

# Ensure repository root is importable when launched as a script
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from desktop.paths import APP_DISPLAY_NAME, AppPaths, resolve_app_paths
from desktop.postgres_manager import EmbeddedPostgresManager, find_free_port, is_pid_alive
from desktop.tray import get_lan_ip, run_tray, show_error_dialog

logger = logging.getLogger("desktop.launcher")


def configure_logging(logs_dir: Path, verbose: bool = False) -> None:
    log_file = logs_dir / "desktop.log"
    handlers: list[logging.Handler] = [
        logging.FileHandler(log_file, encoding="utf-8"),
    ]
    if not getattr(sys, "frozen", False) or verbose:
        handlers.append(logging.StreamHandler(sys.stdout))

    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )


def _check_existing_instance(paths: AppPaths) -> str | None:
    """If another desktop instance is already healthy, return its URL."""
    if not paths.runtime_file.is_file():
        return None
    try:
        info = json.loads(paths.runtime_file.read_text(encoding="utf-8"))
        pid = int(info.get("pid", 0))
        url = str(info.get("url", ""))
        if pid and is_pid_alive(pid) and url:
            with urllib.request.urlopen(f"{url}/api/health", timeout=2) as resp:
                if resp.status == 200:
                    return url
    except Exception:
        pass
    paths.runtime_file.unlink(missing_ok=True)
    return None


def _write_runtime_info(paths: AppPaths, url: str, pg_port: int) -> None:
    payload = {
        "pid": os.getpid(),
        "url": url,
        "pg_port": pg_port,
        "started_at": time.time(),
    }
    paths.runtime_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _wait_for_http(url: str, timeout: float = 25.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=2) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise TimeoutError(f"Backend HTTP server did not become ready at {url}")


class DesktopApp:
    def __init__(self, paths: AppPaths, preferred_port: int = 8000, preferred_pg_port: int = 54329) -> None:
        self.paths = paths
        self.preferred_port = preferred_port
        self.pg = EmbeddedPostgresManager(paths, preferred_port=preferred_pg_port)
        self.uvicorn_server = None
        self.server_thread: threading.Thread | None = None
        self.app_port: int = preferred_port
        self._shutdown_lock = threading.Lock()
        self._is_shutting_down = False

    def start(self) -> str:
        # 1. Start embedded PostgreSQL
        database_url = self.pg.start()

        # 2. Configure environment BEFORE importing backend modules (Settings loads at import time)
        os.environ["DATABASE_URL"] = database_url
        os.environ["DATA_DIR"] = str(self.paths.uploads_dir)
        os.environ["STATIC_DIR"] = str(self.paths.static_dir)
        os.environ.setdefault("APP_PASSWORD", "")

        # 3. Run Alembic migrations
        from desktop.migrations import run_migrations

        run_migrations(self.paths, database_url)

        # 4. Import FastAPI app and start Uvicorn on a background thread
        backend_str = str(self.paths.backend_dir)
        if backend_str not in sys.path:
            sys.path.insert(0, backend_str)

        import uvicorn
        from app.main import app as fastapi_app

        self.app_port = find_free_port(self.preferred_port, host="0.0.0.0")
        config = uvicorn.Config(
            fastapi_app,
            host="0.0.0.0",
            port=self.app_port,
            log_level="warning",
            access_log=False,
        )
        self.uvicorn_server = uvicorn.Server(config)
        # Prevent uvicorn from installing signal handlers in a non-main thread
        self.uvicorn_server.install_signal_handlers = lambda: None  # type: ignore[method-assign]

        self.server_thread = threading.Thread(
            target=self.uvicorn_server.run,
            name="uvicorn-server",
            daemon=True,
        )
        self.server_thread.start()

        local_url = f"http://127.0.0.1:{self.app_port}"
        _wait_for_http(local_url)
        _write_runtime_info(self.paths, local_url, self.pg.port)

        lan_ip = get_lan_ip()
        logger.info("Application ready at %s (LAN: %s)", local_url, f"http://{lan_ip}:{self.app_port}" if lan_ip else "N/A")
        return local_url

    def shutdown(self) -> None:
        with self._shutdown_lock:
            if self._is_shutting_down:
                return
            self._is_shutting_down = True

        logger.info("Shutting down desktop application...")
        try:
            if self.uvicorn_server is not None:
                self.uvicorn_server.should_exit = True
            if self.server_thread is not None and self.server_thread.is_alive():
                self.server_thread.join(timeout=5)
        except Exception as exc:
            logger.warning("Error stopping HTTP server: %s", exc)

        self.pg.stop()
        self.paths.runtime_file.unlink(missing_ok=True)
        logger.info("Shutdown complete.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Review Test Maker Desktop Launcher")
    parser.add_argument("--no-tray", action="store_true", help="Run without system tray (headless/CLI mode)")
    parser.add_argument("--no-browser", action="store_true", help="Do not auto-open browser on startup")
    parser.add_argument("--smoke-test", action="store_true", help="Start, verify health & DB, then shut down cleanly")
    parser.add_argument("--port", type=int, default=8000, help="Preferred HTTP port (default: 8000)")
    parser.add_argument("--pg-port", type=int, default=54329, help="Preferred PostgreSQL port (default: 54329)")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    args = parser.parse_args(argv)

    paths = resolve_app_paths()
    configure_logging(paths.logs_dir, verbose=args.verbose or args.smoke_test)

    # Single-instance check: focus existing instance instead of launching twice
    existing_url = _check_existing_instance(paths)
    if existing_url and not args.smoke_test:
        logger.info("Existing instance detected at %s; opening browser.", existing_url)
        if not args.no_browser:
            webbrowser.open(existing_url)
        return 0

    desktop_app = DesktopApp(paths, preferred_port=args.port, preferred_pg_port=args.pg_port)
    atexit.register(desktop_app.shutdown)

    def _handle_signal(signum: int, _frame: object) -> None:
        logger.info("Received signal %s; exiting...", signum)
        desktop_app.shutdown()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        local_url = desktop_app.start()
    except Exception as exc:
        logger.exception("Failed to start desktop application")
        desktop_app.shutdown()
        if not args.no_tray and not args.smoke_test:
            show_error_dialog(
                f"{APP_DISPLAY_NAME} 起動エラー",
                f"起動に失敗しました:\n{exc}\n\nログ: {paths.logs_dir / 'desktop.log'}",
            )
        return 1

    if args.smoke_test:
        logger.info("Smoke test passed! Verifying /api/auth/status, /api/groups, / and backup ...")
        with urllib.request.urlopen(f"{local_url}/api/auth/status", timeout=5) as resp:
            assert resp.status == 200, f"Unexpected auth status HTTP {resp.status}"
        with urllib.request.urlopen(f"{local_url}/api/groups", timeout=5) as resp:
            assert resp.status == 200, f"Unexpected groups HTTP {resp.status}"
        with urllib.request.urlopen(f"{local_url}/", timeout=5) as resp:
            assert resp.status == 200, f"Unexpected index HTTP {resp.status}"
        backup_zip = desktop_app.pg.backup()
        assert backup_zip.is_file() and backup_zip.stat().st_size > 0, "Backup zip failed"
        desktop_app.shutdown()
        logger.info("Smoke test completed cleanly.")
        return 0

    if args.no_tray:
        if not args.no_browser:
            webbrowser.open(local_url)
        logger.info("Running in no-tray mode. Press Ctrl+C to stop.")
        try:
            while True:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            desktop_app.shutdown()
        return 0

    try:
        run_tray(
            paths=paths,
            local_url=local_url,
            port=desktop_app.app_port,
            on_backup=desktop_app.pg.backup,
            on_quit=desktop_app.shutdown,
        )
    except Exception:
        logger.exception("System tray failed; falling back to headless server mode.")
        if not args.no_browser:
            webbrowser.open(local_url)
        try:
            while True:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            pass
    finally:
        desktop_app.shutdown()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
