from __future__ import annotations

import re
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow running `python -m unittest discover -s tests` from `backend/` or repo root
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.ledger import (  # noqa: E402
    calculate_dual_idr_checkout,
    compute_leaderboard_standing,
    evaluate_void_reversal,
    generate_cryptographic_qr_code,
    generate_ticket_code,
)


class LedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2025, 5, 17, 12, 0, 0, tzinfo=timezone.utc)
        self.event = {
            "id": "event-1",
            "min_stamp_spend_idr": 20_000,
            "cold_bounty_multiplier": 1.50,
            "hidden_bounty_bonus_idr": 25_000,
        }
        self.participant = {
            "id": "part-1",
            "actual_spent_idr": 100_000,
            "leaderboard_idr": 100_000,
            "streak_expires_at": None,
        }

    def _make_tenant(
        self,
        tenant_id: str = "tenant-a",
        *,
        is_cold_bounty: bool = False,
        cold_bounty_multiplier: float = 1.50,
        cold_bounty_expires_at: datetime | None = None,
        is_hidden_bounty: bool = False,
        hidden_bounty_bonus_idr: int = 25_000,
    ) -> dict:
        return {
            "id": tenant_id,
            "is_cold_bounty": is_cold_bounty,
            "cold_bounty_multiplier": cold_bounty_multiplier,
            "cold_bounty_expires_at": cold_bounty_expires_at,
            "is_hidden_bounty": is_hidden_bounty,
            "hidden_bounty_bonus_idr": hidden_bounty_bonus_idr,
        }

    def test_cooldown_blocks_same_booth_within_10_seconds_and_allows_after(self) -> None:
        tenant = self._make_tenant("tenant-a")
        recent_txs = [
            {
                "id": "tx-prev",
                "tenant_id": "tenant-a",
                "status": "completed",
                "created_at": self.now - timedelta(seconds=6),
            }
        ]

        blocked = calculate_dual_idr_checkout(
            actual_amount_idr=50_000,
            event=self.event,
            participant=self.participant,
            tenant=tenant,
            recent_participant_txs=recent_txs,
            now=self.now,
        )
        self.assertFalse(blocked.allowed)
        self.assertTrue(blocked.cooldown.cooldown_blocked)
        self.assertEqual(blocked.cooldown.remaining_cooldown_seconds, 4)
        self.assertIn("COOLDOWN_ACTIVE:", blocked.block_reason or "")

        allowed = calculate_dual_idr_checkout(
            actual_amount_idr=50_000,
            event=self.event,
            participant=self.participant,
            tenant=tenant,
            recent_participant_txs=recent_txs,
            now=self.now + timedelta(seconds=5),
        )
        self.assertTrue(allowed.allowed)
        self.assertFalse(allowed.cooldown.cooldown_blocked)

    def test_sixty_minute_three_booth_streak_and_additive_cold_bounty(self) -> None:
        cold_tenant = self._make_tenant(
            "tenant-c",
            is_cold_bounty=True,
            cold_bounty_multiplier=1.50,
            cold_bounty_expires_at=self.now + timedelta(minutes=25),
            is_hidden_bounty=True,
            hidden_bounty_bonus_idr=25_000,
        )
        recent_txs = [
            {
                "id": "tx-1",
                "tenant_id": "tenant-a",
                "status": "completed",
                "created_at": self.now - timedelta(minutes=30),
            },
            {
                "id": "tx-2",
                "tenant_id": "tenant-b",
                "status": "completed",
                "created_at": self.now - timedelta(minutes=15),
            },
        ]

        result = calculate_dual_idr_checkout(
            actual_amount_idr=100_000,
            event=self.event,
            participant=self.participant,
            tenant=cold_tenant,
            recent_participant_txs=recent_txs,
            now=self.now,
        )
        self.assertTrue(result.allowed)
        self.assertTrue(result.streak.is_streak_active)
        self.assertEqual(result.streak.status, "activated")
        self.assertEqual(result.streak.distinct_booths_count, 3)
        # Additive stacking: 1.0 + (1.25 - 1.0) + (1.50 - 1.0) = 1.75
        self.assertEqual(result.multiplier_applied, 1.75)
        self.assertTrue(result.hidden_bounty_triggered)
        self.assertEqual(result.hidden_bounty_bonus_idr, 25_000)
        # 100,000 * 1.75 + 25,000 = 200,000
        self.assertEqual(result.leaderboard_amount_idr, 200_000)
        self.assertEqual(result.new_participant_actual_spent_idr, 200_000)
        self.assertEqual(result.new_participant_leaderboard_idr, 300_000)
        self.assertTrue(result.should_unlock_booth_stamp)

    def test_stamp_threshold_uses_actual_amount_not_hidden_bounty_leaderboard_amount(self) -> None:
        hidden_tenant = self._make_tenant("tenant-h", is_hidden_bounty=True, hidden_bounty_bonus_idr=25_000)
        result = calculate_dual_idr_checkout(
            actual_amount_idr=15_000,
            event=self.event,
            participant=self.participant,
            tenant=hidden_tenant,
            recent_participant_txs=[],
            now=self.now,
        )
        self.assertTrue(result.allowed)
        self.assertEqual(result.leaderboard_amount_idr, 40_000)
        self.assertFalse(result.should_unlock_booth_stamp)

    def test_void_reversal_and_stamp_revocation(self) -> None:
        tx_to_void = {
            "id": "tx-void",
            "tenant_id": "tenant-a",
            "status": "completed",
            "actual_amount_idr": 50_000,
            "leaderboard_amount_idr": 62_500,
        }
        only_tx = evaluate_void_reversal(
            tx_to_void=tx_to_void,
            event_min_stamp_spend_idr=20_000,
            participant_transactions=[tx_to_void],
            participant_has_booth_stamp=True,
        )
        self.assertTrue(only_tx.valid)
        self.assertEqual(only_tx.deduct_actual_idr, 50_000)
        self.assertEqual(only_tx.deduct_leaderboard_idr, 62_500)
        self.assertTrue(only_tx.should_reverse_booth_stamp)

        with_other_qualifying = evaluate_void_reversal(
            tx_to_void=tx_to_void,
            event_min_stamp_spend_idr=20_000,
            participant_transactions=[
                tx_to_void,
                {
                    "id": "tx-other",
                    "tenant_id": "tenant-a",
                    "status": "completed",
                    "actual_amount_idr": 25_000,
                    "leaderboard_amount_idr": 25_000,
                },
            ],
            participant_has_booth_stamp=True,
        )
        self.assertTrue(with_other_qualifying.valid)
        self.assertFalse(with_other_qualifying.should_reverse_booth_stamp)

    def test_leaderboard_standing_omits_actual_spent_idr(self) -> None:
        ranked = compute_leaderboard_standing(
            [
                {
                    "participant_id": "p2",
                    "event_id": "e1",
                    "user_id": "u2",
                    "username": "Beta",
                    "actual_spent_idr": 999_999,
                    "leaderboard_idr": 500_000,
                    "streak_expires_at": None,
                    "stamps_count": 3,
                },
                {
                    "participant_id": "p1",
                    "event_id": "e1",
                    "user_id": "u1",
                    "username": "Alpha",
                    "actual_spent_idr": 600_000,
                    "leaderboard_idr": 750_000,
                    "streak_expires_at": None,
                    "stamps_count": 5,
                },
            ]
        )
        self.assertEqual([r["participant_id"] for r in ranked], ["p1", "p2"])
        self.assertEqual([r["rank_position"] for r in ranked], [1, 2])
        for row in ranked:
            self.assertNotIn("actual_spent_idr", row)

    def test_qr_and_ticket_code_generation(self) -> None:
        qr = generate_cryptographic_qr_code({"EV-AAAAAA"})
        self.assertRegex(qr, r"^EV-[A-Z0-9]{6}$")
        self.assertNotEqual(qr, "EV-AAAAAA")

        seen: set[str] = set()
        tkt_buyer = generate_ticket_code("buyer", seen)
        tkt_merchant = generate_ticket_code("merchant", seen)
        self.assertTrue(re.match(r"^TKT-[A-Z0-9]{4}-BYR$", tkt_buyer))
        self.assertTrue(re.match(r"^TKT-[A-Z0-9]{4}-SLR$", tkt_merchant))


if __name__ == "__main__":
    unittest.main()
