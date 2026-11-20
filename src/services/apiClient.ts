import { DEMO_SEED_DATA, USER_IDS } from '../db/seed';
import {
  calculateDualIdrCheckout,
  computeLeaderboardStanding,
  evaluateVoidReversal,
  formatIdr,
  generateCryptographicQrCode,
} from '../lib/ledgerEngine';
import type {
  ChatMessageType,
  ChatSenderRole,
  DemoSeedDataset,
  Event,
  EventChatMessage,
  EventParticipant,
  LeaderboardEntry,
  Stamp,
  Tenant,
  TenantItem,
  TicketRoleType,
  TicketUid,
  Transaction,
  TransactionItemSummary,
  User,
  ViewMode,
} from '../types/types';

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const RAW_API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? '';
export const API_BASE_URL = RAW_API_BASE_URL.trim().replace(/\/+$/, '');
export const isRemoteApiConfigured = Boolean(API_BASE_URL);

const AUTH_TOKEN_KEY = 'rallypos_auth_token_v1';
const DEMO_STORE_KEY = 'rallypos_demo_dataset_v1';
const DEMO_SESSION_USER_ID_KEY = 'rallypos_demo_session_user_id_v1';
const TICKET_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export type DemoPresetRole = 'fresh_buyer' | 'active_buyer' | 'merchant' | 'admin';

export class ApiHttpError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
  }
}

// ============================================================================
// API PAYLOAD & RESPONSE CONTRACTS
// ============================================================================

export interface AuthResponse {
  token: string;
  user: User;
}

export interface EventsBootstrapResponse {
  events: Event[];
  participants: EventParticipant[];
  tenants: Tenant[];
  tenant_items: TenantItem[];
  stamps: Stamp[];
  transactions: Transaction[];
  ticket_uids: TicketUid[];
  meetups: EventChatMessage[];
  users: User[];
}

export interface CheckInRequest {
  uid_code: string;
  booth_name?: string;
  booth_number?: string;
  booth_bio?: string;
}

export interface CheckInResponse {
  event: Event;
  role_type: TicketRoleType;
  participant: EventParticipant;
  tenant: Tenant | null;
  check_in_stamp: Stamp;
  ticket_uid?: TicketUid;
  user?: User;
  is_new_join: boolean;
}

export interface LinkBoothRequest {
  uid_code: string;
  booth_name: string;
  booth_number?: string;
  bio?: string;
}

export interface LinkBoothResponse {
  user: User;
  tenant: Tenant;
  participant: EventParticipant;
  check_in_stamp: Stamp;
  ticket_uid?: TicketUid;
}

export interface PosCheckoutRequest {
  client_tx_id: string;
  event_id: string;
  tenant_id: string;
  buyer_qr_code: string;
  actual_amount_idr: number;
  item_summary: TransactionItemSummary[] | null;
}

export interface PosCheckoutResponse {
  transaction: Transaction;
  participant: EventParticipant;
  tenant: Tenant;
  unlocked_stamp: Stamp | null;
  hidden_bounty_triggered: boolean;
  hidden_bounty_bonus_idr: number;
}

export interface PosReverseRequest {
  transaction_id: string;
  admin_void_pin?: string;
}

export interface PosReverseResponse {
  transaction: Transaction;
  participant: EventParticipant;
  tenant: Tenant;
  reversed_stamp_id: string | null;
  deduct_actual_idr: number;
  deduct_leaderboard_idr: number;
}

export interface LeaderboardResponse {
  event_id: string;
  entries: LeaderboardEntry[];
}

export interface MeetupsListResponse {
  event_id: string;
  messages: EventChatMessage[];
}

export interface CreateMeetupRequest {
  message_type: ChatMessageType;
  announcement_text?: string | null;
  is_pinned?: boolean;
  target_character?: string | null;
  target_location?: string | null;
  target_activity?: string | null;
  sender_role?: ChatSenderRole;
}

// ============================================================================
// INTERNAL STORAGE & NETWORK FALLBACK HELPERS
// ============================================================================

let inMemoryFallbackFlag = !isRemoteApiConfigured;
let warnedUnreachableOnce = false;
let memoryDatasetCache: DemoSeedDataset | null = null;

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function cloneSeedDataset(): DemoSeedDataset {
  return JSON.parse(JSON.stringify(DEMO_SEED_DATA)) as DemoSeedDataset;
}

export function loadLocalDataset(): DemoSeedDataset {
  if (typeof window === 'undefined') {
    if (!memoryDatasetCache) {
      memoryDatasetCache = cloneSeedDataset();
    }
    return memoryDatasetCache;
  }
  try {
    const raw = window.localStorage.getItem(DEMO_STORE_KEY);
    if (!raw) {
      const fresh = cloneSeedDataset();
      memoryDatasetCache = fresh;
      return fresh;
    }
    const parsed = JSON.parse(raw) as DemoSeedDataset;
    if (!Array.isArray(parsed.users) || !Array.isArray(parsed.events)) {
      const fresh = cloneSeedDataset();
      memoryDatasetCache = fresh;
      return fresh;
    }
    memoryDatasetCache = parsed;
    return parsed;
  } catch {
    const fresh = cloneSeedDataset();
    memoryDatasetCache = fresh;
    return fresh;
  }
}

export function saveLocalDataset(dataset: DemoSeedDataset): void {
  memoryDatasetCache = dataset;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(dataset));
  } catch {
    // Ignore storage quota exceptions
  }
}

function mutateLocalDataset<T>(mutator: (draft: DemoSeedDataset) => { next: DemoSeedDataset; result: T }): T {
  const current = loadLocalDataset();
  const { next, result } = mutator(current);
  saveLocalDataset(next);
  return result;
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // Ignore storage quota exceptions
  }
}

export function getLocalSessionUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(DEMO_SESSION_USER_ID_KEY);
  } catch {
    return null;
  }
}

export function setLocalSessionUserId(userId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (userId) {
      window.localStorage.setItem(DEMO_SESSION_USER_ID_KEY, userId);
    } else {
      window.localStorage.removeItem(DEMO_SESSION_USER_ID_KEY);
    }
  } catch {
    // Ignore storage quota exceptions
  }
}

function resolveCurrentLocalUserId(explicitUserId?: string): string {
  const id = explicitUserId ?? getLocalSessionUserId();
  if (!id) {
    throw new Error('Authentication required. Please sign in first.');
  }
  return id;
}

function isNetworkFailure(err: unknown): boolean {
  if (err instanceof ApiHttpError) return false;
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error) {
    return /failed to fetch|networkerror|load failed|econnrefused|fetch failed|network request failed/i.test(
      err.message
    );
  }
  return false;
}

