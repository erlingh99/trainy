from datetime import date

import sqlalchemy as sa

from app.garmin.mapper import map_activities

from .helpers import USER, search

ACTIVITY = {
    "activityId": 1,
    "activityName": "Morning intervals",
    "description": "  6x4min hard  ",
    "startTimeLocal": "2026-07-01 07:00:00",
    "duration": 3600,
    "distance": 10000,
    "activityType": {"typeKey": "running", "typeDisplayName": "Running"},
}


def _add_creds(db_path):
    engine = sa.create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO garmin_credentials (user_id, garmin_username, garmin_password,"
                " mfa_pending, created_at, updated_at)"
                " VALUES ('u1', 'g', 'x', 0, '2026-01-01', '2026-01-01')"
            )
        )
    engine.dispose()


def _item(**extra):
    return {
        "garmin_activity_id": 1,
        "date": "2026-07-01",
        "form": "running",
        "duration_seconds": 3600,
        "activity_name": "Morning intervals",
        "description": "6x4min hard",
        **extra,
    }


def test_mapper_carries_trimmed_description():
    [p] = map_activities([ACTIVITY], [])
    assert p.activity_name == "Morning intervals"
    assert p.description == "6x4min hard"


def test_mapper_blank_description_is_none():
    [p] = map_activities([{**ACTIVITY, "description": "   "}], [])
    assert p.description is None


def test_apply_create_sets_name_and_comment(client, db_path, seed):
    seed([])
    _add_creds(db_path)
    r = client.post(
        f"/api/garmin/sync/apply?user={USER}",
        json={"items": [_item(action="create")]},
    )
    assert r.status_code == 200, r.text
    [s] = search(client, q=None)["items"]
    assert s["name"] == "Morning intervals"
    assert s["comment"] == "6x4min hard"


def test_apply_match_keeps_existing_comment_and_fills_empty(client, db_path, seed):
    seed(
        [
            {"date": date(2026, 7, 1), "name": "Plan", "comment": "mine"},
            {"date": date(2026, 7, 2), "name": None, "comment": None},
        ]
    )
    _add_creds(db_path)
    sessions = search(client)["items"]
    by_date = {s["date"]: s for s in sessions}
    items = [
        _item(action="match", session_id=by_date["2026-07-01"]["id"]),
        _item(
            action="match",
            session_id=by_date["2026-07-02"]["id"],
            garmin_activity_id=2,
            date="2026-07-02",
        ),
    ]
    r = client.post(f"/api/garmin/sync/apply?user={USER}", json={"items": items})
    assert r.status_code == 200, r.text
    after = {s["date"]: s for s in search(client)["items"]}
    assert after["2026-07-01"]["name"] == "Plan"
    assert after["2026-07-01"]["comment"] == "mine"
    assert after["2026-07-02"]["name"] == "Morning intervals"
    assert after["2026-07-02"]["comment"] == "6x4min hard"
