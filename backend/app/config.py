import os
from pathlib import Path

DATABASE_URL = "sqlite+aiosqlite:////app/data/training.db"

FRONTEND_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"
MIGRATIONS_PATH = Path(__file__).parent.parent / "alembic.ini"

# Required for Garmin password encryption at rest.
# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
GARMIN_SECRET_KEY = os.environ.get("GARMIN_SECRET_KEY", "")