async function requestWithFallback<T>(
  path: string,
  options: RequestInit,
  fallbackFn: () => T | Promise<T>
): Promise<T> {
  if (!API_BASE_URL) {
    inMemoryFallbackFlag = true;
    return fallbackFn();
  }

  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (err) {
    if (isNetworkFailure(err)) {
      inMemoryFallbackFlag = true;
      if (!warnedUnreachableOnce) {
        warnedUnreachableOnce = true;
        console.warn(
          `[RallyPOS apiClient] Backend at ${API_BASE_URL} is unreachable. Falling back to standalone local state.`
        );
      }
      return fallbackFn();
    }
    throw err;
  }

  inMemoryFallbackFlag = false;

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      message = body.error || body.message || message;
    } catch {
      // Response body wasn't JSON
    }
    throw new ApiHttpError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function generateTicketCode(role: TicketRoleType, existingSet: Set<string>): string {
  const suffix = role === 'merchant' ? 'SLR' : 'BYR';
  const cryptoApi = globalThis.crypto;
  for (let attempt = 0; attempt < 30; attempt++) {
    let mid = '';
    if (cryptoApi?.getRandomValues) {
      const buf = new Uint8Array(4);
      cryptoApi.getRandomValues(buf);
      for (let i = 0; i < 4; i++) {
        mid += TICKET_ALPHABET[buf[i] % TICKET_ALPHABET.length];
      }
    } else {
      mid = Math.random().toString(36).slice(2, 6).toUpperCase();
    }
    const candidate = `TKT-${mid}-${suffix}`;
    if (!existingSet.has(candidate)) {
      existingSet.add(candidate);
      return candidate;
    }
  }
  return `TKT-${Date.now().toString(36).slice(-4).toUpperCase()}-${suffix}`;
}

// ============================================================================
// STANDALONE REST API CLIENT (WITH AUTOMATIC LOCAL FALLBACK)
// ============================================================================

