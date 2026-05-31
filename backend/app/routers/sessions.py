from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..database.db import get_session
from ..models.models import Session, SessionCreate, SessionReorder, SessionUpdate, User

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
