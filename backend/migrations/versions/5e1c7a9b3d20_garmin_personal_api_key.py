"""replace garmin password login with personal api key

Revision ID: 5e1c7a9b3d20
Revises: 4d9b2c5e8f31
Create Date: 2026-11-06 00:00:00

Stored passwords and DI tokens can't be converted to Personal API keys, so
existing connections are dropped and users reconnect with a key.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5e1c7a9b3d20"
down_revision: str | Sequence[str] | None = "4d9b2c5e8f31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create(columns: list[sa.Column]) -> None:
    op.create_table(
        "garmin_credentials",
        sa.Column("user_id", sa.String(), nullable=False),
        *columns,
        sa.Column("last_sync_at", sa.DateTime(), nullable=True),
        sa.Column("last_sync_error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def upgrade() -> None:
    op.drop_table("garmin_credentials")
    _create(
        [
            sa.Column("api_key", sa.String(), nullable=False),
            sa.Column("api_key_expires_on", sa.Date(), nullable=True),
        ]
    )


def downgrade() -> None:
    op.drop_table("garmin_credentials")
    _create(
        [
            sa.Column("garmin_username", sa.String(), nullable=False),
            sa.Column("garmin_password", sa.String(), nullable=False),
            sa.Column("di_token", sa.String(), nullable=True),
            sa.Column("di_refresh_token", sa.String(), nullable=True),
            sa.Column("di_client_id", sa.String(), nullable=True),
            sa.Column("token_expires_at", sa.DateTime(), nullable=True),
            sa.Column("mfa_pending", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("mfa_state", sa.Text(), nullable=True),
        ]
    )
