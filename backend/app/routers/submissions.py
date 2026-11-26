import shutil
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.database import get_db
from app.models.exam import Exam, ExamAnswer, ExamItem, ExamSubmission
from app.models.question import Question, QuestionGroup
from app.schemas import (
    ExamAnswerRead,
    ExamAnswerReviewRequest,
    ExamAnswerSaveRequest,
    ExamItemRead,
    ExamSubmissionDetailRead,
    ExamSubmissionSummaryRead,
    QuestionGroupRead,
    QuestionRead,
    SubmissionCreateRequest,
    SubmissionGroupSection,
    SubmissionItemBundle,
    SubmissionRegradeRequest,
    SubmissionSubmitRequest,
)
from app.services.grading import (
    grade_submission,
    recompute_submission_counts,
    save_handwriting_image,
)

router = APIRouter(tags=["submissions"])

SUBJECT_ORDER = ["kokugo", "rika", "shakai", "sansu"]


def cleanup_submission_files(submission_id: uuid.UUID) -> None:
    target = (settings.upload_path / "submissions" / str(submission_id)).resolve()
    try:
        if settings.upload_path in target.parents and target.exists():
            shutil.rmtree(target, ignore_errors=True)
    except Exception:
        pass


def _build_submission_detail(db: Session, submission_id: uuid.UUID) -> ExamSubmissionDetailRead:
    sub = (
        db.query(ExamSubmission)
        .options(
            selectinload(ExamSubmission.answers),
            selectinload(ExamSubmission.exam).selectinload(Exam.items),
            selectinload(ExamSubmission.exam).selectinload(Exam.submissions),
        )
        .filter(ExamSubmission.id == submission_id)
        .first()
    )
    if sub is None:
        raise HTTPException(status_code=404, detail="解答記録が見つかりません。")

    exam = sub.exam
    answer_by_item_id = {a.exam_item_id: a for a in sub.answers}
    target_items = [it for it in exam.items if it.id in answer_by_item_id]

    group_ids = {it.group_id for it in target_items}
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

    sections: dict[str, list[SubmissionGroupSection]] = {}
    for subj in SUBJECT_ORDER:
        subj_items = [it for it in target_items if it.subject == subj]
        if not subj_items:
            continue
        subj_items.sort(key=lambda x: (x.section_order, x.item_order))

        grouped_order: list[tuple[int, uuid.UUID]] = []
        bucket: dict[tuple[int, uuid.UUID], list[ExamItem]] = {}
        for it in subj_items:
            key = (it.section_order, it.group_id)
            if key not in bucket:
                grouped_order.append(key)
                bucket[key] = []
            bucket[key].append(it)

        sec_list: list[SubmissionGroupSection] = []
        for key in grouped_order:
            grp = group_map.get(key[1])
            if grp is None:
                continue
            bundles: list[SubmissionItemBundle] = []
            for it in bucket[key]:
                q = question_map.get(it.question_id)
                ans = answer_by_item_id.get(it.id)
                if q is None or ans is None:
                    continue
                bundles.append(
                    SubmissionItemBundle(
                        exam_item=ExamItemRead.model_validate(it),
                        question=QuestionRead.model_validate(q),
                        answer=ExamAnswerRead.model_validate(ans),
                    )
                )
            if bundles:
                sec_list.append(
                    SubmissionGroupSection(
                        group=QuestionGroupRead.model_validate(grp),
                        items=bundles,
                    )
                )
        if sec_list:
            sections[subj] = sec_list

    all_attempts = [
        ExamSubmissionSummaryRead.model_validate(s)
        for s in sorted(exam.submissions, key=lambda x: x.attempt_number, reverse=True)
    ]

    base = ExamSubmissionSummaryRead.model_validate(sub)
    return ExamSubmissionDetailRead(
        **base.model_dump(),
        exam_title=exam.title,
        sections=sections,
        all_attempts=all_attempts,
    )


@router.get("/api/exams/{exam_id}/submissions", response_model=list[ExamSubmissionSummaryRead])
def list_exam_submissions(exam_id: uuid.UUID, db: Session = Depends(get_db)) -> list[ExamSubmissionSummaryRead]:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status_code=404, detail="テストが見つかりません。")
    rows = (
        db.scalars(
            select(ExamSubmission)
            .where(ExamSubmission.exam_id == exam_id)
            .order_by(ExamSubmission.attempt_number.desc())
        )
        .all()
    )
    return [ExamSubmissionSummaryRead.model_validate(r) for r in rows]


