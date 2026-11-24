import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models.exam import Exam, ExamItem
from app.models.question import Question, QuestionGroup
from app.schemas import (
    ExamCreateRequest,
    ExamDetailRead,
    ExamGenerateRequest,
    ExamGroupSectionRead,
    ExamItemGradeRequest,
    ExamItemRead,
    ExamSummaryRead,
    QuestionGroupRead,
    QuestionRead,
)
from app.services.exam_builder import generate_exam_candidates

router = APIRouter(prefix="/api/exams", tags=["exams"])

SUBJECT_ORDER = ["kokugo", "rika", "shakai", "sansu"]


@router.post("/generate")
def generate_candidates(payload: ExamGenerateRequest, db: Session = Depends(get_db)) -> dict:
    raw = generate_exam_candidates(db, payload)
    result = []
    for entry in raw["selections"]:
        result.append(
            {
                "group": QuestionGroupRead.model_validate(entry["group"]).model_dump(mode="json"),
                "selected_question_ids": [str(qid) for qid in entry["selected_question_ids"]],
            }
        )
    return {"selections": result}


@router.post("", response_model=ExamDetailRead)
def create_exam(payload: ExamCreateRequest, db: Session = Depends(get_db)) -> ExamDetailRead:
    if not payload.selections:
        raise HTTPException(status_code=400, detail="問題が1つも選択されていません。")

    exam = Exam(
        title=payload.title.strip() or "確認テスト",
        paper_size=payload.paper_size,
        layout_config=payload.layout_config or {},
    )
    db.add(exam)
    db.flush()

    now = datetime.now(timezone.utc)
    # 科目順に並べ替え
    ordered_selections = sorted(
        payload.selections,
        key=lambda s: SUBJECT_ORDER.index(s.subject) if s.subject in SUBJECT_ORDER else 99,
    )

    section_counter: dict[str, int] = {}
    touched_qids: set[uuid.UUID] = set()

    for sel in ordered_selections:
        subj = sel.subject
        sec_idx = section_counter.get(subj, 0)
        section_counter[subj] = sec_idx + 1

        for item_idx, qid in enumerate(sel.question_ids):
            db.add(
                ExamItem(
                    exam_id=exam.id,
                    group_id=sel.group_id,
                    question_id=qid,
                    subject=subj,
                    section_order=sec_idx,
                    item_order=item_idx,
                    is_wrong=None,
                )
            )
            touched_qids.add(qid)

    if touched_qids:
        qs = db.scalars(select(Question).where(Question.id.in_(touched_qids))).all()
        for q in qs:
            q.tested_count += 1
            q.last_tested_at = now

    db.commit()
    return _build_exam_detail(db, exam.id)


@router.get("", response_model=list[ExamSummaryRead])
def list_exams(db: Session = Depends(get_db)) -> list[ExamSummaryRead]:
    exams = (
        db.query(Exam)
        .options(selectinload(Exam.items))
        .order_by(Exam.created_at.desc())
        .all()
    )
    res: list[ExamSummaryRead] = []
    for ex in exams:
        subjs = [s for s in SUBJECT_ORDER if any(it.subject == s for it in ex.items)]
        wrong_cnt = sum(1 for it in ex.items if it.is_wrong is True)
        res.append(
            ExamSummaryRead(
                id=ex.id,
                title=ex.title,
                paper_size=ex.paper_size,
                layout_config=ex.layout_config or {},
                created_at=ex.created_at,
                item_count=len(ex.items),
                wrong_count=wrong_cnt,
                subjects=subjs,
            )
        )
    return res


def _build_exam_detail(db: Session, exam_id: uuid.UUID) -> ExamDetailRead:
    exam = db.query(Exam).options(selectinload(Exam.items)).filter(Exam.id == exam_id).first()
    if exam is None:
        raise HTTPException(status_code=404, detail="テストが見つかりません。")

    group_ids = {it.group_id for it in exam.items}
    groups = (
        db.query(QuestionGroup)
        .options(selectinload(QuestionGroup.questions), selectinload(QuestionGroup.images))
        .filter(QuestionGroup.id.in_(group_ids))
        .all()
        if group_ids
        else []
    )
    group_map = {g.id: g for g in groups}
    question_map = {q.id: q for g in groups for q in g.questions}

    sections: dict[str, list[ExamGroupSectionRead]] = {}

    for subj in SUBJECT_ORDER:
        subj_items = [it for it in exam.items if it.subject == subj]
        if not subj_items:
            continue
        subj_items.sort(key=lambda x: (x.section_order, x.item_order))

        # (section_order, group_id) でまとめる
        grouped_order: list[tuple[int, uuid.UUID]] = []
        bucket: dict[tuple[int, uuid.UUID], list[ExamItem]] = {}
        for it in subj_items:
            key = (it.section_order, it.group_id)
            if key not in bucket:
                grouped_order.append(key)
                bucket[key] = []
            bucket[key].append(it)

        sec_list: list[ExamGroupSectionRead] = []
        for key in grouped_order:
            gid = key[1]
            grp = group_map.get(gid)
            if grp is None:
                continue
            item_entries = []
            for it in bucket[key]:
                q = question_map.get(it.question_id)
                if q is None:
                    continue
                item_entries.append(
                    {
                        "exam_item": ExamItemRead.model_validate(it).model_dump(mode="json"),
                        "question": QuestionRead.model_validate(q).model_dump(mode="json"),
                    }
                )
            if item_entries:
                sec_list.append(
                    ExamGroupSectionRead(
                        group=QuestionGroupRead.model_validate(grp),
                        items=item_entries,
                    )
                )
        if sec_list:
            sections[subj] = sec_list

    return ExamDetailRead(
        id=exam.id,
        title=exam.title,
        paper_size=exam.paper_size,
        layout_config=exam.layout_config or {},
        created_at=exam.created_at,
        sections=sections,
    )


@router.get("/{exam_id}", response_model=ExamDetailRead)
def get_exam(exam_id: uuid.UUID, db: Session = Depends(get_db)) -> ExamDetailRead:
    return _build_exam_detail(db, exam_id)


@router.patch("/{exam_id}/items/{item_id}")
def grade_exam_item(
    exam_id: uuid.UUID,
    item_id: uuid.UUID,
    payload: ExamItemGradeRequest,
    db: Session = Depends(get_db),
) -> dict:
    item = db.get(ExamItem, item_id)
    if item is None or item.exam_id != exam_id:
        raise HTTPException(status_code=404, detail="テスト項目が見つかりません。")

    old_val = item.is_wrong
    new_val = payload.is_wrong
    item.is_wrong = new_val

    q = db.get(Question, item.question_id)
    if q is not None:
        if new_val is True and old_val is not True:
            q.wrong_count += 1
            q.needs_review = True
        elif old_val is True and new_val is not True:
            q.wrong_count = max(0, q.wrong_count - 1)
            if new_val is False:
                q.needs_review = False
        elif new_val is False:
            q.needs_review = False

    db.commit()
    return {
        "id": str(item.id),
        "is_wrong": item.is_wrong,
        "question_needs_review": q.needs_review if q else False,
        "question_wrong_count": q.wrong_count if q else 0,
    }


@router.delete("/{exam_id}")
def delete_exam(exam_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, bool]:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status_code=404, detail="テストが見つかりません。")
    db.delete(exam)
    db.commit()
    return {"deleted": True}
