"""add llm_usage token stats to question_groups

Revision ID: 0004_group_llm_usage
Revises: 0003_submission_llm_usage
Create Date: 2026-11-25 11:40:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0004_group_llm_usage"
down_revision: Union[str, None] = "0003_submission_llm_usage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "question_groups",
        sa.Column(
            "llm_usage",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("question_groups", "llm_usage")
