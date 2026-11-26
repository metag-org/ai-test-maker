"""Cross-platform path resolution for the Review Test Maker desktop app."""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

APP_NAME = "ReviewTestMaker"
APP_DISPLAY_NAME = "復習テストメーカー"
DB_NAME = "review_test"
DB_USER = "testmaker"


@dataclass(frozen=True)
class AppPaths:
    bundle_dir: Path
    backend_dir: Path
    static_dir: Path
    postgres_dir: Path
    alembic_ini: Path
    alembic_dir: Path
    data_root: Path
    pgdata_dir: Path
    pg_socket_dir: Path
    uploads_dir: Path
    backups_dir: Path
    logs_dir: Path
    runtime_file: Path


def _get_windows_short_path(path: Path) -> Path:
    """Return Windows 8.3 short path (ASCII-safe) if supported by the filesystem."""
    if sys.platform != "win32":
        return path
    try:
        import ctypes

        path.mkdir(parents=True, exist_ok=True)
        buf = ctypes.create_unicode_buffer(1024)
        res = ctypes.windll.kernel32.GetShortPathNameW(str(path), buf, len(buf))
        if res and res < len(buf):
            return Path(buf.value)
    except Exception:
        pass
    return path


def _is_ascii(text: str) -> bool:
    try:
        text.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def resolve_bundle_dir() -> Path:
    """Return the root directory containing bundled resources (PyInstaller or dev)."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()
    return Path(__file__).resolve().parent.parent


def resolve_data_root() -> Path:
    """Return a persistent, user-writable data directory outside the install folder."""
    override = os.environ.get("REVIEW_TEST_DATA_ROOT", "").strip()
    if override:
        root = Path(override).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        return root

    if sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support" / APP_NAME
    elif sys.platform == "win32":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            root = Path(local_app_data) / APP_NAME
        else:
            root = Path.home() / "AppData" / "Local" / APP_NAME
    else:
        xdg = os.environ.get("XDG_DATA_HOME")
        root = (Path(xdg) if xdg else Path.home() / ".local" / "share") / APP_NAME

    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_pgdata_dir(data_root: Path) -> Path:
    """Return an ASCII-safe PGDATA path on Windows to prevent initdb locale issues."""
    candidate = data_root / "pgdata"
    if sys.platform != "win32" or _is_ascii(str(candidate)):
        return candidate

    short_root = _get_windows_short_path(data_root)
    if _is_ascii(str(short_root)):
        return short_root / "pgdata"

    # Fallback when 8.3 short paths are disabled and Windows username is non-ASCII
    user_key = hashlib.sha256(str(data_root).lower().encode("utf-8")).hexdigest()[:10]
    program_data = Path(os.environ.get("PROGRAMDATA", "C:\\ProgramData"))
    fallback = program_data / APP_NAME / f"u_{user_key}" / "pgdata"
    fallback.parent.mkdir(parents=True, exist_ok=True)
    return fallback


def resolve_postgres_dir(bundle_dir: Path) -> Path:
    """Locate the bundled portable PostgreSQL runtime directory."""
    env_override = os.environ.get("REVIEW_TEST_POSTGRES_DIR", "").strip()
    if env_override:
        return Path(env_override).expanduser().resolve()

    exe_dir = Path(sys.executable).resolve().parent
    candidates = [
        # macOS .app bundle: Contents/MacOS/ReviewTestMaker -> Contents/Resources/runtime/postgres
        exe_dir.parent / "Resources" / "runtime" / "postgres",
        # Windows / Linux onedir: <app_dir>/runtime/postgres
        exe_dir / "runtime" / "postgres",
        # PyInstaller _MEIPASS fallback
        bundle_dir / "runtime" / "postgres",
        # Local development tree
        bundle_dir / "desktop" / "runtime" / "postgres",
    ]
    for candidate in candidates:
        if (candidate / "bin").is_dir():
            return candidate
    return candidates[0]


def resolve_app_paths() -> AppPaths:
    bundle_dir = resolve_bundle_dir()
    is_frozen = getattr(sys, "frozen", False)

    if is_frozen:
        backend_dir = bundle_dir / "backend"
        static_dir = bundle_dir / "static"
    else:
        backend_dir = bundle_dir / "backend"
        static_dir = bundle_dir / "frontend" / "dist"
        if not static_dir.is_dir():
            static_dir = bundle_dir / "static"

    data_root = resolve_data_root()
    pgdata_dir = resolve_pgdata_dir(data_root)
    uploads_dir = data_root / "uploads"
    backups_dir = data_root / "backups"
    logs_dir = data_root / "logs"

    for directory in (data_root, uploads_dir, backups_dir, logs_dir):
        directory.mkdir(parents=True, exist_ok=True)

    # Keep Unix domain socket path short (macOS has a 104-byte sun_path limit)
    if sys.platform == "win32":
        pg_socket_dir = data_root
    else:
        uid = os.getuid() if hasattr(os, "getuid") else 0
        pg_socket_dir = Path(tempfile.gettempdir()) / f"rtm-pg-{uid}"
        pg_socket_dir.mkdir(parents=True, exist_ok=True)

    return AppPaths(
        bundle_dir=bundle_dir,
        backend_dir=backend_dir,
        static_dir=static_dir,
        postgres_dir=resolve_postgres_dir(bundle_dir),
        alembic_ini=backend_dir / "alembic.ini",
        alembic_dir=backend_dir / "alembic",
        data_root=data_root,
        pgdata_dir=pgdata_dir,
        pg_socket_dir=pg_socket_dir,
        uploads_dir=uploads_dir,
        backups_dir=backups_dir,
        logs_dir=logs_dir,
        runtime_file=data_root / "runtime.json",
    )
