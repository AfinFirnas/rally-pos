from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection

from ..database import get_db
from ..ledger import generate_cryptographic_qr_code
from ..schemas import (
    CheckInRequest,
    CheckInResponse,
    EventChatMessageOut,
    EventDetailResponse,
    EventOut,
    EventParticipantOut,
    EventsBootstrapResponse,
    LinkBoothRequest,
    LinkBoothResponse,
    StampOut,
    TenantItemOut,
    TenantOut,
    TicketUidOut,
    TransactionOut,
    UserOut,
)
from ..security import get_current_user, get_optional_current_user

router = APIRouter(prefix="/api/events", tags=["events"])


def _sanitize_participant_for_viewer(
    row: dict[str, Any],
    viewer: dict[str, Any] | None,
) -> dict[str, Any]:
    copy = dict(row)
    is_owner = viewer is not None and str(row["user_id"]) == str(viewer["id"])
    is_admin = viewer is not None and bool(viewer.get("is_admin"))
    if not (is_owner or is_admin):
        copy["actual_spent_idr"] = 0
    return copy


def _sanitize_user_for_viewer(
    row: dict[str, Any],
    viewer: dict[str, Any] | None,
) -> dict[str, Any]:
    copy = dict(row)
    is_owner = viewer is not None and str(row["id"]) == str(viewer["id"])
    is_admin = viewer is not None and bool(viewer.get("is_admin"))
    if not (is_owner or is_admin):
        copy["lifetime_actual_spent_idr"] = 0
    return copy


def _sanitize_event_for_viewer(
    row: dict[str, Any],
    viewer: dict[str, Any] | None,
) -> dict[str, Any]:
    copy = dict(row)
    is_admin = viewer is not None and bool(viewer.get("is_admin"))
    if not is_admin:
        copy["admin_void_pin"] = ""
    return copy


