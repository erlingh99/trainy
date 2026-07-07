# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trainy is a training planner app with two components:

- `backend/` — FastAPI service (Python, uv, SQLModel/SQLAlchemy over SQLite) managing users, training sessions, and goals, plus a Garmin Connect integration for importing completed activities.
- `frontend/` — React 19 + Vite + TanStack Router (file-based, `src/routes/`, generates `src/routeTree.gen.ts` — don't hand-edit it) + Tailwind + shadcn/radix, with i18n (`src/locales/{en,sv,nb}`) via i18next and an MSW mock mode (`dev:mock`, backed by `src/mocks/`).

No test suite exists in either component today (CI only runs typecheck + lint) — don't assume `pytest`/`vitest` are configured unless you add them.

The root multi-stage `Dockerfile` builds frontend (bun) + backend (uv) into one production image (`FRONTEND_DIST` in `backend/app/config.py` points the backend at the built frontend assets).

## Common Commands

### Backend (`backend/`)
```bash
uv sync --group dev
uv run uvicorn app.main:app --reload
uv run ruff check
uv run ty check
```
Alembic migrations in `backend/migrations/versions/`; `init_db()` (`app/database/db.py`) runs `alembic upgrade head` automatically on startup.

### Frontend (`frontend/`)
```bash
bun install
bun run dev            # against a real backend
bun run dev:mock        # VITE_USE_MOCK_API=true, uses MSW mocks in src/mocks/
bun run build
bun run typecheck        # tsc --noEmit
bun run lint
bun run format            # prettier --write
```

### Full stack
```bash
docker compose up -d --build
```

## Architecture Notes

**Users are name-scoped, not authenticated**: every API endpoint takes a `?user=<name>` query param (no auth/session system) resolved to a `User` row by unique `name` (see `_resolve_user` pattern in `app/routers/garmin.py`, repeated across routers). Treat this as a single/family-household app model, not multi-tenant SaaS with real auth.

**Sessions can have multiple "parts"**: a `Session` (`app/models/models.py`) holds a `parts: list[dict]` JSON column, where each part is a `SessionPart` (form/character/intensity/surface/duration/distance/rpe) — e.g. a brick workout of running + strength in one calendar slot. `SessionPart.check_combinations` enforces which `SessionSurface`/`SessionCharacter` values are valid per `SessionForm` (`VALID_SURFACES`/`VALID_CHARACTERS` maps) — extend those maps rather than relaxing the validator when adding new session types.

**Garmin integration is the most complex subsystem** (`app/garmin/`):
- `client.py` — a from-scratch Garmin Connect SSO client (adapted from a reference implementation, not an installed package) with a 5-strategy login fallback chain (portal/mobile/widget × cffi/requests) to work around Cloudflare's WAF. **The 30–45s delay between the SSO page GET and the credentials POST is load-bearing — do not shorten it**, and DI OAuth2 bearer tokens are used exclusively (no JWT-cookie path). MFA is a two-step flow: `login()` returns `mfa_required=True` and stashes serializable session state (`pending_mfa_state`) in the DB (`GarminCredentials.mfa_state`); `resume_mfa()` later replays it.
- `crypto.py` — Garmin passwords are Fernet-encrypted at rest using `GARMIN_SECRET_KEY` (must be set in the environment; generate via the command in the module docstring). Losing/rotating this key invalidates all stored Garmin credentials.
- `mapper.py` — maps raw Garmin activity `typeKey`s to `SessionForm`/`SessionSurface` and proposes matches against existing planned `Session`s.
- `routers/garmin.py` — two-phase sync: `POST /api/garmin/sync/preview` (read-only, proposes matches) then `POST /api/garmin/sync/apply` (writes user-confirmed choices — match into an existing session, create a new one, or skip).

**Backend layering** mirrors the sibling projects (alarmy, leafy): `routers/` → SQLModel table + schema classes in `models/models.py` (SQLModel doubles as both ORM model and Pydantic schema here, unlike alarmy/leafy's separate Pydantic/SQLAlchemy layers) → `database/db.py` for session/engine setup.

## CI (`.github/workflows/`)

- `pr-checks.yml`: backend (`ty check`, `ruff check` — no tests) and frontend (`tsc --noEmit`, `eslint`) run independently.
- `deploy.yml`: on push to `main`, builds+pushes the arm64 Docker image to GHCR, then SSHes over Tailscale to the `trainy` staging environment and runs `scripts/restart.sh`.
