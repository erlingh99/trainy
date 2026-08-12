import json
from collections import defaultdict
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, or_, tuple_
from sqlalchemy import select as sa_select
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..dependencies import DbSession
from ..models.models import (
    Session,
    SessionCharacter,
    SessionCreate,
    SessionForm,
    SessionReorder,
    SessionStatus,
    SessionUpdate,
    User,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

_LIKE_ESCAPE = "\\"

DEFAULT_SEARCH_LIMIT = 50
MAX_SEARCH_LIMIT = 500


def _contains_pattern(term: str) -> str:
    """LIKE pattern matching `term` literally — user input may contain % or _."""
    escaped = (
        term.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", r"\%")
        .replace("_", r"\_")
    )
    return f"%{escaped}%"


def _part_has(field: str, value: object):
    """Correlated EXISTS over the JSON `parts` array (SQLite json_each)."""
    parts = func.json_each(col(Session.parts)).table_valued(
        "value", joins_implicitly=True
    )
    return (
        sa_select(1)
        .select_from(parts)
        .where(func.json_extract(parts.c.value, f"$.{field}") == value)
        .exists()
    )


async def _resolve_user(db: AsyncSession, user: str) -> User:
    result = await db.exec(select(User).where(User.name == user))
    u = result.first()
    if not u:
        raise HTTPException(404, f"Unknown user: {user}")
    return u


@router.get("")
async def list_sessions(
    db: DbSession,
    user: str = Query(...),
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
):
    u = await _resolve_user(db, user)
    stmt = select(Session).where(Session.user_id == u.id)
    if from_:
        stmt = stmt.where(Session.date >= from_)
    if to:
        stmt = stmt.where(Session.date <= to)
    stmt = stmt.order_by(col(Session.date), col(Session.session_no))
    result = await db.exec(stmt)
    return result.all()


class SessionSearchResult(BaseModel):
    items: list[Session]
    has_more: bool
    next_cursor: str | None = None
    # Only computed for the first page; later pages reuse the client's copy.
    total: int | None = None


def _parse_cursor(cursor: str) -> tuple[date, int]:
    try:
        raw_date, raw_no = cursor.rsplit(":", 1)
        return date.fromisoformat(raw_date), int(raw_no)
    except ValueError as e:
        raise HTTPException(422, f"Invalid cursor: {cursor}") from e


@router.get("/search")
async def search_sessions(
    db: DbSession,
    user: str = Query(...),
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    q: str | None = None,
    status: SessionStatus | None = None,
    form: SessionForm | None = None,
    character: SessionCharacter | None = None,
    competition: bool | None = None,
    has_lactate: bool | None = None,
    cursor: str | None = None,
    limit: int = Query(DEFAULT_SEARCH_LIMIT, ge=1, le=MAX_SEARCH_LIMIT),
) -> SessionSearchResult:
    u = await _resolve_user(db, user)

    conds: list[ColumnElement[bool]] = [col(Session.user_id) == u.id]
    if from_:
        conds.append(col(Session.date) >= from_)
    if to:
        conds.append(col(Session.date) <= to)
    if status:
        conds.append(col(Session.status) == status)
    if q:
        like = _contains_pattern(q)
        conds.append(
            or_(
                col(Session.name).ilike(like, escape=_LIKE_ESCAPE),
                col(Session.comment).ilike(like, escape=_LIKE_ESCAPE),
            )
        )
    if form:
        conds.append(_part_has("form", str(form)))
    if character:
        conds.append(_part_has("character", str(character)))
    if competition is not None:
        is_competition = _part_has("competition", True)
        conds.append(is_competition if competition else ~is_competition)
    if has_lactate is not None:
        any_lactate = func.json_array_length(col(Session.lactate_measurements)) > 0
        conds.append(any_lactate if has_lactate else ~any_lactate)

    # Count once, on the first page only — it is the expensive half of the request.
    total = (
        None
        if cursor
        else (
            await db.scalar(sa_select(func.count()).select_from(Session).where(*conds))
            or 0
        )
    )

    if cursor:
        conds.append(
            tuple_(col(Session.date), col(Session.session_no)) < _parse_cursor(cursor)
        )

    # Newest first, so a page keeps the most recent matches rather than the oldest.
    # Over-fetch by one to learn whether another page exists without a second query.
    stmt = (
        select(Session)
        .where(*conds)
        .order_by(col(Session.date).desc(), col(Session.session_no).desc())
        .limit(limit + 1)
    )
    rows = list((await db.exec(stmt)).all())
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = (
        f"{items[-1].date.isoformat()}:{items[-1].session_no}" if has_more else None
    )
    return SessionSearchResult(
        items=items, has_more=has_more, next_cursor=next_cursor, total=total
    )


@router.post("", status_code=201)
async def create_session(payload: SessionCreate, db: DbSession):
    if not await db.get(User, payload.user_id):
        raise HTTPException(404, "Unknown user_id")
    s = Session(**payload.model_dump(exclude={"buddy_usernames"}))
    db.add(s)

    for username in payload.buddy_usernames:
        buddy_result = await db.exec(select(User).where(User.name == username))
        buddy = buddy_result.first()
        if not buddy or buddy.id == payload.user_id:
            continue
        last_result = await db.exec(
            select(Session)
            .where(Session.user_id == buddy.id)
            .where(Session.date == s.date)
            .order_by(col(Session.session_no).desc())
        )
        last = last_result.first()
        db.add(
            Session(
                user_id=buddy.id,
                date=s.date,
                session_no=(last.session_no + 1) if last else 1,
                name=s.name,
                parts=s.parts,
                status=SessionStatus.planned,
                comment=s.comment,
            )
        )

    return s


@router.patch("/{session_id}")
async def update_session(session_id: str, payload: SessionUpdate, db: DbSession):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    if "parts" in data:
        flag_modified(s, "parts")
    if "lactate_measurements" in data:
        flag_modified(s, "lactate_measurements")
    s.updated_at = datetime.now(UTC)
    db.add(s)
    return s


@router.post("/reorder", status_code=200)
async def reorder_sessions(payload: SessionReorder, db: DbSession):
    """Atomically assign session_no 1, 2, … to sessions in the given order."""
    for idx, session_id in enumerate(payload.ids, start=1):
        s = await db.get(Session, session_id)
        if not s:
            raise HTTPException(404, f"Session not found: {session_id}")
        s.session_no = idx
        s.updated_at = datetime.now(UTC)
        db.add(s)
    return {"reordered": len(payload.ids)}


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str, db: DbSession):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    await db.delete(s)


