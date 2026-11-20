import type {
  AntiFraudValidationInput,
  AntiFraudValidationResult,
  DualIdrCheckoutInput,
  DualIdrCheckoutResult,
  FraudFlagCode,
  LeaderboardEntry,
  MultiplierStackMode,
  StreakEvaluationInput,
  StreakEvaluationResult,
  VoidReversalInput,
  VoidReversalResult,
} from '../types/types';

// ============================================================================
// CONSTANTS & DEFAULTS
// ============================================================================

export const DEFAULT_COOLDOWN_SECONDS = 180; // 3-minute same-booth cooldown
export const DEFAULT_STREAK_WINDOW_MINUTES = 60;
export const DEFAULT_STREAK_DURATION_MINUTES = 60;
export const DEFAULT_STREAK_MULTIPLIER = 1.25;
export const DEFAULT_STREAK_DISTINCT_BOOTHS = 3;
export const DEFAULT_COLD_BOOTH_MULTIPLIER = 1.25;
export const DEFAULT_HIDDEN_BOUNTY_BONUS_IDR = 25_000;
export const DEFAULT_CROSS_BOOTH_TELEPORT_SECONDS = 20;
export const DEFAULT_RAPID_FIRE_WINDOW_SECONDS = 120;
export const DEFAULT_RAPID_FIRE_PRIOR_TX_THRESHOLD = 3;
export const DEFAULT_MERCHANT_BURST_WINDOW_SECONDS = 60;
export const DEFAULT_MERCHANT_BURST_TX_THRESHOLD = 6;
export const DEFAULT_HIGH_VALUE_ANOMALY_IDR = 10_000_000;

/** Unambiguous 32-character Crockford-inspired alphabet (omits 0, O, 1, I). */
export const QR_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' as const;
export const QR_CODE_LENGTH = 6;

const STRICT_GENERATED_QR_REGEX = /^EV-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const GENERAL_QR_REGEX = /^EV-[A-Z0-9]{6}$/;

// ============================================================================
// TIME & IDR FORMATTING HELPERS
// ============================================================================

function toTimestampMs(input?: Date | string | number | null): number {
  if (input === undefined || input === null) {
    return Date.now();
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error(`Invalid numeric timestamp: ${input}`);
    }
    return input;
  }
  const ms = input instanceof Date ? input.getTime() : Date.parse(input);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid date value: ${String(input)}`);
  }
  return ms;
}

/**
 * Formats integer Indonesian Rupiah with dot thousand separators and zero decimals.
 * Example: 125000 -> "Rp 125.000"
 */
export function formatIdr(amount: number): string {
  const safeInt = Number.isFinite(amount) ? Math.round(amount) : 0;
  const sign = safeInt < 0 ? '-' : '';
  const formatted = new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.abs(safeInt));
  return `${sign}Rp ${formatted}`;
}

/**
 * Parses a raw keyboard/numpad IDR input string into a clean non-negative integer.
 * Example: "Rp 25.000" -> 25000
 */
export function parseIdrInput(raw: string): number {
  const digitsOnly = raw.replace(/[^\d]/g, '');
  if (!digitsOnly) return 0;
  const parsed = Number.parseInt(digitsOnly, 10);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function roundMultiplier(value: number): number {
  return Math.round(value * 100) / 100;
}

// ============================================================================
// CRYPTOGRAPHIC QR CODE GENERATOR (EV-XXXXXX)
// ============================================================================

/**
 * Generates a cryptographically random, non-sequential `EV-XXXXXX` QR code
 * using `crypto.getRandomValues` with rejection sampling (zero modulo bias).
 */
export function generateCryptographicQrCode(
  existingCodes?: ReadonlySet<string> | Set<string>,
  maxAttempts = 32
): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Web Crypto API (crypto.getRandomValues) is required to generate secure QR codes.');
  }

  const alphabetLen = QR_CODE_ALPHABET.length; // 32
  const maxUnbiasedByte = Math.floor(256 / alphabetLen) * alphabetLen; // 256 (exact multiple)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let suffix = '';
    const buffer = new Uint8Array(QR_CODE_LENGTH * 2);

    while (suffix.length < QR_CODE_LENGTH) {
      cryptoApi.getRandomValues(buffer);
      for (let i = 0; i < buffer.length && suffix.length < QR_CODE_LENGTH; i++) {
        const byte = buffer[i];
        if (byte < maxUnbiasedByte) {
          suffix += QR_CODE_ALPHABET[byte % alphabetLen];
        }
      }
    }

    const candidate = `EV-${suffix}`;
    if (!existingCodes || !existingCodes.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Failed to generate a unique EV-XXXXXX QR code after ${maxAttempts} attempts.`
  );
}

