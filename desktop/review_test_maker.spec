# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Review Test Maker (macOS .app & Windows onedir)."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

SPEC_DIR = Path(SPECPATH).resolve()
REPO_ROOT = SPEC_DIR.parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"
ASSETS_DIR = SPEC_DIR / "assets"

if not FRONTEND_DIST.is_dir():
    raise FileNotFoundError(
        f"Frontend build output not found at {FRONTEND_DIST}. "
        "Please run `npm run build` in frontend/ first."
    )

APP_VERSION = os.environ.get("APP_VERSION", "1.0.0").lstrip("v")

datas = [
    (str(FRONTEND_DIST), "static"),
    (str(BACKEND_DIR / "alembic"), "backend/alembic"),
    (str(BACKEND_DIR / "alembic.ini"), "backend"),
]

hiddenimports = [
    # Uvicorn dynamic imports
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    # PostgreSQL / SQLAlchemy / Alembic
    "psycopg",
    "psycopg_binary",
    "sqlalchemy.dialects.postgresql",
    "sqlalchemy.dialects.postgresql.psycopg",
    "alembic",
    "alembic.runtime.migration",
    "alembic.script",
    "alembic.operations",
    # Web / multipart / AI clients
    "multipart",
    "python_multipart",
    "google.genai",
    "openai",
    "httpx",
    # System tray
    "pystray",
]

# Collect all backend application modules
sys.path.insert(0, str(BACKEND_DIR))
hiddenimports += collect_submodules("app")
hiddenimports += collect_submodules("psycopg")
hiddenimports += collect_submodules("psycopg_binary")

if sys.platform == "darwin":
    hiddenimports += ["pystray._darwin", "AppKit", "Foundation", "Quartz"]
elif sys.platform == "win32":
    hiddenimports += ["pystray._win32"]

icon_file = None
if sys.platform == "darwin" and (ASSETS_DIR / "app.icns").is_file():
    icon_file = str(ASSETS_DIR / "app.icns")
elif sys.platform == "win32" and (ASSETS_DIR / "app.ico").is_file():
    icon_file = str(ASSETS_DIR / "app.ico")

a = Analysis(
    [str(SPEC_DIR / "launcher.py")],
    pathex=[str(REPO_ROOT), str(BACKEND_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest", "IPython"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ReviewTestMaker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_file,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="ReviewTestMaker",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="ReviewTestMaker.app",
        icon=icon_file,
        bundle_identifier="app.reviewtestmaker.desktop",
        info_plist={
            "CFBundleName": "ReviewTestMaker",
            "CFBundleDisplayName": "復習テストメーカー",
            "CFBundleShortVersionString": APP_VERSION,
            "CFBundleVersion": APP_VERSION,
            "LSUIElement": True,
            "NSHighResolutionCapable": True,
            "NSLocalNetworkUsageDescription": "同一Wi-Fiのスマートフォンから宿題写真をアップロードするためにローカルネットワークを使用します。",
        },
    )
