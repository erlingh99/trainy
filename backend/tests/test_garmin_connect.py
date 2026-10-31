import sqlite3

import pytest
from cryptography.fernet import Fernet

from app.routers import garmin

from .helpers import USER


@pytest.fixture(autouse=True)
def secret_key(monkeypatch):
    monkeypatch.setenv("GARMIN_SECRET_KEY", Fernet.generate_key().decode())


def test_connect_does_not_hold_write_lock_during_login(client, db_path, monkeypatch):
    """Login takes 30-45s+; another write during it must not hit "database is locked"."""
    write_errors: list[Exception] = []

    def fake_login(self):
        # Runs in the worker thread while the request is mid-flight. timeout=0
        # fails at once instead of waiting if the request holds the write lock.
        conn = sqlite3.connect(db_path, timeout=0)
        try:
            conn.execute("UPDATE users SET name = name")
            conn.commit()
        except sqlite3.OperationalError as e:
            write_errors.append(e)
        finally:
            conn.close()
        return {"di_token": "tok"}, False

    monkeypatch.setattr(garmin.GarminClient, "login", fake_login)

    r = client.post(
        "/api/garmin/connect",
        params={"user": USER},
        json={"garmin_username": "me@example.com", "garmin_password": "pw"},
    )

    assert r.status_code == 200, r.text
    assert r.json()["connected"] is True
    assert write_errors == []
