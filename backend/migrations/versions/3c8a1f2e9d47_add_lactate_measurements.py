"""add lactate measurements

Revision ID: 3c8a1f2e9d47
Revises: 2b3f91c74a10
Create Date: 2026-07-28 00:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "3c8a1f2e9d47"
down_revision: Union[str, Sequence[str], None] = "2b3f91c74a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("lactate_measurements", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("sessions", "lactate_measurements")
