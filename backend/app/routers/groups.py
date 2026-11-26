import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models.question import Question, QuestionGroup, QuestionImage
from app.schemas import (
    AnswerSuggestionItem,
    AnswerSuggestionResponse,
    ImageRotateRequest,
    QuestionGroupCreate,
    QuestionGroupListResponse,
    QuestionGroupRead,
    QuestionGroupUpdate,
    QuestionImageCreate,
    QuestionImageRead,
    QuestionImageUpdate,
)
from app.services.grading import (
    extract_answers_from_image_for_group,
    record_group_llm_usage,
    suggest_answers_for_group,
)
from app.services.image_proc import (
    crop_and_clean_image,
    delete_upload_file,
    reclean_cropped_image,
    rotate_crop_box_cw,
    rotate_cropped_pair_cw,
    rotate_source_image_cw,
)

router = APIRouter(prefix="/api/groups", tags=["groups"])


def _load_group(db: Session, group_id: uuid.UUID) -> QuestionGroup:
    grp = (
        db.query(QuestionGroup)
        .options(selectinload(QuestionGroup.questions), selectinload(QuestionGroup.images))
        .filter(QuestionGroup.id == group_id)
        .first()
    )
    if grp is None:
        raise HTTPException(status_code=404, detail="問題グループが見つかりません。")
    return grp


@router.get("/meta/facets")
def get_facets(db: Session = Depends(get_db)) -> dict:
    groups = db.scalars(select(QuestionGroup).where(QuestionGroup.status == "published")).all()
    sources = sorted({g.source_name for g in groups if g.source_name})
    tags = sorted({t for g in groups for t in (g.tags or []) if t})
    counts = {"kokugo": 0, "rika": 0, "shakai": 0, "sansu": 0}
    for g in groups:
        if g.subject in counts:
            counts[g.subject] += 1
    draft_count = db.scalar(select(func.count()).select_from(QuestionGroup).where(QuestionGroup.status == "draft")) or 0
    return {
        "sources": sources,
        "tags": tags,
        "published_counts": counts,
        "draft_count": draft_count,
    }


