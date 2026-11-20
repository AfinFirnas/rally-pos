from __future__ import annotations

import math
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

QR_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
QR_CODE_LENGTH = 6
TICKET_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

DEFAULT_COOLDOWN_SECONDS = 10
DEFAULT_STREAK_WINDOW_MINUTES = 60
DEFAULT_STREAK_DURATION_MINUTES = 60
DEFAULT_STREAK_MULTIPLIER = 1.25
DEFAULT_STREAK_DISTINCT_BOOTHS = 3
DEFAULT_COLD_BOOTH_MULTIPLIER = 1.50
DEFAULT_HIDDEN_BOUNTY_BONUS_IDR = 25_000

DEFAULT_CROSS_BOOTH_TELEPORT_SECONDS = 20
DEFAULT_RAPID_FIRE_WINDOW_SECONDS = 120
DEFAULT_RAPID_FIRE_PRIOR_TX_THRESHOLD = 3
DEFAULT_MERCHANT_BURST_WINDOW_SECONDS = 60
DEFAULT_MERCHANT_BURST_TX_THRESHOLD = 6
DEFAULT_HIGH_VALUE_ANOMALY_IDR = 10_000_000


def parse_timestamp(value: datetime | str | None, fallback: datetime | None = None) -> datetime:
    if value is None:
        return fallback or datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    dt = datetime.fromisoformat(cleaned)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def generate_cryptographic_qr_code(
    existing_codes: set[str] | Iterable[str] | None = None,
    max_attempts: int = 32,
) -> str:
    existing = {c.upper() for c in (existing_codes or ())}
    for _ in range(max_attempts):
        suffix = "".join(secrets.choice(QR_CODE_ALPHABET) for _ in range(QR_CODE_LENGTH))
        candidate = f"EV-{suffix}"
        if candidate not in existing:
            return candidate
    raise RuntimeError(f"Failed to mint unique EV-XXXXXX pass ID after {max_attempts} attempts.")


def generate_ticket_code(role_type: str, existing_codes: set[str]) -> str:
    suffix = "SLR" if role_type == "merchant" else "BYR"
    for _ in range(40):
        mid = "".join(secrets.choice(TICKET_ALPHABET) for _ in range(4))
        candidate = f"TKT-{mid}-{suffix}"
        if candidate not in existing_codes:
            existing_codes.add(candidate)
            return candidate
    raise RuntimeError("Failed to generate unique Event Ticket Code.")


def format_idr(amount: int) -> str:
    formatted = f"{abs(round(amount)):,}".replace(",", ".")
    sign = "-" if amount < 0 else ""
    return f"{sign}Rp {formatted}"


def _round_multiplier(value: float) -> float:
    return round(float(value) * 100) / 100


@dataclass(frozen=True)
class CooldownFraudEvaluation:
    allowed: bool
    cooldown_blocked: bool
    remaining_cooldown_seconds: int
    is_flagged: bool
    flag_reasons: list[str]
    flag_description: str | None


@dataclass(frozen=True)
class StreakEvaluation:
    is_streak_active: bool
    status: str
    distinct_booths_count: int
    multiplier_from_streak: float
    streak_expires_at: datetime | None


@dataclass(frozen=True)
class DualIdrCheckoutEvaluation:
    allowed: bool
    block_reason: str | None
    cooldown: CooldownFraudEvaluation
    streak: StreakEvaluation
    cold_booth_active: bool
    multiplier_from_cold_booth: float
    hidden_bounty_triggered: bool
    hidden_bounty_bonus_idr: int
    actual_amount_idr: int
    multiplier_applied: float
    leaderboard_amount_idr: int
    should_unlock_booth_stamp: bool
    new_participant_actual_spent_idr: int
    new_participant_leaderboard_idr: int
    new_streak_expires_at: datetime | None


@dataclass(frozen=True)
class VoidReversalEvaluation:
    valid: bool
    error_reason: str | None
    deduct_actual_idr: int
    deduct_leaderboard_idr: int
    should_reverse_booth_stamp: bool


