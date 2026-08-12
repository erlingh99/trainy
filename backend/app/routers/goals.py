from datetime import UTC, datetime

from fastapi import APIRouter, Query
from sqlmodel import select

from ..dependencies import DbSession
from ..models.models import Goal, GoalUpdate
from .summary import _resolve_user

router = APIRouter(prefix="/api/goals", tags=["goals"])


@router.get("")
async def get_goals(db: DbSession, user: str = Query(...)):
    u = await _resolve_user(db, user)
    result = await db.exec(select(Goal).where(Goal.user_id == u.id))
    goal = result.first()
    if not goal:
        return {"sessions_per_week": 0.0, "hours_per_week": 0.0, "km_per_week": 0.0}
    return {
        "sessions_per_week": goal.sessions_per_week,
        "hours_per_week": goal.hours_per_week,
        "km_per_week": goal.km_per_week,
    }


@router.put("")
async def upsert_goals(
    db: DbSession,
    body: GoalUpdate,
    user: str = Query(...),
):
    u = await _resolve_user(db, user)
    result = await db.exec(select(Goal).where(Goal.user_id == u.id))
    goal = result.first()
    if goal:
        goal.sessions_per_week = body.sessions_per_week
        goal.hours_per_week = body.hours_per_week
        goal.km_per_week = body.km_per_week
        goal.updated_at = datetime.now(UTC)
    else:
        goal = Goal(
            user_id=u.id,
            sessions_per_week=body.sessions_per_week,
            hours_per_week=body.hours_per_week,
            km_per_week=body.km_per_week,
        )
        db.add(goal)
    return {
        "sessions_per_week": goal.sessions_per_week,
        "hours_per_week": goal.hours_per_week,
        "km_per_week": goal.km_per_week,
    }
