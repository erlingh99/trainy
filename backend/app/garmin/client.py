"""
Garmin Connect Personal API access via Garmin's official client library.

Each user pastes a Personal API key created at
https://connect.garmin.com/app/settings/personalApiToken. The library exchanges
it for a 24h bearer token and caches that token in a per-user file.
"""

from datetime import date
from pathlib import Path

from garmin_personal_api import (
    GarminPersonalApiClient,
    GarminPersonalApiError,
    HttpError,
    PersonalApiAuthenticator,
)

from ..config import GARMIN_TOKEN_CACHE_DIR

_PAGE_SIZE = 20


class GarminAuthError(Exception):
    """The API key is invalid, revoked or expired."""


class GarminRateLimitError(Exception):
    """HTTP 429 from Garmin."""


class GarminConnectionError(Exception):
    """Network failure or unexpected response."""


def token_cache_file(user_id: str) -> Path:
    return Path(GARMIN_TOKEN_CACHE_DIR) / f"{user_id}.json"


def _translate(e: Exception) -> Exception:
    if isinstance(e, HttpError):
        if e.status_code in (401, 403):
            return GarminAuthError(
                "Garmin rejected the API key — it may be invalid or expired"
            )
        if e.status_code == 429:
            return GarminRateLimitError(str(e))
    return GarminConnectionError(str(e))


def _bearer_token(api_key: str, user_id: str, *, force_refresh: bool) -> str:
    with PersonalApiAuthenticator(
        bearer_token_cache_file=token_cache_file(user_id)
    ) as auth:
        return auth.obtain_token(api_key, force_refresh=force_refresh).access_token


def verify_api_key(api_key: str, user_id: str) -> None:
    """Exchange the key for a fresh token, raising if Garmin rejects it."""
    try:
        _bearer_token(api_key, user_id, force_refresh=True)
    except (GarminPersonalApiError, OSError) as e:
        raise _translate(e) from e


def get_activities(
    api_key: str, user_id: str, start_date: date, end_date: date
) -> list[dict]:
    """Fetch all activities in the date range (blocking — run in a thread)."""
    try:
        try:
            return _fetch(
                _bearer_token(api_key, user_id, force_refresh=False),
                start_date,
                end_date,
            )
        except HttpError as e:
            if e.status_code != 401:
                raise
            # A cached token can be revoked before it expires.
            return _fetch(
                _bearer_token(api_key, user_id, force_refresh=True),
                start_date,
                end_date,
            )
    except (GarminPersonalApiError, OSError) as e:
        raise _translate(e) from e


def _fetch(token: str, start_date: date, end_date: date) -> list[dict]:
    activities: list[dict] = []
    with GarminPersonalApiClient(token) as client:
        start = 0
        while True:
            page = client.search_activities(
                start=start,
                limit=_PAGE_SIZE,
                start_date=start_date,
                end_date=end_date,
            )
            if not isinstance(page, list) or not page:
                break
            activities.extend(page)
            if len(page) < _PAGE_SIZE:
                break
            start += _PAGE_SIZE
    return activities
