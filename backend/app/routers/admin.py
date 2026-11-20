from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection

from ..database import get_db
from ..ledger import format_idr, generate_ticket_code
from ..schemas import (
    ActivateColdBountyRequest,
    ActivateColdBountyResponse,
    CreateEventRequest,
    CreateEventTicketsRequest,
    EventEnvelope,
    EventOut,
    RotateHiddenBountyRequest,
    TenantEnvelope,
    TenantOut,
    TenantsListResponse,
    TicketsListResponse,
    TicketUidOut,
    ToggleHiddenBountyRequest,
    TransactionEnvelope,
    TransactionOut,
    UpdateEventStatusRequest,
    UpdateEventStatusResponse,
    EventChatMessageOut,
)
from ..security import require_organizer

router = APIRouter(prefix="/api/organizer", tags=["organizer"])


@router.post("/events", response_model=EventEnvelope, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: CreateEventRequest,
    current_user: dict[str, Any] = Depends(require_organizer),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> EventEnvelope:
    now = datetime.now(timezone.utc)
    zones = payload.venue_zones or ["Main Stage", "Photo Zone A", "Photo Zone B", "Cosplay Lounge"]

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.events (
                    id, name, description, status, min_stamp_spend_idr,
                    admin_void_pin, cold_bounty_multiplier, hidden_bounty_bonus_idr,
                    venue_zones, event_date, started_at, ended_at, created_by,
                    created_at, updated_at
                )
                VALUES (%s, %s, %s, 'draft', %s, %s, %s, %s, %s, %s, NULL, NULL, %s, %s, %s)
                RETURNING *
                """,
                (
                    str(uuid.uuid4()),
                    payload.name.strip(),
                    payload.description.strip(),
                    payload.min_stamp_spend_idr,
                    payload.admin_void_pin.strip(),
                    payload.cold_bounty_multiplier,
                    payload.hidden_bounty_bonus_idr,
                    zones,
                    now,
                    current_user["id"],
                    now,
                    now,
                ),
            )
            event = cur.fetchone()

    return EventEnvelope(event=EventOut.model_validate(event))


@router.patch("/events/{event_id}/status", response_model=UpdateEventStatusResponse)
def update_event_status(
    event_id: str,
    payload: UpdateEventStatusRequest,
    current_user: dict[str, Any] = Depends(require_organizer),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> UpdateEventStatusResponse:
    now = datetime.now(timezone.utc)

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM public.events WHERE id = %s FOR UPDATE", (event_id,))
            existing = cur.fetchone()
            if not existing:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

            started_at = existing["started_at"] or now if payload.status == "active" else existing["started_at"]
            ended_at = now if payload.status == "archived" else existing["ended_at"]

            cur.execute(
                """
                UPDATE public.events
                SET status = %s,
                    started_at = %s,
                    ended_at = %s,
                    updated_at = %s
                WHERE id = %s
                RETURNING *
                """,
                (payload.status, started_at, ended_at, now, event_id),
            )
            updated_event = cur.fetchone()

            welcome_announcement = None
            if payload.status == "active":
                cur.execute(
                    """
                    SELECT id FROM public.event_chat_messages
                    WHERE event_id = %s AND message_type = 'admin_announcement'
                    LIMIT 1
                    """,
                    (event_id,),
                )
                if not cur.fetchone():
                    min_spend = format_idr(int(updated_event["min_stamp_spend_idr"]))
                    text = (
                        f'Welcome to {updated_event["name"]}! Collect booth stamps ({min_spend}+ per booth) '
                        "and visit 3 booths in 60 minutes for a 1.25x streak boost!"
                    )
                    cur.execute(
                        """
                        INSERT INTO public.event_chat_messages (
                            id, event_id, sender_user_id, sender_username, sender_role,
                            message_type, announcement_text, target_character,
                            target_location, target_activity, interested_user_ids,
                            is_pinned, created_at
                        )
                        VALUES (%s, %s, %s, %s, 'organizer', 'admin_announcement', %s, NULL, NULL, NULL, '{}'::UUID[], TRUE, %s)
                        RETURNING *
                        """,
                        (
                            str(uuid.uuid4()),
                            event_id,
                            current_user["id"],
                            current_user["username"],
                            text,
                            now,
                        ),
                    )
                    welcome_announcement = cur.fetchone()

    return UpdateEventStatusResponse(
        event=EventOut.model_validate(updated_event),
        welcome_announcement=(
            EventChatMessageOut.model_validate(welcome_announcement)
            if welcome_announcement
            else None
        ),
    )


@router.post(
    "/events/{event_id}/tickets",
    response_model=TicketsListResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_event_tickets(
    event_id: str,
    payload: CreateEventTicketsRequest,
    _: dict[str, Any] = Depends(require_organizer),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> TicketsListResponse:
    now = datetime.now(timezone.utc)
    created_rows: list[dict[str, Any]] = []

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM public.events WHERE id = %s", (event_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

            cur.execute("SELECT UPPER(uid_code) AS code FROM public.ticket_uids")
            existing_set = {row["code"] for row in cur.fetchall()}

            if payload.mode == "generate":
                count = max(1, min(50, payload.count or 10))
                assert payload.role_type is not None
                for _ in range(count):
                    code = generate_ticket_code(payload.role_type, existing_set)
                    cur.execute(
                        """
                        INSERT INTO public.ticket_uids (id, event_id, uid_code, role_type, claimed_by_user_id, claimed_at, created_at)
                        VALUES (%s, %s, %s, %s, NULL, NULL, %s)
                        RETURNING *
                        """,
                        (str(uuid.uuid4()), event_id, code, payload.role_type, now),
                    )
                    created_rows.append(cur.fetchone())
            else:
                for item in payload.tickets or []:
                    clean_code = item.uid_code.strip().upper()
                    if not clean_code or clean_code in existing_set:
                        continue
                    existing_set.add(clean_code)
                    cur.execute(
                        """
                        INSERT INTO public.ticket_uids (id, event_id, uid_code, role_type, claimed_by_user_id, claimed_at, created_at)
                        VALUES (%s, %s, %s, %s, NULL, NULL, %s)
                        RETURNING *
                        """,
                        (str(uuid.uuid4()), event_id, clean_code, item.role_type, now),
                    )
                    created_rows.append(cur.fetchone())

    return TicketsListResponse(tickets=[TicketUidOut.model_validate(t) for t in created_rows])


@router.post("/events/{event_id}/cold-bounty", response_model=ActivateColdBountyResponse)
def activate_cold_bounty(
    event_id: str,
    payload: ActivateColdBountyRequest,
    current_user: dict[str, Any] = Depends(require_organizer),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> ActivateColdBountyResponse:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=payload.duration_minutes)

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM public.events WHERE id = %s", (event_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

            cur.execute(
                """
                UPDATE public.tenants
                SET is_cold_bounty = TRUE,
                    cold_bounty_expires_at = %s,
                    cold_bounty_multiplier = %s,
                    updated_at = %s
                WHERE event_id = %s AND id = ANY(%s::UUID[])
                RETURNING *
                """,
                (expires_at, payload.multiplier, now, event_id, payload.tenant_ids),
            )
            updated_tenants = cur.fetchall()
            if not updated_tenants:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No matching booths found for cold-booth bounty.",
                )

            boosted_names = ", ".join(
                f'{t["booth_number"]} {t["booth_name"]}' for t in updated_tenants
            )
            msg_text = (
                f"GOLD COLD-BOOTH BOUNTY LIVE ({payload.duration_minutes}m): "
                f"{boosted_names} now grant a {payload.multiplier}x Leaderboard Spend Boost!"
            )
            cur.execute(
                """
                INSERT INTO public.event_chat_messages (
                    id, event_id, sender_user_id, sender_username, sender_role,
                    message_type, announcement_text, target_character,
                    target_location, target_activity, interested_user_ids,
                    is_pinned, created_at
                )
                VALUES (%s, %s, %s, %s, 'organizer', 'admin_announcement', %s, NULL, NULL, NULL, '{}'::UUID[], TRUE, %s)
                RETURNING *
                """,
                (
                    str(uuid.uuid4()),
                    event_id,
                    current_user["id"],
                    current_user["username"],
                    msg_text,
                    now,
                ),
            )
            announcement = cur.fetchone()

    return ActivateColdBountyResponse(
        tenants=[TenantOut.model_validate(t) for t in updated_tenants],
        announcement=EventChatMessageOut.model_validate(announcement) if announcement else None,
    )


@router.delete("/events/{event_id}/cold-bounty/{tenant_id}", response_model=TenantEnvelope)
def clear_cold_bounty(
    event_id: str,
    tenant_id: str,
    _: dict[str, Any] = Depends(require_organizer),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> TenantEnvelope:
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.tenants
                SET is_cold_bounty = FALSE,
                    cold_bounty_expires_at = NULL,
                    updated_at = %s
                WHERE id = %s AND event_id = %s
                RETURNING *
                """,
                (datetime.now(timezone.utc), tenant_id, event_id),
            )
            updated = cur.fetchone()
            if not updated:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booth not found.")

    return TenantEnvelope(tenant=TenantOut.model_validate(updated))


