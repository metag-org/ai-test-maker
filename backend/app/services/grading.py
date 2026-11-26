import base64
import io
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps
from sqlalchemy.orm import Session

from app.config import settings
from app.models.exam import ExamAnswer, ExamSubmission
from app.models.question import Question, QuestionGroup
from app.services.llm.prompts import (
    build_answer_from_image_prompt,
    build_answer_suggestion_prompt,
    build_blind_ocr_prompt,
    build_semantic_grading_prompt,
)
from app.services.llm.provider import run_structured_llm, run_structured_llm_with_usage
from app.services.llm.schema import (
    BlindOcrItem,
    BlindOcrResult,
    LLMAnswerSuggestionResult,
    SemanticGradeItem,
    SemanticGradeResult,
)

# 1回の盲識リクエストでまとめる手書き画像数の上限
COLLAGE_BATCH_SIZE = 10
KANJI_CONFIDENCE_THRESHOLD = 0.80


def save_handwriting_image(submission_id: uuid.UUID, exam_item_id: uuid.UUID, image_data_url: str) -> str:
    """data:image/png;base64,... を受け取り白背景PNGとして保存し、uploads 基準の相対パスを返す。"""
    if "," in image_data_url:
        _, b64_part = image_data_url.split(",", 1)
    else:
        b64_part = image_data_url

    raw = base64.b64decode(b64_part)
    img = Image.open(io.BytesIO(raw))

    # 透過PNGを白背景に合成
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        bg.alpha_composite(rgba)
        img = bg.convert("RGB")
    else:
        img = img.convert("RGB")

    # 過度な解像度を抑えつつ鮮明さを維持
    max_w = 1400
    if img.width > max_w:
        scale = max_w / img.width
        img = img.resize((max_w, max(1, int(img.height * scale))), Image.Resampling.LANCZOS)

    rel_dir = Path("submissions") / str(submission_id)
    abs_dir = settings.upload_path / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)

    rel_path = (rel_dir / f"{exam_item_id}.png").as_posix()
    abs_path = settings.upload_path / rel_path
    img.save(abs_path, format="PNG", optimize=True)
    return rel_path


def _load_pil_font(size: int = 24) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


def build_handwriting_collage(entries: list[tuple[int, Path]]) -> bytes:
    """
    複数の手書きPNGを赤い番号ラベル (#1, #2...) 付きで縦2列グリッドに結合したPNGバイト列を返す。
    """
    cell_w = 560
    cell_h = 240
    header_h = 36
    pad = 16
    cols = 1 if len(entries) <= 3 else 2
    rows = (len(entries) + cols - 1) // cols

    canvas_w = cols * cell_w + (cols + 1) * pad
    canvas_h = rows * (cell_h + header_h) + (rows + 1) * pad
    canvas = Image.new("RGB", (canvas_w, canvas_h), (248, 250, 252))
    draw = ImageDraw.Draw(canvas)
    font = _load_pil_font(22)

    for pos, (idx_num, img_path) in enumerate(entries):
        r = pos // cols
        c = pos % cols
        x0 = pad + c * (cell_w + pad)
        y0 = pad + r * (cell_h + header_h + pad)

        # ヘッダーバー（赤ラベル）
        draw.rectangle([x0, y0, x0 + cell_w, y0 + header_h], fill=(220, 38, 38))
        draw.text((x0 + 12, y0 + 6), f"#{idx_num}", fill=(255, 255, 255), font=font)

        # 画像枠
        box_y0 = y0 + header_h
        draw.rectangle([x0, box_y0, x0 + cell_w, box_y0 + cell_h], fill=(255, 255, 255), outline=(148, 163, 184), width=2)

        if img_path.exists():
            with Image.open(img_path) as im:
                rgb = im.convert("RGB")
                rgb.thumbnail((cell_w - 16, cell_h - 16), Image.Resampling.LANCZOS)
                ox = x0 + (cell_w - rgb.width) // 2
                oy = box_y0 + (cell_h - rgb.height) // 2
                canvas.paste(rgb, (ox, oy))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# --- Text & Answer Normalization Utilities ---

def katakana_to_hiragana(text: str) -> str:
    out: list[str] = []
    for ch in text:
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            out.append(chr(code - 0x60))
        else:
            out.append(ch)
    return "".join(out)


