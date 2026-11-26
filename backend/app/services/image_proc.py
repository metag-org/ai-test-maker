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
    印刷図版上の赤ペン・青ペン採点跡を除去し、紙面の照明ムラを補正して
    白黒印刷・オンライン表示に適した鮮明な図版に仕上げる（軽量 CPU 処理）。

    ポイント:
    - 彩度＋色差チェックで白平衡ズレによる印刷黒・灰線の誤消去を防止
    - 縮小大カーネル＋紙面明度下限（パーセンタイル）で背景照明を推定し、
      地球・太陽・棒グラフ等の大きな塗りつぶし図形が白抜け（中抜き）する現象を防止
    - 印刷の網点・影（中間グレー）や細線を残しつつ、紙の地色だけを自然に白く整える
    """
    if bgr.size == 0:
        return bgr

    # 1. 赤ペン・青ペン領域のマスクを HSV + チャンネル色差で高精度抽出
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    b_ch = bgr[:, :, 0].astype(np.int16)
    g_ch = bgr[:, :, 1].astype(np.int16)
    r_ch = bgr[:, :, 2].astype(np.int16)

    # 赤色 (H: 0-12, 165-180) かつ彩度十分 かつ R が G/B より明確に高い
    red_hsv = cv2.bitwise_or(
        cv2.inRange(hsv, np.array([0, 65, 55]), np.array([12, 255, 255])),
        cv2.inRange(hsv, np.array([165, 65, 55]), np.array([180, 255, 255])),
    )
    red_diff = ((r_ch - np.maximum(g_ch, b_ch)) >= 28).astype(np.uint8) * 255
    red_mask = cv2.bitwise_and(red_hsv, red_diff)

    # 青色 (H: 98-132) かつ彩度十分 かつ B が R/G より明確に高い
    blue_hsv = cv2.inRange(hsv, np.array([98, 65, 55]), np.array([132, 255, 255]))
    blue_diff = ((b_ch - np.maximum(r_ch, g_ch)) >= 28).astype(np.uint8) * 255
    blue_mask = cv2.bitwise_and(blue_hsv, blue_diff)

    color_mask = cv2.bitwise_or(red_mask, blue_mask)
    if np.count_nonzero(color_mask) > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        color_mask = cv2.dilate(color_mask, kernel, iterations=1)
        bgr = cv2.inpaint(bgr, color_mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

    # 2. グレースケール化 & 大域的な紙面照明の推定（塗りつぶし図形の中抜きを防止）
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]

    # 縮小空間で大きな構造要素のクロージング＋ガウス平滑により低周波の紙面輝度場のみを抽出
    max_small_dim = 160
    scale = min(1.0, max_small_dim / float(max(h, w, 1)))
    sw = max(16, int(round(w * scale)))
    sh = max(16, int(round(h * scale)))
    small_gray = cv2.resize(gray, (sw, sh), interpolation=cv2.INTER_AREA)

    k_small = max(19, int(round(min(sw, sh) * 0.35)) | 1)
    k_small = min(k_small, 61)
    bg_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_small, k_small))
    bg_small = cv2.morphologyEx(small_gray, cv2.MORPH_CLOSE, bg_kernel)
    blur_k = max(15, (k_small // 2) | 1)
    bg_small = cv2.GaussianBlur(bg_small, (blur_k, blur_k), 0)
    background = cv2.resize(bg_small, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)

    # 紙面全体の明るい領域（78パーセンタイル）の 86% を下限とし、大きな黒丸内部で背景が沈むのを防ぐ
    paper_ref = float(np.percentile(gray, 78))
    paper_floor = max(90.0, paper_ref * 0.86)
    background = np.maximum(background, paper_floor)

    normalized = np.clip((gray.astype(np.float32) / background) * 255.0, 0.0, 255.0)

    # 3. 穏やかなコントラスト補正（紙面の微灰だけを白に飛ばし、網点・影・細線を忠実に維持）
    white_point = 236.0
    t = np.clip(normalized / white_point, 0.0, 1.0)
    # 軽いガンマ（1.12）で印刷文字・細線をくっきり保ちつつ中間階調を潰さない
    enhanced = np.clip(np.power(t, 1.12) * 255.0, 0.0, 255.0).astype(np.uint8)
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)


def reclean_cropped_image(
    raw_crop_rel_path: str,
    group_id: str,
    image_id: str,
) -> str:
    """保存済みの原本切り抜き画像（raw_crop_path）から最新の補正アルゴリズムで cleaned 画像を再生成する。"""
    raw_abs = settings.upload_path / raw_crop_rel_path
    if not raw_abs.exists():
        raise FileNotFoundError(f"切り抜き原本画像が見つかりません: {raw_crop_rel_path}")

    with Image.open(raw_abs) as pil_img:
        cropped = pil_img.convert("RGB")

    rel_dir = Path("crops") / str(group_id)
    abs_dir = settings.upload_path / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)

    stamp = uuid.uuid4().hex[:8]
    clean_rel = (rel_dir / f"{image_id}_{stamp}_clean.png").as_posix()

    bgr = cv2.cvtColor(np.array(cropped), cv2.COLOR_RGB2BGR)
    cleaned_bgr = _clean_handwriting_bgr(bgr)
    cleaned_rgb = cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB)
    Image.fromarray(cleaned_rgb).save(settings.upload_path / clean_rel, format="PNG")
    return clean_rel


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


def rotate_crop_box_cw(crop_box: dict[str, Any], angle_cw: int) -> dict[str, int]:
    """画像を時計回りに 90/180/270 度回転したときの 0-1000 正規化座標を返す。"""
    angle = int(angle_cw) % 360
    ymin = int(max(0, min(1000, int(crop_box.get("ymin", 0)))))
    xmin = int(max(0, min(1000, int(crop_box.get("xmin", 0)))))
    ymax = int(max(0, min(1000, int(crop_box.get("ymax", 1000)))))
    xmax = int(max(0, min(1000, int(crop_box.get("xmax", 1000)))))

    if angle == 90:
        return {"ymin": xmin, "xmin": 1000 - ymax, "ymax": xmax, "xmax": 1000 - ymin}
    if angle == 180:
        return {"ymin": 1000 - ymax, "xmin": 1000 - xmax, "ymax": 1000 - ymin, "xmax": 1000 - xmin}
    if angle == 270:
        return {"ymin": 1000 - xmax, "xmin": ymin, "ymax": 1000 - xmin, "xmax": ymax}
    return {"ymin": ymin, "xmin": xmin, "ymax": ymax, "xmax": xmax}


def _pil_rotate_cw(img: Image.Image, angle_cw: int) -> Image.Image:
    angle = int(angle_cw) % 360
    if angle == 90:
        return img.transpose(Image.Transpose.ROTATE_270)
    if angle == 180:
        return img.transpose(Image.Transpose.ROTATE_180)
    if angle == 270:
        return img.transpose(Image.Transpose.ROTATE_90)
    return img


def rotate_source_image_cw(source_rel_path: str, angle_cw: int) -> str:
    """原本画像を時計回りに回転し、キャッシュ回避用の新しいファイルとして保存する。"""
    angle = int(angle_cw) % 360
    if angle == 0:
        return source_rel_path
    src_abs = settings.upload_path / source_rel_path
    if not src_abs.exists():
        raise FileNotFoundError(f"原本画像が見つかりません: {source_rel_path}")

    with Image.open(src_abs) as pil_img:
        rotated = _pil_rotate_cw(pil_img.convert("RGB"), angle)

    rel_dir = Path("sources")
    abs_dir = settings.upload_path / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)
    new_rel = (rel_dir / f"{uuid.uuid4().hex}.jpg").as_posix()
    rotated.save(settings.upload_path / new_rel, format="JPEG", quality=92, optimize=True)
    return new_rel


def rotate_cropped_pair_cw(
    raw_rel_path: str,
    clean_rel_path: str,
    group_id: str,
    image_id: str,
    angle_cw: int,
) -> tuple[str, str]:
    """切り抜き原本と補正後画像のペアを時計回りに回転して新規保存する。"""
    angle = int(angle_cw) % 360
    if angle == 0:
        return raw_rel_path, clean_rel_path

    raw_abs = settings.upload_path / raw_rel_path
    clean_abs = settings.upload_path / clean_rel_path
    if not raw_abs.exists():
        raise FileNotFoundError(f"切り抜き原本画像が見つかりません: {raw_rel_path}")

    rel_dir = Path("crops") / str(group_id)
    abs_dir = settings.upload_path / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)
    stamp = uuid.uuid4().hex[:8]
    new_raw_rel = (rel_dir / f"{image_id}_{stamp}_raw.png").as_posix()
    new_clean_rel = (rel_dir / f"{image_id}_{stamp}_clean.png").as_posix()

    with Image.open(raw_abs) as raw_im:
        rot_raw = _pil_rotate_cw(raw_im.convert("RGB"), angle)
        rot_raw.save(settings.upload_path / new_raw_rel, format="PNG")

    if clean_abs.exists():
        with Image.open(clean_abs) as clean_im:
            rot_clean = _pil_rotate_cw(clean_im.convert("RGB"), angle)
            rot_clean.save(settings.upload_path / new_clean_rel, format="PNG")
    else:
        bgr = cv2.cvtColor(np.array(rot_raw), cv2.COLOR_RGB2BGR)
        cleaned_rgb = cv2.cvtColor(_clean_handwriting_bgr(bgr), cv2.COLOR_BGR2RGB)
        Image.fromarray(cleaned_rgb).save(settings.upload_path / new_clean_rel, format="PNG")

    return new_raw_rel, new_clean_rel
