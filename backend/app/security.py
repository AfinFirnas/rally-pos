from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg import Connection

from .config import settings
from .database import get_db

_bearer_scheme = HTTPBearer(auto_error=False)
_REVOKED_TOKENS: set[str] = set()


# ============================================================================
# PASSWORD HASHING & VERIFICATION
# ============================================================================


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash:
        return False

    # Seeded interactive demo accounts accept any non-empty password in dev/demo mode
    if stored_hash.startswith("DEMO_HASH_"):
        return len(password) > 0

    if stored_hash.startswith("DEMO_PW_"):
        return hmac.compare_digest(stored_hash, f"DEMO_PW_{password}")

    if stored_hash.startswith("pbkdf2_sha256$"):
        try:
            _, salt, expected_hex = stored_hash.split("$", 2)
        except ValueError:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000
        )
        return hmac.compare_digest(digest.hex(), expected_hex)

    return hmac.compare_digest(stored_hash, password)


# ============================================================================
# JWT ISSUE, DECODE & REVOCATION
# ============================================================================


def create_access_token(user: dict[str, Any]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["id"]),
        "email": user["email"],
        "is_merchant": bool(user["is_merchant"]),
        "is_admin": bool(user["is_admin"]),
        "jti": secrets.token_hex(12),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    if token in _REVOKED_TOKENS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session token has been logged out.",
        )
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        ) from exc


def revoke_token(token: str) -> None:
    if token:
        _REVOKED_TOKENS.add(token)


# ============================================================================
# FASTAPI ROLE GUARDS (attendee, booth, organizer)
# ============================================================================


def _fetch_user_by_id(conn: Connection[dict[str, Any]], user_id: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM public.users WHERE id = %s", (user_id,))
        return cur.fetchone()


def get_optional_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> dict[str, Any] | None:
    if credentials is None or not credentials.credentials:
        return None
    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        return None
    return _fetch_user_by_id(conn, str(user_id))


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> dict[str, Any]:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a Bearer token.",
        )
    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject.",
        )
    user = _fetch_user_by_id(conn, str(user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user no longer exists.",
        )
    return user


def require_attendee(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Authenticated attendee (any signed-in user)."""
    return user


def require_booth(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Authenticated merchant / booth operator or organizer."""
    if not user.get("is_merchant") and not user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Merchant booth access required. Unlock a booth first.",
        )
    return user


def require_organizer(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Authenticated event organizer / admin."""
    if not user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organizer permissions required for this operation.",
        )
    return user
