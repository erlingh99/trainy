"""
Garmin Connect Personal API access via Garmin's official client library.

Each user pastes a Personal API key created at
https://connect.garmin.com/app/settings/personalApiToken, which is exchanged
for a 24h bearer token. The caller persists that token (in the DB) and passes
it back in; the library's own file cache is confined to a throwaway temp dir.
"""

from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

from garmin_personal_api import (
    BearerToken,
    GarminPersonalApiClient,
    GarminPersonalApiError,
    HttpError,
    PersonalApiAuthenticator,
)

_PAGE_SIZE = 20


class GarminAuthError(Exception):
    """The API key is invalid, revoked or expired."""


class GarminRateLimitError(Exception):
    """HTTP 429 from Garmin."""


class GarminConnectionError(Exception):
    """Network failure or unexpected response."""


def _translate(e: Exception) -> Exception:
    if isinstance(e, HttpError):
        if e.status_code in (401, 403):
            return GarminAuthError(
                "Garmin rejected the API key — it may be invalid or expired"
            )
        if e.status_code == 429:
            return GarminRateLimitError(str(e))
    return GarminConnectionError(str(e))


def _exchange(api_key: str) -> BearerToken:
    with (
        TemporaryDirectory() as tmp,
        PersonalApiAuthenticator(
            bearer_token_cache_file=Path(tmp) / "token.json"
        ) as auth,
    ):
        return auth.obtain_token(api_key, force_refresh=True)


def exchange_api_key(api_key: str) -> BearerToken:
    """Exchange the key for a fresh bearer token, raising if Garmin rejects it."""
    try:
        return _exchange(api_key)
    except (GarminPersonalApiError, OSError) as e:
        raise _translate(e) from e


def get_activities(
    api_key: str, token: str | None, start_date: date, end_date: date
) -> tuple[list[dict], BearerToken | None]:
    """
    Fetch all activities in the date range (blocking — run in a thread).

    Returns the activities and a new bearer token when one had to be obtained,
    or None when the given token was reused.
    """
    try:
        if token is not None:
            try:
                return _fetch(token, start_date, end_date), None
            except HttpError as e:
                # A stored token can be revoked before it expires.
                if e.status_code != 401:
                    raise
        new_token = _exchange(api_key)
        return _fetch(new_token.access_token, start_date, end_date), new_token
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