class _DupSession(BaseModel):
    id: str
    date: str
    name: str | None
    form: str | None
    duration_seconds: int | None
    distance_km: float | None


class _DupGroup(BaseModel):
    date: str
    form: str | None
    sessions: list[_DupSession]


@router.get("/duplicates")
async def find_duplicates(
    db: DbSession,
    user: str = Query(...),
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
) -> list[_DupGroup]:
    """Return groups of identical done sessions (all fields match) in the given range."""
    u = await _resolve_user(db, user)
    stmt = (
        select(Session)
        .where(Session.user_id == u.id)
        .where(col(Session.status) == SessionStatus.done)
    )
    if from_:
        stmt = stmt.where(Session.date >= from_)
    if to:
        stmt = stmt.where(Session.date <= to)
    stmt = stmt.order_by(col(Session.date), col(Session.session_no))
    result = await db.exec(stmt)
    sessions = list(result.all())

    def _fingerprint(s: Session) -> tuple:
        parts_key = json.dumps(s.parts, sort_keys=True)
        return (str(s.date), s.name, s.comment, parts_key)

    groups: dict[tuple, list[Session]] = defaultdict(list)
    for s in sessions:
        groups[_fingerprint(s)].append(s)

    def _dur(s: Session) -> int | None:
        if not s.parts:
            return None
        d = s.parts[0].get("duration_seconds")
        return int(d) if d is not None else None

    dup_groups: list[_DupGroup] = []
    for grp in groups.values():
        if len(grp) < 2:
            continue
        s0 = grp[0]
        dup_groups.append(
            _DupGroup(
                date=str(s0.date),
                form=s0.parts[0].get("form") if s0.parts else None,
                sessions=[
                    _DupSession(
                        id=s.id,
                        date=str(s.date),
                        name=s.name,
                        form=s.parts[0].get("form") if s.parts else None,
                        duration_seconds=_dur(s),
                        distance_km=s.parts[0].get("distance_km") if s.parts else None,
                    )
                    for s in grp
                ],
            )
        )

    dup_groups.sort(key=lambda g: g.date)
    return dup_groups