@router.get("", response_model=EventsBootstrapResponse)
def list_events_bootstrap(
    viewer: dict[str, Any] | None = Depends(get_optional_current_user),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> EventsBootstrapResponse:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM public.events ORDER BY created_at DESC")
        events_rows = cur.fetchall()

        cur.execute("SELECT * FROM public.event_participants ORDER BY created_at ASC")
        participant_rows = cur.fetchall()

        cur.execute("SELECT * FROM public.tenants ORDER BY booth_number ASC")
        tenant_rows = cur.fetchall()

        cur.execute("SELECT * FROM public.tenant_items ORDER BY sort_order ASC, created_at ASC")
        item_rows = cur.fetchall()

        cur.execute("SELECT * FROM public.stamps ORDER BY unlocked_at ASC")
        stamp_rows = cur.fetchall()

        cur.execute("SELECT * FROM public.transactions ORDER BY created_at DESC")
        tx_rows = cur.fetchall()

        cur.execute("SELECT * FROM public.ticket_uids ORDER BY created_at DESC")
        ticket_rows = cur.fetchall()

        cur.execute(
            "SELECT * FROM public.event_chat_messages ORDER BY is_pinned DESC, created_at DESC"
        )
        meetup_rows = cur.fetchall()

        cur.execute("SELECT * FROM public.users ORDER BY created_at ASC")
        user_rows = cur.fetchall()

    # Privacy-aware transaction visibility
    if viewer is None:
        visible_txs: list[dict[str, Any]] = []
    elif viewer.get("is_admin"):
        visible_txs = tx_rows
    else:
        viewer_id = str(viewer["id"])
        viewer_participant_ids = {
            str(p["id"]) for p in participant_rows if str(p["user_id"]) == viewer_id
        }
        viewer_tenant_ids = {
            str(t["id"]) for t in tenant_rows if str(t["user_id"]) == viewer_id
        }
        visible_txs = [
            tx
            for tx in tx_rows
            if str(tx["participant_id"]) in viewer_participant_ids
            or str(tx["tenant_id"]) in viewer_tenant_ids
        ]

    # Non-organizers only see their own claimed tickets or unclaimed demo codes
    if viewer and viewer.get("is_admin"):
        visible_tickets = ticket_rows
    else:
        viewer_id = str(viewer["id"]) if viewer else None
        visible_tickets = [
            t
            for t in ticket_rows
            if t["claimed_by_user_id"] is None
            or (viewer_id is not None and str(t["claimed_by_user_id"]) == viewer_id)
        ]

    return EventsBootstrapResponse(
        events=[EventOut.model_validate(_sanitize_event_for_viewer(e, viewer)) for e in events_rows],
        participants=[
            EventParticipantOut.model_validate(_sanitize_participant_for_viewer(p, viewer))
            for p in participant_rows
        ],
        tenants=[TenantOut.model_validate(t) for t in tenant_rows],
        tenant_items=[TenantItemOut.model_validate(i) for i in item_rows],
        stamps=[StampOut.model_validate(s) for s in stamp_rows],
        transactions=[TransactionOut.model_validate(tx) for tx in visible_txs],
        ticket_uids=[TicketUidOut.model_validate(t) for t in visible_tickets],
        meetups=[EventChatMessageOut.model_validate(m) for m in meetup_rows],
        users=[UserOut.model_validate(_sanitize_user_for_viewer(u, viewer)) for u in user_rows],
    )


@router.get("/{event_id}", response_model=EventDetailResponse)
def get_event_detail(
    event_id: str,
    viewer: dict[str, Any] | None = Depends(get_optional_current_user),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> EventDetailResponse:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM public.events WHERE id = %s", (event_id,))
        event = cur.fetchone()
        if not event:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Selected event was not found.",
            )

        cur.execute(
            "SELECT * FROM public.tenants WHERE event_id = %s ORDER BY booth_number ASC",
            (event_id,),
        )
        tenants = cur.fetchall()

        tenant_ids = [t["id"] for t in tenants]
        if tenant_ids:
            cur.execute(
                """
                SELECT * FROM public.tenant_items
                WHERE tenant_id = ANY(%s::UUID[])
                ORDER BY sort_order ASC, created_at ASC
                """,
                (tenant_ids,),
            )
            items = cur.fetchall()
        else:
            items = []

        cur.execute(
            "SELECT COUNT(*)::INT AS cnt FROM public.event_participants WHERE event_id = %s",
            (event_id,),
        )
        participants_count = int(cur.fetchone()["cnt"])

        my_participant = None
        my_tenant = None
        if viewer is not None:
            cur.execute(
                "SELECT * FROM public.event_participants WHERE event_id = %s AND user_id = %s",
                (event_id, viewer["id"]),
            )
            my_participant = cur.fetchone()
            cur.execute(
                "SELECT * FROM public.tenants WHERE event_id = %s AND user_id = %s",
                (event_id, viewer["id"]),
            )
            my_tenant = cur.fetchone()

    return EventDetailResponse(
        event=EventOut.model_validate(_sanitize_event_for_viewer(event, viewer)),
        tenants=[TenantOut.model_validate(t) for t in tenants],
        tenant_items=[TenantItemOut.model_validate(i) for i in items],
        participants_count=participants_count,
        my_participant=EventParticipantOut.model_validate(my_participant) if my_participant else None,
        my_tenant=TenantOut.model_validate(my_tenant) if my_tenant else None,
    )


def _execute_check_in(
    conn: Connection[dict[str, Any]],
    *,
    event_id: str,
    current_user: dict[str, Any],
    uid_code: str,
    booth_name: str | None = None,
    booth_number: str | None = None,
    booth_bio: str | None = None,
    require_merchant_role: bool = False,
) -> dict[str, Any]:
    normalized_code = uid_code.strip().upper()
    if not normalized_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter your Event Ticket Code.",
        )

    now = datetime.now(timezone.utc)
    user_id = str(current_user["id"])

    with conn.cursor() as cur:
        cur.execute("SELECT * FROM public.events WHERE id = %s", (event_id,))
        event = cur.fetchone()
        if not event:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Selected event was not found.",
            )
        if event["status"] != "active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only active events accept new Event Ticket Code check-ins.",
            )

        # Single-claim lock on ticket_uids
        cur.execute(
            """
            SELECT * FROM public.ticket_uids
            WHERE event_id = %s AND UPPER(uid_code) = %s
            FOR UPDATE
            """,
            (event_id, normalized_code),
        )
        ticket = cur.fetchone()
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f'Event Ticket Code "{normalized_code}" is invalid for {event["name"]}. Try TKT-DEMO-BYR or TKT-DEMO-SLR.',
            )
        if require_merchant_role and ticket["role_type"] != "merchant":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This Event Ticket Code is an Attendee ticket. Please enter a Booth Event Ticket Code.",
            )
        if ticket["claimed_by_user_id"] is not None and str(ticket["claimed_by_user_id"]) != user_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This Event Ticket Code has already been claimed by another attendee.",
            )

        # Ensure EventParticipant & unique EV-XXXXXX QR pass
        cur.execute(
            "SELECT * FROM public.event_participants WHERE event_id = %s AND user_id = %s FOR UPDATE",
            (event_id, user_id),
        )
        participant = cur.fetchone()
        is_new_participant = False
        if not participant:
            is_new_participant = True
            cur.execute(
                "SELECT qr_code FROM public.event_participants WHERE event_id = %s",
                (event_id,),
            )
            existing_codes = {row["qr_code"] for row in cur.fetchall()}
            qr_code = generate_cryptographic_qr_code(existing_codes)

            cur.execute(
                """
                INSERT INTO public.event_participants (
                    id, event_id, user_id, qr_code,
                    actual_spent_idr, leaderboard_idr, streak_expires_at,
                    created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, 0, 0, NULL, %s, %s)
                RETURNING *
                """,
                (str(uuid.uuid4()), event_id, user_id, qr_code, now, now),
            )
            participant = cur.fetchone()

        # Ensure Stamp #1 (checkin)
        cur.execute(
            """
            SELECT * FROM public.stamps
            WHERE event_id = %s AND participant_id = %s AND stamp_type = 'checkin'
            LIMIT 1
            """,
            (event_id, participant["id"]),
        )
        check_in_stamp = cur.fetchone()
        if not check_in_stamp:
            cur.execute(
                """
                INSERT INTO public.stamps (id, event_id, participant_id, tenant_id, stamp_type, unlocked_at)
                VALUES (%s, %s, %s, NULL, 'checkin', %s)
                RETURNING *
                """,
                (str(uuid.uuid4()), event_id, participant["id"], now),
            )
            check_in_stamp = cur.fetchone()

        # Provision Booth if merchant ticket
        cur.execute(
            "SELECT * FROM public.tenants WHERE event_id = %s AND user_id = %s FOR UPDATE",
            (event_id, user_id),
        )
        tenant = cur.fetchone()
        is_new_tenant = False
        if ticket["role_type"] == "merchant" and not tenant:
            is_new_tenant = True
            cur.execute(
                "SELECT booth_number FROM public.tenants WHERE event_id = %s",
                (event_id,),
            )
            existing_booths = {r["booth_number"].upper() for r in cur.fetchall()}
            clean_booth_number = (booth_number or "").strip().upper()
            if not clean_booth_number or clean_booth_number in existing_booths:
                idx = len(existing_booths) + 1
                while f"E-{idx:02d}" in existing_booths:
                    idx += 1
                clean_booth_number = f"E-{idx:02d}"

            clean_booth_name = (
                (booth_name or "").strip()
                or current_user.get("merchant_brand_name")
                or f'{current_user["username"]}\'s Booth'
            )
            clean_bio = (
                (booth_bio or "").strip()
                or current_user.get("merchant_bio")
                or "Independent creator booth at the event."
            )
            cur.execute(
                """
                INSERT INTO public.tenants (
                    id, event_id, user_id, booth_number, booth_name, description,
                    stamp_image_url, event_sales_idr, unique_stamps_count,
                    is_cold_bounty, cold_bounty_expires_at, cold_bounty_multiplier,
                    is_hidden_bounty, hidden_bounty_bonus_idr, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, '', 0, 0, FALSE, NULL, %s, FALSE, %s, %s, %s)
                RETURNING *
                """,
                (
                    str(uuid.uuid4()),
                    event_id,
                    user_id,
                    clean_booth_number,
                    clean_booth_name,
                    clean_bio,
                    float(event["cold_bounty_multiplier"]),
                    int(event["hidden_bounty_bonus_idr"]),
                    now,
                    now,
                ),
            )
            tenant = cur.fetchone()

        # Claim ticket_uids row (single-claim)
        cur.execute(
            """
            UPDATE public.ticket_uids
            SET claimed_by_user_id = COALESCE(claimed_by_user_id, %s),
                claimed_at = COALESCE(claimed_at, %s)
            WHERE id = %s
            RETURNING *
            """,
            (user_id, now, ticket["id"]),
        )
        claimed_ticket = cur.fetchone()

        # Recompute distinct joined event count & update user merchant flags
        cur.execute(
            """
            SELECT COUNT(DISTINCT eid)::INT AS cnt
            FROM (
                SELECT event_id AS eid FROM public.event_participants WHERE user_id = %s
                UNION
                SELECT event_id AS eid FROM public.tenants WHERE user_id = %s
            ) sub
            """,
            (user_id, user_id),
        )
        events_count = int(cur.fetchone()["cnt"])

        upgrading_to_merchant = ticket["role_type"] == "merchant"
        new_is_merchant = bool(current_user.get("is_merchant")) or upgrading_to_merchant
        new_view_mode = "merchant" if upgrading_to_merchant else current_user["active_view_mode"]
        new_brand = (
            (booth_name or "").strip()
            if (upgrading_to_merchant and booth_name and booth_name.strip())
            else current_user.get("merchant_brand_name")
        )
        new_bio = (
            (booth_bio or "").strip()
            if (upgrading_to_merchant and booth_bio and booth_bio.strip())
            else current_user.get("merchant_bio")
        )

        cur.execute(
            """
            UPDATE public.users
            SET is_merchant = %s,
                active_view_mode = %s,
                merchant_brand_name = %s,
                merchant_bio = %s,
                events_count = %s,
                updated_at = %s
            WHERE id = %s
            RETURNING *
            """,
            (new_is_merchant, new_view_mode, new_brand, new_bio, events_count, now, user_id),
        )
        updated_user = cur.fetchone()

    return {
        "event": event,
        "role_type": ticket["role_type"],
        "participant": participant,
        "tenant": tenant,
        "check_in_stamp": check_in_stamp,
        "ticket_uid": claimed_ticket,
        "user": updated_user,
        "is_new_join": is_new_participant or is_new_tenant,
    }