@router.post("/api/exams/{exam_id}/submissions", response_model=ExamSubmissionDetailRead)
def create_submission(
    exam_id: uuid.UUID,
    payload: SubmissionCreateRequest,
    db: Session = Depends(get_db),
) -> ExamSubmissionDetailRead:
    exam = (
        db.query(Exam)
        .options(selectinload(Exam.items), selectinload(Exam.submissions).selectinload(ExamSubmission.answers))
        .filter(Exam.id == exam_id)
        .first()
    )
    if exam is None:
        raise HTTPException(status_code=404, detail="テストが見つかりません。")
    if not exam.items:
        raise HTTPException(status_code=400, detail="このテストには問題が含まれていません。")

    target_items: list[ExamItem] = list(exam.items)

    if payload.mode == "wrong_only":
        graded_subs = [
            s for s in sorted(exam.submissions, key=lambda x: x.attempt_number, reverse=True)
            if s.status in ("graded", "reviewed")
        ]
        wrong_item_ids: set[uuid.UUID] = set()
        if graded_subs:
            latest_sub = graded_subs[0]
            wrong_item_ids = {
                a.exam_item_id for a in latest_sub.answers if a.final_is_wrong is not False
            }
        else:
            wrong_item_ids = {it.id for it in exam.items if it.is_wrong is True}

        target_items = [it for it in exam.items if it.id in wrong_item_ids]
        if not target_items:
            raise HTTPException(
                status_code=400,
                detail="前回間違えた問題・要確認の問題がないため、「全問に挑戦」を選択してください。",
            )

    max_attempt = (
        db.scalar(
            select(func.coalesce(func.max(ExamSubmission.attempt_number), 0)).where(
                ExamSubmission.exam_id == exam_id
            )
        )
        or 0
    )

    q_ids = {it.question_id for it in target_items}
    q_rows = db.scalars(select(Question).where(Question.id.in_(q_ids))).all()
    q_map = {q.id: q for q in q_rows}

    sub = ExamSubmission(
        exam_id=exam.id,
        attempt_number=int(max_attempt) + 1,
        mode=payload.mode,
        status="in_progress",
        total_count=len(target_items),
        correct_count=0,
        wrong_count=0,
        uncertain_count=len(target_items),
    )
    db.add(sub)
    db.flush()

    for it in target_items:
        q = q_map.get(it.question_id)
        default_mode = (
            "choice" if (q and q.question_type in ("single_choice", "multi_choice")) else "handwriting"
        )
        db.add(
            ExamAnswer(
                submission_id=sub.id,
                exam_item_id=it.id,
                question_id=it.question_id,
                input_mode=default_mode,
                selected_options=[],
                typed_text="",
                strokes_data={},
                ai_status="unanswered",
                ai_feedback="",
            )
        )

    db.commit()
    return _build_submission_detail(db, sub.id)


@router.get("/api/submissions/{submission_id}", response_model=ExamSubmissionDetailRead)
def get_submission(submission_id: uuid.UUID, db: Session = Depends(get_db)) -> ExamSubmissionDetailRead:
    return _build_submission_detail(db, submission_id)


@router.put("/api/submissions/{submission_id}/answers/{exam_item_id}", response_model=ExamAnswerRead)
def save_submission_answer(
    submission_id: uuid.UUID,
    exam_item_id: uuid.UUID,
    payload: ExamAnswerSaveRequest,
    db: Session = Depends(get_db),
) -> ExamAnswerRead:
    sub = db.get(ExamSubmission, submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="解答記録が見つかりません。")
    if sub.status not in ("in_progress",):
        raise HTTPException(status_code=400, detail="すでに提出済みの解答は編集できません。")

    ans = db.scalar(
        select(ExamAnswer).where(
            ExamAnswer.submission_id == submission_id,
            ExamAnswer.exam_item_id == exam_item_id,
        )
    )
    if ans is None:
        raise HTTPException(status_code=404, detail="該当の設問が見つかりません。")

    ans.input_mode = payload.input_mode
    ans.selected_options = [str(x).strip() for x in (payload.selected_options or []) if str(x).strip()]
    ans.typed_text = payload.typed_text or ""
    ans.strokes_data = payload.strokes_data or {}

    if payload.image_data_url is not None:
        if payload.image_data_url.strip():
            try:
                ans.handwriting_image_path = save_handwriting_image(
                    submission_id, exam_item_id, payload.image_data_url
                )
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"手書き画像の保存に失敗しました: {exc}") from exc
        else:
            ans.handwriting_image_path = None

    if payload.duration_seconds is not None:
        sub.duration_seconds = max(sub.duration_seconds, payload.duration_seconds)

    db.commit()
    db.refresh(ans)
    return ExamAnswerRead.model_validate(ans)


@router.post("/api/submissions/{submission_id}/submit", response_model=ExamSubmissionDetailRead)
def submit_and_grade(
    submission_id: uuid.UUID,
    payload: SubmissionSubmitRequest,
    db: Session = Depends(get_db),
) -> ExamSubmissionDetailRead:
    sub = (
        db.query(ExamSubmission)
        .options(selectinload(ExamSubmission.answers))
        .filter(ExamSubmission.id == submission_id)
        .first()
    )
    if sub is None:
        raise HTTPException(status_code=404, detail="解答記録が見つかりません。")

    if payload.duration_seconds is not None:
        sub.duration_seconds = max(sub.duration_seconds, payload.duration_seconds)

    q_ids = {a.question_id for a in sub.answers}
    q_rows = db.scalars(select(Question).where(Question.id.in_(q_ids))).all()
    q_map = {q.id: q for q in q_rows}

    sub.status = "grading"
    db.commit()

    try:
        grade_submission(db, sub, q_map)
        db.commit()
    except ValueError as exc:
        sub.status = "in_progress"
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        sub.status = "in_progress"
        db.commit()
        raise HTTPException(status_code=502, detail=f"AI自動採点に失敗しました: {exc}") from exc

    return _build_submission_detail(db, sub.id)


