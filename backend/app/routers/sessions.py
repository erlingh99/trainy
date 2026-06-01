import json
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..database.db import get_session
from ..models.models import Session, SessionCreate, SessionReorder, SessionStatus, SessionUpdate, User

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


async def _resolve_user(db: AsyncSession, user: str) -> User:
    result = await db.exec(select(User).where(User.name == user))
    u = result.first()
    if not u:
        raise HTTPException(404, f"Unknown user: {user}")
    return u


@router.get("")
async def list_sessions(
    user: str = Query(...),
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = None,
    db: AsyncSession = Depends(get_session),
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


@router.post("", status_code=201)
async def create_session(payload: SessionCreate, db: AsyncSession = Depends(get_session)):
    if not await db.get(User, payload.user_id):
        raise HTTPException(404, "Unknown user_id")
    s = Session(**payload.model_dump())
    db.add(s)
    return s


@router.patch("/{session_id}")
async def update_session(session_id: str, payload: SessionUpdate, db: AsyncSession = Depends(get_session)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    if "parts" in data:
        flag_modified(s, "parts")
    s.updated_at = datetime.now(timezone.utc)
    db.add(s)
    return s


@router.post("/reorder", status_code=200)
async def reorder_sessions(payload: SessionReorder, db: AsyncSession = Depends(get_session)):
    """Atomically assign session_no 1, 2, … to sessions in the given order."""
    for idx, session_id in enumerate(payload.ids, start=1):
        s = await db.get(Session, session_id)
        if not s:
            raise HTTPException(404, f"Session not found: {session_id}")
        s.session_no = idx
        s.updated_at = datetime.now(timezone.utc)
        db.add(s)
    return {"reordered": len(payload.ids)}


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str, db: AsyncSession = Depends(get_session)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    await db.delete(s)


class _DupSession(BaseModel):
    id: str
    date: str
    name: Optional[str]
    form: Optional[str]
    duration_seconds: Optional[int]
    distance_km: Optional[float]


class _DupGroup(BaseModel):
    date: str
    form: Optional[str]
    sessions: list[_DupSession]


@router.get("/duplicates")
async def find_duplicates(
    user: str = Query(...),
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = None,
    db: AsyncSession = Depends(get_session),
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

    def _dur(s: Session) -> Optional[int]:
        if not s.parts:
            return None
        d = s.parts[0].get("duration_seconds")
        return int(d) if d is not None else None

    dup_groups: list[_DupGroup] = []
    for grp in groups.values():
        if len(grp) < 2:
            continue
        s0 = grp[0]
        dup_groups.append(_DupGroup(
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
        ))

    dup_groups.sort(key=lambda g: g.date)
    return dup_groups
