from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from ..dependencies import DbSession
from ..models.models import User, UserCreate


class UserUpdate(BaseModel):
    name: str | None = None
    palette: str | None = None


router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
async def list_users(db: DbSession):
    result = await db.exec(select(User).order_by(User.name))
    return result.all()


@router.post("", status_code=201)
async def create_user(payload: UserCreate, db: DbSession):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    result = await db.exec(select(User).where(User.name == name))
    existing = result.first()
    if existing:
        return existing
    user = User(name=name, palette=payload.palette)
    db.add(user)
    return user


@router.patch("/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, db: DbSession):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Name is required")
        result = await db.exec(select(User).where(User.name == name))
        conflict = result.first()
        if conflict and conflict.id != user_id:
            raise HTTPException(409, "Name already taken")
        user.name = name
    if "palette" in payload.model_fields_set:
        user.palette = payload.palette
    db.add(user)
    return user


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str, db: DbSession):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    await db.delete(user)