/**
 * Validates whether a scanned/entered string conforms to the EV-XXXXXX format.
 * Set strictGeneratedAlphabet = true to verify the unambiguous 32-char generation alphabet.
 */
export function isValidEventQrCode(
  code: string,
  strictGeneratedAlphabet = false
): boolean {
  const normalized = code.trim().toUpperCase();
  return strictGeneratedAlphabet
    ? STRICT_GENERATED_QR_REGEX.test(normalized)
    : GENERAL_QR_REGEX.test(normalized);
}

/**
 * Normalizes scanned QR payloads (handles raw EV-9X4K2M or URL/JSON payloads containing it).
 */
export function extractEventQrCode(rawScanValue: string): string | null {
  const trimmed = rawScanValue.trim().toUpperCase();
  if (GENERAL_QR_REGEX.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/EV-[A-Z0-9]{6}/);
  return match ? match[0] : null;
}

// ============================================================================
// ANTI-FRAUD & 180-SECOND COOLDOWN VALIDATOR
// ============================================================================

/**
 * Enforces the mandatory 3-minute (180s) same-booth cooldown and detects rapid-fire
 * cross-booth scan anomalies or unusual burst/high-value transactions.
 */
export function validateAntiFraudAndCooldown(
  input: AntiFraudValidationInput
): AntiFraudValidationResult {
  const nowMs = toTimestampMs(input.now);
  const cooldownSeconds =
    input.options?.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
  const crossBoothTeleportSeconds =
    input.options?.crossBoothTeleportSeconds ??
    DEFAULT_CROSS_BOOTH_TELEPORT_SECONDS;
  const rapidFireWindowSeconds =
    input.options?.rapidFireWindowSeconds ?? DEFAULT_RAPID_FIRE_WINDOW_SECONDS;
  const rapidFirePriorTxThreshold =
    input.options?.rapidFirePriorTxThreshold ??
    DEFAULT_RAPID_FIRE_PRIOR_TX_THRESHOLD;
  const merchantBurstWindowSeconds =
    input.options?.merchantBurstWindowSeconds ??
    DEFAULT_MERCHANT_BURST_WINDOW_SECONDS;
  const merchantBurstTxThreshold =
    input.options?.merchantBurstTxThreshold ??
    DEFAULT_MERCHANT_BURST_TX_THRESHOLD;
  const highValueAnomalyIdr =
    input.options?.highValueAnomalyIdr ?? DEFAULT_HIGH_VALUE_ANOMALY_IDR;

  const completedParticipantTxs = input.recentParticipantTransactions.filter(
    (tx) => tx.status === 'completed'
  );

  // 1. Same-booth cooldown check (only non-voided transactions at this booth)
  let latestSameBoothMs: number | null = null;
  let latestOtherBoothMs: number | null = null;
  let scansInBurstWindow = 0;
  const burstCutoffMs = nowMs - rapidFireWindowSeconds * 1000;

  for (const tx of completedParticipantTxs) {
    const txMs = toTimestampMs(tx.created_at);
    if (txMs > nowMs) continue; // Ignore future-dated records relative to evaluation time

    if (tx.tenant_id === input.tenantId) {
      if (latestSameBoothMs === null || txMs > latestSameBoothMs) {
        latestSameBoothMs = txMs;
      }
    } else if (latestOtherBoothMs === null || txMs > latestOtherBoothMs) {
      latestOtherBoothMs = txMs;
    }

    if (txMs >= burstCutoffMs) {
      scansInBurstWindow += 1;
    }
  }

  let cooldownBlocked = false;
  let remainingCooldownSeconds = 0;
  let cooldownEndsAt: string | null = null;

  if (latestSameBoothMs !== null) {
    const elapsedSeconds = (nowMs - latestSameBoothMs) / 1000;
    if (elapsedSeconds >= 0 && elapsedSeconds < cooldownSeconds) {
      cooldownBlocked = true;
      remainingCooldownSeconds = Math.ceil(cooldownSeconds - elapsedSeconds);
      cooldownEndsAt = new Date(
        latestSameBoothMs + cooldownSeconds * 1000
      ).toISOString();
    }
  }

  // 2. Rapid-fire cross-booth & high-value anomaly checks
  const flagReasons: FraudFlagCode[] = [];
  const flagNotes: string[] = [];

  let crossBoothDeltaSeconds: number | null = null;
  if (latestOtherBoothMs !== null) {
    crossBoothDeltaSeconds = Math.max(
      0,
      Math.round((nowMs - latestOtherBoothMs) / 1000)
    );
    if (crossBoothDeltaSeconds < crossBoothTeleportSeconds) {
      flagReasons.push('RAPID_CROSS_BOOTH_SCAN');
      flagNotes.push(
        `Scanned at another booth ${crossBoothDeltaSeconds}s ago (<${crossBoothTeleportSeconds}s)`
      );
    }
  }

  if (scansInBurstWindow >= rapidFirePriorTxThreshold) {
    flagReasons.push('RAPID_FIRE_SCAN_BURST');
    flagNotes.push(
      `${scansInBurstWindow + 1} scans within ${rapidFireWindowSeconds}s burst window`
    );
  }

  if (
    input.recentTenantTransactions &&
    input.recentTenantTransactions.length > 0
  ) {
    const merchantCutoffMs = nowMs - merchantBurstWindowSeconds * 1000;
    const recentBoothCount = input.recentTenantTransactions.filter((tx) => {
      if (tx.status !== 'completed') return false;
      const txMs = toTimestampMs(tx.created_at);
      return txMs <= nowMs && txMs >= merchantCutoffMs;
    }).length;

    if (recentBoothCount >= merchantBurstTxThreshold) {
      flagReasons.push('MERCHANT_TERMINAL_BURST');
      flagNotes.push(
        `Booth processed ${recentBoothCount + 1} checkouts within ${merchantBurstWindowSeconds}s`
      );
    }
  }

  if (input.actualAmountIdr >= highValueAnomalyIdr) {
    flagReasons.push('HIGH_VALUE_TRANSACTION');
    flagNotes.push(`Single transaction >= ${formatIdr(highValueAnomalyIdr)}`);
  }

  return {
    allowed: !cooldownBlocked,
    cooldownBlocked,
    remainingCooldownSeconds,
    cooldownEndsAt,
    lastSameBoothTxAt:
      latestSameBoothMs !== null
        ? new Date(latestSameBoothMs).toISOString()
        : null,
    isFlagged: flagReasons.length > 0,
    flagReasons,
    flagDescription: flagNotes.length > 0 ? flagNotes.join('; ') : null,
    crossBoothDeltaSeconds,
    scansInBurstWindow,
  };
}

