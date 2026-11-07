import base64
import json
import time
from pathlib import Path

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet
from garmin_personal_api import (
    BearerToken,
    GarminPersonalApiClient,
    HttpError,
    PersonalApiAuthenticator,
)

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

PREVIEW = {"start_date": "2026-07-01", "end_date": "2026-07-02"}


def _jwt(n: int) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"n": n}).encode()).decode()
    return f"h.{payload.rstrip('=')}.s"


def _http_error(status: int) -> HttpError:
    return HttpError(status_code=status, method="GET", url="u", response_text="")


@pytest.fixture(autouse=True)
def secret_key(monkeypatch):
    monkeypatch.setenv("GARMIN_SECRET_KEY", Fernet.generate_key().decode())


class Exchanges:
    def __init__(self) -> None:
        self.calls: list[tuple[str, bool]] = []
        self.cache_files: list[Path] = []
        self.lifetime = 86400.0

    @property
    def last_token(self) -> str:
        return _jwt(len(self.calls))


@pytest.fixture
def exchanges(monkeypatch):
    ex = Exchanges()

    def fake_obtain_token(self, api_key, *, force_refresh=False):
        ex.cache_files.append(self.bearer_token_cache_file)
        if api_key == "bad":
            raise HttpError(
                status_code=401, method="POST", url="u", response_text="nope"
            )
        ex.calls.append((api_key, force_refresh))
        return BearerToken(
            access_token=ex.last_token, expires_at=time.time() + ex.lifetime
        )

    monkeypatch.setattr(PersonalApiAuthenticator, "obtain_token", fake_obtain_token)
    return ex


@pytest.fixture
def searches(monkeypatch):
    """Records the bearer token of each search; tests set `responses` per call."""
    state: dict = {"tokens": [], "responses": []}

    def fake_search(self, **kwargs):
        state["tokens"].append(self._headers["Authorization"].removeprefix("Bearer "))
        response = state["responses"].pop(0) if state["responses"] else [ACTIVITY]
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(GarminPersonalApiClient, "search_activities", fake_search)
    return state


def _connect(client, api_key="key-123", **extra):
    return client.post(
        "/api/garmin/connect",
        params={"user": USER},
        json={"api_key": api_key, **extra},
    )


def _preview(client):
    return client.post("/api/garmin/sync/preview", params={"user": USER}, json=PREVIEW)


def _row(db_path) -> dict | None:
    engine = sa.create_engine(f"sqlite:///{db_path}")
    with engine.connect() as conn:
        row = (
            conn.execute(sa.text("SELECT * FROM garmin_credentials")).mappings().first()
        )
    engine.dispose()
    return dict(row) if row else None


def _stored_token(db_path) -> str:
    row = _row(db_path)
    assert row is not None
    return decrypt_secret(row["bearer_token"])


def test_connect_stores_encrypted_key_and_token(client, db_path, seed, exchanges):
    seed([])
    r = _connect(client, api_key="  key-123\n", api_key_expires_on="2027-11-06")
    assert r.status_code == 200, r.text
    assert r.json()["connected"] is True
    assert r.json()["api_key_expires_on"] == "2027-11-06"
    assert exchanges.calls == [("key-123", True)]

    row = _row(db_path)
    assert row is not None
    assert row["api_key"] != "key-123"
    assert decrypt_secret(row["api_key"]) == "key-123"
    assert _stored_token(db_path) == exchanges.last_token
    assert row["bearer_token_expires_at"] is not None


def test_token_exchange_leaves_no_cache_file(client, seed, exchanges):
    seed([])
    _connect(client)
    assert exchanges.cache_files
    assert not any(p.exists() or p.parent.exists() for p in exchanges.cache_files)


def test_connect_rejects_bad_key(client, seed, exchanges):
    seed([])
    r = _connect(client, api_key="bad")
    assert r.status_code == 401
    status = client.get("/api/garmin/status", params={"user": USER}).json()
    assert status["connected"] is False


def test_preview_reuses_stored_token(client, seed, exchanges, searches):
    seed([])
    _connect(client)
    stored = exchanges.last_token

    assert _preview(client).status_code == 200
    assert _preview(client).status_code == 200
    assert len(exchanges.calls) == 1
    assert searches["tokens"] == [stored, stored]


def test_preview_exchanges_key_when_token_nearly_expired(
    client, db_path, seed, exchanges, searches
):
    seed([])
    exchanges.lifetime = 1800
    _connect(client)
    exchanges.lifetime = 86400

    assert _preview(client).status_code == 200
    assert len(exchanges.calls) == 2
    assert searches["tokens"] == [exchanges.last_token]
    assert _stored_token(db_path) == exchanges.last_token


def test_preview_replaces_revoked_token(client, db_path, seed, exchanges, searches):
    seed([])
    _connect(client)
    revoked = exchanges.last_token
    searches["responses"] = [_http_error(401), [ACTIVITY]]

    r = _preview(client)
    assert r.status_code == 200, r.text
    assert searches["tokens"] == [revoked, exchanges.last_token]
    assert _stored_token(db_path) == exchanges.last_token


def test_preview_pages_through_activities(client, seed, exchanges, searches):
    seed([])
    _connect(client)
    searches["responses"] = [[ACTIVITY] * 20, [{**ACTIVITY, "activityId": 2}]]

    r = _preview(client)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 21
    assert len(searches["tokens"]) == 2


@pytest.mark.parametrize(("garmin_status", "expected"), [(429, 429), (500, 502)])
def test_preview_maps_garmin_errors(
    client, seed, exchanges, searches, garmin_status, expected
):
    seed([])
    _connect(client)
    searches["responses"] = [_http_error(garmin_status)]
    assert _preview(client).status_code == expected


def test_disconnect_removes_credentials(client, db_path, seed, exchanges):
    seed([])
    _connect(client)

    r = client.delete("/api/garmin/disconnect", params={"user": USER})
    assert r.status_code == 204
    assert _row(db_path) is None
    status = client.get("/api/garmin/status", params={"user": USER}).json()
    assert status["connected"] is False
