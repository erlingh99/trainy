from pathlib import Path

DATABASE_URL = "sqlite+aiosqlite:////app/data/training.db"

FRONTEND_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"
MIGRATIONS_PATH = Path(__file__).parent.parent / "alembic.ini"
