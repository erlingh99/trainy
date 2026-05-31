# Build frontend
FROM oven/bun:alpine AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/bun.lock ./
COPY ./frontend/ .
RUN bun install --frozen-lockfile && bun run build

# Build backend
FROM ghcr.io/astral-sh/uv:python3.13-alpine AS backend-builder
WORKDIR /app
COPY ./backend/ .
ENV UV_PROJECT_ENVIRONMENT=.venv
RUN uv sync --frozen --no-dev

# Final stage
FROM python:3.13-alpine AS prod

ARG BACKEND_HOST=0.0.0.0
ARG BACKEND_PORT=8000

ENV BACKEND_HOST=${BACKEND_HOST} \
    BACKEND_PORT=${BACKEND_PORT} \
    PATH="/app/.venv/bin:$PATH" \
    TZ=Europe/Berlin

COPY --from=backend-builder /app/.venv /app/.venv

WORKDIR /app

COPY ./backend/app ./backend/app
COPY ./backend/migrations ./backend/migrations
COPY ./backend/alembic.ini ./backend/alembic.ini
COPY --from=frontend-builder /app/dist ./frontend/dist

RUN apk add --no-cache curl tzdata

HEALTHCHECK --interval=5m --timeout=30s --start-period=5s --retries=3 \
    CMD curl "http://localhost:${BACKEND_PORT}/api/health"

WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn app.main:app --host \"${BACKEND_HOST}\" --port \"${BACKEND_PORT}\""]