def validate_anti_fraud_and_cooldown(
    *,
    tenant_id: str,
    actual_amount_idr: int,
    recent_participant_txs: list[dict[str, Any]],
    recent_tenant_txs: list[dict[str, Any]] | None = None,
    now: datetime | None = None,
    cooldown_seconds: int = DEFAULT_COOLDOWN_SECONDS,
) -> CooldownFraudEvaluation:
    now_dt = parse_timestamp(now)
    completed_txs = [tx for tx in recent_participant_txs if tx.get("status") == "completed"]

    latest_same_booth: datetime | None = None
    latest_other_booth: datetime | None = None
    scans_in_burst = 0
    burst_cutoff = now_dt - timedelta(seconds=DEFAULT_RAPID_FIRE_WINDOW_SECONDS)

    for tx in completed_txs:
        tx_dt = parse_timestamp(tx.get("created_at"), now_dt)
        if tx_dt > now_dt:
            continue
        tx_tenant_id = str(tx["tenant_id"])
        if tx_tenant_id == str(tenant_id):
            if latest_same_booth is None or tx_dt > latest_same_booth:
                latest_same_booth = tx_dt
        else:
            if latest_other_booth is None or tx_dt > latest_other_booth:
                latest_other_booth = tx_dt

        if tx_dt >= burst_cutoff:
            scans_in_burst += 1

    cooldown_blocked = False
    remaining_seconds = 0
    if latest_same_booth is not None and cooldown_seconds > 0:
        elapsed = (now_dt - latest_same_booth).total_seconds()
        if 0 <= elapsed < cooldown_seconds:
            cooldown_blocked = True
            remaining_seconds = int(math.ceil(cooldown_seconds - elapsed))

    flag_reasons: list[str] = []
    flag_notes: list[str] = []

    if latest_other_booth is not None:
        cross_delta = max(0, round((now_dt - latest_other_booth).total_seconds()))
        if cross_delta < DEFAULT_CROSS_BOOTH_TELEPORT_SECONDS:
            flag_reasons.append("RAPID_CROSS_BOOTH_SCAN")
            flag_notes.append(
                f"Scanned at another booth {cross_delta}s ago (<{DEFAULT_CROSS_BOOTH_TELEPORT_SECONDS}s)"
            )

    if scans_in_burst >= DEFAULT_RAPID_FIRE_PRIOR_TX_THRESHOLD:
        flag_reasons.append("RAPID_FIRE_SCAN_BURST")
        flag_notes.append(
            f"{scans_in_burst + 1} scans within {DEFAULT_RAPID_FIRE_WINDOW_SECONDS}s burst window"
        )

    if recent_tenant_txs:
        merchant_cutoff = now_dt - timedelta(seconds=DEFAULT_MERCHANT_BURST_WINDOW_SECONDS)
        recent_booth_count = sum(
            1
            for tx in recent_tenant_txs
            if tx.get("status") == "completed"
            and merchant_cutoff <= parse_timestamp(tx.get("created_at"), now_dt) <= now_dt
        )
        if recent_booth_count >= DEFAULT_MERCHANT_BURST_TX_THRESHOLD:
            flag_reasons.append("MERCHANT_TERMINAL_BURST")
            flag_notes.append(
                f"Booth processed {recent_booth_count + 1} checkouts within {DEFAULT_MERCHANT_BURST_WINDOW_SECONDS}s"
            )

    if actual_amount_idr >= DEFAULT_HIGH_VALUE_ANOMALY_IDR:
        flag_reasons.append("HIGH_VALUE_TRANSACTION")
        flag_notes.append(f"Single transaction >= {format_idr(DEFAULT_HIGH_VALUE_ANOMALY_IDR)}")

    return CooldownFraudEvaluation(
        allowed=not cooldown_blocked,
        cooldown_blocked=cooldown_blocked,
        remaining_cooldown_seconds=remaining_seconds,
        is_flagged=len(flag_reasons) > 0,
        flag_reasons=flag_reasons,
        flag_description="; ".join(flag_notes) if flag_notes else None,
    )


