import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    paper_size: Mapped[str] = mapped_column(String(20), nullable=False, default="B4")  # B4 | A4
    layout_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    items: Mapped[list["ExamItem"]] = relationship(
        "ExamItem",
        back_populates="exam",
        cascade="all, delete-orphan",
        order_by="ExamItem.section_order, ExamItem.item_order",
    )
    submissions: Mapped[list["ExamSubmission"]] = relationship(
        "ExamSubmission",
        back_populates="exam",
        cascade="all, delete-orphan",
        order_by="ExamSubmission.attempt_number.desc()",
    )


class ExamItem(Base):
    __tablename__ = "exam_items"
    __table_args__ = (
        Index("ix_exam_items_exam_id", "exam_id"),
        Index("ix_exam_items_question_id", "question_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exams.id", ondelete="CASCADE"),
        nullable=False,
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_groups.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("questions.id", ondelete="CASCADE"),
        nullable=False,
    )
    subject: Mapped[str] = mapped_column(String(20), nullable=False)
    section_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    item_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_wrong: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)

    exam: Mapped["Exam"] = relationship("Exam", back_populates="items")


class ExamSubmission(Base):
    __tablename__ = "exam_submissions"
    __table_args__ = (
        Index("ix_exam_submissions_exam_id", "exam_id"),
        Index("ix_exam_submissions_exam_attempt", "exam_id", "attempt_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exams.id", ondelete="CASCADE"),
        nullable=False,
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="full")  # full | wrong_only
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="in_progress")  # in_progress | grading | graded | reviewed
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uncertain_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    synced_to_bank: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    llm_usage: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    exam: Mapped["Exam"] = relationship("Exam", back_populates="submissions")
    answers: Mapped[list["ExamAnswer"]] = relationship(
        "ExamAnswer",
        back_populates="submission",
        cascade="all, delete-orphan",
    )


class ExamAnswer(Base):
    __tablename__ = "exam_answers"
    __table_args__ = (
        Index("ix_exam_answers_submission_id", "submission_id"),
        Index("ix_exam_answers_exam_item_id", "exam_item_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exam_submissions.id", ondelete="CASCADE"),
        nullable=False,
    )
    exam_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exam_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("questions.id", ondelete="CASCADE"),
        nullable=False,
    )
    input_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="handwriting")  # choice | handwriting | text
    selected_options: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    typed_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    strokes_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    handwriting_image_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    recognized_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    stroke_issues: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unanswered")  # correct | wrong | partial | uncertain | no_key | unanswered
    ai_feedback: Mapped[str] = mapped_column(Text, nullable=False, default="")
    final_is_wrong: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    submission: Mapped["ExamSubmission"] = relationship("ExamSubmission", back_populates="answers")
