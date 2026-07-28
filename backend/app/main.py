from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.gzip import GZipMiddleware

from .routers import sessions as sessions_router
from .routers import summary as summary_router
from .routers import users as users_router
from .routers import health as health_router
from .routers import goals as goals_router
from .routers import garmin as garmin_router
from .config import FRONTEND_DIST
from .database.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Training Planner", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Only present once the frontend has been built (the Docker image does this).
# Guarded so the API still runs standalone — `uvicorn app.main:app`, and tests.
_assets = FRONTEND_DIST / "assets"
if _assets.is_dir():
    app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

app.include_router(users_router.router)
app.include_router(sessions_router.router)
app.include_router(summary_router.router)
app.include_router(goals_router.router)
app.include_router(health_router.router)
app.include_router(garmin_router.router)

# Catch-all route for SPA - must be last
@app.get("/{full_path:path}", include_in_schema=False)
async def catch_all(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    candidate = FRONTEND_DIST / full_path
    if candidate.is_file():
        return FileResponse(candidate)
    index = FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="Frontend not built")
    return FileResponse(index, media_type="text/html")