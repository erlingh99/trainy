"""
Maps Garmin activity dicts to ActivityProposal objects that suggest how to
merge each activity into the training plan.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal, Optional

from ..models.models import Session, SessionStatus

# ── Garmin typeKey → SessionForm ──────────────────────────────────────────────

_FORM_MAP: dict[str, str] = {
    # Running
    "running": "running",
    "trail_running": "running",
    "treadmill_running": "running",
    "track_running": "running",
    "street_running": "running",
    "running_race": "running",
    "ultra_run": "running",
    "obstacle_run": "running",
    "virtual_run": "running",
    "lap_swimming": "running",  # keep as other if confusing
    # Cycling
    "cycling": "cycling",
    "road_biking": "cycling",
    "mountain_biking": "cycling",
    "gravel_cycling": "cycling",
    "indoor_cycling": "cycling",
    "virtual_ride": "cycling",
    "bmx": "cycling",
    "e_bike_fitness": "cycling",
    "e_bike_mountain": "cycling",
    # Strength
    "strength_training": "strength",
    "gym_and_fitness_equipment": "strength",
    "floor_climbing": "strength",
    "bouldering": "strength",
    # Elliptical
    "elliptical": "elliptical",
    # Orienteering (Garmin has no dedicated type — users log as trail_running or other)
    "orienteering": "orienteering",
    # Skiing
    "cross_country_skiing": "skiing",
    "cross_country_skiing_ws": "skiing",
    "resort_skiing_snowboarding_ws": "skiing",
    "backcountry_skiing": "skiing",
    "skate_skiing": "skiing",
    # Skating
    "inline_skating": "skating",
    "ice_skating": "skating",
    "roller_skiing": "skiing",
}

# Surface hints from typeKey for running activities
_SURFACE_MAP: dict[str, str] = {
    "trail_running": "trail",
    "treadmill_running": "treadmill",
    "track_running": "track",
}

# Terrain/trail running defaults to running, but should match a planned
# orienteering session on the same day when one exists.
_TERRAIN_RUNNING_KEYS = {"trail_running"}

# Forms where distance is not meaningful
_NO_DISTANCE_FORMS = {"strength", "elliptical"}


# ── Proposal dataclass ────────────────────────────────────────────────────────


@dataclass
class CandidateSession:
    id: str
    name: Optional[str]
    parts: list[dict]


@dataclass
class ActivityProposal:
    garmin_activity_id: int
    date: date
    form: Optional[str]
    duration_seconds: int
    distance_km: Optional[float]
    activity_name: Optional[str]
    match_status: Literal["matched", "ambiguous", "unmatched", "already_done"]
    matched_session_id: Optional[str]
    candidate_sessions: list[CandidateSession]
    proposed_action: Literal["match", "create", "skip"]


# ── Public functions ──────────────────────────────────────────────────────────


def activity_date(activity: dict) -> date:
    """Parse startTimeLocal (YYYY-MM-DD HH:MM:SS), fall back to startTimeGMT."""
    raw = activity.get("startTimeLocal") or activity.get("startTimeGMT", "")
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return date.today()


def make_session_name(activity: dict) -> Optional[str]:
    """
    Return activityName if it is not a Garmin generic default.
    Generic means it equals the typeDisplayName (case-insensitive) or is blank.
    """
    name = (activity.get("activityName") or "").strip()
    if not name:
        return None
    generic = (
        activity.get("activityType", {}).get("typeDisplayName") or ""
    ).strip().lower()
    if name.lower() == generic:
        return None
    return name


def _detect_form(activity: dict) -> Optional[str]:
    type_key = (activity.get("activityType") or {}).get("typeKey", "").lower()
    return _FORM_MAP.get(type_key)


def _infer_surface(type_key: str) -> Optional[str]:
    return _SURFACE_MAP.get(type_key)


def activity_to_part(activity: dict) -> dict:
    """Convert a Garmin activity to a SessionPart-compatible dict."""
    type_key = (activity.get("activityType") or {}).get("typeKey", "").lower()
    form = _FORM_MAP.get(type_key)

    duration = int(round(float(activity.get("duration") or 0)))

    dist_raw = activity.get("distance")
    if dist_raw and form not in _NO_DISTANCE_FORMS:
        distance_km: Optional[float] = round(float(dist_raw) / 1000, 2)
    else:
        distance_km = None

    part: dict = {"form": form, "duration_seconds": duration or None}
    if distance_km:
        part["distance_km"] = distance_km
    if form == "running":
        surface = _infer_surface(type_key)
        if surface:
            part["surface"] = surface

    return part


def _activity_start_key(activity: dict) -> str:
    return activity.get("startTimeLocal") or activity.get("startTimeGMT") or ""


def map_activities(
    activities: list[dict], existing_sessions: list[Session]
) -> list[ActivityProposal]:
    """
    Propose actions for a batch of Garmin activities, coordinating across the
    whole batch so each planned/done session is claimed by at most one activity.

    Activities are processed earliest-first (by start time). On a day with
    several planned sessions of the same form, the earliest activity claims the
    lowest ``session_no``, the next the next, and so on — matching the convention
    that a higher session number is the later session of the day.
    """
    ordered = sorted(activities, key=_activity_start_key)
    claimed: set[str] = set()
    return [_map_one(a, existing_sessions, claimed) for a in ordered]


def _map_one(
    activity: dict, existing_sessions: list[Session], claimed: set[str]
) -> ActivityProposal:
    """
    Propose an action for one Garmin activity, ignoring sessions already claimed
    by earlier activities in the same batch and recording any new claim.

    Match logic:
    - If an unclaimed done session on the same date with matching form exists →
      already_done (proposed: skip).
    - Otherwise look at unclaimed planned sessions on the same date with a
      matching form, ordered by session_no.
      - 0 candidates → unmatched (proposed: create)
      - 1+ candidates → matched to the lowest session_no (proposed: match)
    - unknown form  → ambiguous
    """
    act_date = activity_date(activity)
    form = _detect_form(activity)
    type_key = (activity.get("activityType") or {}).get("typeKey", "").lower()
    # Terrain/trail running defaults to running, but if an unclaimed orienteering
    # session is planned for this day, match it to that instead.
    if type_key in _TERRAIN_RUNNING_KEYS and form == "running":
        if any(
            s.date == act_date
            and s.status == SessionStatus.planned
            and s.parts
            and s.parts[0].get("form") == "orienteering"
            and s.id not in claimed
            for s in existing_sessions
        ):
            form = "orienteering"
    duration = int(round(float(activity.get("duration") or 0)))
    dist_raw = activity.get("distance")
    dist = round(float(dist_raw) / 1000, 2) if dist_raw and form not in _NO_DISTANCE_FORMS else None
    name = make_session_name(activity)
    activity_id = int(activity.get("activityId") or 0)

    done_matches = [
        s for s in existing_sessions
        if s.date == act_date
        and s.status == SessionStatus.done
        and (not s.parts or s.parts[0].get("form") == form)
        and s.id not in claimed
    ]
    if done_matches:
        done_session = done_matches[0]
        claimed.add(done_session.id)
        return ActivityProposal(
            garmin_activity_id=activity_id,
            date=act_date,
            form=form,
            duration_seconds=duration,
            distance_km=dist,
            activity_name=name,
            match_status="already_done",
            matched_session_id=done_session.id,
            candidate_sessions=[CandidateSession(id=done_session.id, name=done_session.name, parts=done_session.parts)],
            proposed_action="skip",
        )

    candidates = sorted(
        (
            s for s in existing_sessions
            if s.date == act_date
            and s.status == SessionStatus.planned
            and (not s.parts or s.parts[0].get("form") == form)
            and s.id not in claimed
        ),
        key=lambda s: s.session_no,
    )
    candidate_details = [
        CandidateSession(id=s.id, name=s.name, parts=s.parts) for s in candidates
    ]

    if form is None:
        status: Literal["matched", "ambiguous", "unmatched", "already_done"] = "ambiguous"
        matched_id = None
        action: Literal["match", "create", "skip"] = "skip"
    elif candidates:
        chosen = candidates[0]
        claimed.add(chosen.id)
        status = "matched"
        matched_id = chosen.id
        action = "match"
    else:
        status = "unmatched"
        matched_id = None
        action = "create"

    return ActivityProposal(
        garmin_activity_id=activity_id,
        date=act_date,
        form=form,
        duration_seconds=duration,
        distance_km=dist,
        activity_name=name,
        match_status=status,
        matched_session_id=matched_id,
        candidate_sessions=candidate_details,
        proposed_action=action,
    )
