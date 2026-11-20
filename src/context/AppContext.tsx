import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { offlineQueue, type SyncOutcome } from '../lib/offlineQueue';
import {
  API_BASE_URL,
  ApiHttpError,
  apiClient,
  isRemoteApiConfigured,
  loadLocalDataset,
  saveLocalDataset,
  setLocalSessionUserId,
  type DemoPresetRole,
} from '../services/apiClient';
import type {
  DemoSeedDataset,
  Event,
  EventParticipant,
  OfflineQueueStatusSnapshot,
  OfflineQueuedTransaction,
  Stamp,
  Tenant,
  TicketRoleType,
  User,
  ViewMode,
} from '../types/types';

export type { DemoPresetRole } from '../services/apiClient';

// ============================================================================
// LOCAL SESSION STORAGE KEYS
// ============================================================================

const ACTIVE_EVENT_ID_KEY = 'rallypos_active_event_id_v1';

// ============================================================================
// CONTEXT CONTRACTS
// ============================================================================

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

  // Dataset State & Sync Utilities
  updateDataset: (updater: (prev: DemoSeedDataset) => DemoSeedDataset) => void;
  refreshDataset: () => Promise<void>;
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
  const [dataset, setDataset] = useState<DemoSeedDataset>(() => loadLocalDataset());
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('rallypos_demo_session_user_id_v1');
  });
  const [activeEventId, setActiveEventIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACTIVE_EVENT_ID_KEY);
  });
  const [isLoading, setIsLoading] = useState<boolean>(isRemoteApiConfigured);
  const [isFallbackMode, setIsFallbackMode] = useState<boolean>(
    !isRemoteApiConfigured
  );
  const [offlineStatus, setOfflineStatus] =
    useState<OfflineQueueStatusSnapshot>(INITIAL_OFFLINE_STATUS);

  const isDemoMode = !isRemoteApiConfigured || isFallbackMode;

  const updateDataset = useCallback(
    (updater: (prev: DemoSeedDataset) => DemoSeedDataset) => {
      setDataset((prev) => {
        const next = updater(prev);
        if (isDemoMode) {
          saveLocalDataset(next);
        }
        return next;
      });
    },
    [isDemoMode]
  );

  // Hydrate events & participant state via REST API client (with automatic local fallback)
  const refreshDataset = useCallback(async () => {
    const res = await apiClient.getEvents();
    setIsFallbackMode(apiClient.isFallbackActive());
    setDataset((prev) => {
      const mergedUsers =
        Array.isArray(res.users) && res.users.length > 0 ? res.users : prev.users;
      return {
        users: mergedUsers,
        events: res.events ?? prev.events,
        ticket_uids: res.ticket_uids ?? prev.ticket_uids,
        event_participants: res.participants ?? prev.event_participants,
        tenants: res.tenants ?? prev.tenants,
        tenant_items: res.tenant_items ?? prev.tenant_items,
        stamps: res.stamps ?? prev.stamps,
        transactions: res.transactions ?? prev.transactions,
        event_chat_messages: res.meetups ?? prev.event_chat_messages,
      };
    });
  }, []);

  // Bootstrap session & events on initial mount
  useEffect(() => {
    let mounted = true;

    const initApp = async () => {
      try {
        const sessionRes = await apiClient.getSession();
        if (mounted && sessionRes.user) {
          const user = sessionRes.user;
          setCurrentUserId(user.id);
          setDataset((prev) => {
            const exists = prev.users.some((u) => u.id === user.id);
            return {
              ...prev,
              users: exists
                ? prev.users.map((u) => (u.id === user.id ? user : u))
                : [...prev.users, user],
            };
          });
        }
        await refreshDataset();
        if (mounted) {
          setIsFallbackMode(apiClient.isFallbackActive());
        }
      } catch {
        if (mounted) {
          setIsFallbackMode(apiClient.isFallbackActive());
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void initApp();

    return () => {
      mounted = false;
    };
  }, [refreshDataset]);

  // Offline Queue Subscription & Auto-Sync
  const syncTransactionHandler = useCallback(
    async (queued: OfflineQueuedTransaction): Promise<SyncOutcome> => {
      try {
        await apiClient.processPosCheckout({
          client_tx_id: queued.clientTxId,
          event_id: queued.eventId,
          tenant_id: queued.tenantId,
          buyer_qr_code: queued.buyerQrCode,
          actual_amount_idr: queued.actualAmountIdr,
          item_summary: queued.itemSummary,
        });
        setIsFallbackMode(apiClient.isFallbackActive());
        return { outcome: 'synced' };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed';
        if (
          err instanceof ApiHttpError &&
          err.status >= 400 &&
          err.status < 500 &&
          (message.includes('COOLDOWN_ACTIVE') ||
            message.includes('not registered') ||
            message.includes('not active'))
        ) {
          return { outcome: 'permanent_error', message };
        }
        if (
          message.includes('COOLDOWN_ACTIVE') ||
          message.includes('not registered') ||
          message.includes('not active')
        ) {
          return { outcome: 'permanent_error', message };
        }
        return { outcome: 'retryable_error', message };
      }
    },
    []
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

  const persistSessionUser = useCallback((userId: string | null) => {
    setCurrentUserId(userId);
    setLocalSessionUserId(userId);
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

      const { user } = await apiClient.register({
        email: normalizedEmail,
        username: cleanUsername,
        password,
      });
      setIsFallbackMode(apiClient.isFallbackActive());

      setDataset((prev) => {
        const exists = prev.users.some((u) => u.id === user.id);
        return {
          ...prev,
          users: exists
            ? prev.users.map((u) => (u.id === user.id ? user : u))
            : [...prev.users, user],
        };
      });
      persistSessionUser(user.id);
      await refreshDataset();
      return user;
    },
    [persistSessionUser, refreshDataset]
  );

  const loginWithEmail = useCallback(
    async ({ email, password }: LoginPayload): Promise<User> => {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new Error('Please enter a valid email address.');
      }
      if (password.length < 1) {
        throw new Error('Please enter your password.');
      }

      const { user } = await apiClient.login({
        email: normalizedEmail,
        password,
      });
      setIsFallbackMode(apiClient.isFallbackActive());

      setDataset((prev) => {
        const exists = prev.users.some((u) => u.id === user.id);
        return {
          ...prev,
          users: exists
            ? prev.users.map((u) => (u.id === user.id ? user : u))
            : [...prev.users, user],
        };
      });
      persistSessionUser(user.id);
      await refreshDataset();
      return user;
    },
    [persistSessionUser, refreshDataset]
  );

  const loginWithGoogle = useCallback(async (): Promise<void> => {
    if (!isRemoteApiConfigured || isFallbackMode) {
      throw new Error(
        'Google OAuth requires a running backend configured via VITE_API_BASE_URL. Use "Launch Demo Preview" for instant standalone testing.'
      );
    }
    window.location.assign(
      `${API_BASE_URL}/api/auth/google?redirect=${encodeURIComponent(
        `${window.location.origin}/events`
      )}`
    );
  }, [isFallbackMode]);

  const loginWithDemoAccount = useCallback(
    async (preset: DemoPresetRole = 'fresh_buyer'): Promise<User> => {
      const { user } = await apiClient.loginDemo(preset);
      setIsFallbackMode(apiClient.isFallbackActive());

      setDataset((prev) => {
        const exists = prev.users.some((u) => u.id === user.id);
        return {
          ...prev,
          users: exists
            ? prev.users.map((u) => (u.id === user.id ? user : u))
            : [...prev.users, user],
        };
      });
      persistSessionUser(user.id);
      await refreshDataset();
      return user;
    },
    [persistSessionUser, refreshDataset]
  );

  const logout = useCallback(async (): Promise<void> => {
    await apiClient.logout();
    persistSessionUser(null);
    setActiveEventId(null);
  }, [persistSessionUser, setActiveEventId]);

  // --------------------------------------------------------------------------
  // BUYER <-> MERCHANT WORKSPACE MODE SWITCHER & ONBOARDING
  // --------------------------------------------------------------------------

  const switchViewMode = useCallback(
    async (mode: ViewMode): Promise<void> => {
      if (!currentUser) return;
      if (mode === 'merchant' && !currentUser.is_merchant) {
        throw new Error('Complete "Unlock Your Booth" onboarding first.');
      }

      const { user: updatedUser } = await apiClient.switchViewMode(
        mode,
        currentUser.id
      );
      setIsFallbackMode(apiClient.isFallbackActive());

      updateDataset((prev) => ({
        ...prev,
        users: prev.users.map((u) =>
          u.id === currentUser.id ? updatedUser : u
        ),
      }));
    },
    [currentUser, updateDataset]
  );

  // --------------------------------------------------------------------------
  // TICKET CODE CHECK-IN GATE (ENROLLS USER, MINTS EV-XXXXXX QR & STAMP #1)
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
        throw new Error('Please enter your Event Ticket Code.');
      }

      const res = await apiClient.checkInEvent(
        eventId,
        {
          uid_code: normalizedCode,
          booth_name: boothName,
          booth_number: boothNumber,
          booth_bio: currentUser.merchant_bio ?? '',
        },
        currentUser.id
      );
      setIsFallbackMode(apiClient.isFallbackActive());

      // Synchronize full dataset state cleanly
      if (apiClient.isFallbackActive()) {
        setDataset(loadLocalDataset());
      } else {
        await refreshDataset();
      }

      setActiveEventId(eventId);
      return {
        event: res.event,
        roleType: res.role_type,
        participant: res.participant,
        tenant: res.tenant,
        checkInStamp: res.check_in_stamp,
        isNewJoin: res.is_new_join,
      };
    },
    [currentUser, refreshDataset, setActiveEventId]
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
        throw new Error('Please enter a valid Booth Event Ticket Code.');
      }

      const res = await apiClient.linkBooth(
        eventId,
        {
          uid_code: normalizedCode,
          booth_name: cleanBrand,
          booth_number: boothNumber,
          bio: cleanBio,
        },
        currentUser.id
      );
      setIsFallbackMode(apiClient.isFallbackActive());

      if (apiClient.isFallbackActive()) {
        setDataset(loadLocalDataset());
      } else {
        await refreshDataset();
      }

      setActiveEventId(eventId);
      return { user: res.user, tenant: res.tenant };
    },
    [currentUser, refreshDataset, setActiveEventId]
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
    apiClient.resetLocalState();
    const fresh = loadLocalDataset();
    setDataset(fresh);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ACTIVE_EVENT_ID_KEY);
    }
    persistSessionUser(null);
    setActiveEventId(null);
    void offlineQueue.clearQueue();
  }, [persistSessionUser, setActiveEventId]);

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
      updateDataset,
      refreshDataset,
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
      updateDataset,
      refreshDataset,
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