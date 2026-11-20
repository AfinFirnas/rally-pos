from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection

from ..database import get_db
from ..ledger import compute_leaderboard_standing
from ..schemas import LeaderboardEntryOut, LeaderboardResponse

router = APIRouter(prefix="/api/events", tags=["leaderboard"])


@router.get("/{event_id}/leaderboard", response_model=LeaderboardResponse)
def get_event_leaderboard(
    event_id: str,
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> LeaderboardResponse:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM public.events WHERE id = %s", (event_id,))
        if not cur.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Event not found.",
            )

        # Privacy rule: NEVER select or return actual_spent_idr on public leaderboard
        cur.execute(
            """
            SELECT
                ep.id AS participant_id,
                ep.event_id,
                ep.user_id,
                u.username,
                ep.leaderboard_idr,
                ep.streak_expires_at,
                COUNT(s.id)::INT AS stamps_count
            FROM public.event_participants ep
            JOIN public.users u ON u.id = ep.user_id
            LEFT JOIN public.stamps s
                ON s.event_id = ep.event_id
               AND s.participant_id = ep.id
            WHERE ep.event_id = %s
            GROUP BY ep.id, ep.event_id, ep.user_id, u.username, ep.leaderboard_idr, ep.streak_expires_at
            """,
            (event_id,),
        )
        raw_rows = cur.fetchall()

    ranked = compute_leaderboard_standing(raw_rows)
    return LeaderboardResponse(
        event_id=event_id,
        entries=[LeaderboardEntryOut.model_validate(entry) for entry in ranked],
    )
