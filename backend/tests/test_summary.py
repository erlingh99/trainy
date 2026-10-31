from datetime import date

from .helpers import USER

FIXTURE = [
    {
        "date": date(2026, 7, 6),
        "status": "done",
        "parts": [{"form": "running", "duration_seconds": 3600, "distance_km": 12.0}],
    },
    {
        "date": date(2026, 7, 7),
        "status": "done",
        "parts": [
            {"form": "orienteering", "duration_seconds": 1800, "distance_km": 5.0},
            {"form": "strength", "duration_seconds": 1200},
        ],
    },
    {
        "date": date(2026, 7, 8),
        "status": "done",
        "parts": [{"form": "cycling", "duration_seconds": 5400, "distance_km": 40.0}],
    },
]


def season(client, **params) -> dict:
    query = {"user": USER, "from": "2026-07-06", "to": "2026-07-12", **params}
    r = client.get("/api/summary/season", params=query)
    assert r.status_code == 200, r.text
    return r.json()


def test_season_all_activities(seed, client):
    seed(FIXTURE)
    totals = season(client)["totals"]
    assert totals["session_count"] == 3
    assert totals["total_seconds"] == 3600 + 1800 + 1200 + 5400
    assert totals["total_distance_km"] == 17.0
    assert totals["by_form"] == {
        "running": 1,
        "orienteering": 1,
        "strength": 1,
        "cycling": 1,
    }


def test_season_running_only_drops_other_parts_and_sessions(seed, client):
    seed(FIXTURE)
    body = season(client, running="true")
    totals = body["totals"]
    assert totals["session_count"] == 2
    assert totals["total_seconds"] == 3600 + 1800
    assert totals["total_distance_km"] == 17.0
    assert totals["by_form"] == {"running": 1, "orienteering": 1}
    assert body["weeks"][0]["totals"] == totals