// ============================================================================
// 60-MINUTE STREAK ENGINE (3 DISTINCT BOOTHS -> 1.25x MULTIPLIER)
// ============================================================================

/**
 * Evaluates whether a buyer has purchased from 3 distinct booths within the past 60 minutes
 * to activate or extend their 1.25x Leaderboard Spend Multiplier for the next 60 minutes.
 */
export function evaluateSixtyMinuteStreak(
  input: StreakEvaluationInput
): StreakEvaluationResult {
  const nowMs = toTimestampMs(input.now);
  const streakMultiplier =
    input.options?.streakMultiplier ?? DEFAULT_STREAK_MULTIPLIER;
  const windowMinutes =
    input.options?.streakWindowMinutes ?? DEFAULT_STREAK_WINDOW_MINUTES;
  const durationMinutes =
    input.options?.streakDurationMinutes ?? DEFAULT_STREAK_DURATION_MINUTES;
  const distinctRequired =
    input.options?.streakDistinctBoothsRequired ??
    DEFAULT_STREAK_DISTINCT_BOOTHS;
  const applyOnActivatingPurchase =
    input.options?.applyStreakOnActivatingPurchase ?? true;

  const windowStartMs = nowMs - windowMinutes * 60_000;
  const distinctBoothSet = new Set([input.currentTenantId]);

  for (const tx of input.recentParticipantTransactions) {
    if (tx.status !== 'completed') continue;
    const txMs = toTimestampMs(tx.created_at);
    if (txMs >= windowStartMs && txMs <= nowMs) {
      distinctBoothSet.add(tx.tenant_id);
    }
  }

  const distinctBoothIds = Array.from(distinctBoothSet);
  const distinctBoothsCount = distinctBoothIds.length;
  const currentExpiresMs = input.currentStreakExpiresAt
    ? toTimestampMs(input.currentStreakExpiresAt)
    : null;
  const wasAlreadyActive =
    currentExpiresMs !== null && currentExpiresMs > nowMs;

  if (distinctBoothsCount >= distinctRequired) {
    const newExpiresMs = Math.max(
      nowMs + durationMinutes * 60_000,
      currentExpiresMs ?? 0
    );
    const status = wasAlreadyActive ? 'extended' : 'activated';
    const multiplierFromStreak =
      status === 'activated' && !applyOnActivatingPurchase
        ? 1.0
        : streakMultiplier;

    return {
      isStreakActive: true,
      status,
      distinctBoothsCount,
      distinctBoothIds,
      multiplierFromStreak: roundMultiplier(multiplierFromStreak),
      streakExpiresAt: new Date(newExpiresMs).toISOString(),
      windowStartIso: new Date(windowStartMs).toISOString(),
    };
  }

  if (wasAlreadyActive && currentExpiresMs !== null) {
    return {
      isStreakActive: true,
      status: 'already_active',
      distinctBoothsCount,
      distinctBoothIds,
      multiplierFromStreak: roundMultiplier(streakMultiplier),
      streakExpiresAt: new Date(currentExpiresMs).toISOString(),
      windowStartIso: new Date(windowStartMs).toISOString(),
    };
  }

  return {
    isStreakActive: false,
    status: 'inactive',
    distinctBoothsCount,
    distinctBoothIds,
    multiplierFromStreak: 1.0,
    streakExpiresAt: null,
    windowStartIso: new Date(windowStartMs).toISOString(),
  };
}

