import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEMO_SEED_DATA, USER_IDS } from '../db/seed';
import { generateCryptographicQrCode } from '../lib/ledgerEngine';
import { offlineQueue, type SyncOutcome } from '../lib/offlineQueue';
import type {
  DemoSeedDataset,
  Event,
  EventParticipant,
  OfflineQueueStatusSnapshot,
  OfflineQueuedTransaction,
  Stamp,
  Tenant,
  TicketRoleType,
  TicketUid,
  User,
  ViewMode,
} from '../types/types';

// ============================================================================
// SUPABASE CLIENT INITIALIZATION (AUTOMATIC DEMO FALLBACK IF UNCONFIGURED)
// ============================================================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    SUPABASE_URL.startsWith('http') &&
    SUPABASE_ANON_KEY.length > 20
);

let supabaseSingleton: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }
  if (!supabaseSingleton) {
    supabaseSingleton = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return supabaseSingleton;
}

// ============================================================================
// LOCAL DEMO PERSISTENCE KEYS
// ============================================================================

const DEMO_STORE_KEY = 'rallypos_demo_dataset_v1';
const DEMO_SESSION_USER_ID_KEY = 'rallypos_demo_session_user_id_v1';
const ACTIVE_EVENT_ID_KEY = 'rallypos_active_event_id_v1';

function cloneSeedDataset(): DemoSeedDataset {
  return JSON.parse(JSON.stringify(DEMO_SEED_DATA)) as DemoSeedDataset;
}

function loadDemoDataset(): DemoSeedDataset {
  if (typeof window === 'undefined') return cloneSeedDataset();
  try {
    const raw = window.localStorage.getItem(DEMO_STORE_KEY);
    if (!raw) return cloneSeedDataset();
    const parsed = JSON.parse(raw) as DemoSeedDataset;
    if (!Array.isArray(parsed.users) || !Array.isArray(parsed.events)) {
      return cloneSeedDataset();
    }
    return parsed;
  } catch {
    return cloneSeedDataset();
  }
}

function saveDemoDataset(dataset: DemoSeedDataset): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(dataset));
  } catch {
    // Ignore storage quota exceptions
  }
}

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

// ============================================================================
// CONTEXT CONTRACTS
// ============================================================================

export type DemoPresetRole = 'fresh_buyer' | 'active_buyer' | 'merchant' | 'admin';

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface BecomeMerchantPayload {
  brandName: string;
  bio: string;
  ticketUid: string;
  eventId: string;
  boothNumber?: string;
}

export interface JoinEventResult {
  event: Event;
  roleType: TicketRoleType;
  participant: EventParticipant;
  tenant: Tenant | null;
  checkInStamp: Stamp;
  isNewJoin: boolean;
}

export interface AppContextValue {
  isLoading: boolean;
  isDemoMode: boolean;
  currentUser: User | null;
  activeViewMode: ViewMode;
  activeEventId: string | null;
  activeEvent: Event | null;
  dataset: DemoSeedDataset;
  offlineStatus: OfflineQueueStatusSnapshot;

  // Derived helpers for current user
  userParticipants: EventParticipant[];
  userTenants: Tenant[];

  // Auth & Workspace Actions
  registerWithEmail: (payload: RegisterPayload) => Promise<User>;
  loginWithEmail: (payload: LoginPayload) => Promise<User>;
  loginWithGoogle: () => Promise<void>;
  loginWithDemoAccount: (preset?: DemoPresetRole) => Promise<User>;
  logout: () => Promise<void>;
  switchViewMode: (mode: ViewMode) => Promise<void>;
  becomeMerchant: (payload: BecomeMerchantPayload) => Promise<{ user: User; tenant: Tenant }>;

  // Event & Ticket Gate Actions
  setActiveEventId: (eventId: string | null) => void;
  joinEventWithTicketUid: (params: {
    eventId: string;
    uidCode: string;
    boothName?: string;
    boothNumber?: string;
  }) => Promise<JoinEventResult>;
  getParticipantForEvent: (eventId: string) => EventParticipant | null;
  getTenantForEvent: (eventId: string) => Tenant | null;