@router.post("/api/submissions/{submission_id}/regrade", response_model=ExamSubmissionDetailRead)
def regrade_submission(
    submission_id: uuid.UUID,
    payload: SubmissionRegradeRequest | None = None,
    db: Session = Depends(get_db),
) -> ExamSubmissionDetailRead:
    """
    提出済みの解答記録を最新の模範解答・別解・採点ルールで再採点する。
    デフォルト（rerun_ocr=False）では既存の手書き読み取り結果を再利用し、高速かつ低コストで再照合する。
    """
    sub = (
        db.query(ExamSubmission)
        .options(selectinload(ExamSubmission.answers))
        .filter(ExamSubmission.id == submission_id)
        .first()
    )
    if sub is None:
        raise HTTPException(status_code=404, detail="解答記録が見つかりません。")
    if sub.status == "in_progress":
        raise HTTPException(status_code=400, detail="まだ提出されていない解答です。先に提出してください。")

    rerun_ocr = bool(payload.rerun_ocr) if payload is not None else False
    q_ids = {a.question_id for a in sub.answers}
    q_rows = db.scalars(select(Question).where(Question.id.in_(q_ids))).all()
    q_map = {q.id: q for q in q_rows}

    try:
        grade_submission(db, sub, q_map, rerun_ocr=rerun_ocr)
        sub.synced_to_bank = False
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=f"再採点に失敗しました: {exc}") from exc

    return _build_submission_detail(db, sub.id)


@router.patch("/api/submissions/{submission_id}/answers/{exam_item_id}/review")
def review_submission_answer(
    submission_id: uuid.UUID,
    exam_item_id: uuid.UUID,
    payload: ExamAnswerReviewRequest,
    db: Session = Depends(get_db),
) -> dict:
    sub = (
        db.query(ExamSubmission)
        .options(selectinload(ExamSubmission.answers))
        .filter(ExamSubmission.id == submission_id)
        .first()
    )
    if sub is None:
        raise HTTPException(status_code=404, detail="解答記録が見つかりません。")

    ans = next((a for a in sub.answers if a.exam_item_id == exam_item_id), None)
    if ans is None:
        raise HTTPException(status_code=404, detail="該当の設問が見つかりません。")

    ans.final_is_wrong = payload.final_is_wrong
    recompute_submission_counts(sub)
    if sub.uncertain_count == 0 and sub.status == "graded":
        sub.status = "reviewed"

    db.commit()
    return {
        "id": str(ans.id),
        "exam_item_id": str(ans.exam_item_id),
        "final_is_wrong": ans.final_is_wrong,
        "correct_count": sub.correct_count,
        "wrong_count": sub.wrong_count,
        "uncertain_count": sub.uncertain_count,
        "status": sub.status,
    }


@router.post("/api/submissions/{submission_id}/sync-mistakes")
def sync_submission_mistakes(submission_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    """
    今回の最終採点結果を exam_items.is_wrong と問題バンクの wrong_count / needs_review に反映する。
    """
    sub = (
        db.query(ExamSubmission)
        .options(selectinload(ExamSubmission.answers))
        .filter(ExamSubmission.id == submission_id)
        .first()
    )
    if sub is None:
        raise HTTPException(status_code=404, detail="解答記録が見つかりません。")

    now = datetime.now(timezone.utc)
    updated_count = 0
    wrong_marked = 0
    cleared_review = 0

    for ans in sub.answers:
        if ans.final_is_wrong is None:
            continue
        item = db.get(ExamItem, ans.exam_item_id)
        q = db.get(Question, ans.question_id)
        if item is None or q is None:
            continue

        old_val = item.is_wrong
        new_val = ans.final_is_wrong
        item.is_wrong = new_val
        q.last_tested_at = now

        if new_val is True and old_val is not True:
            q.wrong_count += 1
            q.needs_review = True
            wrong_marked += 1
        elif old_val is True and new_val is False:
            q.needs_review = False
            cleared_review += 1
        elif new_val is True:
            q.needs_review = True
            wrong_marked += 1
        elif new_val is False:
            if q.needs_review:
                q.needs_review = False
                cleared_review += 1

        updated_count += 1

    sub.synced_to_bank = True
    if sub.uncertain_count == 0:
        sub.status = "reviewed"
    db.commit()
    return {
        "synced": True,
        "updated_count": updated_count,
        "wrong_marked": wrong_marked,
        "cleared_review": cleared_review,
    }


@router.delete("/api/submissions/{submission_id}")
def delete_submission(submission_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, bool]:
    sub = db.get(ExamSubmission, submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="解答記録が見つかりません。")
    db.delete(sub)
    db.commit()
    cleanup_submission_files(submission_id)
    return {"deleted": True}
