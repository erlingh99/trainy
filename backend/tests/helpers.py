from typing import Optional

from fastapi.testclient import TestClient

USER = "erling"


def search(client: TestClient, **params) -> dict:
    """GET /api/sessions/search, dropping unset params. Raises on non-200."""
    query: dict[str, str | int | float | None] = {"user": USER}
    query.update({k: v for k, v in params.items() if v is not None})
    r = client.get("/api/sessions/search", params=query)
    assert r.status_code == 200, r.text
    return r.json()


def names(page: dict) -> list[Optional[str]]:
    return [s["name"] for s in page["items"]]


def walk(client: TestClient, limit: int, **params) -> list[Optional[str]]:
    """Follow next_cursor to the end, returning every name seen in order."""
    seen: list[Optional[str]] = []
    cursor = None
    for _ in range(100):
        page = search(client, limit=limit, cursor=cursor, **params)
        seen += names(page)
        if not page["has_more"]:
            return seen
        cursor = page["next_cursor"]
    raise AssertionError("cursor walk did not terminate")
