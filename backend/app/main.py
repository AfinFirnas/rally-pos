from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .database import check_database_health, close_pool, init_pool
from .routers import admin, auth, booths, events, leaderboard, meetups, pos


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_pool()
    try:
        yield
    finally:
        close_pool()


app = FastAPI(
    title="RallyPOS Backend API",
    version="1.0.0",
    description="FastAPI + PostgreSQL REST API for RallyPOS Event POS, Stamp Rally & Dual-IDR Leaderboard.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    message = str(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": message,
            "message": message,
            "detail": exc.detail,
        },
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    first_msg = errors[0].get("msg", "Invalid request payload.") if errors else "Invalid request payload."
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": first_msg,
            "message": first_msg,
            "detail": errors,
        },
    )


@app.get("/health", tags=["health"])
def health_check() -> dict[str, Any]:
    db_ok = check_database_health()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "unreachable",
    }


app.include_router(auth.router)
app.include_router(events.router)
app.include_router(leaderboard.router)
app.include_router(pos.router)
app.include_router(booths.router)
app.include_router(meetups.router)
app.include_router(admin.router)
