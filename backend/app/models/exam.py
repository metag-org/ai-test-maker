import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String
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
