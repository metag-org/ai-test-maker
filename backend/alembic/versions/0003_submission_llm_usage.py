"""add llm_usage token stats to exam_submissions

Revision ID: 0003_submission_llm_usage
Revises: 0002_online_solving
Create Date: 2026-11-24 23:20:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003_submission_llm_usage"
down_revision: Union[str, None] = "0002_online_solving"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "exam_submissions",
        sa.Column(
            "llm_usage",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("exam_submissions", "llm_usage")
