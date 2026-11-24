"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-23 18:45:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "question_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("subject", sa.String(length=20), nullable=False),
        sa.Column("source_name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("source_image_path", sa.Text(), nullable=True),
        sa.Column("lead_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_question_groups_subject_status", "question_groups", ["subject", "status"])
    op.create_index("ix_question_groups_created_at", "question_groups", ["created_at"])

    op.create_table(
        "questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("question_type", sa.String(length=40), nullable=False, server_default="short_answer"),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("answer_box_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("manual_answer", sa.Text(), nullable=True),
        sa.Column("memo", sa.Text(), nullable=False, server_default=""),
        sa.Column("tested_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_questions_group_id", "questions", ["group_id"])
    op.create_index("ix_questions_needs_review", "questions", ["needs_review"])
    op.create_index("ix_questions_last_tested_at", "questions", ["last_tested_at"])

    op.create_table(
        "question_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("questions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("raw_crop_path", sa.Text(), nullable=False),
        sa.Column("cleaned_path", sa.Text(), nullable=False),
        sa.Column("use_cleaned", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("crop_box", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("caption", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_question_images_group_id", "question_images", ["group_id"])

    op.create_table(
        "exams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("paper_size", sa.String(length=20), nullable=False, server_default="B4"),
        sa.Column("layout_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "exam_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "exam_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("exams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("subject", sa.String(length=20), nullable=False),
        sa.Column("section_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("item_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_wrong", sa.Boolean(), nullable=True),
    )
    op.create_index("ix_exam_items_exam_id", "exam_items", ["exam_id"])
    op.create_index("ix_exam_items_question_id", "exam_items", ["question_id"])

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_index("ix_exam_items_question_id", table_name="exam_items")
    op.drop_index("ix_exam_items_exam_id", table_name="exam_items")
    op.drop_table("exam_items")
    op.drop_table("exams")
    op.drop_index("ix_question_images_group_id", table_name="question_images")
    op.drop_table("question_images")
    op.drop_index("ix_questions_last_tested_at", table_name="questions")
    op.drop_index("ix_questions_needs_review", table_name="questions")
    op.drop_index("ix_questions_group_id", table_name="questions")
    op.drop_table("questions")
    op.drop_index("ix_question_groups_created_at", table_name="question_groups")
    op.drop_index("ix_question_groups_subject_status", table_name="question_groups")
    op.drop_table("question_groups")
