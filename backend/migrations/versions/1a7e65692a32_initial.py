"""initial

Revision ID: 1a7e65692a32
Revises:
Create Date: 2026-05-28 00:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "1a7e65692a32"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_name", "users", ["name"], unique=True)

    op.create_table(
        "goals",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("sessions_per_week", sa.Float(), nullable=False),
        sa.Column("hours_per_week", sa.Float(), nullable=False),
        sa.Column("km_per_week", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("session_no", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("parts", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("comment", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sessions_date", "sessions", ["date"], unique=False)
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], unique=False)
    op.add_column("users", sa.Column("palette", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_index("ix_sessions_date", table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("goals")
    op.drop_index("ix_users_name", table_name="users")
    op.drop_table("users")
    op.drop_column("users", "palette")
