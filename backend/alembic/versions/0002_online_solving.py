"""add online solving submissions, answers, and question answer metadata

Revision ID: 0002_online_solving
Revises: 0001_initial
Create Date: 2026-11-24 18:35:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002_online_solving"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column(
            "answer_aliases",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
    )
    op.add_column(
        "questions",
        sa.Column(
            "grading_note",
            sa.Text(),
            nullable=False,
            server_default="",
        ),
    )

    op.create_table(
        "exam_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "exam_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("exams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("mode", sa.String(length=20), nullable=False, server_default="full"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="in_progress"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("uncertain_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("synced_to_bank", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_exam_submissions_exam_id", "exam_submissions", ["exam_id"])
    op.create_index("ix_exam_submissions_exam_attempt", "exam_submissions", ["exam_id", "attempt_number"])

    op.create_table(
        "exam_answers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "submission_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("exam_submissions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "exam_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("exam_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("input_mode", sa.String(length=20), nullable=False, server_default="handwriting"),
        sa.Column(
            "selected_options",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("typed_text", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "strokes_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("handwriting_image_path", sa.Text(), nullable=True),
        sa.Column("recognized_text", sa.Text(), nullable=True),
        sa.Column("stroke_issues", sa.Text(), nullable=True),
        sa.Column("ai_confidence", sa.Float(), nullable=True),
        sa.Column("ai_status", sa.String(length=20), nullable=False, server_default="unanswered"),
        sa.Column("ai_feedback", sa.Text(), nullable=False, server_default=""),
        sa.Column("final_is_wrong", sa.Boolean(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_exam_answers_submission_id", "exam_answers", ["submission_id"])
    op.create_index("ix_exam_answers_exam_item_id", "exam_answers", ["exam_item_id"])


def downgrade() -> None:
    op.drop_index("ix_exam_answers_exam_item_id", table_name="exam_answers")
    op.drop_index("ix_exam_answers_submission_id", table_name="exam_answers")
    op.drop_table("exam_answers")

    op.drop_index("ix_exam_submissions_exam_attempt", table_name="exam_submissions")
    op.drop_index("ix_exam_submissions_exam_id", table_name="exam_submissions")
    op.drop_table("exam_submissions")

    op.drop_column("questions", "grading_note")
    op.drop_column("questions", "answer_aliases")
