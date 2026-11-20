// ============================================================================
// CORE DOMAIN TYPES & DATABASE TABLE INTERFACES (MATCHING supabase/schema.sql)
// ============================================================================

export type ViewMode = 'buyer' | 'merchant';
export type EventStatus = 'draft' | 'active' | 'archived';
export type TicketRoleType = 'buyer' | 'merchant';
export type StampType = 'checkin' | 'booth';
export type TransactionStatus = 'completed' | 'voided';
export type ChatSenderRole = 'organizer' | 'buyer' | 'merchant';
export type ChatMessageType = 'admin_announcement' | 'looking_for';

export interface User {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  is_merchant: boolean;
  is_admin: boolean;
  active_view_mode: ViewMode;
  merchant_brand_name: string | null;
  merchant_bio: string | null;
  lifetime_actual_spent_idr: number;
  lifetime_sales_idr: number;
  events_count: number;
  earned_badges: string[];
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: string;
  name: string;
  description: string;
  status: EventStatus;
  min_stamp_spend_idr: number;
  admin_void_pin: string;
  cold_bounty_multiplier: number;
  hidden_bounty_bonus_idr: number;
  venue_zones: string[];
  event_date: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketUid {
  id: string;
  event_id: string;
  uid_code: string;
  role_type: TicketRoleType;
  claimed_by_user_id: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface EventParticipant {
  id: string;
  event_id: string;
  user_id: string;
  qr_code: string;
  actual_spent_idr: number;
  leaderboard_idr: number;
  streak_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  event_id: string;
  user_id: string;
  booth_number: string;
  booth_name: string;
  description: string;
  stamp_image_url: string;
  event_sales_idr: number;
  unique_stamps_count: number;
  is_cold_bounty: boolean;
  cold_bounty_expires_at: string | null;
  cold_bounty_multiplier: number;
  is_hidden_bounty: boolean;
  hidden_bounty_bonus_idr: number;
  created_at: string;
  updated_at: string;
}

export interface TenantItem {
  id: string;
  tenant_id: string;
  item_name: string;
  price_idr: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Stamp {
  id: string;
  event_id: string;
  participant_id: string;
  tenant_id: string | null;
  stamp_type: StampType;
  unlocked_at: string;
}

export interface TransactionItemSummary {
  item_id?: string;
  item_name: string;
  quantity: number;
  unit_price_idr: number;
}

export interface Transaction {
  id: string;
  client_tx_id: string | null;
  event_id: string;
  participant_id: string;
  tenant_id: string;
  actual_amount_idr: number;
  leaderboard_amount_idr: number;
  multiplier_applied: number;
  hit_hidden_bounty: boolean;
  hidden_bounty_bonus_idr: number;
  status: TransactionStatus;
  is_flagged: boolean;
  flag_reason: string | null;
  item_summary: TransactionItemSummary[] | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  created_at: string;
}

export interface EventChatMessage {
  id: string;
  event_id: string;
  sender_user_id: string;
  sender_username: string;
  sender_role: ChatSenderRole;
  message_type: ChatMessageType;
  announcement_text: string | null;
  target_character: string | null;
  target_location: string | null;
  target_activity: string | null;
  interested_user_ids: string[];
  is_pinned: boolean;
  created_at: string;
}

export interface DemoSeedDataset {
  users: User[];
  events: Event[];
  ticket_uids: TicketUid[];
  event_participants: EventParticipant[];
  tenants: Tenant[];
  tenant_items: TenantItem[];
  stamps: Stamp[];
  transactions: Transaction[];
  event_chat_messages: EventChatMessage[];
}

// ============================================================================
// PUBLIC LEADERBOARD PROJECTION (PRIVACY-SAFE: NO actual_spent_idr)
// ============================================================================

export interface LeaderboardEntry {
  participant_id: string;
  event_id: string;
  user_id: string;
  username: string;
  leaderboard_idr: number;
  streak_expires_at: string | null;
  stamps_count: number;
  rank_position: number;
}

// ============================================================================
// DUAL-IDR ENGINE, STREAK & ANTI-FRAUD DTOs
// ============================================================================

export type MultiplierStackMode = 'additive' | 'multiplicative' | 'max';

export interface LedgerEngineOptions {
  multiplierStackMode?: MultiplierStackMode;
  streakMultiplier?: number;
  streakWindowMinutes?: number;
  streakDurationMinutes?: number;
  streakDistinctBoothsRequired?: number;
  applyStreakOnActivatingPurchase?: boolean;
  cooldownSeconds?: number;
  crossBoothTeleportSeconds?: number;
  rapidFireWindowSeconds?: number;
  rapidFirePriorTxThreshold?: number;
  merchantBurstWindowSeconds?: number;
  merchantBurstTxThreshold?: number;
  highValueAnomalyIdr?: number;
  defaultColdBoothMultiplier?: number;
  defaultHiddenBountyBonusIdr?: number;
}

export type FraudFlagCode =
  | 'RAPID_CROSS_BOOTH_SCAN'
  | 'RAPID_FIRE_SCAN_BURST'
  | 'MERCHANT_TERMINAL_BURST'
  | 'HIGH_VALUE_TRANSACTION';

export interface AntiFraudValidationInput {
  participantId: string;
  tenantId: string;
  actualAmountIdr: number;
  recentParticipantTransactions: ReadonlyArray<
    Pick<Transaction, 'id' | 'tenant_id' | 'status' | 'created_at' | 'actual_amount_idr'>
  >;
  recentTenantTransactions?: ReadonlyArray<
    Pick<Transaction, 'id' | 'participant_id' | 'status' | 'created_at'>
  >;
  now?: Date | string | number;
  options?: Pick<
    LedgerEngineOptions,
    | 'cooldownSeconds'
    | 'crossBoothTeleportSeconds'
    | 'rapidFireWindowSeconds'
    | 'rapidFirePriorTxThreshold'
    | 'merchantBurstWindowSeconds'
    | 'merchantBurstTxThreshold'
    | 'highValueAnomalyIdr'
  >;
}

export interface AntiFraudValidationResult {
  allowed: boolean;
  cooldownBlocked: boolean;
  remainingCooldownSeconds: number;
  cooldownEndsAt: string | null;
  lastSameBoothTxAt: string | null;
  isFlagged: boolean;
  flagReasons: FraudFlagCode[];
  flagDescription: string | null;
  crossBoothDeltaSeconds: number | null;
  scansInBurstWindow: number;
}

export type StreakStatus = 'inactive' | 'already_active' | 'activated' | 'extended';

export interface StreakEvaluationInput {
  currentTenantId: string;
  currentStreakExpiresAt: string | null;
  recentParticipantTransactions: ReadonlyArray<
    Pick<Transaction, 'tenant_id' | 'status' | 'created_at'>
  >;
  now?: Date | string | number;
  options?: Pick<
    LedgerEngineOptions,
    | 'streakMultiplier'
    | 'streakWindowMinutes'
    | 'streakDurationMinutes'
    | 'streakDistinctBoothsRequired'
    | 'applyStreakOnActivatingPurchase'
  >;
}

export interface StreakEvaluationResult {
  isStreakActive: boolean;
  status: StreakStatus;
  distinctBoothsCount: number;
  distinctBoothIds: string[];
  multiplierFromStreak: number;
  streakExpiresAt: string | null;
  windowStartIso: string;
}

export interface DualIdrCheckoutInput {
  actualAmountIdr: number;
  event: Pick<
    Event,
    'id' | 'min_stamp_spend_idr' | 'cold_bounty_multiplier' | 'hidden_bounty_bonus_idr'
  >;
  participant: Pick<
    EventParticipant,
    'id' | 'event_id' | 'actual_spent_idr' | 'leaderboard_idr' | 'streak_expires_at'
  >;
  tenant: Pick<
    Tenant,
    | 'id'
    | 'event_id'
    | 'is_cold_bounty'
    | 'cold_bounty_expires_at'
    | 'cold_bounty_multiplier'
    | 'is_hidden_bounty'
    | 'hidden_bounty_bonus_idr'
  >;
  recentParticipantTransactions: ReadonlyArray<Transaction>;
  recentTenantTransactions?: ReadonlyArray<Transaction>;
  existingBoothStamp: boolean;
  now?: Date | string | number;
  options?: LedgerEngineOptions;
}

export interface DualIdrCheckoutResult {
  allowed: boolean;
  blockReason: string | null;
  cooldown: AntiFraudValidationResult;
  streak: StreakEvaluationResult;
  coldBooth: {
    isActive: boolean;
    multiplierFromColdBooth: number;
    expiresAt: string | null;
  };
  hiddenBounty: {
    triggered: boolean;
    bonusIdr: number;
  };
  actualAmountIdr: number;
  multiplierApplied: number;
  leaderboardAmountIdr: number;
  shouldUnlockBoothStamp: boolean;
  newParticipantActualSpentIdr: number;
  newParticipantLeaderboardIdr: number;
  newStreakExpiresAt: string | null;
}

export interface VoidReversalInput {
  transactionToVoid: Transaction;
  eventMinStampSpendIdr: number;
  participantRemainingTransactions: ReadonlyArray<Transaction>;
  participantHasBoothStamp: boolean;
}

export interface VoidReversalResult {
  valid: boolean;
  errorReason: string | null;
  deductActualIdr: number;
  deductLeaderboardIdr: number;
  shouldReverseBoothStamp: boolean;
}

// ============================================================================
// OFFLINE INDEXEDDB QUEUE TYPES
// ============================================================================

export type OfflineTxSyncStatus = 'pending' | 'syncing' | 'failed';

export interface OfflineQueuedTransaction {
  clientTxId: string;
  eventId: string;
  tenantId: string;
  participantId: string | null;
  buyerQrCode: string;
  buyerUsernameHint?: string;
  actualAmountIdr: number;
  leaderboardAmountIdr: number;
  multiplierApplied: number;
  hitHiddenBounty: boolean;
  hiddenBountyBonusIdr: number;
  isFlagged: boolean;
  flagReason: string | null;
  itemSummary: TransactionItemSummary[] | null;
  status: OfflineTxSyncStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OfflineBadgeState = 'synced' | 'offline_queued' | 'syncing' | 'error';

export interface OfflineQueueStatusSnapshot {
  isOnline: boolean;
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  totalQueuedCount: number;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  badgeState: OfflineBadgeState;
}