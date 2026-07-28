from datetime import date as _Date, datetime, timezone
from enum import StrEnum
from typing import Optional
from uuid import uuid4

import sqlalchemy as sa
from pydantic import model_validator
from sqlmodel import Field, SQLModel


def _uuid() -> str:
    return str(uuid4())


class SessionForm(StrEnum):
    running = "running"
    orienteering = "orienteering"
    strength = "strength"
    cycling = "cycling"
    elliptical = "elliptical"
    skiing = "skiing"
    skating = "skating"
    other = "other"


class SessionCharacter(StrEnum):
    distance = "distance"
    interval = "interval"
    tempo = "tempo"
    long = "long"
    middle = "middle"
    technique = "technique"
    fartlek = "fartlek"
    # Strength characters
    upperbody = "upperbody"
    lowerbody = "lowerbody"
    fullbody = "fullbody"
    other = "other"


class SessionIntensity(StrEnum):
    recovery = "recovery"
    flow = "flow"
    threshold = "threshold"
    vo2 = "vo2"
    max = "max"


class SessionSurface(StrEnum):
    trail = "trail"
    gravel = "gravel"
    road = "road"
    forest = "forest"
    gym = "gym"
    track = "track"
    treadmill = "treadmill"
    classic = "classic"
    skate = "skate"
    ice = "ice"
    other = "other"


class SessionStatus(StrEnum):
    planned = "planned"
    done = "done"
    skipped = "skipped"


_ALL_SURFACES = frozenset(SessionSurface)
_ALL_CHARACTERS = frozenset(SessionCharacter)

VALID_SURFACES: dict[SessionForm, frozenset[SessionSurface]] = {
    SessionForm.running: frozenset(
        {
            SessionSurface.trail,
            SessionSurface.gravel,
            SessionSurface.road,
            SessionSurface.forest,
            SessionSurface.track,
            SessionSurface.treadmill,
        }
    ),
    SessionForm.orienteering: frozenset({SessionSurface.forest, SessionSurface.road}),
    SessionForm.strength: frozenset({SessionSurface.gym}),
    SessionForm.cycling: frozenset(
        {
            SessionSurface.road,
            SessionSurface.gravel,
            SessionSurface.trail,
            SessionSurface.gym,
        }
    ),
    SessionForm.elliptical: frozenset({SessionSurface.gym}),
    SessionForm.skiing: frozenset(
        {
            SessionSurface.classic,
            SessionSurface.skate,
        }
    ),
    SessionForm.skating: frozenset({SessionSurface.ice}),
    SessionForm.other: _ALL_SURFACES,
}

_ENDURANCE_CHARACTERS = frozenset(
    {
        SessionCharacter.distance,
        SessionCharacter.interval,
        SessionCharacter.tempo,
        SessionCharacter.fartlek,
        SessionCharacter.other,
    }
)

VALID_CHARACTERS: dict[SessionForm, frozenset[SessionCharacter]] = {
    SessionForm.running: _ENDURANCE_CHARACTERS,
    SessionForm.orienteering: frozenset(
        {
            SessionCharacter.long,
            SessionCharacter.middle,
            SessionCharacter.technique,
            SessionCharacter.interval,
            SessionCharacter.distance,
            SessionCharacter.other,
        }
    ),
    SessionForm.strength: frozenset(
        {
            SessionCharacter.upperbody,
            SessionCharacter.lowerbody,
            SessionCharacter.fullbody,
            SessionCharacter.other,
        }
    ),
    SessionForm.cycling: _ENDURANCE_CHARACTERS,
    SessionForm.elliptical: frozenset(
        {
            SessionCharacter.distance,
            SessionCharacter.interval,
            SessionCharacter.tempo,
            SessionCharacter.other,
        }
    ),
    SessionForm.skiing: _ENDURANCE_CHARACTERS,
    SessionForm.skating: _ENDURANCE_CHARACTERS,
    SessionForm.other: _ALL_CHARACTERS,
}