  // Sync & Demo Utilities
  triggerManualSync: () => Promise<void>;
  resetDemoState: () => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const INITIAL_OFFLINE_STATUS: OfflineQueueStatusSnapshot = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingCount: 0,
  syncingCount: 0,
  failedCount: 0,
  totalQueuedCount: 0,
  isSyncing: false,
  lastSyncedAt: null,
  badgeState: 'synced',
};

// ============================================================================
// PROVIDER IMPLEMENTATION
// ============================================================================

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dataset, setDataset] = useState<DemoSeedDataset>(() => loadDemoDataset());
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(DEMO_SESSION_USER_ID_KEY);
  });
  const [activeEventId, setActiveEventIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACTIVE_EVENT_ID_KEY);
  });
  const [isLoading, setIsLoading] = useState<boolean>(isSupabaseConfigured);
  const [offlineStatus, setOfflineStatus] =
    useState<OfflineQueueStatusSnapshot>(INITIAL_OFFLINE_STATUS);

  const supabase = useMemo(() => getSupabaseClient(), []);
  const isDemoMode = !isSupabaseConfigured;

  // Persist demo dataset edits locally
  useEffect(() => {
    if (isDemoMode) {
      saveDemoDataset(dataset);
    }
  }, [dataset, isDemoMode]);

  // Hydrate Supabase session & cloud tables when Supabase env vars are configured
  const hydrateSupabaseData = useCallback(
    async (userId: string) => {
      if (!supabase) return;
      const [
        usersRes,
        eventsRes,
        ticketsRes,
        participantsRes,
        tenantsRes,
        itemsRes,
        stampsRes,
        txRes,
        chatRes,
      ] = await Promise.all([
        supabase.from('users').select('*').eq('id', userId),
        supabase.from('events').select('*').order('created_at', { ascending: false }),
        supabase.from('ticket_uids').select('*'),
        supabase.from('event_participants').select('*'),
        supabase.from('tenants').select('*'),
        supabase.from('tenant_items').select('*'),
        supabase.from('stamps').select('*'),
        supabase.from('transactions').select('*').order('created_at', { ascending: false }),
        supabase.from('event_chat_messages').select('*').order('created_at', { ascending: false }),
      ]);

      setDataset((prev) => ({
        users: (usersRes.data as User[] | null) ?? prev.users,
        events: (eventsRes.data as Event[] | null) ?? prev.events,
        ticket_uids: (ticketsRes.data as TicketUid[] | null) ?? prev.ticket_uids,
        event_participants:
          (participantsRes.data as EventParticipant[] | null) ?? prev.event_participants,
        tenants: (tenantsRes.data as Tenant[] | null) ?? prev.tenants,
        tenant_items: (itemsRes.data as DemoSeedDataset['tenant_items'] | null) ?? prev.tenant_items,
        stamps: (stampsRes.data as Stamp[] | null) ?? prev.stamps,
        transactions:
          (txRes.data as DemoSeedDataset['transactions'] | null) ?? prev.transactions,
        event_chat_messages:
          (chatRes.data as DemoSeedDataset['event_chat_messages'] | null) ??
          prev.event_chat_messages,
      }));
    },
    [supabase]
  );

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let mounted = true;

    const initAuth = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (mounted && session?.user) {
          setCurrentUserId(session.user.id);
          await hydrateSupabaseData(session.user.id);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void initAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setCurrentUserId(session.user.id);
        void hydrateSupabaseData(session.user.id);
      } else {
        setCurrentUserId(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase, hydrateSupabaseData]);

  // Offline Queue Subscription & Auto-Sync
  const syncTransactionHandler = useCallback(
    async (queued: OfflineQueuedTransaction): Promise<SyncOutcome> => {
      if (supabase) {
        const { error } = await supabase.rpc('process_pos_checkout', {
          p_event_id: queued.eventId,
          p_tenant_id: queued.tenantId,
          p_buyer_qr_code: queued.buyerQrCode,
          p_actual_amount_idr: queued.actualAmountIdr,
          p_client_tx_id: queued.clientTxId,
          p_item_summary: queued.itemSummary,
        });
        if (!error) {
          return { outcome: 'synced' };
        }
        if (
          error.message.includes('COOLDOWN_ACTIVE') ||
          error.message.includes('not registered') ||
          error.message.includes('not active')
        ) {
          return { outcome: 'permanent_error', message: error.message };
        }
        return { outcome: 'retryable_error', message: error.message };
      }

      // Demo Mode offline sync simulation
      return { outcome: 'synced' };
    },
    [supabase]
  );

  useEffect(() => {
    const unsubStatus = offlineQueue.subscribe(setOfflineStatus);
    const stopAutoSync = offlineQueue.startAutoSync(syncTransactionHandler);
    return () => {
      unsubStatus();
      stopAutoSync();
    };
  }, [syncTransactionHandler]);

  const currentUser = useMemo(
    () => dataset.users.find((u) => u.id === currentUserId) ?? null,
    [dataset.users, currentUserId]
  );

  const activeViewMode: ViewMode = useMemo(() => {
    if (!currentUser) return 'buyer';
    if (!currentUser.is_merchant) return 'buyer';
    return currentUser.active_view_mode;
  }, [currentUser]);

  const activeEvent = useMemo(
    () => dataset.events.find((e) => e.id === activeEventId) ?? null,
    [dataset.events, activeEventId]
  );

  const userParticipants = useMemo(() => {
    if (!currentUser) return [];
    return dataset.event_participants.filter((p) => p.user_id === currentUser.id);
  }, [dataset.event_participants, currentUser]);

  const userTenants = useMemo(() => {
    if (!currentUser) return [];
    return dataset.tenants.filter((t) => t.user_id === currentUser.id);
  }, [dataset.tenants, currentUser]);

  const setActiveEventId = useCallback((eventId: string | null) => {
    setActiveEventIdState(eventId);
    if (typeof window !== 'undefined') {
      if (eventId) {
        window.localStorage.setItem(ACTIVE_EVENT_ID_KEY, eventId);
      } else {
        window.localStorage.removeItem(ACTIVE_EVENT_ID_KEY);
      }
    }
  }, []);

  const persistDemoSessionUser = useCallback((userId: string | null) => {
    setCurrentUserId(userId);
    if (typeof window !== 'undefined') {
      if (userId) {
        window.localStorage.setItem(DEMO_SESSION_USER_ID_KEY, userId);
      } else {
        window.localStorage.removeItem(DEMO_SESSION_USER_ID_KEY);
      }
    }
  }, []);

  // --------------------------------------------------------------------------
  // AUTHENTICATION ACTIONS
  // --------------------------------------------------------------------------

  const registerWithEmail = useCallback(
    async ({ email, username, password }: RegisterPayload): Promise<User> => {
      const normalizedEmail = email.trim().toLowerCase();
      const cleanUsername = username.trim();

      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new Error('Please enter a valid email address.');
      }
      if (cleanUsername.length < 3) {
        throw new Error('Username must be at least 3 characters.');
      }
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters.');
      }

      if (supabase) {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { username: cleanUsername },
          },
        });
        if (error) throw new Error(error.message);
        if (!data.user) throw new Error('Registration did not return a user.');

        await hydrateSupabaseData(data.user.id);
        const { data: userRow } = await supabase
          .from('users')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (!userRow) {
          throw new Error('Account created. Please verify your email before signing in.');
        }
        return userRow as User;
      }

      // Demo Mode Registration (defaults strictly to Buyer Mode)
      const duplicateEmail = dataset.users.some(
        (u) => u.email.toLowerCase() === normalizedEmail
      );
      if (duplicateEmail) {
        throw new Error('An account with this email already exists.');
      }

      const duplicateUsername = dataset.users.some(
        (u) => u.username.toLowerCase() === cleanUsername.toLowerCase()
      );
      if (duplicateUsername) {
        throw new Error('That username is already taken.');
      }

      const nowIso = new Date().toISOString();
      const newUser: User = {
        id: createUuid(),
        email: normalizedEmail,
        username: cleanUsername,
        password_hash: `DEMO_PW_${password}`,
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

      setDataset((prev) => ({
        ...prev,
        users: [...prev.users, newUser],
      }));
      persistDemoSessionUser(newUser.id);
      return newUser;
    },
    [supabase, hydrateSupabaseData, dataset.users, persistDemoSessionUser]
  );

  const loginWithEmail = useCallback(
    async ({ email, password }: LoginPayload): Promise<User> => {
      const normalizedEmail = email.trim().toLowerCase();

      if (supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw new Error(error.message);
        if (!data.user) throw new Error('Login failed.');

        await hydrateSupabaseData(data.user.id);
        const { data: userRow, error: profileErr } = await supabase
          .from('users')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (profileErr || !userRow) {
          throw new Error(profileErr?.message ?? 'User profile not found.');
        }
        return userRow as User;
      }

      const matched = dataset.users.find(
        (u) => u.email.toLowerCase() === normalizedEmail
      );
      if (!matched) {
        throw new Error('No account found with that email. Try Demo Account or Sign Up.');
      }

      const isSeededDemoUser = matched.password_hash.startsWith('DEMO_HASH_');
      const expectedLocalPassword = `DEMO_PW_${password}`;
      if (!isSeededDemoUser && matched.password_hash !== expectedLocalPassword) {
        throw new Error('Incorrect password.');
      }
      if (password.length < 1) {
        throw new Error('Please enter your password.');
      }

      persistDemoSessionUser(matched.id);
      return matched;
    },
    [supabase, hydrateSupabaseData, dataset.users, persistDemoSessionUser]
  );

  const loginWithGoogle = useCallback(async (): Promise<void> => {
    if (!supabase) {
      throw new Error(
        'Google OAuth requires Supabase credentials. Use "Continue with Demo Account" for instant local testing.'
      );
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/events`,
      },
    });
    if (error) throw new Error(error.message);
  }, [supabase]);

  const loginWithDemoAccount = useCallback(
    async (preset: DemoPresetRole = 'fresh_buyer'): Promise<User> => {
      if (preset === 'fresh_buyer') {
        const existingGuest = dataset.users.find(
          (u) => u.email === 'demo.explorer@rallypos.id'
        );
        if (existingGuest) {
          persistDemoSessionUser(existingGuest.id);
          return existingGuest;
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

        setDataset((prev) => ({
          ...prev,
          users: [...prev.users, freshDemoBuyer],
        }));
        persistDemoSessionUser(freshDemoBuyer.id);
        return freshDemoBuyer;
      }

      const targetId =
        preset === 'active_buyer'
          ? USER_IDS.BUYER_01
          : preset === 'merchant'
            ? USER_IDS.MERCHANT_01
            : USER_IDS.ADMIN;

      const user = dataset.users.find((u) => u.id === targetId);
      if (!user) {
        throw new Error('Demo account could not be found. Try resetting demo state.');
      }

      persistDemoSessionUser(user.id);
      return user;
    },
    [dataset.users, persistDemoSessionUser]
  );

  const logout = useCallback(async (): Promise<void> => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    persistDemoSessionUser(null);
    setActiveEventId(null);
  }, [supabase, persistDemoSessionUser, setActiveEventId]);

  // --------------------------------------------------------------------------
  // BUYER <-> MERCHANT WORKSPACE MODE SWITCHER & ONBOARDING
  // --------------------------------------------------------------------------

  const switchViewMode = useCallback(
    async (mode: ViewMode): Promise<void> => {
      if (!currentUser) return;
      if (mode === 'merchant' && !currentUser.is_merchant) {
        throw new Error('Complete "Become a Merchant" onboarding first.');
      }

      if (supabase) {
        const { error } = await supabase
          .from('users')
          .update({ active_view_mode: mode })
          .eq('id', currentUser.id);
        if (error) throw new Error(error.message);
      }

      setDataset((prev) => ({
        ...prev,
        users: prev.users.map((u) =>
          u.id === currentUser.id
            ? { ...u, active_view_mode: mode, updated_at: new Date().toISOString() }
            : u
        ),
      }));
    },
    [currentUser, supabase]
  );

  // --------------------------------------------------------------------------
  // TICKET UID JOIN GATE (ENROLLS USER, MINTS EV-XXXXXX QR & UNLOCKS STAMP #1)
  // --------------------------------------------------------------------------

  const joinEventWithTicketUid = useCallback(
    async ({
      eventId,
      uidCode,
      boothName,
      boothNumber,
    }: {
      eventId: string;
      uidCode: string;
      boothName?: string;
      boothNumber?: string;
    }): Promise<JoinEventResult> => {
      if (!currentUser) {
        throw new Error('Please sign in before joining an event.');
      }

      const normalizedCode = uidCode.trim().toUpperCase();
      if (!normalizedCode) {
        throw new Error('Please enter your Ticket UID.');
      }

      const targetEvent = dataset.events.find((e) => e.id === eventId);
      if (!targetEvent) {
        throw new Error('Selected event was not found.');
      }
      if (targetEvent.status !== 'active') {
        throw new Error('Only active events accept new Ticket UID registrations.');
      }

      if (supabase) {
        const { error } = await supabase.rpc('claim_ticket_uid', {
          p_event_id: eventId,
          p_uid_code: normalizedCode,
          p_booth_name: boothName ?? null,
          p_booth_number: boothNumber ?? null,
          p_booth_bio: currentUser.merchant_bio ?? '',
        });
        if (error) throw new Error(error.message);
        await hydrateSupabaseData(currentUser.id);

        // Fetch fresh records after RPC
        const { data: partData } = await supabase
          .from('event_participants')
          .select('*')
          .eq('event_id', eventId)
          .eq('user_id', currentUser.id)
          .single();

        const { data: stampData } = await supabase
          .from('stamps')
          .select('*')
          .eq('event_id', eventId)
          .eq('participant_id', (partData as EventParticipant).id)
          .eq('stamp_type', 'checkin')
          .single();

        const { data: tenantData } = await supabase
          .from('tenants')
          .select('*')
          .eq('event_id', eventId)
          .eq('user_id', currentUser.id)
          .maybeSingle();

        setActiveEventId(eventId);
        return {
          event: targetEvent,
          roleType: tenantData ? 'merchant' : 'buyer',
          participant: partData as EventParticipant,
          tenant: (tenantData as Tenant | null) ?? null,
          checkInStamp: stampData as Stamp,
          isNewJoin: true,
        };
      }

      // Demo Mode Atomic Join Simulation
      const ticket = dataset.ticket_uids.find(
        (t) =>
          t.event_id === eventId && t.uid_code.toUpperCase() === normalizedCode
      );

      if (!ticket) {
        throw new Error(
          `Ticket UID "${normalizedCode}" is invalid for ${targetEvent.name}. Try TKT-DEMO-BYR or TKT-DEMO-SLR.`
        );
      }
      if (ticket.claimed_by_user_id && ticket.claimed_by_user_id !== currentUser.id) {
        throw new Error('This Ticket UID has already been claimed by another user.');
      }

      const nowIso = new Date().toISOString();
      const existingCodes = new Set(
        dataset.event_participants
          .filter((p) => p.event_id === eventId)
          .map((p) => p.qr_code)
      );

      let participant =
        dataset.event_participants.find(
          (p) => p.event_id === eventId && p.user_id === currentUser.id
        ) ?? null;

      let checkInStamp =
        (participant &&
          dataset.stamps.find(
            (s) =>
              s.event_id === eventId &&
              s.participant_id === participant?.id &&
              s.stamp_type === 'checkin'
          )) ??
        null;

      let isNewParticipant = false;
      if (!participant) {
        isNewParticipant = true;
        const mintedQr = generateCryptographicQrCode(existingCodes);
        participant = {
          id: createUuid(),
          event_id: eventId,
          user_id: currentUser.id,
          qr_code: mintedQr,
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
        dataset.tenants.find(
          (t) => t.event_id === eventId && t.user_id === currentUser.id
        ) ?? null;
      let isNewTenant = false;

      if (ticket.role_type === 'merchant' && !tenant) {
        isNewTenant = true;
        const cleanBoothNumber =
          boothNumber?.trim().toUpperCase() ||
          `E-${String(dataset.tenants.filter((t) => t.event_id === eventId).length + 1).padStart(2, '0')}`;
        const cleanBoothName =
          boothName?.trim() ||
          currentUser.merchant_brand_name ||
          `${currentUser.username}'s Booth`;

        tenant = {
          id: createUuid(),
          event_id: eventId,
          user_id: currentUser.id,
          booth_number: cleanBoothNumber,
          booth_name: cleanBoothName,
          description:
            currentUser.merchant_bio || 'Independent creator booth at the event.',
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

      const finalParticipant = participant;
      const finalCheckInStamp = checkInStamp;
      const finalTenant = tenant;

      setDataset((prev) => {
        const joinedEventIds = new Set([
          ...prev.event_participants
            .filter((p) => p.user_id === currentUser.id)
            .map((p) => p.event_id),
          ...prev.tenants
            .filter((t) => t.user_id === currentUser.id)
            .map((t) => t.event_id),
          eventId,
        ]);

        return {
          ...prev,
          ticket_uids: prev.ticket_uids.map((t) =>
            t.id === ticket.id
              ? {
                  ...t,
                  claimed_by_user_id: currentUser.id,
                  claimed_at: t.claimed_at ?? nowIso,
                }
              : t
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
          users: prev.users.map((u) => {
            if (u.id !== currentUser.id) return u;
            const upgradingToMerchant = ticket.role_type === 'merchant';
            return {
              ...u,
              is_merchant: u.is_merchant || upgradingToMerchant,
              active_view_mode: upgradingToMerchant ? 'merchant' : u.active_view_mode,
              merchant_brand_name:
                upgradingToMerchant && boothName
                  ? boothName.trim()
                  : u.merchant_brand_name,
              events_count: joinedEventIds.size,
              updated_at: nowIso,
            };
          }),
        };
      });

      setActiveEventId(eventId);
      return {
        event: targetEvent,
        roleType: ticket.role_type,
        participant: finalParticipant,
        tenant: finalTenant,
        checkInStamp: finalCheckInStamp,
        isNewJoin: isNewParticipant || isNewTenant,
      };
    },
    [currentUser, dataset, supabase, hydrateSupabaseData, setActiveEventId]
  );

  const becomeMerchant = useCallback(
    async ({
      brandName,
      bio,
      ticketUid,
      eventId,
      boothNumber,
    }: BecomeMerchantPayload): Promise<{ user: User; tenant: Tenant }> => {
      if (!currentUser) {
        throw new Error('Authentication required.');
      }

      const cleanBrand = brandName.trim();
      const cleanBio = bio.trim();
      const normalizedCode = ticketUid.trim().toUpperCase();

      if (cleanBrand.length < 2) {
        throw new Error('Brand / Booth name must be at least 2 characters.');
      }
      if (!normalizedCode) {
        throw new Error('Please enter a valid Merchant Ticket UID.');
      }

      if (isDemoMode) {
        const ticket = dataset.ticket_uids.find(
          (t) => t.event_id === eventId && t.uid_code.toUpperCase() === normalizedCode
        );
        if (!ticket) {
          throw new Error('Merchant Ticket UID not found for this event.');
        }
        if (ticket.role_type !== 'merchant') {
          throw new Error(
            'This Ticket UID is a Buyer ticket. Please enter a Merchant Ticket UID.'
          );
        }
      }

      const joinResult = await joinEventWithTicketUid({
        eventId,
        uidCode: normalizedCode,
        boothName: cleanBrand,
        boothNumber,
      });

      if (!joinResult.tenant) {
        throw new Error('Merchant booth could not be provisioned for this ticket.');
      }

      const nowIso = new Date().toISOString();

      if (supabase) {
        await supabase
          .from('users')
          .update({
            is_merchant: true,
            active_view_mode: 'merchant',
            merchant_brand_name: cleanBrand,
            merchant_bio: cleanBio,
          })
          .eq('id', currentUser.id);

        await supabase
          .from('tenants')
          .update({
            booth_name: cleanBrand,
            description: cleanBio || joinResult.tenant.description,
          })
          .eq('id', joinResult.tenant.id);
      }

      const updatedUser: User = {
        ...currentUser,
        is_merchant: true,
        active_view_mode: 'merchant',
        merchant_brand_name: cleanBrand,
        merchant_bio: cleanBio,
        updated_at: nowIso,
      };

      const updatedTenant: Tenant = {
        ...joinResult.tenant,
        booth_name: cleanBrand,
        description: cleanBio || joinResult.tenant.description,
        updated_at: nowIso,
      };

      setDataset((prev) => ({
        ...prev,
        users: prev.users.map((u) => (u.id === currentUser.id ? updatedUser : u)),
        tenants: prev.tenants.map((t) =>
          t.id === updatedTenant.id ? updatedTenant : t
        ),
      }));

      return { user: updatedUser, tenant: updatedTenant };
    },
    [currentUser, dataset.ticket_uids, isDemoMode, joinEventWithTicketUid, supabase]
  );

  const getParticipantForEvent = useCallback(
    (eventId: string): EventParticipant | null => {
      if (!currentUser) return null;
      return (
        dataset.event_participants.find(
          (p) => p.event_id === eventId && p.user_id === currentUser.id
        ) ?? null
      );
    },
    [currentUser, dataset.event_participants]
  );

  const getTenantForEvent = useCallback(
    (eventId: string): Tenant | null => {
      if (!currentUser) return null;
      return (
        dataset.tenants.find(
          (t) => t.event_id === eventId && t.user_id === currentUser.id
        ) ?? null
      );
    },
    [currentUser, dataset.tenants]
  );

  const triggerManualSync = useCallback(async (): Promise<void> => {
    await offlineQueue.syncQueue(syncTransactionHandler);
  }, [syncTransactionHandler]);

  const resetDemoState = useCallback(() => {
    const fresh = cloneSeedDataset();
    setDataset(fresh);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(DEMO_STORE_KEY);
      window.localStorage.removeItem(DEMO_SESSION_USER_ID_KEY);
      window.localStorage.removeItem(ACTIVE_EVENT_ID_KEY);
    }
    persistDemoSessionUser(null);
    setActiveEventId(null);
    void offlineQueue.clearQueue();
  }, [persistDemoSessionUser, setActiveEventId]);

  const value = useMemo<AppContextValue>(
    () => ({
      isLoading,
      isDemoMode,
      currentUser,
      activeViewMode,
      activeEventId,
      activeEvent,
      dataset,
      offlineStatus,
      userParticipants,
      userTenants,
      registerWithEmail,
      loginWithEmail,
      loginWithGoogle,
      loginWithDemoAccount,
      logout,
      switchViewMode,
      becomeMerchant,
      setActiveEventId,
      joinEventWithTicketUid,
      getParticipantForEvent,
      getTenantForEvent,
      triggerManualSync,
      resetDemoState,
    }),
    [
      isLoading,
      isDemoMode,
      currentUser,
      activeViewMode,
      activeEventId,
      activeEvent,
      dataset,
      offlineStatus,
      userParticipants,
      userTenants,
      registerWithEmail,
      loginWithEmail,
      loginWithGoogle,
      loginWithDemoAccount,
      logout,
      switchViewMode,
      becomeMerchant,
      setActiveEventId,
      joinEventWithTicketUid,
      getParticipantForEvent,
      getTenantForEvent,
      triggerManualSync,
      resetDemoState,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}