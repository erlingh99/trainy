# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trainy is a training planner app with two components:

- `backend/` — FastAPI service (Python, uv, SQLModel/SQLAlchemy over SQLite) managing users, training sessions, and goals, plus a Garmin Connect integration for importing completed activities.
- `frontend/` — React 19 + Vite + TanStack Router (file-based, `src/routes/`, generates `src/routeTree.gen.ts` — don't hand-edit it) + Tailwind + shadcn/radix, with i18n (`src/locales/{en,sv,nb}`) via i18next and an MSW mock mode (`dev:mock`, backed by `src/mocks/`).

The backend has a `pytest` suite in `backend/tests/` (run by CI); the frontend has none — don't assume `vitest` is configured unless you add it.

The root multi-stage `Dockerfile` builds frontend (bun) + backend (uv) into one production image (`FRONTEND_DIST` in `backend/app/config.py` points the backend at the built frontend assets).

## Common Commands

### Backend (`backend/`)
```bash
uv sync --group dev
uv run uvicorn app.main:app --reload
uv run ruff check
uv run ty check
uv run pytest
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

## Tests (`backend/tests/`)

Tests drive the API over HTTP with `TestClient` rather than calling router functions directly — calling them directly leaves FastAPI's `Query(...)` defaults as sentinel objects rather than `None`, which silently changes behaviour.

- `conftest.py` — `seed` writes rows through a **sync** engine while the app reads the same SQLite file over `aiosqlite`, which keeps the tests sync and avoids needing `pytest-asyncio`. The `client` fixture overrides the `get_session` dependency and **does not run the app lifespan**, since `init_db()` would run alembic against the configured production path. The test engine uses `NullPool` because `TestClient` runs each request on its own event loop, and a pooled connection closed from a different loop makes aiosqlite call `asyncio.get_event_loop()` with no loop running.
- `filterwarnings = ["error"]` in `pyproject.toml` — warnings fail the suite, so dispose any engine a fixture creates or an unclosed sqlite handle will surface as an unraisable exception. `httpx2` (not `httpx`) is the dev dependency; `starlette.testclient` warns on the latter.
- `test_sessions_search.py` — search filters plus keyset pagination. The `walk()` helper follows `next_cursor` to the end and asserts the concatenation equals the unpaginated order; the same-date cases are what catch a cursor that ignores `session_no`.
- `test_migrations.py` — steps alembic to the revision before a data migration, seeds legacy rows, upgrades, and asserts the rewrite. Worth doing for any migration that rewrites rows, since `downgrade()` for those is typically irreversible.
- `test_app.py` — `app/main.py` must import with **no** `frontend/dist` present, so keep the static mount guarded by `is_dir()`. The backend CI job never builds the frontend, and neither does a plain `uvicorn app.main:app`; an unguarded `StaticFiles(directory=...)` raises at import and takes the whole suite down.

## CI (`.github/workflows/`)

- `pr-checks.yml`: backend (`ty check`, `ruff check`, `pytest`) and frontend (`tsc --noEmit`, `eslint` — no tests) run independently.
- `deploy.yml`: on push to `main`, builds+pushes the arm64 Docker image to GHCR, then SSHes over Tailscale to the `trainy` staging environment and runs `scripts/restart.sh`.

## Backups

The `trainy-backup` service in `docker-compose.yml` (`offen/docker-volume-backup:v2`) archives the `trainy_data` volume (`training.db`) nightly at 03:30 to `${BACKUP_ARCHIVE_ROOT}/trainy` on the host, keeping 30 days of `.tar.gz` files (older ones pruned automatically). `BACKUP_ARCHIVE_ROOT` must be set on the host (same mechanism as `${DNS_IP}`) to the mount point of the external backup HDD, e.g. `/mnt/backup-hdd`. During each backup the `trainy` container is briefly stopped and restarted (via the `docker-volume-backup.stop-during-backup` label) to guarantee a consistent copy of the SQLite file.

To restore: `docker compose stop trainy`, extract the desired `trainy-<timestamp>.tar.gz` from the archive directory so `training.db` lands back at the `trainy_data` volume's `/app/data` path, then `docker compose start trainy`.