class SessionPart(SQLModel):
    """One training modality within a session — each part carries its own stats."""

    form: Optional[SessionForm] = None
    character: Optional[SessionCharacter] = None
    intensity: Optional[SessionIntensity] = None
    surface: Optional[SessionSurface] = None
    duration_seconds: Optional[int] = None
    distance_km: Optional[float] = None
    rpe: Optional[int] = None
    competition: Optional[bool] = None

    @model_validator(mode="after")
    def check_combinations(self) -> "SessionPart":
        if self.form and self.surface:
            allowed = VALID_SURFACES.get(self.form, _ALL_SURFACES)
            if self.surface not in allowed:
                raise ValueError(
                    f"surface '{self.surface}' is not valid for '{self.form}'; "
                    f"allowed: {sorted(s.value for s in allowed)}"
                )
        if self.form and self.character:
            allowed = VALID_CHARACTERS.get(self.form, _ALL_CHARACTERS)
            if self.character not in allowed:
                raise ValueError(
                    f"character '{self.character}' is not valid for '{self.form}'; "
                    f"allowed: {sorted(c.value for c in allowed)}"
                )
        return self


class LactateMeasurement(SQLModel):
    """A single blood lactate reading taken during a session."""

    value_mmol: float
    comment: Optional[str] = None

    @model_validator(mode="after")
    def check_value(self) -> "LactateMeasurement":
        if self.value_mmol <= 0:
            raise ValueError("value_mmol must be greater than 0")
        return self


class User(SQLModel, table=True):
    __tablename__ = "users"
    id: str = Field(default_factory=_uuid, primary_key=True)
    name: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    palette: Optional[str] = None


class Session(SQLModel, table=True):
    __tablename__ = "sessions"
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    date: _Date = Field(index=True)
    session_no: int = 1

    name: Optional[str] = None
    parts: list[dict] = Field(
        default_factory=list,
        sa_column=sa.Column(sa.JSON, nullable=False, server_default="[]"),
    )
    lactate_measurements: list[dict] = Field(
        default_factory=list,
        sa_column=sa.Column(sa.JSON, nullable=False, server_default="[]"),
    )

    status: str = SessionStatus.planned
    comment: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# Schemas (request/response)
class UserCreate(SQLModel):
    name: str
    palette: Optional[str] = None


class SessionCreate(SQLModel):
    user_id: str
    date: _Date
    session_no: int = 1
    name: Optional[str] = None
    parts: list[SessionPart] = []
    lactate_measurements: list[LactateMeasurement] = []
    status: SessionStatus = SessionStatus.planned
    comment: Optional[str] = None
    buddy_usernames: list[str] = []


class SessionUpdate(SQLModel):
    date: Optional[_Date] = None
    session_no: Optional[int] = None
    name: Optional[str] = None
    parts: Optional[list[SessionPart]] = None
    lactate_measurements: Optional[list[LactateMeasurement]] = None
    status: Optional[SessionStatus] = None
    comment: Optional[str] = None


class Goal(SQLModel, table=True):
    __tablename__ = "goals"
    user_id: str = Field(foreign_key="users.id", primary_key=True)
    sessions_per_week: float = 0.0
    hours_per_week: float = 0.0
    km_per_week: float = 0.0
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class GoalUpdate(SQLModel):
    sessions_per_week: float
    hours_per_week: float
    km_per_week: float


class SessionReorder(SQLModel):
    ids: list[str]


class GarminCredentials(SQLModel, table=True):
    __tablename__ = "garmin_credentials"
    user_id: str = Field(primary_key=True, foreign_key="users.id")
    garmin_username: str
    garmin_password: str
    di_token: Optional[str] = None
    di_refresh_token: Optional[str] = None
    di_client_id: Optional[str] = None
    token_expires_at: Optional[datetime] = None
    mfa_pending: bool = False
    mfa_state: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    last_sync_error: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