// ============================================================================
// DUAL-IDR CHECKOUT CALCULATOR
// ============================================================================

function combineMultipliers(
  streakMult: number,
  coldBoothMult: number,
  mode: MultiplierStackMode
): number {
  const safeStreak = Math.max(1.0, streakMult);
  const safeCold = Math.max(1.0, coldBoothMult);

  switch (mode) {
    case 'multiplicative':
      return roundMultiplier(safeStreak * safeCold);
    case 'max':
      return roundMultiplier(Math.max(safeStreak, safeCold));
    case 'additive':
    default:
      // Additive bonus stacking: 1.25x streak (+0.25) + 1.25x cold booth (+0.25) = 1.50x
      return roundMultiplier(1.0 + (safeStreak - 1.0) + (safeCold - 1.0));
  }
}

/**
 * Pure Dual-IDR Checkout Engine:
 * - Preserves exact actual_spent_idr (never multiplied)
 * - Computes leaderboard_idr = Math.round(actual_amount_idr * active_multiplier) + hiddenBountyBonusIdr
 * - Enforces 180s cooldown, rapid-fire anomaly flags, 60m streak, Cold-Booth Bounty, Hidden Bounty & Stamp unlock
 */
export function calculateDualIdrCheckout(
  input: DualIdrCheckoutInput
): DualIdrCheckoutResult {
  if (!Number.isInteger(input.actualAmountIdr) || input.actualAmountIdr <= 0) {
    throw new Error(
      `actualAmountIdr must be a positive integer in IDR. Received: ${input.actualAmountIdr}`
    );
  }
  if (input.participant.event_id !== input.event.id) {
    throw new Error('Participant does not belong to the specified event.');
  }
  if (input.tenant.event_id !== input.event.id) {
    throw new Error('Merchant tenant does not belong to the specified event.');
  }

  const nowMs = toTimestampMs(input.now);
  const stackMode: MultiplierStackMode =
    input.options?.multiplierStackMode ?? 'additive';

  // 1. Validate 180s same-booth cooldown and anti-fraud rules
  const cooldown = validateAntiFraudAndCooldown({
    participantId: input.participant.id,
    tenantId: input.tenant.id,
    actualAmountIdr: input.actualAmountIdr,
    recentParticipantTransactions: input.recentParticipantTransactions,
    recentTenantTransactions: input.recentTenantTransactions,
    now: nowMs,
    options: input.options,
  });

  // 2. Evaluate 60-minute distinct-booth streak multiplier
  const streak = evaluateSixtyMinuteStreak({
    currentTenantId: input.tenant.id,
    currentStreakExpiresAt: input.participant.streak_expires_at,
    recentParticipantTransactions: input.recentParticipantTransactions,
    now: nowMs,
    options: input.options,
  });

  // 3. Evaluate Cold-Booth Bounty multiplier
  const coldExpiresMs = input.tenant.cold_bounty_expires_at
    ? toTimestampMs(input.tenant.cold_bounty_expires_at)
    : null;
  const isColdActive =
    input.tenant.is_cold_bounty &&
    (coldExpiresMs === null || coldExpiresMs > nowMs);

  const configuredColdMultiplier =
    input.tenant.cold_bounty_multiplier ??
    input.event.cold_bounty_multiplier ??
    input.options?.defaultColdBoothMultiplier ??
    DEFAULT_COLD_BOOTH_MULTIPLIER;

  const multiplierFromColdBooth = isColdActive
    ? roundMultiplier(Math.max(1.0, configuredColdMultiplier))
    : 1.0;

  // 4. Combine active multipliers & apply Hourly Hidden Bounty bonus
  const multiplierApplied = combineMultipliers(
    streak.multiplierFromStreak,
    multiplierFromColdBooth,
    stackMode
  );

  const hiddenBountyTriggered = Boolean(input.tenant.is_hidden_bounty);
  const hiddenBonusIdr = hiddenBountyTriggered
    ? Math.max(
        0,
        Math.round(
          input.tenant.hidden_bounty_bonus_idr ??
            input.event.hidden_bounty_bonus_idr ??
            input.options?.defaultHiddenBountyBonusIdr ??
            DEFAULT_HIDDEN_BOUNTY_BONUS_IDR
        )
      )
    : 0;

  const leaderboardAmountIdr =
    Math.round(input.actualAmountIdr * multiplierApplied) + hiddenBonusIdr;

  // If blocked by cooldown, return exact diagnostics without advancing totals/stamps
  if (!cooldown.allowed) {
    return {
      allowed: false,
      blockReason: `Same-booth cooldown active. Retry in ${cooldown.remainingCooldownSeconds}s.`,
      cooldown,
      streak,
      coldBooth: {
        isActive: isColdActive,
        multiplierFromColdBooth,
        expiresAt: isColdActive ? input.tenant.cold_bounty_expires_at : null,
      },
      hiddenBounty: {
        triggered: false,
        bonusIdr: 0,
      },
      actualAmountIdr: input.actualAmountIdr,
      multiplierApplied: 1.0,
      leaderboardAmountIdr: input.actualAmountIdr,
      shouldUnlockBoothStamp: false,
      newParticipantActualSpentIdr: input.participant.actual_spent_idr,
      newParticipantLeaderboardIdr: input.participant.leaderboard_idr,
      newStreakExpiresAt: input.participant.streak_expires_at,
    };
  }

  // Stamp threshold always evaluates against REAL actual_amount_idr (never multiplied)
  const shouldUnlockBoothStamp =
    !input.existingBoothStamp &&
    input.actualAmountIdr >= input.event.min_stamp_spend_idr;

  return {
    allowed: true,
    blockReason: null,
    cooldown,
    streak,
    coldBooth: {
      isActive: isColdActive,
      multiplierFromColdBooth,
      expiresAt: isColdActive ? input.tenant.cold_bounty_expires_at : null,
    },
    hiddenBounty: {
      triggered: hiddenBountyTriggered,
      bonusIdr: hiddenBonusIdr,
    },
    actualAmountIdr: input.actualAmountIdr,
    multiplierApplied,
    leaderboardAmountIdr,
    shouldUnlockBoothStamp,
    newParticipantActualSpentIdr:
      input.participant.actual_spent_idr + input.actualAmountIdr,
    newParticipantLeaderboardIdr:
      input.participant.leaderboard_idr + leaderboardAmountIdr,
    newStreakExpiresAt: streak.streakExpiresAt,
  };
}

