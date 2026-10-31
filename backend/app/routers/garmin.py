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
from ..garmin.client import (
    GarminAuthError,
    GarminClient,
    GarminRateLimitError,
    TokenCache,
)
from ..garmin.crypto import decrypt_password, encrypt_password
from ..garmin.mapper import ActivityProposal, map_activities
from ..models.models import GarminCredentials, Session, SessionStatus, User

router = APIRouter(prefix="/api/garmin", tags=["garmin"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class GarminConnectRequest(BaseModel):
    garmin_username: str
    garmin_password: str


class GarminMfaRequest(BaseModel):
    mfa_code: str


class GarminStatusResponse(BaseModel):
    connected: bool
    garmin_username: str | None = None
    last_sync_at: str | None = None
    last_sync_error: str | None = None
    mfa_pending: bool = False


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


def _creds_to_cache(creds: GarminCredentials) -> TokenCache:
    return TokenCache(
        di_token=creds.di_token,
        di_refresh_token=creds.di_refresh_token,
        di_client_id=creds.di_client_id,
        token_expires_at=creds.token_expires_at.isoformat()
        if creds.token_expires_at
        else None,
    )


def _apply_cache_to_creds(cache: TokenCache, creds: GarminCredentials) -> None:
    creds.di_token = cache.get("di_token")
    creds.di_refresh_token = cache.get("di_refresh_token")
    creds.di_client_id = cache.get("di_client_id")
    raw = cache.get("token_expires_at")
    creds.token_expires_at = datetime.fromisoformat(raw) if raw else None
    creds.updated_at = datetime.now(UTC)


def _proposal_to_out(p: ActivityProposal) -> ActivityProposalOut:
    return ActivityProposalOut(
        garmin_activity_id=p.garmin_activity_id,
        date=p.date.isoformat(),
        form=p.form,
        surface=p.surface,
        duration_seconds=p.duration_seconds,
        distance_km=p.distance_km,
        activity_name=p.activity_name,
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
):
    """Store credentials and initiate login. Returns 202 if MFA is required."""
    u = await _resolve_user(db, user)
    # Encrypt up front so a missing GARMIN_SECRET_KEY fails before the slow login.
    encrypted_password = encrypt_password(payload.garmin_password)

    # Log in before writing anything: login takes 30-45s+ (Cloudflare delay plus
    # fallback strategies), and a flushed write would hold SQLite's write lock for
    # that whole time, failing every other write with "database is locked".
    client = GarminClient(
        payload.garmin_username, payload.garmin_password
    )  # use plaintext from request, not from DB
    try:
        cache, mfa_required = await asyncio.to_thread(client.login)
    except Exception as e:
        raise _garmin_error_to_http(e) from e

    creds = await db.get(GarminCredentials, u.id)
    now = datetime.now(UTC)
    if creds is None:
        creds = GarminCredentials(
            user_id=u.id,
            garmin_username=payload.garmin_username,
            garmin_password=encrypted_password,
            created_at=now,
            updated_at=now,
        )
    else:
        creds.garmin_username = payload.garmin_username
        creds.garmin_password = encrypted_password
        creds.updated_at = now

    if mfa_required:
        creds.mfa_pending = True
        creds.mfa_state = client.pending_mfa_state
        db.add(creds)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=202, content={"mfa_required": True})

    _apply_cache_to_creds(cache, creds)
    creds.mfa_pending = False
    creds.mfa_state = None
    db.add(creds)
    return _build_status(creds)


@router.post("/mfa")
async def complete_mfa(
    db: DbSession,
    payload: GarminMfaRequest,
    user: str = Query(...),
):
    u = await _resolve_user(db, user)
    creds = await _get_creds(db, u.id)

    if not creds.mfa_pending or not creds.mfa_state:
        raise HTTPException(400, "No pending MFA challenge — connect first")

    client = GarminClient(
        creds.garmin_username, decrypt_password(creds.garmin_password)
    )
    try:
        cache = await asyncio.to_thread(
            client.resume_mfa, creds.mfa_state, payload.mfa_code
        )
    except Exception as e:
        raise _garmin_error_to_http(e) from e

    _apply_cache_to_creds(cache, creds)
    creds.mfa_pending = False
    creds.mfa_state = None
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

    if creds.mfa_pending:
        raise HTTPException(
            400, "MFA verification pending — complete via /api/garmin/mfa first"
        )
    if not creds.di_token:
        raise HTTPException(
            400, "Not authenticated with Garmin — reconnect via /api/garmin/connect"
        )

    client = GarminClient(
        creds.garmin_username, decrypt_password(creds.garmin_password)
    )
    cache = _creds_to_cache(creds)

    try:
        activities, updated_cache = await asyncio.to_thread(
            client.get_activities, cache, payload.start_date, payload.end_date
        )
    except Exception as e:
        raise _garmin_error_to_http(e) from e

    _apply_cache_to_creds(updated_cache, creds)
    db.add(creds)

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
        connected=bool(creds.di_token and not creds.mfa_pending),
        garmin_username=creds.garmin_username,
        last_sync_at=creds.last_sync_at.isoformat() if creds.last_sync_at else None,
        last_sync_error=creds.last_sync_error,
        mfa_pending=creds.mfa_pending,
    )