@router.patch("/booths/{tenant_id}/hidden-bounty", response_model=TenantEnvelope)
def toggle_hidden_bounty(
    tenant_id: str,
    payload: ToggleHiddenBountyRequest,
    _: dict[str, Any] = Depends(require_organizer),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> TenantEnvelope:
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.tenants
                SET is_hidden_bounty = %s,
                    updated_at = %s
                WHERE id = %s
                RETURNING *
                """,
                (payload.is_hidden_bounty, datetime.now(timezone.utc), tenant_id),
            )
            updated = cur.fetchone()
            if not updated:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booth not found.")

    return TenantEnvelope(tenant=TenantOut.model_validate(updated))


@router.post("/events/{event_id}/hidden-bounty/rotate", response_model=TenantsListResponse)
def rotate_hidden_bounties(
    event_id: str,
    payload: RotateHiddenBountyRequest,
    _: dict[str, Any] = Depends(require_organizer),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> TenantsListResponse:
    now = datetime.now(timezone.utc)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM public.tenants WHERE event_id = %s", (event_id,))
            booth_ids = [str(row["id"]) for row in cur.fetchall()]
            if not booth_ids:
                return TenantsListResponse(tenants=[])

            default_cnt = max(3, min(5, (len(booth_ids) + 1) // 2))
            target_count = min(len(booth_ids), payload.count or default_cnt)
            chosen_ids = random.sample(booth_ids, target_count)

            cur.execute(
                """
                UPDATE public.tenants
                SET is_hidden_bounty = (id = ANY(%s::UUID[])),
                    updated_at = %s
                WHERE event_id = %s
                RETURNING *
                """,
                (chosen_ids, now, event_id),
            )
            updated = cur.fetchall()

    return TenantsListResponse(tenants=[TenantOut.model_validate(t) for t in updated])


@router.post("/transactions/{transaction_id}/dismiss-flag", response_model=TransactionEnvelope)
def dismiss_transaction_flag(
    transaction_id: str,
    _: dict[str, Any] = Depends(require_organizer),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> TransactionEnvelope:
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.transactions
                SET is_flagged = FALSE
                WHERE id = %s
                RETURNING *
                """,
                (transaction_id,),
            )
            updated = cur.fetchone()
            if not updated:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Transaction not found.",
                )

    return TransactionEnvelope(transaction=TransactionOut.model_validate(updated))
