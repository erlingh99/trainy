"""add garmin credentials

Revision ID: 2b3f91c74a10
Revises: 1a7e65692a32
Create Date: 2026-06-01 00:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2b3f91c74a10"
down_revision: str | Sequence[str] | None = "1a7e65692a32"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "garmin_credentials",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("garmin_username", sa.String(), nullable=False),
        sa.Column("garmin_password", sa.String(), nullable=False),
        sa.Column("di_token", sa.String(), nullable=True),
        sa.Column("di_refresh_token", sa.String(), nullable=True),
        sa.Column("di_client_id", sa.String(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(), nullable=True),
        sa.Column("mfa_pending", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("mfa_state", sa.Text(), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(), nullable=True),
        sa.Column("last_sync_error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("garmin_credentials")