def normalize_basic(text: str) -> str:
    """全角半角正規化・前後および内部空白/句読点軽微除去。"""
    s = unicodedata.normalize("NFKC", text or "").strip()
    s = re.sub(r"[\s　]+", "", s)
    s = s.strip("。、.,・")
    return s


def normalize_choice_labels(raw: str | list[str]) -> set[str]:
    """選択記号を正規化集合へ変換（例: 'ア、ウ' -> {'ア', 'ウ'}）。"""
    if isinstance(raw, list):
        tokens = raw
    else:
        norm = unicodedata.normalize("NFKC", raw or "").strip()
        if not norm:
            return set()
        tokens = re.split(r"[\s　,、・/／と・]+", norm)

    result: set[str] = set()
    for tok in tokens:
        t = unicodedata.normalize("NFKC", str(tok)).strip()
        t = re.sub(r"^[\(（\[【「]|[)）\]】」\.．。、]$", "", t)
        if t:
            result.add(t.upper())
    return result


def collect_acceptable_answers(question: Question) -> list[str]:
    candidates: list[str] = []
    if question.manual_answer and question.manual_answer.strip():
        candidates.append(question.manual_answer.strip())
    for alias in (question.answer_aliases or []):
        if isinstance(alias, str) and alias.strip():
            candidates.append(alias.strip())
    return candidates


def evaluate_choice_answer(selected_options: list[str], question: Question) -> tuple[str, str, bool | None]:
    """選択問題の確定判定。(ai_status, ai_feedback, final_is_wrong)"""
    key_candidates = collect_acceptable_answers(question)
    student_set = normalize_choice_labels(selected_options)
    if not student_set:
        return "unanswered", "未解答です。", True
    if not key_candidates:
        return "no_key", "模範解答が未登録のため自動判定できません。", None

    for key in key_candidates:
        key_set = normalize_choice_labels(key)
        if key_set and student_set == key_set:
            return "correct", "選択肢が模範解答と一致しています。", False

    return "wrong", f"模範解答（{key_candidates[0]}）と異なります。", True


def evaluate_kanji_write_answer(
    student_text: str,
    question: Question,
    confidence: float | None,
    stroke_issues: str | None,
) -> tuple[str, str, bool | None]:
    """漢字書き取りの判定。誤字・画数不足の疑いは uncertain で保護者確認へ回す。"""
    norm_student = normalize_basic(student_text)
    if not norm_student:
        return "unanswered", "文字が読み取れませんでした（未記入または判読不可）。", True

    key_candidates = collect_acceptable_answers(question)
    if not key_candidates:
        return "no_key", "模範解答が未登録です。手書き画像を確認して採点してください。", None

    matched = any(norm_student == normalize_basic(k) for k in key_candidates)
    issues = (stroke_issues or "").strip()
    low_conf = confidence is not None and confidence < KANJI_CONFIDENCE_THRESHOLD

    if matched:
        if issues:
            return "uncertain", f"字は一致していますが字形の確認が必要です（{issues}）。", None
        if low_conf:
            return "uncertain", "読み取り確信度が低いため、手書き画像を目視確認してください。", None
        return "correct", "模範解答と一致しています。", False

    if issues:
        return "wrong", f"模範解答と異なります（読み取り: {student_text} / {issues}）。", True
    return "wrong", f"模範解答（{key_candidates[0]}）と異なります（読み取り: {student_text}）。", True


def evaluate_kanji_read_answer(
    student_text: str,
    question: Question,
    confidence: float | None,
) -> tuple[str, str, bool | None]:
    """漢字の読みの判定。原則ひらがな統一、採点メモでカタカナ指定があれば厳密比較。"""
    norm_student = normalize_basic(student_text)
    if not norm_student:
        return "unanswered", "文字が読み取れませんでした。", True

    key_candidates = collect_acceptable_answers(question)
    if not key_candidates:
        return "no_key", "模範解答が未登録です。", None

    strict_kana = "カタカナ" in (question.grading_note or "") or "片仮名" in (question.grading_note or "")
    s_cmp = norm_student if strict_kana else katakana_to_hiragana(norm_student)

    for k in key_candidates:
        k_norm = normalize_basic(k)
        k_cmp = k_norm if strict_kana else katakana_to_hiragana(k_norm)
        if s_cmp == k_cmp:
            if confidence is not None and confidence < 0.72:
                return "uncertain", "読みは一致していますが字の判別確信度が低いためご確認ください。", None
            return "correct", "読みが模範解答と一致しています。", False

    return "wrong", f"模範解答（{key_candidates[0]}）と異なります（読み取り: {student_text}）。", True


