import base64
import json
import time

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet
from garmin_personal_api import (
    BearerToken,
    GarminPersonalApiClient,
    HttpError,
    PersonalApiAuthenticator,
)

from app.garmin import client as garmin_client
from app.garmin.crypto import decrypt_secret

from .helpers import USER

ACTIVITY = {
    "activityId": 1,
    "activityName": "Morning run",
    "startTimeLocal": "2026-07-01 07:00:00",
    "duration": 3600,
    "distance": 10000,
    "activityType": {"typeKey": "running"},
}


def _jwt(exp: float) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode()
    return f"h.{payload.rstrip('=')}.s"


def _http_error(status: int) -> HttpError:
    return HttpError(status_code=status, method="GET", url="u", response_text="")


@pytest.fixture(autouse=True)
def garmin_env(monkeypatch, tmp_path):
    monkeypatch.setenv("GARMIN_SECRET_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(garmin_client, "GARMIN_TOKEN_CACHE_DIR", str(tmp_path))


@pytest.fixture
def token_calls(monkeypatch):
    calls: list[tuple[str, bool]] = []

    def fake_obtain_token(self, api_key, *, force_refresh=False):
        if api_key == "bad":
            raise HttpError(
                status_code=401, method="POST", url="u", response_text="nope"
            )
        calls.append((api_key, force_refresh))
        return BearerToken(
            access_token=_jwt(time.time() + 86400), expires_at=time.time() + 86400
        )

    monkeypatch.setattr(PersonalApiAuthenticator, "obtain_token", fake_obtain_token)
    return calls


def _connect(client, api_key="key-123", **extra):
    return client.post(
        "/api/garmin/connect",
        params={"user": USER},
        json={"api_key": api_key, **extra},
    )


def _stored_key(db_path) -> str:
    engine = sa.create_engine(f"sqlite:///{db_path}")
    with engine.connect() as conn:
        key = conn.execute(
            sa.text("SELECT api_key FROM garmin_credentials")
        ).scalar_one()
    engine.dispose()
    return key


def test_connect_verifies_and_encrypts_key(client, db_path, seed, token_calls):
    seed([])
    r = _connect(client, api_key="  key-123\n", api_key_expires_on="2027-11-06")
    assert r.status_code == 200, r.text
    assert r.json()["connected"] is True
    assert r.json()["api_key_expires_on"] == "2027-11-06"
    assert token_calls == [("key-123", True)]

    stored = _stored_key(db_path)
    assert stored != "key-123"
    assert decrypt_secret(stored) == "key-123"

    status = client.get("/api/garmin/status", params={"user": USER}).json()
    assert status["connected"] is True


def test_connect_rejects_bad_key(client, seed, token_calls):
    seed([])
    r = _connect(client, api_key="bad")
    assert r.status_code == 401
    status = client.get("/api/garmin/status", params={"user": USER}).json()
    assert status["connected"] is False


def test_preview_pages_through_activities(client, seed, token_calls, monkeypatch):
    seed([])
    _connect(client)
    pages = [[ACTIVITY] * 20, [{**ACTIVITY, "activityId": 2}]]
    seen: list[dict] = []

    def fake_search(self, **kwargs):
        seen.append(kwargs)
        return pages[len(seen) - 1]

    monkeypatch.setattr(GarminPersonalApiClient, "search_activities", fake_search)
    r = client.post(
        "/api/garmin/sync/preview",
        params={"user": USER},
        json={"start_date": "2026-07-01", "end_date": "2026-07-02"},
    )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 21
    assert [s["start"] for s in seen] == [0, 20]
    assert str(seen[0]["start_date"]) == "2026-07-01"


def test_preview_refreshes_revoked_token_once(client, seed, token_calls, monkeypatch):
    seed([])
    _connect(client)
    attempts: list[int] = []

    def fake_search(self, **kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise _http_error(401)
        return [ACTIVITY]

    monkeypatch.setattr(GarminPersonalApiClient, "search_activities", fake_search)
    r = client.post(
        "/api/garmin/sync/preview",
        params={"user": USER},
        json={"start_date": "2026-07-01", "end_date": "2026-07-01"},
    )
    assert r.status_code == 200, r.text
    assert token_calls[-2:] == [("key-123", False), ("key-123", True)]


@pytest.mark.parametrize(("garmin_status", "expected"), [(429, 429), (500, 502)])
def test_preview_maps_garmin_errors(
    client, seed, token_calls, monkeypatch, garmin_status, expected
):
    seed([])
    _connect(client)

    def fake_search(self, **kwargs):
        raise _http_error(garmin_status)

    monkeypatch.setattr(GarminPersonalApiClient, "search_activities", fake_search)
    r = client.post(
        "/api/garmin/sync/preview",
        params={"user": USER},
        json={"start_date": "2026-07-01", "end_date": "2026-07-01"},
    )
    assert r.status_code == expected


def test_disconnect_removes_key_and_token_cache(client, seed, token_calls):
    seed([])
    _connect(client)
    cache = garmin_client.token_cache_file("u1")
    cache.write_text("{}")

    r = client.delete("/api/garmin/disconnect", params={"user": USER})
    assert r.status_code == 204
    assert not cache.exists()
    status = client.get("/api/garmin/status", params={"user": USER}).json()
    assert status["connected"] is False
