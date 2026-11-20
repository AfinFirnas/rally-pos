from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection

from ..database import get_db
from ..schemas import (
    CreateMeetupRequest,
    EventChatMessageOut,
    MeetupMessageEnvelope,
    MeetupsListResponse,
    ToggleMeetupInterestResponse,
)
from ..security import require_attendee

router = APIRouter(tags=["meetups"])


@router.get("/api/events/{event_id}/meetups", response_model=MeetupsListResponse)
def list_event_meetups(
    event_id: str,
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> MeetupsListResponse:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM public.events WHERE id = %s", (event_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

        cur.execute(
            """
            SELECT * FROM public.event_chat_messages
            WHERE event_id = %s
            ORDER BY is_pinned DESC, created_at DESC
            """,
            (event_id,),
        )
        rows = cur.fetchall()

    return MeetupsListResponse(
        event_id=event_id,
        messages=[EventChatMessageOut.model_validate(r) for r in rows],
    )


@router.post(
    "/api/events/{event_id}/meetups",
    response_model=MeetupMessageEnvelope,
    status_code=status.HTTP_201_CREATED,
)
def create_meetup_message(
    event_id: str,
    payload: CreateMeetupRequest,
    current_user: dict[str, Any] = Depends(require_attendee),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> MeetupMessageEnvelope:
    if payload.message_type == "admin_announcement" and not current_user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organizers can post official announcements.",
        )

    if payload.message_type == "admin_announcement":
        sender_role = "organizer"
        announcement_text = payload.announcement_text.strip() if payload.announcement_text else None
        target_character = None
        target_location = None
        target_activity = None
        is_pinned = bool(payload.is_pinned)
    else:
        if payload.sender_role == "merchant" and current_user.get("is_merchant"):
            sender_role = "merchant"
        elif payload.sender_role == "organizer" and current_user.get("is_admin"):
            sender_role = "organizer"
        else:
            sender_role = "buyer"
        announcement_text = None
        target_character = payload.target_character.strip() if payload.target_character else None
        target_location = payload.target_location.strip() if payload.target_location else None
        target_activity = payload.target_activity.strip() if payload.target_activity else None
        is_pinned = False

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM public.events WHERE id = %s", (event_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Event not found.",
                )

            cur.execute(
                """
                INSERT INTO public.event_chat_messages (
                    id, event_id, sender_user_id, sender_username, sender_role,
                    message_type, announcement_text, target_character,
                    target_location, target_activity, interested_user_ids,
                    is_pinned, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, '{}'::UUID[], %s, %s)
                RETURNING *
                """,
                (
                    str(uuid.uuid4()),
                    event_id,
                    current_user["id"],
                    current_user["username"],
                    sender_role,
                    payload.message_type,
                    announcement_text,
                    target_character,
                    target_location,
                    target_activity,
                    is_pinned,
                    datetime.now(timezone.utc),
                ),
            )
            msg = cur.fetchone()

    return MeetupMessageEnvelope(message=EventChatMessageOut.model_validate(msg))


@router.post("/api/meetups/{message_id}/interest", response_model=ToggleMeetupInterestResponse)
def toggle_meetup_interest(
    message_id: str,
    current_user: dict[str, Any] = Depends(require_attendee),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> ToggleMeetupInterestResponse:
    user_id_str = str(current_user["id"])

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM public.event_chat_messages WHERE id = %s FOR UPDATE",
                (message_id,),
            )
            msg = cur.fetchone()
            if not msg:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Meetup post not found.",
                )

            existing_ids = [str(uid) for uid in (msg.get("interested_user_ids") or [])]
            if user_id_str in existing_ids:
                next_ids = [uid for uid in existing_ids if uid != user_id_str]
                interested = False
            else:
                next_ids = existing_ids + [user_id_str]
                interested = True

            cur.execute(
                """
                UPDATE public.event_chat_messages
                SET interested_user_ids = %s::UUID[]
                WHERE id = %s
                RETURNING *
                """,
                (next_ids, message_id),
            )
            updated = cur.fetchone()

    return ToggleMeetupInterestResponse(
        message=EventChatMessageOut.model_validate(updated),
        interested=interested,
    )
