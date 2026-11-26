import base64
import io
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.models.exam import ExamAnswer, ExamSubmission
from app.models.question import Question, QuestionGroup
from app.services.grading import (
    build_handwriting_collage,
    evaluate_choice_answer,
    evaluate_kanji_read_answer,
    evaluate_kanji_write_answer,
    grade_submission,
    record_group_llm_usage,
    save_handwriting_image,
    try_exact_text_match,
)
from app.services.llm.schema import BlindOcrItem, BlindOcrResult, SemanticGradeItem, SemanticGradeResult


def _make_png_data_url() -> str:
    img = Image.new("RGBA", (120, 60), (255, 255, 255, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _make_question(
    qtype: str,
    body: str = "設問",
    manual_answer: str | None = None,
    aliases: list[str] | None = None,
    grading_note: str = "",
) -> Question:
    return Question(
        id=uuid.uuid4(),
        group_id=uuid.uuid4(),
        sort_order=0,
        question_type=qtype,
        body=body,
        options=[],
        answer_box_config={"type": "kanji_grid", "cells": 2},
        manual_answer=manual_answer,
        answer_aliases=aliases or [],
        grading_note=grading_note,
        memo="",
    )


class GradingServiceTests(unittest.TestCase):
    def test_choice_evaluation(self):
        q_single = _make_question("single_choice", manual_answer="ア")
        self.assertEqual(evaluate_choice_answer(["ア"], q_single)[0], "correct")
        self.assertEqual(evaluate_choice_answer(["イ"], q_single)[0], "wrong")
        self.assertEqual(evaluate_choice_answer([], q_single)[0], "unanswered")

        q_multi = _make_question("multi_choice", manual_answer="ア、ウ")
        self.assertEqual(evaluate_choice_answer(["ウ", "ア"], q_multi)[0], "correct")
        self.assertEqual(evaluate_choice_answer(["ア"], q_multi)[0], "wrong")

        q_nokey = _make_question("single_choice", manual_answer=None)
        status, _, final_wrong = evaluate_choice_answer(["ア"], q_nokey)
        self.assertEqual(status, "no_key")
        self.assertIsNone(final_wrong)

    def test_kanji_write_evaluation_guards_against_stroke_defects(self):
        q = _make_question("kanji_write", body="==ヤクソク==を守る。", manual_answer="約束")
        # 正確＆高確信度 -> correct
        st, _, fw = evaluate_kanji_write_answer("約束", q, 0.95, "")
        self.assertEqual(st, "correct")
        self.assertFalse(fw)

        # 文字は一致しているが画数不足の指摘あり -> uncertain（保護者確認へ）
        st, _, fw = evaluate_kanji_write_answer("約束", q, 0.92, "約の糸へんが1画不足の疑い")
        self.assertEqual(st, "uncertain")
        self.assertIsNone(fw)

        # 低確信度 -> uncertain
        st, _, fw = evaluate_kanji_write_answer("約束", q, 0.65, "")
        self.assertEqual(st, "uncertain")
        self.assertIsNone(fw)

        # 誤字 -> wrong
        st, _, fw = evaluate_kanji_write_answer("約東", q, 0.91, "")
        self.assertEqual(st, "wrong")
        self.assertTrue(fw)

    def test_kanji_read_and_exact_match(self):
        q_read = _make_question("kanji_read", manual_answer="つうか")
        self.assertEqual(evaluate_kanji_read_answer("ツウカ", q_read, 0.95)[0], "correct")

        q_read_strict = _make_question("kanji_read", manual_answer="ツウカ", grading_note="カタカナ指定")
        self.assertEqual(evaluate_kanji_read_answer("つうか", q_read_strict, 0.95)[0], "wrong")
        self.assertEqual(evaluate_kanji_read_answer("ツウカ", q_read_strict, 0.95)[0], "correct")

        q_short = _make_question("short_answer", manual_answer="光合成", aliases=["こうごうせい"])
        self.assertTrue(try_exact_text_match("こうごうせい", q_short))

        q_kanji_only = _make_question("short_answer", body="漢字で書きなさい。", manual_answer="光合成")
        self.assertFalse(try_exact_text_match("こうごうせい", q_kanji_only))

    def test_two_stage_blind_ocr_prompt_excludes_question_and_key(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            old_data_dir = settings.data_dir
            settings.data_dir = tmpdir
            try:
                sub_id = uuid.uuid4()
                q_kanji = _make_question(
                    "kanji_write",
                    body="秘密の設問文==ヤクソク==を守る。",
                    manual_answer="約束",
                )
                q_desc = _make_question(
                    "short_answer",
                    body="植物が日光ででんぷんを作るはたらきは？",
                    manual_answer="光合成",
                )
                q_choice = _make_question("single_choice", body="正しいものを選べ。", manual_answer="イ")

                item1, item2, item3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
                rel1 = save_handwriting_image(sub_id, item1, _make_png_data_url())
                rel2 = save_handwriting_image(sub_id, item2, _make_png_data_url())

                # コラージュ生成チェック
                collage = build_handwriting_collage(
                    [(1, Path(tmpdir) / rel1), (2, Path(tmpdir) / rel2)]
                )
                self.assertGreater(len(collage), 100)

                sub = ExamSubmission(id=sub_id, exam_id=uuid.uuid4(), attempt_number=1, mode="full")
                a1 = ExamAnswer(
                    id=uuid.uuid4(),
                    submission_id=sub_id,
                    exam_item_id=item1,
                    question_id=q_kanji.id,
                    input_mode="handwriting",
                    strokes_data={"mode": "kanji_grid", "cells": [[{"points": [{"x": 1, "y": 1}], "size": 6}]]},
                    handwriting_image_path=rel1,
                )
                a2 = ExamAnswer(
                    id=uuid.uuid4(),
                    submission_id=sub_id,
                    exam_item_id=item2,
                    question_id=q_desc.id,
                    input_mode="handwriting",
                    strokes_data={"mode": "freehand", "strokes": [{"points": [{"x": 2, "y": 2}], "size": 6}]},
                    handwriting_image_path=rel2,
                )
                a3 = ExamAnswer(
                    id=uuid.uuid4(),
                    submission_id=sub_id,
                    exam_item_id=item3,
                    question_id=q_choice.id,
                    input_mode="choice",
                    selected_options=["イ"],
                )
                sub.answers = [a1, a2, a3]

                captured_prompts: list[tuple[str, str]] = []

                def fake_llm(db, prompt, schema_cls, images=None, temperature=0.1):
                    captured_prompts.append((schema_cls.__name__, prompt))
                    if schema_cls is BlindOcrResult:
                        return (
                            BlindOcrResult(
                                items=[
                                    BlindOcrItem(item_index=1, recognized_text="約束", confidence=0.95, stroke_issues=""),
                                    BlindOcrItem(item_index=2, recognized_text="日光で栄養をつくる作用", confidence=0.90, stroke_issues=""),
                                ]
                            ),
                            {
                                "provider": "gemini",
                                "model": "gemini-2.5-flash",
                                "input_tokens": 1100,
                                "output_tokens": 220,
                                "thoughts_tokens": 0,
                                "total_tokens": 1320,
                            },
                        )
                    if schema_cls is SemanticGradeResult:
                        return (
                            SemanticGradeResult(
                                items=[
                                    SemanticGradeItem(item_index=1, status="partial", feedback="用語名「光合成」で答えましょう。")
                                ]
                            ),
                            {
                                "provider": "gemini",
                                "model": "gemini-2.5-flash",
                                "input_tokens": 300,
                                "output_tokens": 80,
                                "thoughts_tokens": 0,
                                "total_tokens": 380,
                            },
                        )
                    raise AssertionError(f"Unexpected schema: {schema_cls}")

                with patch("app.services.grading.run_structured_llm_with_usage", side_effect=fake_llm):
                    grade_submission(
                        db=None,  # type: ignore[arg-type]
                        submission=sub,
                        question_map={q_kanji.id: q_kanji, q_desc.id: q_desc, q_choice.id: q_choice},
                    )

                # Stage 1 (BlindOcrResult) のプロンプトに問題文や模範解答が一切漏れていないことを検証
                blind_calls = [p for name, p in captured_prompts if name == "BlindOcrResult"]
                self.assertEqual(len(blind_calls), 1)
                self.assertNotIn("秘密の設問文", blind_calls[0])
                self.assertNotIn("約束", blind_calls[0])
                self.assertNotIn("光合成", blind_calls[0])

                # 集計検証: a1(○), a2(partial->未確定), a3(○)
                self.assertEqual(a1.ai_status, "correct")
                self.assertFalse(a1.final_is_wrong)
                self.assertEqual(a2.ai_status, "partial")
                self.assertIsNone(a2.final_is_wrong)
                self.assertEqual(a3.ai_status, "correct")
                self.assertFalse(a3.final_is_wrong)
                self.assertEqual(sub.correct_count, 2)
                self.assertEqual(sub.uncertain_count, 1)
                self.assertEqual(sub.wrong_count, 0)

                # LLM トークン消費統計検証
                self.assertEqual(sub.llm_usage["model"], "gemini-2.5-flash")
                self.assertEqual(sub.llm_usage["ocr"]["input_tokens"], 1100)
                self.assertEqual(sub.llm_usage["ocr"]["output_tokens"], 220)
                self.assertEqual(sub.llm_usage["semantic"]["input_tokens"], 300)
                self.assertEqual(sub.llm_usage["semantic"]["output_tokens"], 80)
                self.assertEqual(sub.llm_usage["total_input_tokens"], 1400)
                self.assertEqual(sub.llm_usage["total_output_tokens"], 300)
                self.assertEqual(sub.llm_usage["total_tokens"], 1700)
            finally:
                settings.data_dir = old_data_dir

    def test_regrade_reuses_ocr_without_calling_blind_ocr_again(self):
        q_read = _make_question("kanji_read", body="電車が==通過==する。", manual_answer=None)
        sub = ExamSubmission(
            id=uuid.uuid4(),
            exam_id=uuid.uuid4(),
            attempt_number=1,
            mode="full",
            llm_usage={
                "provider": "gemini",
                "model": "gemini-2.5-flash",
                "ocr": {"calls": 1, "input_tokens": 900, "output_tokens": 150, "thoughts_tokens": 0, "total_tokens": 1050},
                "semantic": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "thoughts_tokens": 0, "total_tokens": 0},
                "total_input_tokens": 900,
                "total_output_tokens": 150,
                "total_thoughts_tokens": 0,
                "total_tokens": 1050,
            },
        )
        ans = ExamAnswer(
            id=uuid.uuid4(),
            submission_id=sub.id,
            exam_item_id=uuid.uuid4(),
            question_id=q_read.id,
            input_mode="handwriting",
            recognized_text="つうか",
            ai_confidence=0.95,
            ai_status="no_key",
            ai_feedback="模範解答が未登録です。",
            final_is_wrong=None,
        )
        sub.answers = [ans]

        # 提出後に模範解答を追加して rerun_ocr=False で再採点
        q_read.manual_answer = "つうか"
        with patch("app.services.grading.run_structured_llm_with_usage") as mock_llm:
            grade_submission(
                db=None,  # type: ignore[arg-type]
                submission=sub,
                question_map={q_read.id: q_read},
                rerun_ocr=False,
            )
            mock_llm.assert_not_called()

        self.assertEqual(ans.ai_status, "correct")
        self.assertFalse(ans.final_is_wrong)
        self.assertEqual(sub.correct_count, 1)
        self.assertEqual(sub.uncertain_count, 0)
        # 既存の OCR トークン消費が保持されること
        self.assertEqual(sub.llm_usage["ocr"]["total_tokens"], 1050)
        self.assertEqual(sub.llm_usage["total_tokens"], 1050)

    def test_record_group_llm_usage_accumulates_extract_and_answer_stages(self):
        grp = QuestionGroup(id=uuid.uuid4(), subject="rika", llm_usage={})
        # 1. 画像アップロードから問題抽出（1枚の画像から2大問抽出）
        record_group_llm_usage(
            grp,
            "extract",
            {
                "provider": "gemini",
                "model": "gemini-2.5-flash",
                "input_tokens": 2000,
                "output_tokens": 500,
                "thoughts_tokens": 100,
                "total_tokens": 2600,
            },
            shared_groups=2,
        )
        # 2. AIによる模範解答候補下書き生成
        record_group_llm_usage(
            grp,
            "answer_suggest",
            {
                "provider": "gemini",
                "model": "gemini-2.5-flash",
                "input_tokens": 400,
                "output_tokens": 180,
                "thoughts_tokens": 0,
                "total_tokens": 580,
            },
        )
        # 3. 解答写真から取込
        record_group_llm_usage(
            grp,
            "answer_image",
            {
                "provider": "gemini",
                "model": "gemini-2.5-flash",
                "input_tokens": 1500,
                "output_tokens": 220,
                "thoughts_tokens": 0,
                "total_tokens": 1720,
            },
        )

        u = grp.llm_usage
        self.assertEqual(u["model"], "gemini-2.5-flash")
        self.assertEqual(u["extract"]["shared_groups"], 2)
        self.assertEqual(u["extract"]["total_tokens"], 2600)
        self.assertEqual(u["answer_suggest"]["total_tokens"], 580)
        self.assertEqual(u["answer_image"]["total_tokens"], 1720)
        self.assertEqual(u["total_input_tokens"], 3900)
        self.assertEqual(u["total_output_tokens"], 900)
        self.assertEqual(u["total_thoughts_tokens"], 100)
        self.assertEqual(u["total_tokens"], 4900)


if __name__ == "__main__":
    unittest.main()
