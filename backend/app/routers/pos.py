from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection
from psycopg.types.json import Jsonb

from ..config import settings
from ..database import get_db
from ..ledger import calculate_dual_idr_checkout, evaluate_void_reversal
from ..schemas import (
    EventParticipantOut,
    PosCheckoutRequest,
    PosCheckoutResponse,
    PosReverseRequest,
    PosReverseResponse,
    StampOut,
    TenantOut,
    TransactionOut,
)
from ..security import require_booth

router = APIRouter(prefix="/api/pos", tags=["pos"])


@router.post("/checkout", response_model=PosCheckoutResponse)
def pos_checkout(
    payload: PosCheckoutRequest,
    current_user: dict[str, Any] = Depends(require_booth),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> PosCheckoutResponse:
    normalized_qr = payload.buyer_qr_code.strip().upper()

    with conn.transaction():
        with conn.cursor() as cur:
            # 1. Idempotency check using client_tx_id / transaction_uuid
            cur.execute(
                "SELECT * FROM public.transactions WHERE client_tx_id = %s LIMIT 1",
                (payload.client_tx_id,),
            )
            existing_tx = cur.fetchone()
            if existing_tx:
                cur.execute(
                    "SELECT * FROM public.event_participants WHERE id = %s",
                    (existing_tx["participant_id"],),
                )
                participant = cur.fetchone()
                cur.execute(
                    "SELECT * FROM public.tenants WHERE id = %s",
                    (existing_tx["tenant_id"],),
                )
                tenant = cur.fetchone()
                if not participant or not tenant:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Participant or booth record not found for existing transaction.",
                    )
                return PosCheckoutResponse(
                    transaction=TransactionOut.model_validate(existing_tx),
                    participant=EventParticipantOut.model_validate(participant),
                    tenant=TenantOut.model_validate(tenant),
                    unlocked_stamp=None,
                    hidden_bounty_triggered=bool(existing_tx["hit_hidden_bounty"]),
                    hidden_bounty_bonus_idr=int(existing_tx["hidden_bounty_bonus_idr"]),
                )

            # 2. Validate Event, Booth (with ownership check), and Buyer QR Pass (locked FOR UPDATE)
            cur.execute("SELECT * FROM public.events WHERE id = %s", (payload.event_id,))
            event = cur.fetchone()
            if not event:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
            if event["status"] != "active":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Event is not active.",
                )

            cur.execute(
                """
                SELECT * FROM public.tenants
                WHERE id = %s AND event_id = %s
                FOR UPDATE
                """,
                (payload.tenant_id, payload.event_id),
            )
            tenant = cur.fetchone()
            if not tenant:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Booth tenant not found for this event.",
                )
            if not current_user.get("is_admin") and str(tenant["user_id"]) != str(current_user["id"]):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not own this booth terminal.",
                )

            cur.execute(
                """
                SELECT * FROM public.event_participants
                WHERE event_id = %s AND UPPER(qr_code) = %s
                FOR UPDATE
                """,
                (payload.event_id, normalized_qr),
            )
            participant = cur.fetchone()
            if not participant:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f'Buyer QR "{normalized_qr}" is not registered in this event.',
                )

            # 3. Fetch recent transactions & existing booth stamp for Dual-IDR + Cooldown calculation
            cur.execute(
                """
                SELECT * FROM public.transactions
                WHERE event_id = %s AND participant_id = %s
                ORDER BY created_at DESC
                LIMIT 100
                """,
                (event["id"], participant["id"]),
            )
            recent_participant_txs = cur.fetchall()

            cur.execute(
                """
                SELECT * FROM public.transactions
                WHERE event_id = %s AND tenant_id = %s
                ORDER BY created_at DESC
                LIMIT 50
                """,
                (event["id"], tenant["id"]),
            )
            recent_tenant_txs = cur.fetchall()

            cur.execute(
                """
                SELECT id FROM public.stamps
                WHERE event_id = %s
                  AND participant_id = %s
                  AND tenant_id = %s
                  AND stamp_type = 'booth'
                LIMIT 1
                """,
                (event["id"], participant["id"], tenant["id"]),
            )
            existing_booth_stamp = cur.fetchone() is not None

            now = datetime.now(timezone.utc)
            calc = calculate_dual_idr_checkout(
                actual_amount_idr=payload.actual_amount_idr,
                event=event,
                participant=participant,
                tenant=tenant,
                recent_participant_txs=recent_participant_txs,
                recent_tenant_txs=recent_tenant_txs,
                existing_booth_stamp=existing_booth_stamp,
                now=now,
                cooldown_seconds=settings.pos_cooldown_seconds,
            )

            if not calc.allowed:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=calc.block_reason or "COOLDOWN_ACTIVE: Duplicate scan cooldown active.",
                )

            # 4. Atomic Ledger Inserts & Rollup Updates
            items_json = (
                Jsonb([item.model_dump() for item in payload.item_summary])
                if payload.item_summary is not None
                else None
            )
            cur.execute(
                """
                INSERT INTO public.transactions (
                    id, client_tx_id, event_id, participant_id, tenant_id,
                    actual_amount_idr, leaderboard_amount_idr, multiplier_applied,
                    hit_hidden_bounty, hidden_bounty_bonus_idr, status,
                    is_flagged, flag_reason, item_summary, voided_at, voided_by_user_id, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'completed', %s, %s, %s, NULL, NULL, %s)
                RETURNING *
                """,
                (
                    str(uuid.uuid4()),
                    payload.client_tx_id,
                    event["id"],
                    participant["id"],
                    tenant["id"],
                    calc.actual_amount_idr,
                    calc.leaderboard_amount_idr,
                    calc.multiplier_applied,
                    calc.hidden_bounty_triggered,
                    calc.hidden_bounty_bonus_idr,
                    calc.cooldown.is_flagged,
                    calc.cooldown.flag_description,
                    items_json,
                    now,
                ),
            )
            new_tx = cur.fetchone()

            cur.execute(
                """
                UPDATE public.event_participants
                SET actual_spent_idr = %s,
                    leaderboard_idr = %s,
                    streak_expires_at = %s,
                    updated_at = %s
                WHERE id = %s
                RETURNING *
                """,
                (
                    calc.new_participant_actual_spent_idr,
                    calc.new_participant_leaderboard_idr,
                    calc.new_streak_expires_at,
                    now,
                    participant["id"],
                ),
            )
            updated_participant = cur.fetchone()

            unlocked_stamp = None
            if calc.should_unlock_booth_stamp:
                cur.execute(
                    """
                    INSERT INTO public.stamps (id, event_id, participant_id, tenant_id, stamp_type, unlocked_at)
                    VALUES (%s, %s, %s, %s, 'booth', %s)
                    ON CONFLICT DO NOTHING
                    RETURNING *
                    """,
                    (str(uuid.uuid4()), event["id"], participant["id"], tenant["id"], now),
                )
                unlocked_stamp = cur.fetchone()

            cur.execute(
                """
                UPDATE public.tenants
                SET event_sales_idr = event_sales_idr + %s,
                    unique_stamps_count = unique_stamps_count + %s,
                    updated_at = %s
                WHERE id = %s
                RETURNING *
                """,
                (
                    calc.actual_amount_idr,
                    1 if unlocked_stamp is not None else 0,
                    now,
                    tenant["id"],
                ),
            )
            updated_tenant = cur.fetchone()

            cur.execute(
                """
                UPDATE public.users
                SET lifetime_actual_spent_idr = lifetime_actual_spent_idr + %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (calc.actual_amount_idr, now, participant["user_id"]),
            )
            cur.execute(
                """
                UPDATE public.users
                SET lifetime_sales_idr = lifetime_sales_idr + %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (calc.actual_amount_idr, now, tenant["user_id"]),
            )

    return PosCheckoutResponse(
        transaction=TransactionOut.model_validate(new_tx),
        participant=EventParticipantOut.model_validate(updated_participant),
        tenant=TenantOut.model_validate(updated_tenant),
        unlocked_stamp=StampOut.model_validate(unlocked_stamp) if unlocked_stamp else None,
        hidden_bounty_triggered=calc.hidden_bounty_triggered,
        hidden_bounty_bonus_idr=calc.hidden_bounty_bonus_idr,
    )