def try_exact_text_match(student_text: str, question: Question) -> bool:
    """穴埋め・短答の事前厳密一致チェック（LLM節約＋高速化）。"""
    norm_student = normalize_basic(student_text)
    if not norm_student:
        return False
    strict_kanji = "漢字" in (question.body or "") or "漢字" in (question.grading_note or "")
    for k in collect_acceptable_answers(question):
        k_norm = normalize_basic(k)
        if norm_student.lower() == k_norm.lower():
            return True
        if not strict_kanji and katakana_to_hiragana(norm_student) == katakana_to_hiragana(k_norm):
            return True
    return False


# --- Dual-Channel Standard Answer Helpers ---

def _format_questions_for_prompt(group: QuestionGroup) -> str:
    lines: list[str] = []
    for idx, q in enumerate(sorted(group.questions, key=lambda x: x.sort_order), start=1):
        opt_str = ""
        if q.options:
            opt_str = " / 選択肢: " + ", ".join(f"{o.get('label', '')}:{o.get('text', '')}" for o in q.options)
        lines.append(f"{idx}. [{q.question_type}] {q.body}{opt_str}")
    return "\n".join(lines)


def suggest_answers_for_group(
    db: Session, group: QuestionGroup
) -> tuple[LLMAnswerSuggestionResult, dict[str, Any]]:
    """チャネル1: AI が問題文と図版から模範解答候補を下書き生成する。"""
    questions_desc = _format_questions_for_prompt(group)
    prompt = build_answer_suggestion_prompt(group.subject, group.lead_text, questions_desc)

    images: list[tuple[bytes, str]] = []
    for img in sorted(group.images, key=lambda x: x.sort_order)[:4]:
        rel = img.cleaned_path if img.use_cleaned else img.raw_crop_path
        abs_p = settings.upload_path / rel
        if abs_p.exists():
            images.append((abs_p.read_bytes(), "image/png"))

    return run_structured_llm_with_usage(
        db=db,
        prompt=prompt,
        schema_cls=LLMAnswerSuggestionResult,
        images=images,
        temperature=0.1,
    )


def extract_answers_from_image_for_group(
    db: Session,
    group: QuestionGroup,
    answer_image_bytes: bytes,
) -> tuple[LLMAnswerSuggestionResult, dict[str, Any]]:
    """チャネル2: 解答ページ写真をアップロードし、設問と自動照合して公式解答を抽出する。"""
    img = Image.open(io.BytesIO(answer_image_bytes))
    img = ImageOps.exif_transpose(img).convert("RGB")
    max_dim = 2200
    if max(img.size) > max_dim:
        scale = max_dim / max(img.size)
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92, optimize=True)
    jpeg_bytes = buf.getvalue()

    questions_desc = _format_questions_for_prompt(group)
    prompt = build_answer_from_image_prompt(group.subject, group.lead_text, questions_desc)

    return run_structured_llm_with_usage(
        db=db,
        prompt=prompt,
        schema_cls=LLMAnswerSuggestionResult,
        images=[(jpeg_bytes, "image/jpeg")],
        temperature=0.05,
    )