@router.post("/{event_id}/check-in", response_model=CheckInResponse)
def check_in_event(
    event_id: str,
    payload: CheckInRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> CheckInResponse:
    with conn.transaction():
        res = _execute_check_in(
            conn,
            event_id=event_id,
            current_user=current_user,
            uid_code=payload.uid_code,
            booth_name=payload.booth_name,
            booth_number=payload.booth_number,
            booth_bio=payload.booth_bio,
            require_merchant_role=False,
        )

    return CheckInResponse(
        event=EventOut.model_validate(_sanitize_event_for_viewer(res["event"], current_user)),
        role_type=res["role_type"],
        participant=EventParticipantOut.model_validate(res["participant"]),
        tenant=TenantOut.model_validate(res["tenant"]) if res["tenant"] else None,
        check_in_stamp=StampOut.model_validate(res["check_in_stamp"]),
        ticket_uid=TicketUidOut.model_validate(res["ticket_uid"]) if res["ticket_uid"] else None,
        user=UserOut.model_validate(res["user"]) if res["user"] else None,
        is_new_join=res["is_new_join"],
    )


@router.post("/{event_id}/link-booth", response_model=LinkBoothResponse)
def link_booth(
    event_id: str,
    payload: LinkBoothRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> LinkBoothResponse:
    clean_brand = payload.booth_name.strip()
    clean_bio = (payload.bio or "").strip()

    with conn.transaction():
        res = _execute_check_in(
            conn,
            event_id=event_id,
            current_user=current_user,
            uid_code=payload.uid_code,
            booth_name=clean_brand,
            booth_number=payload.booth_number,
            booth_bio=clean_bio,
            require_merchant_role=True,
        )
        tenant = res["tenant"]
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Merchant booth could not be provisioned for this ticket.",
            )

        with conn.cursor() as cur:
            now = datetime.now(timezone.utc)
            cur.execute(
                """
                UPDATE public.tenants
                SET booth_name = %s,
                    description = COALESCE(NULLIF(%s, ''), description),
                    updated_at = %s
                WHERE id = %s
                RETURNING *
                """,
                (clean_brand, clean_bio, now, tenant["id"]),
            )
            tenant = cur.fetchone()

    return LinkBoothResponse(
        user=UserOut.model_validate(res["user"]),
        tenant=TenantOut.model_validate(tenant),
        participant=EventParticipantOut.model_validate(res["participant"]),
        check_in_stamp=StampOut.model_validate(res["check_in_stamp"]),
        ticket_uid=TicketUidOut.model_validate(res["ticket_uid"]) if res["ticket_uid"] else None,
    )