@router.post("/reverse", response_model=PosReverseResponse)
def pos_reverse(
    payload: PosReverseRequest,
    current_user: dict[str, Any] = Depends(require_booth),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> PosReverseResponse:
    provided_pin = (payload.admin_void_pin or "").strip()

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM public.transactions WHERE id = %s FOR UPDATE",
                (payload.transaction_id,),
            )
            tx = cur.fetchone()
            if not tx:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Transaction not found.",
                )

            cur.execute("SELECT * FROM public.events WHERE id = %s", (tx["event_id"],))
            event = cur.fetchone()
            if not event:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

            cur.execute(
                "SELECT * FROM public.tenants WHERE id = %s FOR UPDATE",
                (tx["tenant_id"],),
            )
            tenant = cur.fetchone()
            if not tenant:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booth record not found.")

            is_admin = bool(current_user.get("is_admin"))
            is_booth_owner = str(tenant["user_id"]) == str(current_user["id"])
            if not is_admin and not is_booth_owner:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have permission to void this transaction.",
                )

            if not is_admin and provided_pin != event["admin_void_pin"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="INVALID_VOID_PIN: Invalid Organizer Admin PIN.",
                )
            if provided_pin and provided_pin != event["admin_void_pin"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="INVALID_VOID_PIN: Invalid Organizer Admin PIN.",
                )

            cur.execute(
                "SELECT * FROM public.event_participants WHERE id = %s FOR UPDATE",
                (tx["participant_id"],),
            )
            participant = cur.fetchone()
            if not participant:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Participant record not found.",
                )

            cur.execute(
                """
                SELECT * FROM public.transactions
                WHERE event_id = %s AND participant_id = %s
                """,
                (tx["event_id"], tx["participant_id"]),
            )
            participant_txs = cur.fetchall()

            cur.execute(
                """
                SELECT * FROM public.stamps
                WHERE event_id = %s
                  AND participant_id = %s
                  AND tenant_id = %s
                  AND stamp_type = 'booth'
                LIMIT 1
                """,
                (tx["event_id"], tx["participant_id"], tx["tenant_id"]),
            )
            booth_stamp = cur.fetchone()

            reversal = evaluate_void_reversal(
                tx_to_void=tx,
                event_min_stamp_spend_idr=int(event["min_stamp_spend_idr"]),
                participant_transactions=participant_txs,
                participant_has_booth_stamp=booth_stamp is not None,
            )
            if not reversal.valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=reversal.error_reason or "Cannot void transaction.",
                )

            now = datetime.now(timezone.utc)
            cur.execute(
                """
                UPDATE public.transactions
                SET status = 'voided',
                    is_flagged = FALSE,
                    voided_at = %s,
                    voided_by_user_id = %s
                WHERE id = %s
                RETURNING *
                """,
                (now, current_user["id"], tx["id"]),
            )
            voided_tx = cur.fetchone()

            cur.execute(
                """
                UPDATE public.event_participants
                SET actual_spent_idr = GREATEST(0, actual_spent_idr - %s),
                    leaderboard_idr = GREATEST(0, leaderboard_idr - %s),
                    updated_at = %s
                WHERE id = %s
                RETURNING *
                """,
                (
                    reversal.deduct_actual_idr,
                    reversal.deduct_leaderboard_idr,
                    now,
                    participant["id"],
                ),
            )
            updated_participant = cur.fetchone()

            reversed_stamp_id: str | None = None
            if reversal.should_reverse_booth_stamp and booth_stamp:
                cur.execute("DELETE FROM public.stamps WHERE id = %s", (booth_stamp["id"],))
                reversed_stamp_id = str(booth_stamp["id"])

            cur.execute(
                """
                UPDATE public.tenants
                SET event_sales_idr = GREATEST(0, event_sales_idr - %s),
                    unique_stamps_count = GREATEST(0, unique_stamps_count - %s),
                    updated_at = %s
                WHERE id = %s
                RETURNING *
                """,
                (
                    reversal.deduct_actual_idr,
                    1 if reversed_stamp_id else 0,
                    now,
                    tenant["id"],
                ),
            )
            updated_tenant = cur.fetchone()

            cur.execute(
                """
                UPDATE public.users
                SET lifetime_actual_spent_idr = GREATEST(0, lifetime_actual_spent_idr - %s),
                    updated_at = %s
                WHERE id = %s
                """,
                (reversal.deduct_actual_idr, now, participant["user_id"]),
            )
            cur.execute(
                """
                UPDATE public.users
                SET lifetime_sales_idr = GREATEST(0, lifetime_sales_idr - %s),
                    updated_at = %s
                WHERE id = %s
                """,
                (reversal.deduct_actual_idr, now, tenant["user_id"]),
            )

    return PosReverseResponse(
        transaction=TransactionOut.model_validate(voided_tx),
        participant=EventParticipantOut.model_validate(updated_participant),
        tenant=TenantOut.model_validate(updated_tenant),
        reversed_stamp_id=reversed_stamp_id,
        deduct_actual_idr=reversal.deduct_actual_idr,
        deduct_leaderboard_idr=reversal.deduct_leaderboard_idr,
    )
