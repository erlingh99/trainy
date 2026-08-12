from datetime import date

import pytest

from .helpers import USER, names, search, walk

# Six sessions on consecutive days from 2026-07-01, newest = "none" on 07-06.
FIXTURE = [
    {
        "name": "Long run",
        "comment": "easy 100% effort",
        "status": "done",
        "parts": [{"form": "running", "character": "long"}],
    },
    {
        "name": "Intervals",
        "comment": "6x1000",
        "status": "planned",
        "parts": [{"form": "running", "character": "interval"}],
        "lactate_measurements": [{"value_mmol": 5.2}],
    },
    {
        "name": "Race day",
        "status": "done",
        "parts": [{"form": "orienteering", "character": "middle", "competition": True}],
        "lactate_measurements": [{"value_mmol": 8.0}],
    },
    {
        "name": "Gym",
        "comment": "a_b upper",
        "status": "done",
        "parts": [{"form": "strength", "character": "upperbody"}],
    },
    {
        "name": "Brick",
        "status": "skipped",
        "parts": [{"form": "cycling"}, {"form": "running", "character": "tempo"}],
    },
    {"name": None, "comment": "no name here", "status": "planned", "parts": []},
]

ALL_NAMES = ["Long run", "Intervals", "Race day", "Gym", "Brick", None]
NEWEST_FIRST = list(reversed(ALL_NAMES))


@pytest.fixture
def six(seed, client):
    seed(FIXTURE)
    return client


@pytest.mark.parametrize(
    "params,expected",
    [
        ({}, ALL_NAMES),
        # free text spans name and comment, and is case-insensitive
        ({"q": "run"}, ["Long run"]),
        ({"q": "RACE"}, ["Race day"]),
        ({"q": "name"}, [None]),
        # % and _ are literal, not wildcards
        ({"q": "100%"}, ["Long run"]),
        ({"q": "a_b"}, ["Gym"]),
        ({"q": "a%b"}, []),
        ({"status": "done"}, ["Long run", "Race day", "Gym"]),
        # form/character match if any part matches
        ({"form": "running"}, ["Long run", "Intervals", "Brick"]),
        ({"character": "tempo"}, ["Brick"]),
        ({"competition": "true"}, ["Race day"]),
        ({"competition": "false"}, ["Long run", "Intervals", "Gym", "Brick", None]),
        ({"has_lactate": "true"}, ["Intervals", "Race day"]),
        ({"has_lactate": "false"}, ["Long run", "Gym", "Brick", None]),
        ({"form": "running", "status": "done"}, ["Long run"]),
        ({"from": "2026-07-03", "to": "2026-07-04"}, ["Race day", "Gym"]),
    ],
)
def test_filters(six, params, expected):
    assert sorted(names(search(six, **params)), key=str) == sorted(expected, key=str)


def test_first_page_shape(six):
    page = search(six)
    assert sorted(page) == ["has_more", "items", "next_cursor", "total"]
    assert (page["total"], page["has_more"], page["next_cursor"]) == (6, False, None)
    assert names(page) == NEWEST_FIRST


def test_limit_keeps_the_newest(six):
    page = search(six, limit=2)
    assert names(page) == NEWEST_FIRST[:2]
    assert (page["total"], page["has_more"], page["next_cursor"]) == (
        6,
        True,
        "2026-07-05:1",
    )


def test_total_is_first_page_only(six):
    first = search(six, limit=2)
    assert search(six, limit=2, cursor=first["next_cursor"])["total"] is None


def test_total_reflects_the_filter(six):
    page = search(six, limit=1, status="done")
    assert (page["total"], len(page["items"]), page["has_more"]) == (3, 1, True)


def test_no_matches(six):
    page = search(six, q="zzzz")
    assert (page["items"], page["total"], page["has_more"], page["next_cursor"]) == (
        [],
        0,
        False,
        None,
    )


@pytest.mark.parametrize("limit", [1, 2, 3, 5, 6, 7])
def test_cursor_walk_sees_everything_exactly_once(six, limit):
    assert walk(six, limit) == NEWEST_FIRST


@pytest.mark.parametrize("limit", [1, 2, 3])
def test_cursor_walk_preserves_filters(six, limit):
    assert walk(six, limit, status="done") == ["Gym", "Race day", "Long run"]


# Several sessions on one date: session_no is what makes the cursor unambiguous.
SAME_DAY = [
    {"name": f"same-{n}", "date": date(2026, 8, 1), "session_no": n}
    for n in range(1, 6)
]
SAME_DAY_ORDER = ["after", "same-5", "same-4", "same-3", "same-2", "same-1"]


@pytest.fixture
def same_day(seed, client):
    seed([*SAME_DAY, {"name": "after", "date": date(2026, 8, 2), "session_no": 1}])
    return client


def test_same_date_orders_by_session_no(same_day):
    assert names(search(same_day)) == SAME_DAY_ORDER


@pytest.mark.parametrize("limit", [1, 2, 3, 4])
def test_cursor_walk_across_same_date_rows(same_day, limit):
    """A date-only cursor would skip or repeat rows sharing a date."""
    assert walk(same_day, limit) == SAME_DAY_ORDER


@pytest.mark.parametrize(
    "params,status",
    [
        ({"cursor": "nonsense"}, 422),
        ({"cursor": "notadate:1"}, 422),
        ({"cursor": "2026-07-01:x"}, 422),
        ({"limit": 0}, 422),
        ({"limit": 9999}, 422),
        ({"form": "swimming"}, 422),
        ({"status": "procrastinated"}, 422),
    ],
)
def test_rejects_bad_input(six, params, status):
    assert (
        six.get("/api/sessions/search", params={"user": USER, **params}).status_code
        == status
    )


def test_unknown_user(six):
    assert six.get("/api/sessions/search", params={"user": "nobody"}).status_code == 404


def test_list_endpoint_still_returns_a_bare_array(six):
    """The week and month views depend on this shape, not the search envelope."""
    r = six.get(
        "/api/sessions", params={"user": USER, "from": "2026-07-01", "to": "2026-07-02"}
    )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    assert [s["name"] for s in body] == ["Long run", "Intervals"]