def record_group_llm_usage(
    group: QuestionGroup,
    stage_key: str,
    call_usage: dict[str, Any] | None,
    shared_groups: int = 1,
) -> dict[str, Any]:
    """
    問題グループの LLM トークン消費量を段階別（extract / answer_suggest / answer_image）に
    累積保存し、更新後の辞書を返す。
    """
    prev = group.llm_usage if isinstance(group.llm_usage, dict) else {}
    provider_name = str((call_usage or {}).get("provider") or prev.get("provider") or "")
    model_name = str((call_usage or {}).get("model") or prev.get("model") or "")

    extract_u = _normalize_stage_usage(prev.get("extract"))
    if isinstance(prev.get("extract"), dict) and prev["extract"].get("shared_groups"):
        extract_u["shared_groups"] = int(prev["extract"]["shared_groups"])
    suggest_u = _normalize_stage_usage(prev.get("answer_suggest"))
    img_u = _normalize_stage_usage(prev.get("answer_image"))

    stage_map = {
        "extract": extract_u,
        "answer_suggest": suggest_u,
        "answer_image": img_u,
    }
    target = stage_map.get(stage_key)
    if target is not None:
        _add_stage_usage(target, call_usage)
        if stage_key == "extract" and shared_groups > 1:
            target["shared_groups"] = int(shared_groups)

    updated: dict[str, Any] = {
        "provider": provider_name,
        "model": model_name,
        "extract": extract_u,
        "answer_suggest": suggest_u,
        "answer_image": img_u,
        "total_input_tokens": extract_u["input_tokens"] + suggest_u["input_tokens"] + img_u["input_tokens"],
        "total_output_tokens": extract_u["output_tokens"] + suggest_u["output_tokens"] + img_u["output_tokens"],
        "total_thoughts_tokens": (
            extract_u["thoughts_tokens"] + suggest_u["thoughts_tokens"] + img_u["thoughts_tokens"]
        ),
        "total_tokens": extract_u["total_tokens"] + suggest_u["total_tokens"] + img_u["total_tokens"],
    }
    group.llm_usage = updated
    return updated


# --- Full Two-Stage Grading Pipeline ---

def _has_strokes(strokes_data: dict[str, Any] | None) -> bool:
    if not isinstance(strokes_data, dict):
        return False
    cells = strokes_data.get("cells")
    if isinstance(cells, list):
        return any(isinstance(cell, list) and len(cell) > 0 for cell in cells)
    strokes = strokes_data.get("strokes")
    if isinstance(strokes, list):
        return len(strokes) > 0
    return False


def recompute_submission_counts(submission: ExamSubmission) -> None:
    total = len(submission.answers)
    correct = 0
    wrong = 0
    uncertain = 0
    for ans in submission.answers:
        if ans.final_is_wrong is False:
            correct += 1
        elif ans.final_is_wrong is True:
            wrong += 1
        else:
            uncertain += 1
    submission.total_count = total
    submission.correct_count = correct
    submission.wrong_count = wrong
    submission.uncertain_count = uncertain


def _empty_stage_usage() -> dict[str, int]:
    return {
        "calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "thoughts_tokens": 0,
        "total_tokens": 0,
    }


def _normalize_stage_usage(raw: Any) -> dict[str, int]:
    if not isinstance(raw, dict):
        return _empty_stage_usage()
    return {
        "calls": int(raw.get("calls") or 0),
        "input_tokens": int(raw.get("input_tokens") or 0),
        "output_tokens": int(raw.get("output_tokens") or 0),
        "thoughts_tokens": int(raw.get("thoughts_tokens") or 0),
        "total_tokens": int(raw.get("total_tokens") or 0),
    }


def _add_stage_usage(stage: dict[str, int], call_usage: dict[str, Any] | None) -> None:
    stage["calls"] += 1
    if not isinstance(call_usage, dict):
        return
    in_tok = int(call_usage.get("input_tokens") or 0)
    out_tok = int(call_usage.get("output_tokens") or 0)
    th_tok = int(call_usage.get("thoughts_tokens") or 0)
    tot_tok = int(call_usage.get("total_tokens") or (in_tok + out_tok + th_tok))
    stage["input_tokens"] += in_tok
    stage["output_tokens"] += out_tok
    stage["thoughts_tokens"] += th_tok
    stage["total_tokens"] += tot_tok


