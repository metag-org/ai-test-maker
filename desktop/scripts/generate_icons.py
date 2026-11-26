#!/usr/bin/env python3
"""Generate desktop application icons (.ico for Windows, .icns for macOS) from icon-512.png."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SOURCE_PNG = REPO_ROOT / "frontend" / "public" / "icon-512.png"
ASSETS_DIR = REPO_ROOT / "desktop" / "assets"


def generate_ico(img: Image.Image, dest: Path) -> None:
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(dest, format="ICO", sizes=sizes)
    print(f"Generated Windows icon: {dest}")


def generate_icns(img: Image.Image, dest: Path) -> None:
    if sys.platform == "darwin" and shutil.which("iconutil"):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = Path(tmp) / "app.iconset"
            iconset.mkdir()
            spec = [
                ("icon_16x16.png", 16),
                ("icon_16x16@2x.png", 32),
                ("icon_32x32.png", 32),
                ("icon_32x32@2x.png", 64),
                ("icon_128x128.png", 128),
                ("icon_128x128@2x.png", 256),
                ("icon_256x256.png", 256),
                ("icon_256x256@2x.png", 512),
                ("icon_512x512.png", 512),
                ("icon_512x512@2x.png", 1024),
            ]
            for filename, size in spec:
                resized = img.resize((size, size), Image.Resampling.LANCZOS)
                resized.save(iconset / filename, format="PNG")
            subprocess.run(
                ["iconutil", "-c", "icns", str(iconset), "-o", str(dest)],
                check=True,
            )
            print(f"Generated macOS icon (iconutil): {dest}")
            return

    # Cross-platform fallback via Pillow
    img.save(dest, format="ICNS")
    print(f"Generated macOS icon (Pillow): {dest}")


def main() -> int:
    if not SOURCE_PNG.is_file():
        raise FileNotFoundError(f"Source icon not found: {SOURCE_PNG}")

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    img = Image.open(SOURCE_PNG).convert("RGBA")
    generate_ico(img, ASSETS_DIR / "app.ico")
    generate_icns(img, ASSETS_DIR / "app.icns")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
