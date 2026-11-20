from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env if present
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_ROOT / ".env")


def _parse_cors_origins(raw: str) -> list[str]:
    origins = [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
    if not origins:
        origins = ["http://localhost:5173"]

    # Dev convenience: if localhost:5173 is enabled, also allow Vite port 3000 & 127.0.0.1
    if "http://localhost:5173" in origins:
        for extra in (
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ):
            if extra not in origins:
                origins.append(extra)
    return origins


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    jwt_algorithm: str
    jwt_expire_minutes: int
    cors_origins: list[str]
    pos_cooldown_seconds: int


def load_settings() -> Settings:
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/rallypos",
    ).strip()
    jwt_secret = os.getenv("JWT_SECRET", "change-me-in-production").strip()
    cors_raw = os.getenv("CORS_ORIGINS", "http://localhost:5173").strip()
    cooldown = int(os.getenv("POS_COOLDOWN_SECONDS", "10"))
    expire_minutes = int(os.getenv("JWT_EXPIRE_MINUTES", str(60 * 24 * 7)))

    return Settings(
        database_url=database_url,
        jwt_secret=jwt_secret,
        jwt_algorithm="HS256",
        jwt_expire_minutes=expire_minutes,
        cors_origins=_parse_cors_origins(cors_raw),
        pos_cooldown_seconds=max(0, cooldown),
    )


settings = load_settings()
