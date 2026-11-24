import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class QuestionGroup(Base):
    __tablename__ = "question_groups"
    __table_args__ = (
        Index("ix_question_groups_subject_status", "subject", "status"),
        Index("ix_question_groups_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject: Mapped[str] = mapped_column(String(20), nullable=False)  # kokugo | rika | shakai | sansu
    source_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    source_image_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    lead_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")  # draft | published | archived
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    questions: Mapped[list["Question"]] = relationship(
        "Question",
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="Question.sort_order",
    )
    images: Mapped[list["QuestionImage"]] = relationship(
        "QuestionImage",
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="QuestionImage.sort_order",
    )


class QuestionImage(Base):
    __tablename__ = "question_images"
    __table_args__ = (Index("ix_question_images_group_id", "group_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_groups.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("questions.id", ondelete="SET NULL"),
        nullable=True,
    )
    raw_crop_path: Mapped[str] = mapped_column(Text, nullable=False)
    cleaned_path: Mapped[str] = mapped_column(Text, nullable=False)
    use_cleaned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    crop_box: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)  # {ymin, xmin, ymax, xmax}
    caption: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    group: Mapped["QuestionGroup"] = relationship("QuestionGroup", back_populates="images")


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (
        Index("ix_questions_group_id", "group_id"),
        Index("ix_questions_needs_review", "needs_review"),
        Index("ix_questions_last_tested_at", "last_tested_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_groups.id", ondelete="CASCADE"),
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # kanji_write | kanji_read | kokugo_subjective | single_choice | multi_choice | fill_blank | short_answer
    question_type: Mapped[str] = mapped_column(String(40), nullable=False, default="short_answer")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    options: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)  # [{label, text}]
    answer_box_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    manual_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    memo: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tested_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    group: Mapped["QuestionGroup"] = relationship("QuestionGroup", back_populates="questions")