def evaluate_sixty_minute_streak(
    *,
    current_tenant_id: str,
    current_streak_expires_at: datetime | str | None,
    recent_participant_txs: list[dict[str, Any]],
    now: datetime | None = None,
) -> StreakEvaluation:
    now_dt = parse_timestamp(now)
    window_start = now_dt - timedelta(minutes=DEFAULT_STREAK_WINDOW_MINUTES)
    distinct_booths = {str(current_tenant_id)}

    for tx in recent_participant_txs:
        if tx.get("status") != "completed":
            continue
        tx_dt = parse_timestamp(tx.get("created_at"), now_dt)
        if window_start <= tx_dt <= now_dt:
            distinct_booths.add(str(tx["tenant_id"]))

    current_exp = (
        parse_timestamp(current_streak_expires_at) if current_streak_expires_at else None
    )
    was_active = current_exp is not None and current_exp > now_dt

    if len(distinct_booths) >= DEFAULT_STREAK_DISTINCT_BOOTHS:
        candidate_exp = now_dt + timedelta(minutes=DEFAULT_STREAK_DURATION_MINUTES)
        new_exp = max(candidate_exp, current_exp) if current_exp else candidate_exp
        status = "extended" if was_active else "activated"
        return StreakEvaluation(
            is_streak_active=True,
            status=status,
            distinct_booths_count=len(distinct_booths),
            multiplier_from_streak=_round_multiplier(DEFAULT_STREAK_MULTIPLIER),
            streak_expires_at=new_exp,
        )

    if was_active and current_exp is not None:
        return StreakEvaluation(
            is_streak_active=True,
            status="already_active",
            distinct_booths_count=len(distinct_booths),
            multiplier_from_streak=_round_multiplier(DEFAULT_STREAK_MULTIPLIER),
            streak_expires_at=current_exp,
        )

    return StreakEvaluation(
        is_streak_active=False,
        status="inactive",
        distinct_booths_count=len(distinct_booths),
        multiplier_from_streak=1.0,
        streak_expires_at=None,
    )


def calculate_dual_idr_checkout(
    *,
    actual_amount_idr: int,
    event: dict[str, Any],
    participant: dict[str, Any],
    tenant: dict[str, Any],
    recent_participant_txs: list[dict[str, Any]],
    recent_tenant_txs: list[dict[str, Any]] | None = None,
    existing_booth_stamp: bool = False,
    now: datetime | None = None,
    cooldown_seconds: int = DEFAULT_COOLDOWN_SECONDS,
) -> DualIdrCheckoutEvaluation:
    if actual_amount_idr <= 0:
        raise ValueError("actual_amount_idr must be a positive integer.")

    now_dt = parse_timestamp(now)

    cooldown = validate_anti_fraud_and_cooldown(
        tenant_id=str(tenant["id"]),
        actual_amount_idr=actual_amount_idr,
        recent_participant_txs=recent_participant_txs,
        recent_tenant_txs=recent_tenant_txs,
        now=now_dt,
        cooldown_seconds=cooldown_seconds,
    )

    streak = evaluate_sixty_minute_streak(
        current_tenant_id=str(tenant["id"]),
        current_streak_expires_at=participant.get("streak_expires_at"),
        recent_participant_txs=recent_participant_txs,
        now=now_dt,
    )

    cold_expires_raw = tenant.get("cold_bounty_expires_at")
    cold_expires = parse_timestamp(cold_expires_raw) if cold_expires_raw else None
    is_cold_active = bool(tenant.get("is_cold_bounty")) and (
        cold_expires is None or cold_expires > now_dt
    )
    configured_cold = float(
        tenant.get("cold_bounty_multiplier")
        or event.get("cold_bounty_multiplier")
        or DEFAULT_COLD_BOOTH_MULTIPLIER
    )
    cold_multiplier = _round_multiplier(max(1.0, configured_cold)) if is_cold_active else 1.0

    # Additive bonus stacking matches frontend ledgerEngine:
    # e.g., 1.25x streak (+0.25) + 1.50x cold booth (+0.50) = 1.75x
    multiplier_applied = _round_multiplier(
        1.0 + max(0.0, streak.multiplier_from_streak - 1.0) + max(0.0, cold_multiplier - 1.0)
    )

    hidden_triggered = bool(tenant.get("is_hidden_bounty"))
    hidden_bonus = (
        max(
            0,
            int(
                tenant.get("hidden_bounty_bonus_idr")
                if tenant.get("hidden_bounty_bonus_idr") is not None
                else event.get("hidden_bounty_bonus_idr") or DEFAULT_HIDDEN_BOUNTY_BONUS_IDR
            ),
        )
        if hidden_triggered
        else 0
    )

    leaderboard_amount_idr = round(actual_amount_idr * multiplier_applied) + hidden_bonus

    if not cooldown.allowed:
        return DualIdrCheckoutEvaluation(
            allowed=False,
            block_reason=f"COOLDOWN_ACTIVE: Same-booth cooldown active. Retry in {cooldown.remaining_cooldown_seconds}s.",
            cooldown=cooldown,
            streak=streak,
            cold_booth_active=is_cold_active,
            multiplier_from_cold_booth=cold_multiplier,
            hidden_bounty_triggered=False,
            hidden_bounty_bonus_idr=0,
            actual_amount_idr=actual_amount_idr,
            multiplier_applied=1.0,
            leaderboard_amount_idr=actual_amount_idr,
            should_unlock_booth_stamp=False,
            new_participant_actual_spent_idr=int(participant["actual_spent_idr"]),
            new_participant_leaderboard_idr=int(participant["leaderboard_idr"]),
            new_streak_expires_at=participant.get("streak_expires_at"),
        )

    min_stamp_spend = int(event.get("min_stamp_spend_idr") or 20_000)
    should_unlock_stamp = (not existing_booth_stamp) and (actual_amount_idr >= min_stamp_spend)

    return DualIdrCheckoutEvaluation(
        allowed=True,
        block_reason=None,
        cooldown=cooldown,
        streak=streak,
        cold_booth_active=is_cold_active,
        multiplier_from_cold_booth=cold_multiplier,
        hidden_bounty_triggered=hidden_triggered,
        hidden_bounty_bonus_idr=hidden_bonus,
        actual_amount_idr=actual_amount_idr,
        multiplier_applied=multiplier_applied,
        leaderboard_amount_idr=leaderboard_amount_idr,
        should_unlock_booth_stamp=should_unlock_stamp,
        new_participant_actual_spent_idr=int(participant["actual_spent_idr"]) + actual_amount_idr,
        new_participant_leaderboard_idr=int(participant["leaderboard_idr"]) + leaderboard_amount_idr,
        new_streak_expires_at=streak.streak_expires_at,
    )


