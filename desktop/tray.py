"""System tray controller and desktop UX helpers (macOS & Windows)."""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import sys
import webbrowser
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw

from desktop.paths import APP_DISPLAY_NAME, AppPaths

logger = logging.getLogger("desktop.tray")


def get_lan_ip() -> str | None:
    """Best-effort LAN IP detection for smartphone camera uploads on the same Wi-Fi."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 80))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass
    try:
        ip = socket.gethostbyname(socket.gethostname())
        if ip and not ip.startswith("127."):
            return ip
    except OSError:
        pass
    return None


def open_path_in_os(target: Path) -> None:
    target = target.resolve()
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        elif sys.platform == "win32":
            os.startfile(str(target))  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", str(target)])
    except Exception as exc:
        logger.warning("Failed to open path %s: %s", target, exc)


def show_error_dialog(title: str, message: str) -> None:
    """Display a native error dialog without requiring tkinter."""
    logger.error("%s: %s", title, message)
    try:
        if sys.platform == "win32":
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, message, title, 0x10)
            return
        if sys.platform == "darwin":
            escaped_msg = message.replace("\\", "\\\\").replace('"', '\\"')
            escaped_title = title.replace("\\", "\\\\").replace('"', '\\"')
            subprocess.run(
                [
                    "osascript",
                    "-e",
                    f'display dialog "{escaped_msg}" with title "{escaped_title}" buttons {{"OK"}} default button "OK" with icon stop',
                ],
                check=False,
                timeout=15,
            )
            return
    except Exception:
        pass


def _load_tray_icon(paths: AppPaths) -> Image.Image:
    candidates = [
        paths.static_dir / "apple-touch-icon.png",
        paths.static_dir / "icon-512.png",
        paths.bundle_dir / "frontend" / "public" / "apple-touch-icon.png",
    ]
    for candidate in candidates:
        if candidate.is_file():
            try:
                return Image.open(candidate).convert("RGBA").resize((64, 64))
            except Exception:
                continue

    # Fallback generated icon
    img = Image.new("RGBA", (64, 64), (79, 70, 229, 255))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((10, 8, 54, 56), radius=8, fill=(255, 255, 255, 255))
    draw.rectangle((18, 18, 46, 24), fill=(225, 29, 72, 255))
    draw.rectangle((18, 30, 42, 36), fill=(99, 102, 241, 255))
    draw.rectangle((18, 42, 38, 48), fill=(148, 163, 184, 255))
    return img


def run_tray(
    paths: AppPaths,
    local_url: str,
    port: int,
    on_backup: Callable[[], Path],
    on_quit: Callable[[], None],
) -> None:
    """Run the system tray icon on the main thread (blocks until quit)."""
    import pystray

    lan_ip = get_lan_ip()
    lan_url = f"http://{lan_ip}:{port}" if lan_ip else None

    def _open_browser(_icon: pystray.Icon, _item: pystray.MenuItem) -> None:
        webbrowser.open(local_url)

    def _open_lan(_icon: pystray.Icon, _item: pystray.MenuItem) -> None:
        if lan_url:
            webbrowser.open(lan_url)

    def _open_data(_icon: pystray.Icon, _item: pystray.MenuItem) -> None:
        open_path_in_os(paths.data_root)

    def _open_logs(_icon: pystray.Icon, _item: pystray.MenuItem) -> None:
        open_path_in_os(paths.logs_dir)

    def _do_backup(icon: pystray.Icon, _item: pystray.MenuItem) -> None:
        try:
            backup_path = on_backup()
            open_path_in_os(backup_path.parent)
            try:
                icon.notify(f"バックアップ保存完了: {backup_path.name}", APP_DISPLAY_NAME)
            except Exception:
                pass
        except Exception as exc:
            show_error_dialog(f"{APP_DISPLAY_NAME} バックアップ失敗", str(exc))

    def _do_quit(icon: pystray.Icon, _item: pystray.MenuItem) -> None:
        icon.stop()
        on_quit()

    menu_items = [
        pystray.MenuItem(f"ブラウザで開く ({local_url})", _open_browser, default=True),
    ]
    if lan_url:
        menu_items.append(pystray.MenuItem(f"スマホ接続 (同一Wi-Fi): {lan_url}", _open_lan))
    menu_items.extend(
        [
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("データ一括バックアップ (.zip)", _do_backup),
            pystray.MenuItem("データフォルダを開く", _open_data),
            pystray.MenuItem("ログフォルダを開く", _open_logs),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("終了", _do_quit),
        ]
    )

    icon = pystray.Icon(
        name="ReviewTestMaker",
        icon=_load_tray_icon(paths),
        title=f"{APP_DISPLAY_NAME} ({local_url})",
        menu=pystray.Menu(*menu_items),
    )

    def _setup(tray_icon: pystray.Icon) -> None:
        tray_icon.visible = True
        webbrowser.open(local_url)

    icon.run(setup=_setup)