@router.get("", response_model=QuestionGroupListResponse)
def list_groups(
    status: str | None = Query(default=None),
    subject: str | None = Query(default=None),
    search: str | None = Query(default=None),
    source_name: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    needs_review: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> QuestionGroupListResponse:
    stmt = (
        select(QuestionGroup)
        .options(selectinload(QuestionGroup.questions), selectinload(QuestionGroup.images))
        .order_by(QuestionGroup.created_at.desc())
    )
    if status:
        stmt = stmt.where(QuestionGroup.status == status)
    if subject:
        stmt = stmt.where(QuestionGroup.subject == subject)
    if source_name:
        stmt = stmt.where(QuestionGroup.source_name.ilike(f"%{source_name.strip()}%"))

    all_rows = list(db.scalars(stmt).all())

    filtered: list[QuestionGroup] = []
    q_search = (search or "").strip().lower()
    q_tag = (tag or "").strip().lower()

    for g in all_rows:
        if q_tag:
            if not any(q_tag in str(t).lower() for t in (g.tags or [])):
                continue
        if needs_review is True:
            if not any(q.needs_review for q in g.questions):
                continue
        if q_search:
            haystack = " ".join(
                [
                    g.source_name or "",
                    g.lead_text or "",
                    " ".join(g.tags or []),
                    " ".join((q.body or "") + " " + (q.manual_answer or "") for q in g.questions),
                ]
            ).lower()
            if q_search not in haystack:
                continue
        filtered.append(g)

    draft_count = db.scalar(select(func.count()).select_from(QuestionGroup).where(QuestionGroup.status == "draft")) or 0
    return QuestionGroupListResponse(
        items=[QuestionGroupRead.model_validate(g) for g in filtered],
        total=len(filtered),
        draft_count=draft_count,
    )


@router.get("/{group_id}", response_model=QuestionGroupRead)
def get_group(group_id: uuid.UUID, db: Session = Depends(get_db)) -> QuestionGroupRead:
    return QuestionGroupRead.model_validate(_load_group(db, group_id))


@router.post("", response_model=QuestionGroupRead)
def create_group(payload: QuestionGroupCreate, db: Session = Depends(get_db)) -> QuestionGroupRead:
    grp = QuestionGroup(
        subject=payload.subject,
        source_name=payload.source_name.strip(),
        lead_text=payload.lead_text,
        status=payload.status,
        tags=[t.strip() for t in payload.tags if t.strip()],
    )
    db.add(grp)
    db.flush()
    for idx, q in enumerate(payload.questions):
        db.add(
            Question(
                group_id=grp.id,
                sort_order=idx,
                question_type=q.question_type,
                body=q.body,
                options=[opt.model_dump() for opt in q.options],
                answer_box_config=q.answer_box_config,
                manual_answer=q.manual_answer if (q.manual_answer and q.manual_answer.strip()) else None,
                answer_aliases=[a.strip() for a in (q.answer_aliases or []) if a and a.strip()],
                grading_note=(q.grading_note or "").strip(),
                memo=q.memo,
                needs_review=q.needs_review,
            )
        )
    db.commit()
    return QuestionGroupRead.model_validate(_load_group(db, grp.id))


@router.put("/{group_id}", response_model=QuestionGroupRead)
def update_group(group_id: uuid.UUID, payload: QuestionGroupUpdate, db: Session = Depends(get_db)) -> QuestionGroupRead:
    grp = _load_group(db, group_id)

    if payload.subject is not None:
        grp.subject = payload.subject
    if payload.source_name is not None:
        grp.source_name = payload.source_name.strip()
    if payload.lead_text is not None:
        grp.lead_text = payload.lead_text
    if payload.status is not None:
        grp.status = payload.status
    if payload.tags is not None:
        grp.tags = [t.strip() for t in payload.tags if t.strip()]

    if payload.questions is not None:
        existing_map = {q.id: q for q in grp.questions}
        keep_ids: set[uuid.UUID] = set()

        for idx, q_in in enumerate(payload.questions):
            ans = q_in.manual_answer.strip() if q_in.manual_answer else None
            if ans == "":
                ans = None
            aliases = [a.strip() for a in (q_in.answer_aliases or []) if a and a.strip()]
            g_note = (q_in.grading_note or "").strip()
            if q_in.id and q_in.id in existing_map:
                q_obj = existing_map[q_in.id]
                q_obj.sort_order = idx
                q_obj.question_type = q_in.question_type
                q_obj.body = q_in.body
                q_obj.options = [opt.model_dump() for opt in q_in.options]
                q_obj.answer_box_config = q_in.answer_box_config
                q_obj.manual_answer = ans
                q_obj.answer_aliases = aliases
                q_obj.grading_note = g_note
                q_obj.memo = q_in.memo
                q_obj.needs_review = q_in.needs_review
                keep_ids.add(q_obj.id)
            else:
                new_q = Question(
                    group_id=grp.id,
                    sort_order=idx,
                    question_type=q_in.question_type,
                    body=q_in.body,
                    options=[opt.model_dump() for opt in q_in.options],
                    answer_box_config=q_in.answer_box_config,
                    manual_answer=ans,
                    answer_aliases=aliases,
                    grading_note=g_note,
                    memo=q_in.memo,
                    needs_review=q_in.needs_review,
                )
                db.add(new_q)

        for q_id, q_obj in existing_map.items():
            if q_id not in keep_ids:
                db.delete(q_obj)

    db.commit()
    return QuestionGroupRead.model_validate(_load_group(db, group_id))


@router.delete("/{group_id}")
def delete_group(group_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, bool]:
    grp = _load_group(db, group_id)
    source_path = grp.source_image_path
    for img in grp.images:
        delete_upload_file(img.raw_crop_path)
        delete_upload_file(img.cleaned_path)
    db.delete(grp)
    db.commit()
    if source_path:
        remaining = (
            db.scalar(
                select(func.count())
                .select_from(QuestionGroup)
                .where(QuestionGroup.source_image_path == source_path)
            )
            or 0
        )
        if remaining == 0:
            delete_upload_file(source_path)
    return {"deleted": True}


@router.patch("/questions/{question_id}/review")
def toggle_question_review(question_id: uuid.UUID, needs_review: bool, db: Session = Depends(get_db)) -> dict:
    q = db.get(Question, question_id)
    if q is None:
        raise HTTPException(status_code=404, detail="問題が見つかりません。")
    q.needs_review = needs_review
    db.commit()
    return {"id": str(q.id), "needs_review": q.needs_review}


@router.post("/{group_id}/images", response_model=QuestionImageRead)
def add_cropped_image(
    group_id: uuid.UUID,
    payload: QuestionImageCreate,
    db: Session = Depends(get_db),
) -> QuestionImageRead:
    grp = _load_group(db, group_id)
    if not grp.source_image_path:
        raise HTTPException(status_code=400, detail="この問題グループには原本画像が紐づいていません。")

    img_id = uuid.uuid4()
    raw_rel, clean_rel, norm_box = crop_and_clean_image(
        grp.source_image_path,
        payload.crop_box.model_dump(),
        str(grp.id),
        str(img_id),
    )
    next_order = len(grp.images)
    img_obj = QuestionImage(
        id=img_id,
        group_id=grp.id,
        question_id=payload.question_id,
        raw_crop_path=raw_rel,
        cleaned_path=clean_rel,
        use_cleaned=payload.use_cleaned,
        crop_box=norm_box,
        caption=payload.caption.strip(),
        sort_order=next_order,
    )
    db.add(img_obj)
    db.commit()
    db.refresh(img_obj)
    return QuestionImageRead.model_validate(img_obj)


@router.put("/{group_id}/images/{image_id}", response_model=QuestionImageRead)
def update_cropped_image(
    group_id: uuid.UUID,
    image_id: uuid.UUID,
    payload: QuestionImageUpdate,
    db: Session = Depends(get_db),
) -> QuestionImageRead:
    grp = _load_group(db, group_id)
    img_obj = db.get(QuestionImage, image_id)
    if img_obj is None or img_obj.group_id != grp.id:
        raise HTTPException(status_code=404, detail="図版が見つかりません。")

    if payload.crop_box is not None:
        if not grp.source_image_path:
            raise HTTPException(status_code=400, detail="原本画像がありません。")
        old_raw = img_obj.raw_crop_path
        old_clean = img_obj.cleaned_path
        raw_rel, clean_rel, norm_box = crop_and_clean_image(
            grp.source_image_path,
            payload.crop_box.model_dump(),
            str(grp.id),
            str(img_obj.id),
        )
        img_obj.raw_crop_path = raw_rel
        img_obj.cleaned_path = clean_rel
        img_obj.crop_box = norm_box
        delete_upload_file(old_raw)
        delete_upload_file(old_clean)

    if payload.caption is not None:
        img_obj.caption = payload.caption.strip()
    if payload.use_cleaned is not None:
        img_obj.use_cleaned = payload.use_cleaned
    if payload.sort_order is not None:
        img_obj.sort_order = payload.sort_order
    if payload.question_id is not None:
        img_obj.question_id = payload.question_id

    db.commit()
    db.refresh(img_obj)
    return QuestionImageRead.model_validate(img_obj)


@router.post("/{group_id}/images/{image_id}/reclean", response_model=QuestionImageRead)
def reclean_group_image(
    group_id: uuid.UUID,
    image_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> QuestionImageRead:
    """保存済みの切り抜き原本から最新の画像補正を再実行する。"""
    img_obj = db.get(QuestionImage, image_id)
    if img_obj is None or img_obj.group_id != group_id:
        raise HTTPException(status_code=404, detail="図版が見つかりません。")
    old_clean = img_obj.cleaned_path
    try:
        new_clean = reclean_cropped_image(img_obj.raw_crop_path, str(group_id), str(img_obj.id))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    img_obj.cleaned_path = new_clean
    img_obj.use_cleaned = True
    db.commit()
    db.refresh(img_obj)
    if old_clean and old_clean != new_clean:
        delete_upload_file(old_clean)
    return QuestionImageRead.model_validate(img_obj)


@router.post("/{group_id}/images/{image_id}/rotate", response_model=QuestionImageRead)
def rotate_group_image(
    group_id: uuid.UUID,
    image_id: uuid.UUID,
    payload: ImageRotateRequest,
    db: Session = Depends(get_db),
) -> QuestionImageRead:
    """単体の切り抜き図版（原本＋補正版）を時計回りに 90/180/270 度回転する。"""
    img_obj = db.get(QuestionImage, image_id)
    if img_obj is None or img_obj.group_id != group_id:
        raise HTTPException(status_code=404, detail="図版が見つかりません。")
    old_raw = img_obj.raw_crop_path
    old_clean = img_obj.cleaned_path
    try:
        new_raw, new_clean = rotate_cropped_pair_cw(
            old_raw, old_clean, str(group_id), str(img_obj.id), payload.angle_cw
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    img_obj.raw_crop_path = new_raw
    img_obj.cleaned_path = new_clean
    db.commit()
    db.refresh(img_obj)
    if old_raw != new_raw:
        delete_upload_file(old_raw)
    if old_clean != new_clean:
        delete_upload_file(old_clean)
    return QuestionImageRead.model_validate(img_obj)


@router.post("/{group_id}/source-image/rotate", response_model=QuestionGroupRead)
def rotate_group_source_image(
    group_id: uuid.UUID,
    payload: ImageRotateRequest,
    db: Session = Depends(get_db),
) -> QuestionGroupRead:
    """
    原本画像を時計回りに回転し、同じ原本画像を共有するグループおよび紐づく切り抜き図版と座標も一括回転する。
    """
    grp = _load_group(db, group_id)
    old_source = grp.source_image_path
    if not old_source:
        raise HTTPException(status_code=400, detail="この問題グループには原本画像が紐づいていません。")

    try:
        new_source = rotate_source_image_cw(old_source, payload.angle_cw)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # 同じ原本画像を共有する全グループを同期更新
    shared_groups = (
        db.query(QuestionGroup)
        .options(selectinload(QuestionGroup.images))
        .filter(QuestionGroup.source_image_path == old_source)
        .all()
    )
    old_files_to_delete: list[str] = [old_source]
    for g in shared_groups:
        g.source_image_path = new_source
        for img_obj in g.images:
            old_raw = img_obj.raw_crop_path
            old_clean = img_obj.cleaned_path
            try:
                new_raw, new_clean = rotate_cropped_pair_cw(
                    old_raw, old_clean, str(g.id), str(img_obj.id), payload.angle_cw
                )
                img_obj.raw_crop_path = new_raw
                img_obj.cleaned_path = new_clean
                if img_obj.crop_box:
                    img_obj.crop_box = rotate_crop_box_cw(img_obj.crop_box, payload.angle_cw)
                old_files_to_delete.extend([old_raw, old_clean])
            except Exception:
                continue

    db.commit()
    for p in old_files_to_delete:
        if p and p != new_source:
            delete_upload_file(p)

    return QuestionGroupRead.model_validate(_load_group(db, group_id))


@router.delete("/{group_id}/images/{image_id}")
def delete_cropped_image(group_id: uuid.UUID, image_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, bool]:
    img_obj = db.get(QuestionImage, image_id)
    if img_obj is None or img_obj.group_id != group_id:
        raise HTTPException(status_code=404, detail="図版が見つかりません。")
    delete_upload_file(img_obj.raw_crop_path)
    delete_upload_file(img_obj.cleaned_path)
    db.delete(img_obj)
    db.commit()
    return {"deleted": True}


def _map_llm_suggestions(
    group: QuestionGroup,
    raw_items: list,
    source: str,
    call_usage: dict,
    group_llm_usage: dict,
) -> AnswerSuggestionResponse:
    ordered_qs = sorted(group.questions, key=lambda x: x.sort_order)
    by_order = {it.question_order: it for it in raw_items}
    mapped: list[AnswerSuggestionItem] = []
    for idx, q in enumerate(ordered_qs, start=1):
        it = by_order.get(idx)
        mapped.append(
            AnswerSuggestionItem(
                question_id=q.id,
                question_order=idx,
                suggested_answer=(it.suggested_answer.strip() if it else ""),
                suggested_aliases=[a.strip() for a in (it.suggested_aliases if it else []) if a and a.strip()],
                suggested_grading_note=(it.suggested_grading_note.strip() if it else ""),
                confidence=float(it.confidence) if it else 0.0,
                reason=(it.reason.strip() if it else ""),
            )
        )
    return AnswerSuggestionResponse(
        group_id=group.id,
        source=source,  # type: ignore[arg-type]
        items=mapped,
        call_usage=call_usage,
        group_llm_usage=group_llm_usage,
    )


@router.post("/{group_id}/answers/suggest", response_model=AnswerSuggestionResponse)
def suggest_group_answers(group_id: uuid.UUID, db: Session = Depends(get_db)) -> AnswerSuggestionResponse:
    """AI が設問文と図版から模範解答候補を下書き生成する（DBの解答には上書きせず、トークン消費量のみ保存）。"""
    grp = _load_group(db, group_id)
    if not grp.questions:
        raise HTTPException(status_code=400, detail="設問が登録されていません。")
    try:
        llm_res, call_usage = suggest_answers_for_group(db, grp)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI模範解答の生成に失敗しました: {exc}") from exc

    updated_usage = record_group_llm_usage(grp, "answer_suggest", call_usage)
    db.commit()
    return _map_llm_suggestions(grp, llm_res.items, "ai_suggest", call_usage, updated_usage)


@router.post("/{group_id}/answers/from-image", response_model=AnswerSuggestionResponse)
async def extract_group_answers_from_image(
    group_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> AnswerSuggestionResponse:
    """解答ページの写真をアップロードし、各設問と照合して模範解答候補を抽出する（トークン消費量も保存）。"""
    grp = _load_group(db, group_id)
    if not grp.questions:
        raise HTTPException(status_code=400, detail="設問が登録されていません。")
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="画像ファイルが空です。")
    try:
        llm_res, call_usage = extract_answers_from_image_for_group(db, grp, raw_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"解答ページからの抽出に失敗しました: {exc}") from exc

    updated_usage = record_group_llm_usage(grp, "answer_image", call_usage)
    db.commit()
    return _map_llm_suggestions(grp, llm_res.items, "answer_image", call_usage, updated_usage)
