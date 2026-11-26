import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.image_proc import _clean_handwriting_bgr, rotate_crop_box_cw


class ImageCleanTests(unittest.TestCase):
    def test_preserves_solid_dark_shapes_and_shading_while_removing_red_pen(self):
        # 500x500 の照明ムラ付き紙面画像を合成（左が暗め165、右が明るめ225）
        h, w = 500, 500
        x_grad = np.linspace(165, 225, w, dtype=np.float32)
        bg = np.tile(x_grad, (h, 1)).astype(np.uint8)
        bgr = cv2.cvtColor(bg, cv2.COLOR_GRAY2BGR)

        # 1. 大きな塗りつぶし黒丸（地球・太陽などを想定：半径 65px）
        cv2.circle(bgr, (160, 250), 65, (35, 35, 35), thickness=-1)

        # 2. 網点・夜半球的グレー領域（輝度 125、半径 55px）
        cv2.circle(bgr, (340, 250), 55, (125, 125, 125), thickness=-1)

        # 3. 細い印刷線
        cv2.line(bgr, (80, 420), (420, 420), (45, 45, 45), thickness=2)

        # 4. 赤ペン採点マーク（B=25, G=25, R=220）
        cv2.line(bgr, (60, 80), (220, 80), (25, 25, 220), thickness=4)

        cleaned = _clean_handwriting_bgr(bgr)
        gray_out = cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY)

        # 黒丸の中心が白抜け（中抜き）せず濃い黒を保っていること
        dark_center_mean = float(gray_out[235:265, 145:175].mean())
        self.assertLess(dark_center_mean, 70.0, f"Solid dark circle was hollowed out! mean={dark_center_mean}")

        # グレー領域の階調が白飛びせず残っていること
        shade_center_mean = float(gray_out[235:265, 325:355].mean())
        self.assertGreater(shade_center_mean, 80.0)
        self.assertLess(shade_center_mean, 200.0, f"Gray shading was washed out! mean={shade_center_mean}")

        # 暗い側（左端）の紙面がきちんと白く均一化されていること
        left_paper_mean = float(gray_out[20:50, 20:50].mean())
        self.assertGreater(left_paper_mean, 235.0, f"Uneven paper lighting not normalized: {left_paper_mean}")

        # 赤ペン跡が紙面並みに消去されていること
        red_line_mean = float(gray_out[79:82, 80:200].mean())
        self.assertGreater(red_line_mean, 225.0, f"Red pen mark remained visible: {red_line_mean}")

    def test_rotate_crop_box_cw_exact_coordinates(self):
        box = {"ymin": 100, "xmin": 800, "ymax": 400, "xmax": 900}
        # 反時計回り90度 (= 時計回り270度) で右端の領域が上端へ移動すること
        rot270 = rotate_crop_box_cw(box, 270)
        self.assertEqual(rot270, {"ymin": 100, "xmin": 100, "ymax": 200, "xmax": 400})

        # 時計回り90度を4回で元の座標へ完全復帰すること
        cur = dict(box)
        for _ in range(4):
            cur = rotate_crop_box_cw(cur, 90)
        self.assertEqual(cur, box)


if __name__ == "__main__":
    unittest.main()