export const apiClient = {
  isRemoteConfigured(): boolean {
    return isRemoteApiConfigured;
  },

  isFallbackActive(): boolean {
    return inMemoryFallbackFlag;
  },

  resetLocalState(): void {
    const fresh = cloneSeedDataset();
    saveLocalDataset(fresh);
    setAuthToken(null);
    setLocalSessionUserId(null);
  },

  // --------------------------------------------------------------------------
  // AUTHENTICATION & SESSION
  // --------------------------------------------------------------------------

  async login(payload: { email: string; password: string }): Promise<AuthResponse> {
    const normalizedEmail = payload.email.trim().toLowerCase();
    const res = await requestWithFallback<AuthResponse>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail, password: payload.password }),
      },
      () => {
        const dataset = loadLocalDataset();
        const matched = dataset.users.find(
          (u) => u.email.toLowerCase() === normalizedEmail
        );
        if (!matched) {
          throw new Error('No account found with that email. Try Demo Preview or Create Account.');
        }
        const isSeededDemoUser = matched.password_hash.startsWith('DEMO_HASH_');
        const expectedLocalPassword = `DEMO_PW_${payload.password}`;
        if (!isSeededDemoUser && matched.password_hash !== expectedLocalPassword) {
          throw new Error('Incorrect password.');
        }
        if (payload.password.length < 1) {
          throw new Error('Please enter your password.');
        }
        setLocalSessionUserId(matched.id);
        return {
          token: `local-jwt-${matched.id}`,
          user: matched,
        };
      }
    );

    setAuthToken(res.token);
    setLocalSessionUserId(res.user.id);
    return res;
  },

  async register(payload: {
    email: string;
    username: string;
    password: string;
  }): Promise<AuthResponse> {
    const normalizedEmail = payload.email.trim().toLowerCase();
    const cleanUsername = payload.username.trim();

    const res = await requestWithFallback<AuthResponse>(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({
          email: normalizedEmail,
          username: cleanUsername,
          password: payload.password,
        }),
      },
      () =>
        mutateLocalDataset((prev) => {
          if (prev.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
            throw new Error('An account with this email already exists.');
          }
          if (
            prev.users.some(
              (u) => u.username.toLowerCase() === cleanUsername.toLowerCase()
            )
          ) {
            throw new Error('That username is already taken.');
          }
          const nowIso = new Date().toISOString();
          const newUser: User = {
            id: createUuid(),
            email: normalizedEmail,
            username: cleanUsername,
            password_hash: `DEMO_PW_${payload.password}`,
            is_merchant: false,
            is_admin: false,
            active_view_mode: 'buyer',
            merchant_brand_name: null,
            merchant_bio: null,
            lifetime_actual_spent_idr: 0,
            lifetime_sales_idr: 0,
            events_count: 0,
            earned_badges: [],
            created_at: nowIso,
            updated_at: nowIso,
          };
          setLocalSessionUserId(newUser.id);
          return {
            next: { ...prev, users: [...prev.users, newUser] },
            result: { token: `local-jwt-${newUser.id}`, user: newUser },
          };
        })
    );

    setAuthToken(res.token);
    setLocalSessionUserId(res.user.id);
    return res;
  },

  async loginDemo(preset: DemoPresetRole = 'fresh_buyer'): Promise<AuthResponse> {
    const res = await requestWithFallback<AuthResponse>(
      '/api/auth/demo',
      {
        method: 'POST',
        body: JSON.stringify({ preset }),
      },
      () =>
        mutateLocalDataset((prev) => {
          if (preset === 'fresh_buyer') {
            const existingGuest = prev.users.find(
              (u) => u.email === 'demo.explorer@rallypos.id'
            );
            if (existingGuest) {
              setLocalSessionUserId(existingGuest.id);
              return {
                next: prev,
                result: {
                  token: `local-jwt-${existingGuest.id}`,
                  user: existingGuest,
                },
              };
            }

            const nowIso = new Date().toISOString();
            const freshDemoBuyer: User = {
              id: createUuid(),
              email: 'demo.explorer@rallypos.id',
              username: 'DemoExplorer',
              password_hash: 'DEMO_HASH_EXPLORER',
              is_merchant: false,
              is_admin: false,
              active_view_mode: 'buyer',
              merchant_brand_name: null,
              merchant_bio: null,
              lifetime_actual_spent_idr: 0,
              lifetime_sales_idr: 0,
              events_count: 0,
              earned_badges: [],
              created_at: nowIso,
              updated_at: nowIso,
            };
            setLocalSessionUserId(freshDemoBuyer.id);
            return {
              next: { ...prev, users: [...prev.users, freshDemoBuyer] },
              result: {
                token: `local-jwt-${freshDemoBuyer.id}`,
                user: freshDemoBuyer,
              },
            };
          }

          const targetId =
            preset === 'active_buyer'
              ? USER_IDS.BUYER_01
              : preset === 'merchant'
                ? USER_IDS.MERCHANT_01
                : USER_IDS.ADMIN;

          const user = prev.users.find((u) => u.id === targetId);
          if (!user) {
            throw new Error(
              'Demo account could not be found. Try resetting demo state.'
            );
          }
          setLocalSessionUserId(user.id);
          return {
            next: prev,
            result: { token: `local-jwt-${user.id}`, user },
          };
        })
    );

    setAuthToken(res.token);
    setLocalSessionUserId(res.user.id);
    return res;
  },

  async getSession(): Promise<{ user: User | null }> {
    const token = getAuthToken();
    const localId = getLocalSessionUserId();
    if (!token && !localId) {
      return { user: null };
    }

    return requestWithFallback<{ user: User | null }>(
      '/api/auth/me',
      { method: 'GET' },
      () => {
        const dataset = loadLocalDataset();
        const user = localId
          ? dataset.users.find((u) => u.id === localId) ?? null
          : null;
        return { user };
      }
    );
  },

  async logout(): Promise<{ ok: boolean }> {
    try {
      return await requestWithFallback<{ ok: boolean }>(
        '/api/auth/logout',
        { method: 'POST' },
        () => ({ ok: true })
      );
    } finally {
      setAuthToken(null);
      setLocalSessionUserId(null);
    }
  },

  async switchViewMode(mode: ViewMode, userId?: string): Promise<{ user: User }> {
    return requestWithFallback<{ user: User }>(
      '/api/auth/view-mode',
      {
        method: 'PATCH',
        body: JSON.stringify({ active_view_mode: mode }),
      },
      () =>
        mutateLocalDataset((prev) => {
          const targetId = resolveCurrentLocalUserId(userId);
          const nowIso = new Date().toISOString();
          let updatedUser: User | null = null;
          const nextUsers = prev.users.map((u) => {
            if (u.id !== targetId) return u;
            if (mode === 'merchant' && !u.is_merchant) {
              throw new Error('Unlock a merchant booth first.');
            }
            updatedUser = { ...u, active_view_mode: mode, updated_at: nowIso };
            return updatedUser;
          });
          if (!updatedUser) {
            throw new Error('User not found.');
          }
          return {
            next: { ...prev, users: nextUsers },
            result: { user: updatedUser },
          };
        })
    );
  },

  // --------------------------------------------------------------------------
  // EVENTS & DATASET HYDRATION
  // --------------------------------------------------------------------------

  async getEvents(): Promise<EventsBootstrapResponse> {
    return requestWithFallback<EventsBootstrapResponse>(
      '/api/events',
      { method: 'GET' },
      () => {
        const ds = loadLocalDataset();
        return {
          events: ds.events,
          participants: ds.event_participants,
          tenants: ds.tenants,
          tenant_items: ds.tenant_items,
          stamps: ds.stamps,
          transactions: ds.transactions,
          ticket_uids: ds.ticket_uids,
          meetups: ds.event_chat_messages,
          users: ds.users,
        };
      }
    );
  },

  async getEventLeaderboard(eventId: string): Promise<LeaderboardResponse> {
    return requestWithFallback<LeaderboardResponse>(
      `/api/events/${encodeURIComponent(eventId)}/leaderboard`,
      { method: 'GET' },
      () => {
        const ds = loadLocalDataset();
        const userMap = new Map(ds.users.map((u) => [u.id, u.username]));
        const rawEntries: LeaderboardEntry[] = ds.event_participants
          .filter((p) => p.event_id === eventId)
          .map((p) => ({
            participant_id: p.id,
            event_id: p.event_id,
            user_id: p.user_id,
            username: userMap.get(p.user_id) ?? 'Attendee',
            leaderboard_idr: p.leaderboard_idr,
            streak_expires_at: p.streak_expires_at,
            stamps_count: ds.stamps.filter(
              (s) => s.event_id === eventId && s.participant_id === p.id
            ).length,
            rank_position: 0,
          }));

        const { ranked } = computeLeaderboardStanding(rawEntries);
        return { event_id: eventId, entries: ranked };
      }
    );
  },

  // --------------------------------------------------------------------------
  // EVENT CHECK-IN & BOOTH ONBOARDING / SETUP
  // --------------------------------------------------------------------------

  async checkInEvent(
    eventId: string,
    payload: CheckInRequest,
    userId?: string
  ): Promise<CheckInResponse> {
    const normalizedCode = payload.uid_code.trim().toUpperCase();
    return requestWithFallback<CheckInResponse>(
      `/api/events/${encodeURIComponent(eventId)}/check-in`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          uid_code: normalizedCode,
        }),
      },
      () =>
        mutateLocalDataset((prev) => {
          const targetUserId = resolveCurrentLocalUserId(userId);
          const currentUser = prev.users.find((u) => u.id === targetUserId);
          if (!currentUser) {
            throw new Error('Please sign in before joining an event.');
          }
          if (!normalizedCode) {
            throw new Error('Please enter your Event Ticket Code.');
          }

          const targetEvent = prev.events.find((e) => e.id === eventId);
          if (!targetEvent) {
            throw new Error('Selected event was not found.');
          }
          if (targetEvent.status !== 'active') {
            throw new Error('Only active events accept new Event Ticket Code check-ins.');
          }

          const ticket = prev.ticket_uids.find(
            (t) =>
              t.event_id === eventId && t.uid_code.toUpperCase() === normalizedCode
          );
          if (!ticket) {
            throw new Error(
              `Event Ticket Code "${normalizedCode}" is invalid for ${targetEvent.name}. Try TKT-DEMO-BYR or TKT-DEMO-SLR.`
            );
          }
          if (
            ticket.claimed_by_user_id &&
            ticket.claimed_by_user_id !== currentUser.id
          ) {
            throw new Error('This Event Ticket Code has already been claimed by another attendee.');
          }

          const nowIso = new Date().toISOString();
          const existingCodes = new Set(
            prev.event_participants
              .filter((p) => p.event_id === eventId)
              .map((p) => p.qr_code)
          );

          let participant =
            prev.event_participants.find(
              (p) => p.event_id === eventId && p.user_id === currentUser.id
            ) ?? null;

          let checkInStamp =
            (participant &&
              prev.stamps.find(
                (s) =>
                  s.event_id === eventId &&
                  s.participant_id === participant?.id &&
                  s.stamp_type === 'checkin'
              )) ??
            null;

          let isNewParticipant = false;
          if (!participant) {
            isNewParticipant = true;
            participant = {
              id: createUuid(),
              event_id: eventId,
              user_id: currentUser.id,
              qr_code: generateCryptographicQrCode(existingCodes),
              actual_spent_idr: 0,
              leaderboard_idr: 0,
              streak_expires_at: null,
              created_at: nowIso,
              updated_at: nowIso,
            };
          }

          if (!checkInStamp) {
            checkInStamp = {
              id: createUuid(),
              event_id: eventId,
              participant_id: participant.id,
              tenant_id: null,
              stamp_type: 'checkin',
              unlocked_at: nowIso,
            };
          }

          let tenant =
            prev.tenants.find(
              (t) => t.event_id === eventId && t.user_id === currentUser.id
            ) ?? null;
          let isNewTenant = false;

          if (ticket.role_type === 'merchant' && !tenant) {
            isNewTenant = true;
            const cleanBoothNumber =
              payload.booth_number?.trim().toUpperCase() ||
              `E-${String(
                prev.tenants.filter((t) => t.event_id === eventId).length + 1
              ).padStart(2, '0')}`;
            const cleanBoothName =
              payload.booth_name?.trim() ||
              currentUser.merchant_brand_name ||
              `${currentUser.username}'s Booth`;

            tenant = {
              id: createUuid(),
              event_id: eventId,
              user_id: currentUser.id,
              booth_number: cleanBoothNumber,
              booth_name: cleanBoothName,
              description:
                payload.booth_bio?.trim() ||
                currentUser.merchant_bio ||
                'Independent creator booth at the event.',
              stamp_image_url: '',
              event_sales_idr: 0,
              unique_stamps_count: 0,
              is_cold_bounty: false,
              cold_bounty_expires_at: null,
              cold_bounty_multiplier: targetEvent.cold_bounty_multiplier,
              is_hidden_bounty: false,
              hidden_bounty_bonus_idr: targetEvent.hidden_bounty_bonus_idr,
              created_at: nowIso,
              updated_at: nowIso,
            };
          }

          const joinedEventIds = new Set([
            ...prev.event_participants
              .filter((p) => p.user_id === currentUser.id)
              .map((p) => p.event_id),
            ...prev.tenants
              .filter((t) => t.user_id === currentUser.id)
              .map((t) => t.event_id),
            eventId,
          ]);

          const claimedTicket: TicketUid = {
            ...ticket,
            claimed_by_user_id: currentUser.id,
            claimed_at: ticket.claimed_at ?? nowIso,
          };

          const upgradingToMerchant = ticket.role_type === 'merchant';
          const updatedUser: User = {
            ...currentUser,
            is_merchant: currentUser.is_merchant || upgradingToMerchant,
            active_view_mode: upgradingToMerchant
              ? 'merchant'
              : currentUser.active_view_mode,
            merchant_brand_name:
              upgradingToMerchant && payload.booth_name?.trim()
                ? payload.booth_name.trim()
                : currentUser.merchant_brand_name,
            events_count: joinedEventIds.size,
            updated_at: nowIso,
          };

          const finalParticipant = participant;
          const finalCheckInStamp = checkInStamp;
          const finalTenant = tenant;

          const next: DemoSeedDataset = {
            ...prev,
            ticket_uids: prev.ticket_uids.map((t) =>
              t.id === ticket.id ? claimedTicket : t
            ),
            event_participants: isNewParticipant
              ? [...prev.event_participants, finalParticipant]
              : prev.event_participants,
            stamps: prev.stamps.some((s) => s.id === finalCheckInStamp.id)
              ? prev.stamps
              : [...prev.stamps, finalCheckInStamp],
            tenants:
              isNewTenant && finalTenant
                ? [...prev.tenants, finalTenant]
                : prev.tenants,
            users: prev.users.map((u) => (u.id === currentUser.id ? updatedUser : u)),
          };

          return {
            next,
            result: {
              event: targetEvent,
              role_type: ticket.role_type,
              participant: finalParticipant,
              tenant: finalTenant,
              check_in_stamp: finalCheckInStamp,
              ticket_uid: claimedTicket,
              user: updatedUser,
              is_new_join: isNewParticipant || isNewTenant,
            },
          };
        })
    );
  },

  async linkBooth(
    eventId: string,
    payload: LinkBoothRequest,
    userId?: string
  ): Promise<LinkBoothResponse> {
    const cleanBrand = payload.booth_name.trim();
    const cleanBio = (payload.bio ?? '').trim();
    const normalizedCode = payload.uid_code.trim().toUpperCase();

    return requestWithFallback<LinkBoothResponse>(
      `/api/events/${encodeURIComponent(eventId)}/link-booth`,
      {
        method: 'POST',
        body: JSON.stringify({
          uid_code: normalizedCode,
          booth_name: cleanBrand,
          booth_number: payload.booth_number?.trim() || undefined,
          bio: cleanBio,
        }),
      },
      () => {
        const dataset = loadLocalDataset();
        const ticket = dataset.ticket_uids.find(
          (t) =>
            t.event_id === eventId && t.uid_code.toUpperCase() === normalizedCode
        );
        if (!ticket) {
          throw new Error('Booth Event Ticket Code not found for this event.');
        }
        if (ticket.role_type !== 'merchant') {
          throw new Error(
            'This Event Ticket Code is an Attendee ticket. Please enter a Booth Event Ticket Code.'
          );
        }

        // Perform check-in & booth minting, then apply brand/bio details
        return (async () => {
          const joinRes = await apiClient.checkInEvent(
            eventId,
            {
              uid_code: normalizedCode,
              booth_name: cleanBrand,
              booth_number: payload.booth_number,
              booth_bio: cleanBio,
            },
            userId
          );

          if (!joinRes.tenant) {
            throw new Error('Merchant booth could not be provisioned for this ticket.');
          }

          return mutateLocalDataset((prev) => {
            const targetUserId = resolveCurrentLocalUserId(userId);
            const nowIso = new Date().toISOString();
            const existingUser = prev.users.find((u) => u.id === targetUserId);
            if (!existingUser) {
              throw new Error('Authentication required.');
            }

            const updatedUser: User = {
              ...existingUser,
              is_merchant: true,
              active_view_mode: 'merchant',
              merchant_brand_name: cleanBrand,
              merchant_bio: cleanBio,
              updated_at: nowIso,
            };

            const updatedTenant: Tenant = {
              ...joinRes.tenant!,
              booth_name: cleanBrand,
              description: cleanBio || joinRes.tenant!.description,
              updated_at: nowIso,
            };

            return {
              next: {
                ...prev,
                users: prev.users.map((u) =>
                  u.id === targetUserId ? updatedUser : u
                ),
                tenants: prev.tenants.map((t) =>
                  t.id === updatedTenant.id ? updatedTenant : t
                ),
              },
              result: {
                user: updatedUser,
                tenant: updatedTenant,
                participant: joinRes.participant,
                check_in_stamp: joinRes.check_in_stamp,
                ticket_uid: joinRes.ticket_uid,
              },
            };
          });
        })();
      }
    );
  },

  async updateBoothProfile(
    tenantId: string,
    payload: {
      booth_name: string;
      booth_number: string;
      description: string;
      stamp_image_url: string;
    }
  ): Promise<{ tenant: Tenant }> {
    return requestWithFallback<{ tenant: Tenant }>(
      `/api/booths/${encodeURIComponent(tenantId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      () =>
        mutateLocalDataset((prev) => {
          const nowIso = new Date().toISOString();
          let updated: Tenant | null = null;
          const tenants = prev.tenants.map((t) => {
            if (t.id !== tenantId) return t;
            updated = {
              ...t,
              booth_name: payload.booth_name,
              booth_number: payload.booth_number,
              description: payload.description,
              stamp_image_url: payload.stamp_image_url,
              updated_at: nowIso,
            };
            return updated;
          });
          if (!updated) throw new Error('Booth not found.');
          return { next: { ...prev, tenants }, result: { tenant: updated } };
        })
    );
  },

  async createBoothItem(
    tenantId: string,
    payload: {
      item_name: string;
      price_idr: number;
      sort_order?: number;
      is_active?: boolean;
    }
  ): Promise<{ item: TenantItem }> {
    return requestWithFallback<{ item: TenantItem }>(
      `/api/booths/${encodeURIComponent(tenantId)}/items`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () =>
        mutateLocalDataset((prev) => {
          const nextSort =
            payload.sort_order ??
            prev.tenant_items
              .filter((i) => i.tenant_id === tenantId)
              .reduce((max, i) => Math.max(max, i.sort_order), 0) + 1;

          const item: TenantItem = {
            id: createUuid(),
            tenant_id: tenantId,
            item_name: payload.item_name,
            price_idr: payload.price_idr,
            sort_order: nextSort,
            is_active: payload.is_active ?? true,
            created_at: new Date().toISOString(),
          };
          return {
            next: { ...prev, tenant_items: [...prev.tenant_items, item] },
            result: { item },
          };
        })
    );
  },

  async updateBoothItem(
    tenantId: string,
    itemId: string,
    payload: {
      item_name?: string;
      price_idr?: number;
      is_active?: boolean;
      sort_order?: number;
    }
  ): Promise<{ item: TenantItem }> {
    return requestWithFallback<{ item: TenantItem }>(
      `/api/booths/${encodeURIComponent(tenantId)}/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      () =>
        mutateLocalDataset((prev) => {
          let updated: TenantItem | null = null;
          const tenant_items = prev.tenant_items.map((i) => {
            if (i.id !== itemId || i.tenant_id !== tenantId) return i;
            updated = {
              ...i,
              ...payload,
            };
            return updated;
          });
          if (!updated) throw new Error('Catalog item not found.');
          return { next: { ...prev, tenant_items }, result: { item: updated } };
        })
    );
  },

  async deleteBoothItem(
    tenantId: string,
    itemId: string
  ): Promise<{ ok: boolean; id: string }> {
    return requestWithFallback<{ ok: boolean; id: string }>(
      `/api/booths/${encodeURIComponent(tenantId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' },
      () =>
        mutateLocalDataset((prev) => ({
          next: {
            ...prev,
            tenant_items: prev.tenant_items.filter((i) => i.id !== itemId),
          },
          result: { ok: true, id: itemId },
        }))
    );
  },

  // --------------------------------------------------------------------------
  // POS CHECKOUT & VOID REVERSAL
  // --------------------------------------------------------------------------

  async processPosCheckout(payload: PosCheckoutRequest): Promise<PosCheckoutResponse> {
    return requestWithFallback<PosCheckoutResponse>(
      '/api/pos/checkout',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () =>
        mutateLocalDataset((prev) => {
          // Idempotent check for offline-synced client_tx_id
          const existingTx = prev.transactions.find(
            (tx) => tx.client_tx_id && tx.client_tx_id === payload.client_tx_id
          );
          if (existingTx) {
            const participant = prev.event_participants.find(
              (p) => p.id === existingTx.participant_id
            );
            const tenant = prev.tenants.find((t) => t.id === existingTx.tenant_id);
            if (!participant || !tenant) {
              throw new Error('Participant or booth record not found.');
            }
            return {
              next: prev,
              result: {
                transaction: existingTx,
                participant,
                tenant,
                unlocked_stamp: null,
                hidden_bounty_triggered: existingTx.hit_hidden_bounty,
                hidden_bounty_bonus_idr: existingTx.hidden_bounty_bonus_idr,
              },
            };
          }

          const event = prev.events.find((e) => e.id === payload.event_id);
          if (!event) throw new Error('Event not found.');
          if (event.status !== 'active') throw new Error('Event is not active.');

          const tenant = prev.tenants.find(
            (t) => t.id === payload.tenant_id && t.event_id === payload.event_id
          );
          if (!tenant) throw new Error('Booth tenant not found for this event.');

          const normalizedQr = payload.buyer_qr_code.trim().toUpperCase();
          const participant = prev.event_participants.find(
            (p) =>
              p.event_id === payload.event_id &&
              p.qr_code.toUpperCase() === normalizedQr
          );
          if (!participant) {
            throw new Error(`Buyer QR "${normalizedQr}" is not registered in this event.`);
          }

          const recentParticipantTransactions = prev.transactions.filter(
            (tx) =>
              tx.event_id === event.id && tx.participant_id === participant.id
          );
          const recentTenantTransactions = prev.transactions.filter(
            (tx) => tx.event_id === event.id && tx.tenant_id === tenant.id
          );
          const existingBoothStamp = prev.stamps.some(
            (s) =>
              s.event_id === event.id &&
              s.participant_id === participant.id &&
              s.tenant_id === tenant.id &&
              s.stamp_type === 'booth'
          );

          const calc = calculateDualIdrCheckout({
            actualAmountIdr: payload.actual_amount_idr,
            event,
            participant,
            tenant,
            recentParticipantTransactions,
            recentTenantTransactions,
            existingBoothStamp,
            now: Date.now(),
          });

          if (!calc.allowed) {
            throw new Error(`COOLDOWN_ACTIVE: ${calc.blockReason ?? 'Wait 180s.'}`);
          }

          const nowIso = new Date().toISOString();
          const newTx: Transaction = {
            id: createUuid(),
            client_tx_id: payload.client_tx_id,
            event_id: event.id,
            participant_id: participant.id,
            tenant_id: tenant.id,
            actual_amount_idr: calc.actualAmountIdr,
            leaderboard_amount_idr: calc.leaderboardAmountIdr,
            multiplier_applied: calc.multiplierApplied,
            hit_hidden_bounty: calc.hiddenBounty.triggered,
            hidden_bounty_bonus_idr: calc.hiddenBounty.bonusIdr,
            status: 'completed',
            is_flagged: calc.cooldown.isFlagged,
            flag_reason: calc.cooldown.flagDescription,
            item_summary: payload.item_summary,
            voided_at: null,
            voided_by_user_id: null,
            created_at: nowIso,
          };

          const updatedParticipant: EventParticipant = {
            ...participant,
            actual_spent_idr: calc.newParticipantActualSpentIdr,
            leaderboard_idr: calc.newParticipantLeaderboardIdr,
            streak_expires_at: calc.newStreakExpiresAt,
            updated_at: nowIso,
          };

          const updatedTenant: Tenant = {
            ...tenant,
            event_sales_idr: tenant.event_sales_idr + calc.actualAmountIdr,
            unique_stamps_count:
              tenant.unique_stamps_count + (calc.shouldUnlockBoothStamp ? 1 : 0),
            updated_at: nowIso,
          };

          const unlockedStamp: Stamp | null = calc.shouldUnlockBoothStamp
            ? {
                id: createUuid(),
                event_id: event.id,
                participant_id: participant.id,
                tenant_id: tenant.id,
                stamp_type: 'booth',
                unlocked_at: nowIso,
              }
            : null;

          const next: DemoSeedDataset = {
            ...prev,
            transactions: [newTx, ...prev.transactions],
            event_participants: prev.event_participants.map((p) =>
              p.id === participant.id ? updatedParticipant : p
            ),
            tenants: prev.tenants.map((t) =>
              t.id === tenant.id ? updatedTenant : t
            ),
            stamps: unlockedStamp ? [...prev.stamps, unlockedStamp] : prev.stamps,
            users: prev.users.map((u) => {
              if (u.id === participant.user_id) {
                return {
                  ...u,
                  lifetime_actual_spent_idr:
                    u.lifetime_actual_spent_idr + calc.actualAmountIdr,
                };
              }
              if (u.id === tenant.user_id) {
                return {
                  ...u,
                  lifetime_sales_idr: u.lifetime_sales_idr + calc.actualAmountIdr,
                };
              }
              return u;
            }),
          };

          return {
            next,
            result: {
              transaction: newTx,
              participant: updatedParticipant,
              tenant: updatedTenant,
              unlocked_stamp: unlockedStamp,
              hidden_bounty_triggered: calc.hiddenBounty.triggered,
              hidden_bounty_bonus_idr: calc.hiddenBounty.bonusIdr,
            },
          };
        })
    );
  },

  async reversePosTransaction(
    payload: PosReverseRequest,
    actorUserId?: string
  ): Promise<PosReverseResponse> {
    return requestWithFallback<PosReverseResponse>(
      '/api/pos/reverse',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () =>
        mutateLocalDataset((prev) => {
          const tx = prev.transactions.find((t) => t.id === payload.transaction_id);
          if (!tx) throw new Error('Transaction not found.');

          const event = prev.events.find((e) => e.id === tx.event_id);
          if (!event) throw new Error('Event not found.');

          const currentUserId = actorUserId ?? getLocalSessionUserId();
          const currentUser = currentUserId
            ? prev.users.find((u) => u.id === currentUserId)
            : null;
          const providedPin = payload.admin_void_pin?.trim() ?? '';

          if (!currentUser?.is_admin && providedPin !== event.admin_void_pin) {
            throw new Error('INVALID_VOID_PIN: Invalid Organizer Admin PIN.');
          }
          if (providedPin && providedPin !== event.admin_void_pin) {
            throw new Error('INVALID_VOID_PIN: Invalid Organizer Admin PIN.');
          }

          const participant = prev.event_participants.find(
            (p) => p.id === tx.participant_id
          );
          const tenant = prev.tenants.find((t) => t.id === tx.tenant_id);
          if (!participant || !tenant) {
            throw new Error('Participant or booth record not found.');
          }

          const participantTxs = prev.transactions.filter(
            (item) =>
              item.event_id === tx.event_id &&
              item.participant_id === tx.participant_id
          );
          const boothStamp = prev.stamps.find(
            (s) =>
              s.event_id === tx.event_id &&
              s.participant_id === tx.participant_id &&
              s.tenant_id === tx.tenant_id &&
              s.stamp_type === 'booth'
          );

          const reversal = evaluateVoidReversal({
            transactionToVoid: tx,
            eventMinStampSpendIdr: event.min_stamp_spend_idr,
            participantRemainingTransactions: participantTxs,
            participantHasBoothStamp: Boolean(boothStamp),
          });
          if (!reversal.valid) {
            throw new Error(reversal.errorReason ?? 'Cannot void transaction.');
          }

          const nowIso = new Date().toISOString();
          const voidedTx: Transaction = {
            ...tx,
            status: 'voided',
            is_flagged: false,
            voided_at: nowIso,
            voided_by_user_id: currentUserId ?? null,
          };

          const updatedParticipant: EventParticipant = {
            ...participant,
            actual_spent_idr: Math.max(
              0,
              participant.actual_spent_idr - reversal.deductActualIdr
            ),
            leaderboard_idr: Math.max(
              0,
              participant.leaderboard_idr - reversal.deductLeaderboardIdr
            ),
            updated_at: nowIso,
          };

          const updatedTenant: Tenant = {
            ...tenant,
            event_sales_idr: Math.max(
              0,
              tenant.event_sales_idr - reversal.deductActualIdr
            ),
            unique_stamps_count: Math.max(
              0,
              tenant.unique_stamps_count - (reversal.shouldReverseBoothStamp ? 1 : 0)
            ),
            updated_at: nowIso,
          };

          const reversedStampId =
            reversal.shouldReverseBoothStamp && boothStamp ? boothStamp.id : null;

          const next: DemoSeedDataset = {
            ...prev,
            transactions: prev.transactions.map((item) =>
              item.id === tx.id ? voidedTx : item
            ),
            event_participants: prev.event_participants.map((p) =>
              p.id === participant.id ? updatedParticipant : p
            ),
            tenants: prev.tenants.map((t) =>
              t.id === tenant.id ? updatedTenant : t
            ),
            stamps: reversedStampId
              ? prev.stamps.filter((s) => s.id !== reversedStampId)
              : prev.stamps,
          };

          return {
            next,
            result: {
              transaction: voidedTx,
              participant: updatedParticipant,
              tenant: updatedTenant,
              reversed_stamp_id: reversedStampId,
              deduct_actual_idr: reversal.deductActualIdr,
              deduct_leaderboard_idr: reversal.deductLeaderboardIdr,
            },
          };
        })
    );
  },

  // --------------------------------------------------------------------------
  // MEETUPS & ANNOUNCEMENTS
  // --------------------------------------------------------------------------

  async getEventMeetups(eventId: string): Promise<MeetupsListResponse> {
    return requestWithFallback<MeetupsListResponse>(
      `/api/events/${encodeURIComponent(eventId)}/meetups`,
      { method: 'GET' },
      () => {
        const ds = loadLocalDataset();
        return {
          event_id: eventId,
          messages: ds.event_chat_messages.filter((m) => m.event_id === eventId),
        };
      }
    );
  },

  async createMeetupMessage(
    eventId: string,
    payload: CreateMeetupRequest,
    actorUser?: User
  ): Promise<{ message: EventChatMessage }> {
    return requestWithFallback<{ message: EventChatMessage }>(
      `/api/events/${encodeURIComponent(eventId)}/meetups`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () =>
        mutateLocalDataset((prev) => {
          const userId = actorUser?.id ?? resolveCurrentLocalUserId();
          const user =
            actorUser ?? prev.users.find((u) => u.id === userId) ?? null;
          if (!user) throw new Error('Authentication required.');

          const message: EventChatMessage = {
            id: createUuid(),
            event_id: eventId,
            sender_user_id: user.id,
            sender_username: user.username,
            sender_role:
              payload.sender_role ??
              (payload.message_type === 'admin_announcement'
                ? 'organizer'
                : 'buyer'),
            message_type: payload.message_type,
            announcement_text: payload.announcement_text ?? null,
            target_character: payload.target_character ?? null,
            target_location: payload.target_location ?? null,
            target_activity: payload.target_activity ?? null,
            interested_user_ids: [],
            is_pinned: Boolean(payload.is_pinned),
            created_at: new Date().toISOString(),
          };

          return {
            next: {
              ...prev,
              event_chat_messages: [message, ...prev.event_chat_messages],
            },
            result: { message },
          };
        })
    );
  },

  async toggleMeetupInterest(
    messageId: string,
    userId?: string
  ): Promise<{ message: EventChatMessage; interested: boolean }> {
    return requestWithFallback<{ message: EventChatMessage; interested: boolean }>(
      `/api/meetups/${encodeURIComponent(messageId)}/interest`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
      () =>
        mutateLocalDataset((prev) => {
          const actorId = resolveCurrentLocalUserId(userId);
          let updatedMessage: EventChatMessage | null = null;
          let interested = false;

          const event_chat_messages = prev.event_chat_messages.map((m) => {
            if (m.id !== messageId) return m;
            const exists = m.interested_user_ids.includes(actorId);
            interested = !exists;
            updatedMessage = {
              ...m,
              interested_user_ids: exists
                ? m.interested_user_ids.filter((id) => id !== actorId)
                : [...m.interested_user_ids, actorId],
            };
            return updatedMessage;
          });

          if (!updatedMessage) {
            throw new Error('Meetup post not found.');
          }
          return {
            next: { ...prev, event_chat_messages },
            result: { message: updatedMessage, interested },
          };
        })
    );
  },

  // --------------------------------------------------------------------------
  // ORGANIZER COMMAND CENTER ENDPOINTS
  // --------------------------------------------------------------------------

  async createEvent(
    payload: {
      name: string;
      description: string;
      min_stamp_spend_idr: number;
      admin_void_pin: string;
      cold_bounty_multiplier?: number;
      hidden_bounty_bonus_idr?: number;
      venue_zones?: string[];
    },
    createdByUserId?: string
  ): Promise<{ event: Event }> {
    return requestWithFallback<{ event: Event }>(
      '/api/organizer/events',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () =>
        mutateLocalDataset((prev) => {
          const nowIso = new Date().toISOString();
          const newEvent: Event = {
            id: createUuid(),
            name: payload.name,
            description: payload.description,
            status: 'draft',
            min_stamp_spend_idr: payload.min_stamp_spend_idr,
            admin_void_pin: payload.admin_void_pin,
            cold_bounty_multiplier: payload.cold_bounty_multiplier ?? 1.25,
            hidden_bounty_bonus_idr: payload.hidden_bounty_bonus_idr ?? 25000,
            venue_zones: payload.venue_zones ?? [
              'Main Stage',
              'Photo Zone A',
              'Photo Zone B',
              'Cosplay Lounge',
            ],
            event_date: nowIso,
            started_at: null,
            ended_at: null,
            created_by: createdByUserId ?? getLocalSessionUserId(),
            created_at: nowIso,
            updated_at: nowIso,
          };
          return {
            next: { ...prev, events: [newEvent, ...prev.events] },
            result: { event: newEvent },
          };
        })
    );
  },

  async updateEventStatus(
    eventId: string,
    status: 'active' | 'archived',
    actorUser?: User
  ): Promise<{ event: Event; welcome_announcement: EventChatMessage | null }> {
    return requestWithFallback<{
      event: Event;
      welcome_announcement: EventChatMessage | null;
    }>(
      `/api/organizer/events/${encodeURIComponent(eventId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
      () =>
        mutateLocalDataset((prev) => {
          const nowIso = new Date().toISOString();
          let updatedEvent: Event | null = null;
          const events = prev.events.map((item) => {
            if (item.id !== eventId) return item;
            updatedEvent = {
              ...item,
              status,
              started_at:
                status === 'active' ? item.started_at ?? nowIso : item.started_at,
              ended_at: status === 'archived' ? nowIso : item.ended_at,
              updated_at: nowIso,
            };
            return updatedEvent;
          });
          if (!updatedEvent) throw new Error('Event not found.');

          const targetEv: Event = updatedEvent;
          let welcomeAnnouncement: EventChatMessage | null = null;
          const actor =
            actorUser ??
            prev.users.find((u) => u.id === getLocalSessionUserId()) ??
            null;

          if (status === 'active' && actor) {
            const hasAnnouncement = prev.event_chat_messages.some(
              (m) =>
                m.event_id === targetEv.id &&
                m.message_type === 'admin_announcement'
            );
            if (!hasAnnouncement) {
              welcomeAnnouncement = {
                id: createUuid(),
                event_id: targetEv.id,
                sender_user_id: actor.id,
                sender_username: actor.username,
                sender_role: 'organizer',
                message_type: 'admin_announcement',
                announcement_text: `Welcome to ${targetEv.name}! Collect booth stamps (${formatIdr(
                  targetEv.min_stamp_spend_idr
                )}+ per booth) and visit 3 booths in 60 minutes for a 1.25x streak boost!`,
                target_character: null,
                target_location: null,
                target_activity: null,
                interested_user_ids: [],
                is_pinned: true,
                created_at: nowIso,
              };
            }
          }

          return {
            next: {
              ...prev,
              events,
              event_chat_messages: welcomeAnnouncement
                ? [welcomeAnnouncement, ...prev.event_chat_messages]
                : prev.event_chat_messages,
            },
            result: {
              event: targetEv,
              welcome_announcement: welcomeAnnouncement,
            },
          };
        })
    );
  },

  async createEventTickets(
    eventId: string,
    payload:
      | { mode: 'generate'; role_type: TicketRoleType; count: number }
      | {
          mode: 'import';
          tickets: Array<{ uid_code: string; role_type: TicketRoleType }>;
        }
  ): Promise<{ tickets: TicketUid[] }> {
    return requestWithFallback<{ tickets: TicketUid[] }>(
      `/api/organizer/events/${encodeURIComponent(eventId)}/tickets`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () =>
        mutateLocalDataset((prev) => {
          const existingSet = new Set(
            prev.ticket_uids.map((t) => t.uid_code.toUpperCase())
          );
          const nowIso = new Date().toISOString();

          let newRows: TicketUid[] = [];
          if (payload.mode === 'generate') {
            const count = Math.max(1, Math.min(50, payload.count));
            newRows = Array.from({ length: count }, () => ({
              id: createUuid(),
              event_id: eventId,
              uid_code: generateTicketCode(payload.role_type, existingSet),
              role_type: payload.role_type,
              claimed_by_user_id: null,
              claimed_at: null,
              created_at: nowIso,
            }));
          } else {
            for (const row of payload.tickets) {
              const cleanCode = row.uid_code.trim().toUpperCase();
              if (!cleanCode || existingSet.has(cleanCode)) continue;
              existingSet.add(cleanCode);
              newRows.push({
                id: createUuid(),
                event_id: eventId,
                uid_code: cleanCode,
                role_type: row.role_type,
                claimed_by_user_id: null,
                claimed_at: null,
                created_at: nowIso,
              });
            }
          }

          return {
            next: { ...prev, ticket_uids: [...newRows, ...prev.ticket_uids] },
            result: { tickets: newRows },
          };
        })
    );
  },

  async activateColdBounty(
    eventId: string,
    payload: { tenant_ids: string[]; multiplier: number; duration_minutes?: number },
    actorUser?: User
  ): Promise<{ tenants: Tenant[]; announcement: EventChatMessage | null }> {
    return requestWithFallback<{
      tenants: Tenant[];
      announcement: EventChatMessage | null;
    }>(
      `/api/organizer/events/${encodeURIComponent(eventId)}/cold-bounty`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () =>
        mutateLocalDataset((prev) => {
          const durationMinutes = payload.duration_minutes ?? 30;
          const expiresIso = new Date(
            Date.now() + durationMinutes * 60_000
          ).toISOString();
          const targetSet = new Set(payload.tenant_ids);
          const updatedTenants: Tenant[] = [];

          const tenants = prev.tenants.map((t) => {
            if (!targetSet.has(t.id) || t.event_id !== eventId) return t;
            const nextTenant: Tenant = {
              ...t,
              is_cold_bounty: true,
              cold_bounty_expires_at: expiresIso,
              cold_bounty_multiplier: payload.multiplier,
            };
            updatedTenants.push(nextTenant);
            return nextTenant;
          });

          const boostedNames = updatedTenants.map(
            (b) => `${b.booth_number} ${b.booth_name}`
          );
          const actor =
            actorUser ??
            prev.users.find((u) => u.id === getLocalSessionUserId()) ??
            null;

          const announcement: EventChatMessage | null = actor
            ? {
                id: createUuid(),
                event_id: eventId,
                sender_user_id: actor.id,
                sender_username: actor.username,
                sender_role: 'organizer',
                message_type: 'admin_announcement',
                announcement_text: `GOLD COLD-BOOTH BOUNTY LIVE (${durationMinutes}m): ${boostedNames.join(
                  ', '
                )} now grant a ${payload.multiplier}x Leaderboard Spend Boost!`,
                target_character: null,
                target_location: null,
                target_activity: null,
                interested_user_ids: [],
                is_pinned: true,
                created_at: new Date().toISOString(),
              }
            : null;

          return {
            next: {
              ...prev,
              tenants,
              event_chat_messages: announcement
                ? [announcement, ...prev.event_chat_messages]
                : prev.event_chat_messages,
            },
            result: { tenants: updatedTenants, announcement },
          };
        })
    );
  },

  async clearColdBounty(
    eventId: string,
    tenantId: string
  ): Promise<{ tenant: Tenant }> {
    return requestWithFallback<{ tenant: Tenant }>(
      `/api/organizer/events/${encodeURIComponent(eventId)}/cold-bounty/${encodeURIComponent(
        tenantId
      )}`,
      { method: 'DELETE' },
      () =>
        mutateLocalDataset((prev) => {
          let updated: Tenant | null = null;
          const tenants = prev.tenants.map((t) => {
            if (t.id !== tenantId) return t;
            updated = { ...t, is_cold_bounty: false, cold_bounty_expires_at: null };
            return updated;
          });
          if (!updated) throw new Error('Booth not found.');
          return { next: { ...prev, tenants }, result: { tenant: updated } };
        })
    );
  },

  async toggleHiddenBounty(
    tenantId: string,
    isHiddenBounty: boolean
  ): Promise<{ tenant: Tenant }> {
    return requestWithFallback<{ tenant: Tenant }>(
      `/api/organizer/booths/${encodeURIComponent(tenantId)}/hidden-bounty`,
      {
        method: 'PATCH',
        body: JSON.stringify({ is_hidden_bounty: isHiddenBounty }),
      },
      () =>
        mutateLocalDataset((prev) => {
          let updated: Tenant | null = null;
          const tenants = prev.tenants.map((t) => {
            if (t.id !== tenantId) return t;
            updated = { ...t, is_hidden_bounty: isHiddenBounty };
            return updated;
          });
          if (!updated) throw new Error('Booth not found.');
          return { next: { ...prev, tenants }, result: { tenant: updated } };
        })
    );
  },

  async rotateHiddenBounties(
    eventId: string,
    count?: number
  ): Promise<{ tenants: Tenant[] }> {
    return requestWithFallback<{ tenants: Tenant[] }>(
      `/api/organizer/events/${encodeURIComponent(eventId)}/hidden-bounty/rotate`,
      {
        method: 'POST',
        body: JSON.stringify({ count }),
      },
      () =>
        mutateLocalDataset((prev) => {
          const eventBooths = prev.tenants.filter((t) => t.event_id === eventId);
          const targetCount = Math.min(
            eventBooths.length,
            count ?? Math.max(3, Math.min(5, Math.ceil(eventBooths.length / 2)))
          );
          const shuffled = [...eventBooths].sort(() => Math.random() - 0.5);
          const chosenIds = new Set(shuffled.slice(0, targetCount).map((b) => b.id));

          const updatedEventBooths: Tenant[] = [];
          const tenants = prev.tenants.map((t) => {
            if (t.event_id !== eventId) return t;
            const nextTenant = { ...t, is_hidden_bounty: chosenIds.has(t.id) };
            updatedEventBooths.push(nextTenant);
            return nextTenant;
          });

          return {
            next: { ...prev, tenants },
            result: { tenants: updatedEventBooths },
          };
        })
    );
  },

  async dismissTransactionFlag(
    transactionId: string
  ): Promise<{ transaction: Transaction }> {
    return requestWithFallback<{ transaction: Transaction }>(
      `/api/organizer/transactions/${encodeURIComponent(transactionId)}/dismiss-flag`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
      () =>
        mutateLocalDataset((prev) => {
          let updated: Transaction | null = null;
          const transactions = prev.transactions.map((tx) => {
            if (tx.id !== transactionId) return tx;
            updated = { ...tx, is_flagged: false };
            return updated;
          });
          if (!updated) throw new Error('Transaction not found.');
          return {
            next: { ...prev, transactions },
            result: { transaction: updated },
          };
        })
    );
  },
};
