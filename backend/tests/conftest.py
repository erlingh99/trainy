from datetime import date, timedelta

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session as SyncSession
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database.db import get_session
from app.main import app
from app.models.models import Session

from .helpers import USER


@pytest.fixture
def db_path(tmp_path):
    """A fresh SQLite file per test, reachable from both the sync and async engines."""
    return tmp_path / "test.db"


@pytest.fixture
def seed(db_path):
    """Insert sessions synchronously; the app reads them back over aiosqlite."""
    engine = sa.create_engine(f"sqlite:///{db_path}")
    SQLModel.metadata.create_all(engine)
    user_id = "u1"
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO users (id, name, created_at) VALUES (:i, :n, '2026-01-01')"
            ),
            {"i": user_id, "n": USER},
        )

    def _seed(rows: list[dict]):
        with SyncSession(engine) as s:
            for i, row in enumerate(rows):
                s.add(
                    Session(
                        user_id=user_id,
                        date=row.get("date", date(2026, 7, 1) + timedelta(days=i)),
                        session_no=row.get("session_no", 1),
                        name=row.get("name"),
                        comment=row.get("comment"),
                        status=row.get("status", "planned"),
                        parts=row.get("parts", []),
                        lactate_measurements=row.get("lactate_measurements", []),
                    )
                )
            s.commit()

    yield _seed
    engine.dispose()


@pytest.fixture
def client(db_path, seed):
    # NullPool: TestClient runs each request on its own event loop, so a pooled
    # connection would be closed from a different loop than it was opened on —
    # which is what makes aiosqlite call asyncio.get_event_loop() with no loop.
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", poolclass=NullPool)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_session] = override
    # No lifespan: alembic would run against the configured production path.
    yield TestClient(app)
    app.dependency_overrides.clear()
    engine.sync_engine.dispose()