def evaluate_void_reversal(
    *,
    tx_to_void: dict[str, Any],
    event_min_stamp_spend_idr: int,
    participant_transactions: list[dict[str, Any]],
    participant_has_booth_stamp: bool,
) -> VoidReversalEvaluation:
    if tx_to_void.get("status") == "voided":
        return VoidReversalEvaluation(
            valid=False,
            error_reason="Transaction has already been voided.",
            deduct_actual_idr=0,
            deduct_leaderboard_idr=0,
            should_reverse_booth_stamp=False,
        )

    still_qualifies = any(
        str(tx["id"]) != str(tx_to_void["id"])
        and tx.get("status") == "completed"
        and str(tx["tenant_id"]) == str(tx_to_void["tenant_id"])
        and int(tx["actual_amount_idr"]) >= event_min_stamp_spend_idr
        for tx in participant_transactions
    )

    return VoidReversalEvaluation(
        valid=True,
        error_reason=None,
        deduct_actual_idr=int(tx_to_void["actual_amount_idr"]),
        deduct_leaderboard_idr=int(tx_to_void["leaderboard_amount_idr"]),
        should_reverse_booth_stamp=participant_has_booth_stamp and (not still_qualifies),
    )


def compute_leaderboard_standing(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(
        entries,
        key=lambda e: (
            -int(e["leaderboard_idr"]),
            -int(e["stamps_count"]),
            str(e["username"]).lower(),
        ),
    )
    ranked: list[dict[str, Any]] = []
    for idx, entry in enumerate(ordered, start=1):
        # Explicitly build privacy-safe projection without actual_spent_idr
        ranked.append(
            {
                "participant_id": str(entry["participant_id"]),
                "event_id": str(entry["event_id"]),
                "user_id": str(entry["user_id"]),
                "username": str(entry["username"]),
                "leaderboard_idr": int(entry["leaderboard_idr"]),
                "streak_expires_at": entry.get("streak_expires_at"),
                "stamps_count": int(entry["stamps_count"]),
                "rank_position": idx,
            }
        )
    return ranked