// ============================================================================
// VOID REVERSAL & LEADERBOARD RANKING HELPERS
// ============================================================================

/**
 * Computes exact Dual-IDR deductions and determines whether an unlocked booth stamp
 * should be reversed when an Organizer-PIN-authorized void occurs.
 */
export function evaluateVoidReversal(input: VoidReversalInput): VoidReversalResult {
  const { transactionToVoid } = input;
  if (transactionToVoid.status === 'voided') {
    return {
      valid: false,
      errorReason: 'Transaction has already been voided.',
      deductActualIdr: 0,
      deductLeaderboardIdr: 0,
      shouldReverseBoothStamp: false,
    };
  }

  const stillQualifiesForBoothStamp = input.participantRemainingTransactions.some(
    (tx) =>
      tx.id !== transactionToVoid.id &&
      tx.status === 'completed' &&
      tx.tenant_id === transactionToVoid.tenant_id &&
      tx.actual_amount_idr >= input.eventMinStampSpendIdr
  );

  return {
    valid: true,
    errorReason: null,
    deductActualIdr: transactionToVoid.actual_amount_idr,
    deductLeaderboardIdr: transactionToVoid.leaderboard_amount_idr,
    shouldReverseBoothStamp:
      input.participantHasBoothStamp && !stillQualifiesForBoothStamp,
  };
}

