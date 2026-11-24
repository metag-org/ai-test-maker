import io
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps

from app.config import settings

MAX_SOURCE_DIMENSION = 2400


def save_source_image(file_bytes: bytes, original_filename: str = "upload.jpg") -> str:
    """EXIF補正・リサイズした原本画像を保存し、uploads 基準の相対パスを返す。"""
    img = Image.open(io.BytesIO(file_bytes))
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")

    w, h = img.size
    if max(w, h) > MAX_SOURCE_DIMENSION:
        scale = MAX_SOURCE_DIMENSION / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

    rel_dir = Path("sources")
    abs_dir = settings.upload_path / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)

    file_name = f"{uuid.uuid4().hex}.jpg"
    rel_path = (rel_dir / file_name).as_posix()
    abs_path = settings.upload_path / rel_path
    img.save(abs_path, format="JPEG", quality=92, optimize=True)
    return rel_path


def _clean_handwriting_bgr(bgr: np.ndarray) -> np.ndarray:
    """
    印刷図版上の赤ペン・青ペン採点跡を除去し、薄い鉛筆跡を淡色化して
    白黒印刷に適した鮮明な図版に補正する（軽量 CPU 処理）。
    """
    if bgr.size == 0:
        return bgr

    # 1. 赤ペン・青ペン領域のマスクを HSV 空間で抽出
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    # 赤色 (H: 0-14, 162-180)
    red_mask1 = cv2.inRange(hsv, np.array([0, 42, 40]), np.array([14, 255, 255]))
    red_mask2 = cv2.inRange(hsv, np.array([162, 42, 40]), np.array([180, 255, 255]))
    # 青色 (H: 95-138)
    blue_mask = cv2.inRange(hsv, np.array([95, 45, 40]), np.array([138, 255, 255]))

    color_mask = cv2.bitwise_or(cv2.bitwise_or(red_mask1, red_mask2), blue_mask)
    if np.count_nonzero(color_mask) > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        color_mask = cv2.dilate(color_mask, kernel, iterations=1)
        bgr = cv2.inpaint(bgr, color_mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

    # 2. グレースケール化 & 照明ムラ補正（背景正規化）
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    k_size = max(21, (min(h, w) // 12) | 1)
    k_size = min(k_size, 71)
    bg_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, bg_kernel)
    background = np.maximum(background, 1)
    normalized = np.clip((gray.astype(np.float32) / background.astype(np.float32)) * 255.0, 0, 255).astype(np.uint8)

    # 3. 薄い鉛筆跡（高明度グレー）を白側へ押し上げ、濃い印刷線を鮮明化
    # 210以上 -> 255、130以下 -> コントラスト強化、中間は滑らかに遷移
    lut = np.zeros(256, dtype=np.uint8)
    for i in range(256):
        if i >= 212:
            lut[i] = 255
        elif i <= 110:
            lut[i] = int(max(0, i * 0.82))
        else:
            # 110..212 -> 90..255 に滑らかマッピング
            t = (i - 110) / (212 - 110)
            lut[i] = int(min(255, 90 + (t ** 0.85) * (255 - 90)))
    cleaned = cv2.LUT(normalized, lut)
    return cv2.cvtColor(cleaned, cv2.COLOR_GRAY2BGR)


def crop_and_clean_image(
    source_rel_path: str,
    crop_box: dict[str, Any],
    group_id: str,
    image_id: str,
) -> tuple[str, str, dict[str, int]]:
    """
    0〜1000 正規化座標 [ymin, xmin, ymax, xmax] で原本画像を切り出し、
    原本切り抜きと手書き除去補正版の2ファイルを保存する。
    """
    source_abs = settings.upload_path / source_rel_path
    if not source_abs.exists():
        raise FileNotFoundError(f"原本画像が見つかりません: {source_rel_path}")

    with Image.open(source_abs) as pil_img:
        img_rgb = pil_img.convert("RGB")
        w, h = img_rgb.size

        ymin = int(max(0, min(999, int(crop_box.get("ymin", 0)))))
        xmin = int(max(0, min(999, int(crop_box.get("xmin", 0)))))
        ymax = int(max(ymin + 1, min(1000, int(crop_box.get("ymax", 1000)))))
        xmax = int(max(xmin + 1, min(1000, int(crop_box.get("xmax", 1000)))))

        left = int(round(xmin / 1000.0 * w))
        top = int(round(ymin / 1000.0 * h))
        right = int(round(xmax / 1000.0 * w))
        bottom = int(round(ymax / 1000.0 * h))

        right = max(left + 4, min(w, right))
        bottom = max(top + 4, min(h, bottom))

        cropped = img_rgb.crop((left, top, right, bottom))

    rel_dir = Path("crops") / str(group_id)
    abs_dir = settings.upload_path / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)

    stamp = uuid.uuid4().hex[:8]
    raw_rel = (rel_dir / f"{image_id}_{stamp}_raw.png").as_posix()
    clean_rel = (rel_dir / f"{image_id}_{stamp}_clean.png").as_posix()

    cropped.save(settings.upload_path / raw_rel, format="PNG")

    bgr = cv2.cvtColor(np.array(cropped), cv2.COLOR_RGB2BGR)
    cleaned_bgr = _clean_handwriting_bgr(bgr)
    cleaned_rgb = cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB)
    Image.fromarray(cleaned_rgb).save(settings.upload_path / clean_rel, format="PNG")

    normalized_box = {"ymin": ymin, "xmin": xmin, "ymax": ymax, "xmax": xmax}
    return raw_rel, clean_rel, normalized_box


def delete_upload_file(rel_path: str | None) -> None:
    if not rel_path:
        return
    try:
        target = (settings.upload_path / rel_path).resolve()
        if settings.upload_path in target.parents and target.exists():
            target.unlink(missing_ok=True)
    except Exception:
        pass
