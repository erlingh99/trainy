"""
Garmin Connect integration endpoints.

All endpoints are scoped to a named user via ?user= query param (consistent
with the rest of the API).

Sync is two-phase:
  POST /api/garmin/sync/preview  → fetch activities + propose actions (no writes)
  POST /api/garmin/sync/apply    → execute confirmed choices
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..dependencies import DbSession
from ..garmin import client as garmin_client
from ..garmin.client import GarminAuthError, GarminRateLimitError
from ..garmin.crypto import decrypt_secret, encrypt_secret
from ..garmin.mapper import ActivityProposal, map_activities
from ..models.models import GarminCredentials, Session, SessionStatus, User

router = APIRouter(prefix="/api/garmin", tags=["garmin"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class GarminConnectRequest(BaseModel):
    api_key: str
    api_key_expires_on: date | None = None


class GarminStatusResponse(BaseModel):
    connected: bool
    api_key_expires_on: date | None = None
    last_sync_at: str | None = None
    last_sync_error: str | None = None


class SyncPreviewRequest(BaseModel):
    start_date: date
    end_date: date


class CandidateSessionOut(BaseModel):
    id: str
    name: str | None = None
    parts: list[dict]


class ActivityProposalOut(BaseModel):
    garmin_activity_id: int
    date: str
    form: str | None = None
    surface: str | None = None
    duration_seconds: int
    distance_km: float | None = None
    activity_name: str | None = None
    description: str | None = None
    match_status: str
    matched_session_id: str | None = None
    candidate_sessions: list[CandidateSessionOut]
    proposed_action: str


class ApplyItem(BaseModel):
    garmin_activity_id: int
    date: date
    form: str | None = None
    surface: str | None = None
    duration_seconds: int
    distance_km: float | None = None
    activity_name: str | None = None
    description: str | None = None
    action: Literal["match", "create", "skip"]
    session_id: str | None = None


class SyncApplyRequest(BaseModel):
    items: list[ApplyItem]


class SyncResult(BaseModel):
    matched: int
    created: int
    skipped: int
    errors: list[str]


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _resolve_user(db: AsyncSession, user: str) -> User:
    result = await db.exec(select(User).where(User.name == user))
    u = result.first()
    if not u:
        raise HTTPException(404, f"Unknown user: {user}")
    return u


async def _get_creds(db: DbSession, user_id: str) -> GarminCredentials:
    creds = await db.get(GarminCredentials, user_id)
    if not creds:
        raise HTTPException(400, "Garmin account not connected for this user")
    return creds


def _proposal_to_out(p: ActivityProposal) -> ActivityProposalOut:
    return ActivityProposalOut(
        garmin_activity_id=p.garmin_activity_id,
        date=p.date.isoformat(),
        form=p.form,
        surface=p.surface,
        duration_seconds=p.duration_seconds,
        distance_km=p.distance_km,
        activity_name=p.activity_name,
        description=p.description,
        match_status=p.match_status,
        matched_session_id=p.matched_session_id,
        candidate_sessions=[
            CandidateSessionOut(id=c.id, name=c.name, parts=c.parts)
            for c in p.candidate_sessions
        ],
        proposed_action=p.proposed_action,
    )


def _garmin_error_to_http(e: Exception) -> HTTPException:
    if isinstance(e, GarminAuthError):
        return HTTPException(401, str(e))
    if isinstance(e, GarminRateLimitError):
        return HTTPException(429, "Garmin rate limited — try again in a few minutes")
    return HTTPException(502, f"Garmin connection error: {e}")


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/connect")
async def connect_garmin(
    db: DbSession,
    payload: GarminConnectRequest,
    user: str = Query(...),
) -> GarminStatusResponse:
    """Verify a Personal API key with Garmin and store it encrypted."""
    u = await _resolve_user(db, user)
    api_key = payload.api_key.strip()
    if not api_key:
        raise HTTPException(422, "API key must not be empty")
    encrypted_key = encrypt_secret(api_key)

    try:
        await asyncio.to_thread(garmin_client.verify_api_key, api_key, u.id)
    except Exception as e:
        raise _garmin_error_to_http(e) from e

    creds = await db.get(GarminCredentials, u.id)
    now = datetime.now(UTC)
    if creds is None:
        creds = GarminCredentials(user_id=u.id, api_key=encrypted_key, created_at=now)
    creds.api_key = encrypted_key
    creds.api_key_expires_on = payload.api_key_expires_on
    creds.last_sync_error = None
    creds.updated_at = now
    db.add(creds)
    return _build_status(creds)


@router.get("/status")
async def garmin_status(
    db: DbSession,
    user: str = Query(...),
) -> GarminStatusResponse:
    u = await _resolve_user(db, user)
    creds = await db.get(GarminCredentials, u.id)
    if not creds:
        return GarminStatusResponse(connected=False)
    return _build_status(creds)


@router.delete("/disconnect", status_code=204)
async def disconnect_garmin(
    db: DbSession,
    user: str = Query(...),
):
    u = await _resolve_user(db, user)
    creds = await db.get(GarminCredentials, u.id)
    if creds:
        await db.delete(creds)
    garmin_client.token_cache_file(u.id).unlink(missing_ok=True)


@router.post("/sync/preview")
async def sync_preview(
    db: DbSession,
    payload: SyncPreviewRequest,
    user: str = Query(...),
) -> list[ActivityProposalOut]:
    """
    Fetch Garmin activities for the date range and return proposed actions.
    Makes no changes to the training plan.
    """
    u = await _resolve_user(db, user)
    creds = await _get_creds(db, u.id)

    try:
        activities = await asyncio.to_thread(
            garmin_client.get_activities,
            decrypt_secret(creds.api_key),
            u.id,
            payload.start_date,
            payload.end_date,
        )
    except Exception as e:
        raise _garmin_error_to_http(e) from e

    # Load planned and done sessions in the range for matching
    result = await db.exec(
        select(Session)
        .where(Session.user_id == u.id)
        .where(Session.date >= payload.start_date)
        .where(Session.date <= payload.end_date)
        .where(col(Session.status).in_([SessionStatus.planned, SessionStatus.done]))
        .order_by(col(Session.date), col(Session.session_no))
    )
    existing = list(result.all())

    activities = [a for a in activities if (a.get("duration") or 0) >= 60]
    proposals = map_activities(activities, existing)  # sorts earliest-first internally
    return [_proposal_to_out(p) for p in proposals]


@router.post("/sync/apply")
async def sync_apply(
    db: DbSession,
    payload: SyncApplyRequest,
    user: str = Query(...),
) -> SyncResult:
    """
    Execute the user-confirmed sync choices from a preview.
    """
    u = await _resolve_user(db, user)
    creds = await _get_creds(db, u.id)

    matched = 0
    created = 0
    skipped = 0
    errors: list[str] = []
    matched_session_ids: set[str] = set()

    for item in payload.items:
        if item.action == "skip":
            skipped += 1
            continue

        try:
            if item.action == "match":
                if not item.session_id:
                    errors.append(
                        f"activity {item.garmin_activity_id}: action=match but no session_id"
                    )
                    continue
                if item.session_id in matched_session_ids:
                    errors.append(
                        f"activity {item.garmin_activity_id}: session {item.session_id} already matched by another activity"
                    )
                    continue
                s = await db.get(Session, item.session_id)
                if not s or s.user_id != u.id:
                    errors.append(
                        f"activity {item.garmin_activity_id}: session {item.session_id} not found"
                    )
                    continue
                # Merge actual metrics into parts[0], overwriting estimated values
                parts = list(s.parts)
                if parts:
                    parts[0] = {
                        **parts[0],
                        "duration_seconds": item.duration_seconds,
                        **(
                            {"distance_km": item.distance_km}
                            if item.distance_km is not None
                            else {}
                        ),
                    }
                else:
                    part: dict[str, Any] = {"duration_seconds": item.duration_seconds}
                    if item.form:
                        part["form"] = item.form
                    if item.surface:
                        part["surface"] = item.surface
                    if item.distance_km is not None:
                        part["distance_km"] = item.distance_km
                    parts = [part]
                s.parts = parts
                s.status = SessionStatus.done
                if s.name is None and item.activity_name:
                    s.name = item.activity_name
                if not s.comment and item.description:
                    s.comment = item.description
                s.updated_at = datetime.now(UTC)
                db.add(s)
                matched_session_ids.add(item.session_id)
                matched += 1

            elif item.action == "create":
                # Find how many sessions exist on this date to assign session_no.
                # Flush first so within-transaction creates on the same day are visible.
                await db.flush()
                result = await db.exec(
                    select(Session)
                    .where(Session.user_id == u.id)
                    .where(Session.date == item.date)
                )
                existing = list(result.all())
                next_no = max((s.session_no for s in existing), default=0) + 1

                part: dict = {
                    "duration_seconds": item.duration_seconds
                    if item.duration_seconds
                    else None
                }
                if item.form:
                    part["form"] = item.form
                if item.surface:
                    part["surface"] = item.surface
                if item.distance_km is not None:
                    part["distance_km"] = item.distance_km

                new_session = Session(
                    user_id=u.id,
                    date=item.date,
                    session_no=next_no,
                    name=item.activity_name,
                    comment=item.description,
                    parts=[part],
                    status=SessionStatus.done,
                )
                db.add(new_session)
                created += 1

        except Exception as e:  # noqa: BLE001 - one bad activity must not abort the batch
            errors.append(f"activity {item.garmin_activity_id}: {e}")

    creds.last_sync_at = datetime.now(UTC)
    creds.last_sync_error = "; ".join(errors) if errors else None
    db.add(creds)

    await db.flush()  # surface any DB errors before sending a success response
    return SyncResult(matched=matched, created=created, skipped=skipped, errors=errors)


def _build_status(creds: GarminCredentials) -> GarminStatusResponse:
    return GarminStatusResponse(
        connected=True,
        api_key_expires_on=creds.api_key_expires_on,
        last_sync_at=creds.last_sync_at.isoformat() if creds.last_sync_at else None,
        last_sync_error=creds.last_sync_error,
    )