/**
 * Computes ranked Top N leaderboard entries and the exact leaderboard_idr gap
 * a specific buyer needs to overtake the spender directly ahead.
 */
export function computeLeaderboardStanding(
  entries: ReadonlyArray<LeaderboardEntry>,
  targetParticipantId?: string
): {
  ranked: LeaderboardEntry[];
  top10: LeaderboardEntry[];
  targetEntry: LeaderboardEntry | null;
  leaderAhead: LeaderboardEntry | null;
  gapToOvertakeIdr: number;
} {
  const sorted = [...entries].sort((a, b) => {
    if (b.leaderboard_idr !== a.leaderboard_idr) {
      return b.leaderboard_idr - a.leaderboard_idr;
    }
    if (b.stamps_count !== a.stamps_count) {
      return b.stamps_count - a.stamps_count;
    }
    return a.username.localeCompare(b.username);
  });

  const ranked = sorted.map((entry, idx) => ({
    ...entry,
    rank_position: idx + 1,
  }));

  const top10 = ranked.slice(0, 10);

  if (!targetParticipantId) {
    return {
      ranked,
      top10,
      targetEntry: null,
      leaderAhead: null,
      gapToOvertakeIdr: 0,
    };
  }

  const targetIndex = ranked.findIndex(
    (e) => e.participant_id === targetParticipantId
  );
  if (targetIndex === -1) {
    return {
      ranked,
      top10,
      targetEntry: null,
      leaderAhead: null,
      gapToOvertakeIdr: 0,
    };
  }

  const targetEntry = ranked[targetIndex];
  const leaderAhead = targetIndex > 0 ? ranked[targetIndex - 1] : null;
  const gapToOvertakeIdr = leaderAhead
    ? Math.max(0, leaderAhead.leaderboard_idr - targetEntry.leaderboard_idr + 1)
    : 0;

  return {
    ranked,
    top10,
    targetEntry,
    leaderAhead,
    gapToOvertakeIdr,
  };
}
