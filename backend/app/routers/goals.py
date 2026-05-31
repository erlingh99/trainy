from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..database.db import get_session
from ..models.models import Goal, GoalUpdate
from .summary import _resolve_user

router = APIRouter(prefix="/api/goals", tags=["goals"])


@router.get("")
async def get_goals(user: str = Query(...), db: AsyncSession = Depends(get_session)):
    u = await _resolve_user(db, user)
    result = await db.exec(select(Goal).where(Goal.user_id == u.id))
    goal = result.first()
    if not goal:
        return {"sessions_per_week": 0.0, "hours_per_week": 0.0, "km_per_week": 0.0}
    return {"sessions_per_week": goal.sessions_per_week, "hours_per_week": goal.hours_per_week, "km_per_week": goal.km_per_week}


@router.put("")
async def upsert_goals(
    body: GoalUpdate,
    user: str = Query(...),
    db: AsyncSession = Depends(get_session),
):
    u = await _resolve_user(db, user)
    result = await db.exec(select(Goal).where(Goal.user_id == u.id))
    goal = result.first()
    if goal:
        goal.sessions_per_week = body.sessions_per_week
        goal.hours_per_week = body.hours_per_week
        goal.km_per_week = body.km_per_week
        goal.updated_at = datetime.now(timezone.utc)
    else:
        goal = Goal(
            user_id=u.id,
            sessions_per_week=body.sessions_per_week,
            hours_per_week=body.hours_per_week,
            km_per_week=body.km_per_week,
        )
        db.add(goal)
    return {"sessions_per_week": goal.sessions_per_week, "hours_per_week": goal.hours_per_week, "km_per_week": goal.km_per_week}
