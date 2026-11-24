import re
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.database import get_db
from app.models.question import Question, QuestionGroup, QuestionImage
from app.schemas import QuestionGroupRead
from app.services.image_proc import crop_and_clean_image, save_source_image
from app.services.llm.provider import extract_questions_from_image

router = APIRouter(prefix="/api/upload", tags=["upload"])

_KANJI_RE = re.compile(r"[\u4e00-\u9fff々〆ヵヶ]")


def _normalize_extracted_body(body: str) -> str:
    text = (body or "").strip()
    # LLM が <u>...</u> を使った場合は ==...== 記法に統一
    text = re.sub(r"<u>(.*?)</u>", r"==\1==", text, flags=re.IGNORECASE | re.DOTALL)
    # 設問先頭に混入した問題番号（例: "1 ", "10 ", "(1) ", "① "）を除去
    text = re.sub(r"^(?:\(\d{1,2}\)|（\d{1,2}）|[①-⑳]|\d{1,2})[\s　\.．、]+", "", text)
    return text.strip()


def _normalize_answer_box(q_type: str, body: str, raw_box: dict) -> dict:
    box = dict(raw_box or {})
    bosen_matches = re.findall(r"==([^=]+)==", body)
    bosen_text = bosen_matches[0] if bosen_matches else ""

    if q_type == "kanji_read":
        kanji_len = len(_KANJI_RE.findall(bosen_text)) or len(bosen_text.strip()) or 1
        return {"type": "reading_box", "cells": max(1, min(8, kanji_len))}

    if q_type == "kanji_write":
        # もし傍線内が既に漢字ならその文字数に合わせる、そうでなければLLM推定値を優先
        kanji_len = len(_KANJI_RE.findall(bosen_text))
        cells = int(box.get("cells") or 2)
        if kanji_len > 0 and kanji_len == len(bosen_text.strip()):
            cells = kanji_len
        return {"type": "kanji_grid", "cells": max(1, min(8, cells))}

    return box


@router.post("/extract", response_model=list[QuestionGroupRead])
async def upload_and_extract(
    file: UploadFile = File(...),
    subject: str = Form(...),
    source_name: str = Form(""),
    skip_llm: bool = Form(False),
    db: Session = Depends(get_db),
) -> list[QuestionGroupRead]:
    if subject not in ("kokugo", "rika", "shakai", "sansu"):
        raise HTTPException(status_code=400, detail="無効な科目です。")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="画像ファイルが空です。")

    try:
        source_rel = save_source_image(raw_bytes, file.filename or "upload.jpg")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"画像の読み込みに失敗しました: {exc}") from exc

    created_ids: list[uuid.UUID] = []

    if skip_llm:
        default_qtype = "kanji_write" if subject == "kokugo" else "short_answer"
        default_box = {"type": "kanji_grid", "cells": 2} if subject == "kokugo" else {"type": "blank_line", "cells": 2}
        grp = QuestionGroup(
            subject=subject,
            source_name=source_name.strip(),
            source_image_path=source_rel,
            lead_text="",
            status="draft",
            tags=[],
        )
        db.add(grp)
        db.flush()
        db.add(
            Question(
                group_id=grp.id,
                sort_order=0,
                question_type=default_qtype,
                body="",
                options=[],
                answer_box_config=default_box,
            )
        )
        db.commit()
        created_ids.append(grp.id)
    else:
        source_abs = settings.upload_path / source_rel
        try:
            extracted = extract_questions_from_image(db, source_abs, subject)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"LLMによる問題抽出に失敗しました: {exc}") from exc

        groups_data = extracted.groups
        if not groups_data:
            # 何も抽出されなかった場合でも空ドラフトを作成して手動編集できるようにする
            grp = QuestionGroup(
                subject=subject,
                source_name=source_name.strip(),
                source_image_path=source_rel,
                lead_text="",
                status="draft",
                tags=[],
            )
            db.add(grp)
            db.commit()
            created_ids.append(grp.id)
        else:
            for g_data in groups_data:
                grp = QuestionGroup(
                    subject=subject,
                    source_name=source_name.strip(),
                    source_image_path=source_rel,
                    lead_text=g_data.lead_text.strip(),
                    status="draft",
                    tags=[t.strip() for t in g_data.tags if t.strip()],
                )
                db.add(grp)
                db.flush()

                for idx, img_box in enumerate(g_data.images):
                    img_id = uuid.uuid4()
                    try:
                        raw_rel, clean_rel, norm_box = crop_and_clean_image(
                            source_rel,
                            img_box.model_dump(),
                            str(grp.id),
                            str(img_id),
                        )
                        db.add(
                            QuestionImage(
                                id=img_id,
                                group_id=grp.id,
                                raw_crop_path=raw_rel,
                                cleaned_path=clean_rel,
                                use_cleaned=True,
                                crop_box=norm_box,
                                caption=img_box.caption.strip(),
                                sort_order=idx,
                            )
                        )
                    except Exception:
                        continue

                for q_idx, q_data in enumerate(g_data.questions):
                    norm_body = _normalize_extracted_body(q_data.body)
                    norm_box = _normalize_answer_box(
                        q_data.question_type,
                        norm_body,
                        q_data.answer_box_config.model_dump(),
                    )
                    db.add(
                        Question(
                            group_id=grp.id,
                            sort_order=q_idx,
                            question_type=q_data.question_type,
                            body=norm_body,
                            options=[opt.model_dump() for opt in q_data.options],
                            answer_box_config=norm_box,
                            manual_answer=None,
                            memo="",
                        )
                    )
                created_ids.append(grp.id)

            db.commit()

    result = (
        db.query(QuestionGroup)
        .options(selectinload(QuestionGroup.questions), selectinload(QuestionGroup.images))
        .filter(QuestionGroup.id.in_(created_ids))
        .order_by(QuestionGroup.created_at.asc())
        .all()
    )
    return [QuestionGroupRead.model_validate(g) for g in result]
