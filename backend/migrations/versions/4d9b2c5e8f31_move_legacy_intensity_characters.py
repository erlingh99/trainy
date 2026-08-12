"""move legacy intensity values out of session part character

Revision ID: 4d9b2c5e8f31
Revises: 3c8a1f2e9d47
Create Date: 2026-07-28 00:00:00

Sessions created before character and intensity were split store intensity
values (recovery/flow/threshold/vo2/max) in `character`, which no longer
matches SessionCharacter and renders as a raw i18n key in the UI.
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "4d9b2c5e8f31"
down_revision: str | Sequence[str] | None = "3c8a1f2e9d47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INTENSITIES = {"recovery", "flow", "threshold", "vo2", "max"}

_sessions = sa.table(
    "sessions", sa.column("id", sa.String), sa.column("parts", sa.JSON)
)


def _rows(conn):
    for sid, parts in conn.execute(sa.select(_sessions.c.id, _sessions.c.parts)):
        if isinstance(parts, str):
            parts = json.loads(parts)
        if isinstance(parts, list):
            yield sid, parts


def upgrade() -> None:
    conn = op.get_bind()
    for sid, parts in _rows(conn):
        changed = False
        for p in parts:
            if not isinstance(p, dict) or p.get("character") not in _INTENSITIES:
                continue
            if not p.get("intensity"):
                p["intensity"] = p["character"]
            p["character"] = None
            changed = True
        if changed:
            conn.execute(
                _sessions.update().where(_sessions.c.id == sid).values(parts=parts)
            )


def downgrade() -> None:
    """Irreversible: the original character/intensity split is not recoverable."""
