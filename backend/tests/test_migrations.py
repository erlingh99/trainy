"""Covers 4d9b2c5e8f31, which rewrites rows and cannot be rolled back."""

import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

BACKEND = Path(__file__).resolve().parent.parent
BEFORE_LEGACY_CHARACTERS = "3c8a1f2e9d47"

CASES = [
    pytest.param(
        [{"form": "running", "character": "threshold"}],
        [{"form": "running", "character": None, "intensity": "threshold"}],
        id="moves-intensity-out-of-character",
    ),
    pytest.param(
        [{"form": "running", "character": "vo2", "intensity": "flow"}],
        [{"form": "running", "character": None, "intensity": "flow"}],
        id="keeps-an-intensity-that-is-already-set",
    ),
    pytest.param(
        [{"form": "running", "character": "max", "intensity": None}],
        [{"form": "running", "character": None, "intensity": "max"}],
        id="treats-null-intensity-as-unset",
    ),
    pytest.param(
        [{"form": "running", "character": "interval", "intensity": "threshold"}],
        [{"form": "running", "character": "interval", "intensity": "threshold"}],
        id="leaves-real-characters-alone",
    ),
    pytest.param(
        [{"form": "strength", "character": "upperbody"}],
        [{"form": "strength", "character": "upperbody"}],
        id="leaves-strength-characters-alone",
    ),
    pytest.param([], [], id="handles-sessions-with-no-parts"),
    pytest.param(
        [
            {"form": "cycling", "character": "recovery"},
            {"form": "running", "character": "long"},
        ],
        [
            {"form": "cycling", "character": None, "intensity": "recovery"},
            {"form": "running", "character": "long"},
        ],
        id="rewrites-only-the-offending-part",
    ),
]


@pytest.fixture
def alembic_cfg(tmp_path):
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{tmp_path / 'm.db'}")
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    return cfg


@pytest.fixture
def engine(alembic_cfg):
    e = sa.create_engine(alembic_cfg.get_main_option("sqlalchemy.url"))
    yield e
    e.dispose()


def _parts(engine) -> list[dict]:
    with engine.begin() as c:
        raw = c.execute(sa.text("SELECT parts FROM sessions WHERE id='s1'")).scalar()
    return json.loads(raw) if isinstance(raw, str) else raw


def _run(cfg, engine, parts: list[dict]) -> list[dict]:
    command.upgrade(cfg, BEFORE_LEGACY_CHARACTERS)
    with engine.begin() as c:
        c.execute(
            sa.text(
                "INSERT INTO users (id, name, created_at) VALUES ('u1','e','2026-01-01')"
            )
        )
        c.execute(
            sa.text(
                "INSERT INTO sessions (id, user_id, date, session_no, parts,"
                " lactate_measurements, status, created_at, updated_at)"
                " VALUES ('s1','u1','2026-07-01',1,:p,'[]','planned','2026-01-01','2026-01-01')"
            ),
            {"p": json.dumps(parts)},
        )
    command.upgrade(cfg, "head")
    return _parts(engine)


@pytest.mark.parametrize("before,after", CASES)
def test_legacy_characters_move_to_intensity(alembic_cfg, engine, before, after):
    assert _run(alembic_cfg, engine, before) == after


def test_upgrade_is_idempotent(alembic_cfg, engine):
    once = _run(alembic_cfg, engine, [{"form": "running", "character": "threshold"}])
    command.upgrade(alembic_cfg, "head")
    assert _parts(engine) == once


def test_migrations_run_from_empty(alembic_cfg, engine):
    """Guards the path a fresh deploy takes on startup."""
    command.upgrade(alembic_cfg, "head")
    assert {"users", "sessions"} <= set(sa.inspect(engine).get_table_names())
