from collections import Counter
from collections.abc import Sequence
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..dependencies import DbSession
from ..models.models import Session, User

router = APIRouter(prefix="/api/summary", tags=["summary"])

QUALITY_INTENSITIES = {"threshold", "vo2", "max"}


async def _resolve_user(db: AsyncSession, user: str) -> User:
    result = await db.exec(select(User).where(User.name == user))
    u = result.first()
    if not u:
        raise HTTPException(404, f"Unknown user: {user}")
    return u


def _iso_week_range(iso_week: str) -> tuple[date, date]:
    try:
        year_s, w_s = iso_week.split("-W")
        year = int(year_s)
        week = int(w_s)
        start = date.fromisocalendar(year, week, 1)
        end = start + timedelta(days=6)
        return start, end
    except (ValueError, TypeError) as e:
        raise HTTPException(400, "iso_week must look like 2026-W22") from e


def _month_range(yyyymm: str) -> tuple[date, date]:
    try:
        y_s, m_s = yyyymm.split("-")
        y, m = int(y_s), int(m_s)
        start = date(y, m, 1)
        end = date(y + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1) - timedelta(
            days=1
        )
        return start, end
    except (ValueError, TypeError) as e:
        raise HTTPException(400, "yyyymm must look like 2026-05") from e


RUNNING_FORMS = {"running", "orienteering"}


def _aggregate(sessions: Sequence[Session], forms: set[str] | None = None) -> dict:
    per_session = [
        [p for p in s.parts or [] if forms is None or p.get("form") in forms]
        for s in sessions
    ]
    counted = [parts for parts in per_session if parts or forms is None]
    all_parts = [p for parts in counted for p in parts]
    total_seconds = sum(p.get("duration_seconds") or 0 for p in all_parts)
    running_parts = [p for p in all_parts if p.get("form") in RUNNING_FORMS]
    total_distance = sum(p.get("distance_km") or 0.0 for p in running_parts)
    quality = sum(
        1
        for parts in counted
        if any(
            (p.get("intensity") or "") in QUALITY_INTENSITIES or p.get("competition")
            for p in parts
        )
    )
    by_form: Counter[str] = Counter(p["form"] for p in all_parts if p.get("form"))
    by_character: Counter[str] = Counter(
        p["character"] for p in all_parts if p.get("character")
    )
    n = len(counted)
    return {
        "session_count": n,
        "total_seconds": total_seconds,
        "total_distance_km": round(total_distance, 2),
        "quality_sessions": quality,
        "by_form": dict(by_form),
        "by_character": dict(by_character),
        "avg_km_per_session": round(total_distance / n, 2) if n else 0.0,
        "avg_seconds_per_session": int(total_seconds / n) if n else 0,
    }


@router.get("/season")
async def season_summary(
    db: DbSession,
    user: str,
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    status: str | None = Query(None),
    running: bool = Query(False),
):
    forms = RUNNING_FORMS if running else None
    try:
        from_d = date.fromisoformat(from_date)
        to_d = date.fromisoformat(to_date)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, "from/to must be YYYY-MM-DD") from e
    u = await _resolve_user(db, user)
    result = await db.exec(
        select(Session)
        .where(Session.user_id == u.id, Session.date >= from_d, Session.date <= to_d)
        .order_by(col(Session.date), col(Session.session_no))
    )
    all_sessions = result.all()
    if status:
        all_sessions = [s for s in all_sessions if s.status == status]

    weeks = []
    cur = from_d
    while cur <= to_d:
        iso = cur.isocalendar()
        wk_end = min(cur + timedelta(days=6 - cur.weekday()), to_d)
        iso_week = f"{iso[0]}-W{iso[1]:02d}"
        wk_sessions = [s for s in all_sessions if cur <= s.date <= wk_end]
        weeks.append(
            {
                "iso_week": iso_week,
                "start": cur.isoformat(),
                "end": wk_end.isoformat(),
                "totals": _aggregate(wk_sessions, forms),
            }
        )
        cur = wk_end + timedelta(days=1)

    return {
        "from": from_date,
        "to": to_date,
        "weeks": weeks,
        "totals": _aggregate(all_sessions, forms),
    }


@router.get("/week")
async def week_summary(
    db: DbSession,
    user: str,
    iso_week: str = Query(..., alias="iso_week"),
):
    u = await _resolve_user(db, user)
    start, end = _iso_week_range(iso_week)
    result = await db.exec(
        select(Session)
        .where(Session.user_id == u.id, Session.date >= start, Session.date <= end)
        .order_by(col(Session.date), col(Session.session_no))
    )
    sessions = result.all()
    return {
        "iso_week": iso_week,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "sessions": sessions,
        "totals": _aggregate(sessions),
    }


@router.get("/month")
async def month_summary(
    db: DbSession,
    user: str,
    yyyymm: str = Query(...),
):
    u = await _resolve_user(db, user)
    start, end = _month_range(yyyymm)
    result = await db.exec(
        select(Session).where(
            Session.user_id == u.id, Session.date >= start, Session.date <= end
        )
    )
    sessions = result.all()
    return {
        "yyyymm": yyyymm,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "totals": _aggregate(sessions),
    }
