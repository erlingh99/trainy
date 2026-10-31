import asyncio
from collections.abc import AsyncGenerator

from alembic import command
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from ..config import DATABASE_URL, MIGRATIONS_PATH

engine = create_async_engine(DATABASE_URL)


@event.listens_for(engine.sync_engine, "connect")
def _configure_sqlite(dbapi_connection, _connection_record):
    # WAL lets reads proceed while a write is in progress; busy_timeout makes a
    # writer wait for a competing one instead of failing with "database is locked".
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=15000")
    cursor.close()


async_session_maker = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def init_db():
    cfg = Config(str(MIGRATIONS_PATH))
    await asyncio.to_thread(command.upgrade, cfg, "head")


async def get_session() -> AsyncGenerator[AsyncSession]:
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except SQLAlchemyError:
            await session.rollback()
            raise
