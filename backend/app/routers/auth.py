from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg import Connection

from ..database import get_db
from ..schemas import (
    AuthResponse,
    DemoAuthRequest,
    LoginRequest,
    OkResponse,
    RegisterRequest,
    SwitchViewModeRequest,
    UserEnvelope,
    UserOut,
)
from ..security import (
    create_access_token,
    get_current_user,
    hash_password,
    revoke_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
_optional_bearer = HTTPBearer(auto_error=False)

DEMO_PRESET_USER_IDS = {
    "active_buyer": "20000000-0000-4000-8000-000000000201",
    "merchant": "20000000-0000-4000-8000-000000000101",
    "admin": "20000000-0000-4000-8000-000000000001",
}


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> AuthResponse:
    normalized_email = payload.email.strip().lower()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM public.users WHERE LOWER(email) = %s LIMIT 1",
            (normalized_email,),
        )
        user = cur.fetchone()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No account found with that email. Try Demo Preview or Create Account.",
        )

    if not verify_password(payload.password, user.get("password_hash") or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password.",
        )

    token = create_access_token(user)
    return AuthResponse(token=token, user=UserOut.model_validate(user))


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> AuthResponse:
    normalized_email = payload.email.strip().lower()
    clean_username = payload.username.strip()

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM public.users WHERE LOWER(email) = %s LIMIT 1",
                (normalized_email,),
            )
            if cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account with this email already exists.",
                )

            cur.execute(
                "SELECT id FROM public.users WHERE LOWER(username) = %s LIMIT 1",
                (clean_username.lower(),),
            )
            if cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="That username is already taken.",
                )

            new_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc)
            cur.execute(
                """
                INSERT INTO public.users (
                    id, email, username, password_hash,
                    is_merchant, is_admin, active_view_mode,
                    lifetime_actual_spent_idr, lifetime_sales_idr,
                    events_count, earned_badges, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, FALSE, FALSE, 'buyer', 0, 0, 0, '{}'::TEXT[], %s, %s)
                RETURNING *
                """,
                (new_id, normalized_email, clean_username, hash_password(payload.password), now, now),
            )
            user = cur.fetchone()

    token = create_access_token(user)
    return AuthResponse(token=token, user=UserOut.model_validate(user))


@router.post("/demo", response_model=AuthResponse)
def login_demo(
    payload: DemoAuthRequest,
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> AuthResponse:
    with conn.transaction():
        with conn.cursor() as cur:
            if payload.preset == "fresh_buyer":
                cur.execute(
                    "SELECT * FROM public.users WHERE LOWER(email) = 'demo.explorer@rallypos.id' LIMIT 1"
                )
                user = cur.fetchone()
                if not user:
                    new_id = str(uuid.uuid4())
                    now = datetime.now(timezone.utc)
                    cur.execute(
                        """
                        INSERT INTO public.users (
                            id, email, username, password_hash,
                            is_merchant, is_admin, active_view_mode,
                            lifetime_actual_spent_idr, lifetime_sales_idr,
                            events_count, earned_badges, created_at, updated_at
                        )
                        VALUES (%s, 'demo.explorer@rallypos.id', 'DemoExplorer', 'DEMO_HASH_EXPLORER',
                                FALSE, FALSE, 'buyer', 0, 0, 0, '{}'::TEXT[], %s, %s)
                        RETURNING *
                        """,
                        (new_id, now, now),
                    )
                    user = cur.fetchone()
            else:
                target_id = DEMO_PRESET_USER_IDS[payload.preset]
                cur.execute("SELECT * FROM public.users WHERE id = %s LIMIT 1", (target_id,))
                user = cur.fetchone()
                if not user:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Demo account could not be found. Run seed.sql first.",
                    )

    token = create_access_token(user)
    return AuthResponse(token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserEnvelope)
def get_me(current_user: dict[str, Any] = Depends(get_current_user)) -> UserEnvelope:
    return UserEnvelope(user=UserOut.model_validate(current_user))


@router.post("/logout", response_model=OkResponse)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
) -> OkResponse:
    if credentials and credentials.credentials:
        revoke_token(credentials.credentials)
    return OkResponse(ok=True)


@router.patch("/view-mode", response_model=UserEnvelope)
def switch_view_mode(
    payload: SwitchViewModeRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> UserEnvelope:
    if payload.active_view_mode == "merchant" and not current_user.get("is_merchant"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unlock a merchant booth first.",
        )

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.users
                SET active_view_mode = %s, updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                (payload.active_view_mode, current_user["id"]),
            )
            updated = cur.fetchone()

    return UserEnvelope(user=UserOut.model_validate(updated))