def grade_submission(
    db: Session,
    submission: ExamSubmission,
    question_map: dict[uuid.UUID, Question],
    rerun_ocr: bool = True,
) -> None:
    """
    2段階パイプライン（無文脈盲識 OCR → 問題種別ごとの厳格／意味照合）を実行し、
    submission.answers と submission.llm_usage を更新して集計を確定する。
    rerun_ocr=False の場合は既存の recognized_text / ai_confidence / stroke_issues と
    既存の OCR トークン統計を再利用し、最新の模範解答・別解・採点ルールで Stage 2 の照合だけ再実行する。
    """
    prev_usage = submission.llm_usage if isinstance(submission.llm_usage, dict) else {}
    provider_name = str(prev_usage.get("provider") or "")
    model_name = str(prev_usage.get("model") or "")
    ocr_usage = _empty_stage_usage() if rerun_ocr else _normalize_stage_usage(prev_usage.get("ocr"))
    semantic_usage = _empty_stage_usage()

    # 1. 手書き解答のうち OCR 実行が必要なものを収集
    handwriting_targets: list[tuple[ExamAnswer, Question, Path]] = []
    for ans in submission.answers:
        q = question_map.get(ans.question_id)
        if q is None:
            continue
        if ans.input_mode == "handwriting":
            already_recognized = (not rerun_ocr) and (ans.recognized_text is not None) and (ans.ai_confidence is not None)
            if already_recognized:
                continue
            if ans.handwriting_image_path and (_has_strokes(ans.strokes_data) or True):
                abs_p = settings.upload_path / ans.handwriting_image_path
                if abs_p.exists():
                    handwriting_targets.append((ans, q, abs_p))
                else:
                    ans.recognized_text = ""
                    ans.ai_status = "unanswered"
                    ans.ai_feedback = "手書き画像が見つかりませんでした。"
                    ans.final_is_wrong = True
            else:
                ans.recognized_text = ""
                ans.ai_status = "unanswered"
                ans.ai_feedback = "未記入です。"
                ans.final_is_wrong = True

    # 2. 【Stage 1】無文脈盲識（問題文・解答キーは一切渡さない）
    if handwriting_targets:
        for batch_start in range(0, len(handwriting_targets), COLLAGE_BATCH_SIZE):
            batch = handwriting_targets[batch_start : batch_start + COLLAGE_BATCH_SIZE]
            collage_entries: list[tuple[int, Path]] = []
            meta_lines: list[str] = []
            for local_idx, (_, q, img_path) in enumerate(batch, start=1):
                collage_entries.append((local_idx, img_path))
                cells = (q.answer_box_config or {}).get("cells")
                cell_hint = f"（想定文字数マス: {cells}マス）" if q.question_type == "kanji_write" and cells else ""
                meta_lines.append(f"#{local_idx}: 種別={q.question_type}{cell_hint}")

            collage_bytes = build_handwriting_collage(collage_entries)
            ocr_prompt = build_blind_ocr_prompt("\n".join(meta_lines))
            ocr_result, call_usage = run_structured_llm_with_usage(
                db=db,
                prompt=ocr_prompt,
                schema_cls=BlindOcrResult,
                images=[(collage_bytes, "image/png")],
                temperature=0.0,
            )
            _add_stage_usage(ocr_usage, call_usage)
            if call_usage.get("provider"):
                provider_name = str(call_usage["provider"])
            if call_usage.get("model"):
                model_name = str(call_usage["model"])

            by_index: dict[int, BlindOcrItem] = {it.item_index: it for it in ocr_result.items}
            for local_idx, (ans, _, _) in enumerate(batch, start=1):
                item = by_index.get(local_idx)
                if item:
                    ans.recognized_text = item.recognized_text.strip()
                    ans.ai_confidence = float(item.confidence)
                    ans.stroke_issues = item.stroke_issues.strip() or None
                else:
                    ans.recognized_text = ""
                    ans.ai_confidence = 0.0
                    ans.stroke_issues = "読み取り結果が取得できませんでした。"

    # 3. 【Stage 2】種別ごとの照合＆意味採点対象の収集
    semantic_targets: list[tuple[ExamAnswer, Question, str]] = []

    for ans in submission.answers:
        q = question_map.get(ans.question_id)
        if q is None:
            continue

        # 選択問題
        if q.question_type in ("single_choice", "multi_choice") or ans.input_mode == "choice":
            status, fb, is_wrong = evaluate_choice_answer(ans.selected_options or [], q)
            ans.ai_status = status
            ans.ai_feedback = fb
            ans.final_is_wrong = is_wrong
            continue

        # 生徒の解答テキスト取得（手書きなら盲識結果、キーボードなら入力値）
        if ans.input_mode == "text":
            student_text = (ans.typed_text or "").strip()
            ans.recognized_text = student_text
            ans.ai_confidence = 1.0 if student_text else 0.0
            ans.stroke_issues = None
        else:
            student_text = (ans.recognized_text or "").strip()

        if not student_text:
            ans.ai_status = "unanswered"
            ans.ai_feedback = "未記入です。"
            ans.final_is_wrong = True
            continue

        if q.question_type == "kanji_write":
            status, fb, is_wrong = evaluate_kanji_write_answer(
                student_text, q, ans.ai_confidence, ans.stroke_issues
            )
            ans.ai_status = status
            ans.ai_feedback = fb
            ans.final_is_wrong = is_wrong
            continue

        if q.question_type == "kanji_read":
            status, fb, is_wrong = evaluate_kanji_read_answer(student_text, q, ans.ai_confidence)
            ans.ai_status = status
            ans.ai_feedback = fb
            ans.final_is_wrong = is_wrong
            continue

        # fill_blank / short_answer / kokugo_subjective
        key_candidates = collect_acceptable_answers(q)
        if not key_candidates:
            ans.ai_status = "no_key"
            ans.ai_feedback = "模範解答が未登録です。読み取り結果と手書き画像を確認して採点してください。"
            ans.final_is_wrong = None
            continue

        if try_exact_text_match(student_text, q):
            if ans.input_mode == "handwriting" and ans.ai_confidence is not None and ans.ai_confidence < 0.72:
                ans.ai_status = "uncertain"
                ans.ai_feedback = "模範解答と一致していますが、手書きの読み取り確信度が低いためご確認ください。"
                ans.final_is_wrong = None
            else:
                ans.ai_status = "correct"
                ans.ai_feedback = "模範解答と一致しています。"
                ans.final_is_wrong = False
            continue

        semantic_targets.append((ans, q, student_text))

    # 4. 厳密一致しなかった記述・穴埋めをまとめて1回のLLM意味照合へ
    if semantic_targets:
        desc_lines: list[str] = []
        for idx, (ans, q, student_text) in enumerate(semantic_targets, start=1):
            aliases_str = f" / 別解: {', '.join(q.answer_aliases)}" if q.answer_aliases else ""
            note_str = f" / 採点ルール: {q.grading_note}" if q.grading_note else ""
            issue_str = f" / 字形メモ: {ans.stroke_issues}" if ans.stroke_issues else ""
            desc_lines.append(
                f"{idx}. [種別:{q.question_type}] 設問: {q.body} | 模範解答: {q.manual_answer}{aliases_str}{note_str} | 生徒の解答: {student_text}{issue_str}"
            )

        sem_prompt = build_semantic_grading_prompt("\n".join(desc_lines))
        sem_result, sem_call_usage = run_structured_llm_with_usage(
            db=db,
            prompt=sem_prompt,
            schema_cls=SemanticGradeResult,
            images=[],
            temperature=0.05,
        )
        _add_stage_usage(semantic_usage, sem_call_usage)
        if sem_call_usage.get("provider"):
            provider_name = str(sem_call_usage["provider"])
        if sem_call_usage.get("model"):
            model_name = str(sem_call_usage["model"])
        sem_map: dict[int, SemanticGradeItem] = {it.item_index: it for it in sem_result.items}
        for idx, (ans, _, _) in enumerate(semantic_targets, start=1):
            res = sem_map.get(idx)
            if res is None:
                ans.ai_status = "uncertain"
                ans.ai_feedback = "自動判定できませんでした。保護者の方でご確認ください。"
                ans.final_is_wrong = None
            else:
                ans.ai_status = res.status
                ans.ai_feedback = res.feedback.strip()
                if res.status == "correct":
                    ans.final_is_wrong = False
                elif res.status == "wrong":
                    ans.final_is_wrong = True
                else:
                    # partial / uncertain は保護者確認に委ねる
                    ans.final_is_wrong = None

    submission.llm_usage = {
        "provider": provider_name,
        "model": model_name,
        "ocr": ocr_usage,
        "semantic": semantic_usage,
        "total_input_tokens": ocr_usage["input_tokens"] + semantic_usage["input_tokens"],
        "total_output_tokens": ocr_usage["output_tokens"] + semantic_usage["output_tokens"],
        "total_thoughts_tokens": ocr_usage["thoughts_tokens"] + semantic_usage["thoughts_tokens"],
        "total_tokens": ocr_usage["total_tokens"] + semantic_usage["total_tokens"],
    }

    if submission.submitted_at is None:
        submission.submitted_at = datetime.now(timezone.utc)
    submission.status = "graded"
    recompute_submission_counts(submission)
