import type {
  OfflineBadgeState,
  OfflineQueueStatusSnapshot,
  OfflineQueuedTransaction,
  TransactionItemSummary,
} from '../types/types';

// ============================================================================
// CONSTANTS & TYPES
// ============================================================================

const DB_NAME = 'event_pos_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_transactions';
const AUTO_SYNC_INTERVAL_MS = 30_000;

export type SyncOutcome =
  | { outcome: 'synced' }
  | { outcome: 'retryable_error'; message: string }
  | { outcome: 'permanent_error'; message: string };

export type OfflineTransactionSyncHandler = (
  item: OfflineQueuedTransaction
) => Promise<SyncOutcome>;

export interface EnqueueOfflineTransactionInput {
  clientTxId?: string;
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
  itemSummary?: TransactionItemSummary[] | null;
  createdAt?: string;
}

export interface SyncBatchSummary {
  attempted: number;
  synced: number;
  retried: number;
  failed: number;
}

type QueueStatusListener = (snapshot: OfflineQueueStatusSnapshot) => void;

// ============================================================================
// IDEMPOTENT CLIENT TX ID GENERATOR
// ============================================================================

export function generateClientTxId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `pos-${cryptoApi.randomUUID()}`;
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `pos-${Date.now().toString(36)}-${rand}`;
}

export function isIndexedDbAvailable(): boolean {
  return typeof globalThis.indexedDB !== 'undefined';
}

function getNavigatorOnline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

// ============================================================================
// STORAGE ADAPTER (INDEXEDDB WITH TRANSPARENT IN-MEMORY FALLBACK FOR SSR/TESTS)
// ============================================================================

interface QueueStorageAdapter {
  put(record: OfflineQueuedTransaction): Promise<void>;
  get(clientTxId: string): Promise<OfflineQueuedTransaction | undefined>;
  getAll(): Promise<OfflineQueuedTransaction[]>;
  delete(clientTxId: string): Promise<void>;
  clear(): Promise<void>;
}

class MemoryQueueStorage implements QueueStorageAdapter {
  private readonly records = new Map<string, OfflineQueuedTransaction>();

  async put(record: OfflineQueuedTransaction): Promise<void> {
    this.records.set(record.clientTxId, { ...record });
  }

  async get(clientTxId: string): Promise<OfflineQueuedTransaction | undefined> {
    const found = this.records.get(clientTxId);
    return found ? { ...found } : undefined;
  }

  async getAll(): Promise<OfflineQueuedTransaction[]> {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  async delete(clientTxId: string): Promise<void> {
    this.records.delete(clientTxId);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

class IndexedDbQueueStorage implements QueueStorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDatabase(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'clientTxId' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('eventId', 'eventId', { unique: false });
          store.createIndex('tenantId', 'tenantId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error ?? new Error('Failed to open IndexedDB offline queue'));
      };
    });

    return this.dbPromise;
  }

  private runTransaction<T>(
    mode: IDBTransactionMode,
    executor: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    return this.openDatabase().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, mode);
          const store = tx.objectStore(STORE_NAME);
          const request = executor(store);

          let resultValue: T;
          request.onsuccess = () => {
            resultValue = request.result;
          };
          request.onerror = () => {
            reject(request.error ?? new Error('IndexedDB request failed'));
          };

          tx.oncomplete = () => resolve(resultValue);
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        })
    );
  }

  async put(record: OfflineQueuedTransaction): Promise<void> {
    await this.runTransaction('readwrite', (store) => store.put(record));
  }

  async get(clientTxId: string): Promise<OfflineQueuedTransaction | undefined> {
    return this.runTransaction('readonly', (store) => store.get(clientTxId));
  }

  async getAll(): Promise<OfflineQueuedTransaction[]> {
    const items = await this.runTransaction<OfflineQueuedTransaction[]>('readonly', (store) =>
      store.getAll()
    );
    return items ?? [];
  }

  async delete(clientTxId: string): Promise<void> {
    await this.runTransaction('readwrite', (store) => store.delete(clientTxId));
  }

  async clear(): Promise<void> {
    await this.runTransaction('readwrite', (store) => store.clear());
  }
}

// ============================================================================
// OFFLINE QUEUE MANAGER (FIFO AUTO-SYNC + STATUS SUBSCRIPTIONS)
// ============================================================================

export class OfflineQueueManager {
  private readonly storage: QueueStorageAdapter;
  private readonly listeners = new Set<QueueStatusListener>();
  private activeSyncPromise: Promise<SyncBatchSummary> | null = null;
  private lastSyncedAt: string | null = null;
  private autoSyncCleanup: (() => void) | null = null;

  constructor(customStorage?: QueueStorageAdapter) {
    if (customStorage) {
      this.storage = customStorage;
    } else {
      this.storage = isIndexedDbAvailable()
        ? new IndexedDbQueueStorage()
        : new MemoryQueueStorage();
    }
  }

  /**
   * Queues a POS transaction locally in IndexedDB with an idempotent `clientTxId`.
   */
  async enqueueTransaction(
    input: EnqueueOfflineTransactionInput
  ): Promise<OfflineQueuedTransaction> {
    const nowIso = new Date().toISOString();
    const record: OfflineQueuedTransaction = {
      clientTxId: input.clientTxId ?? generateClientTxId(),
      eventId: input.eventId,
      tenantId: input.tenantId,
      participantId: input.participantId,
      buyerQrCode: input.buyerQrCode.trim().toUpperCase(),
      buyerUsernameHint: input.buyerUsernameHint,
      actualAmountIdr: input.actualAmountIdr,
      leaderboardAmountIdr: input.leaderboardAmountIdr,
      multiplierApplied: input.multiplierApplied,
      hitHiddenBounty: input.hitHiddenBounty,
      hiddenBountyBonusIdr: input.hiddenBountyBonusIdr,
      isFlagged: input.isFlagged,
      flagReason: input.flagReason,
      itemSummary: input.itemSummary ?? null,
      status: 'pending',
      retryCount: 0,
      lastError: null,
      createdAt: input.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    await this.storage.put(record);
    await this.emitStatus();
    return record;
  }

  /**
   * Returns queued transactions sorted chronologically (FIFO) for deterministic replay.
   */
  async getQueuedTransactions(filter?: {
    eventId?: string;
    tenantId?: string;
  }): Promise<OfflineQueuedTransaction[]> {
    const all = await this.storage.getAll();
    const filtered = all.filter((item) => {
      if (filter?.eventId && item.eventId !== filter.eventId) return false;
      if (filter?.tenantId && item.tenantId !== filter.tenantId) return false;
      return true;
    });

    return filtered.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  /**
   * Computes current sync badge state (`synced`, `offline_queued`, `syncing`, or `error`)
   * and queue counts for the POS header badge.
   */
  async getQueueStatus(filter?: {
    eventId?: string;
    tenantId?: string;
  }): Promise<OfflineQueueStatusSnapshot> {
    const items = await this.getQueuedTransactions(filter);
    const isOnline = getNavigatorOnline();
    const isSyncing = this.activeSyncPromise !== null;

    let pendingCount = 0;
    let syncingCount = 0;
    let failedCount = 0;

    for (const item of items) {
      if (item.status === 'pending') pendingCount += 1;
      else if (item.status === 'syncing') syncingCount += 1;
      else if (item.status === 'failed') failedCount += 1;
    }

    let badgeState: OfflineBadgeState = 'synced';
    if (isSyncing || syncingCount > 0) {
      badgeState = 'syncing';
    } else if (failedCount > 0) {
      badgeState = 'error';
    } else if (!isOnline || pendingCount > 0) {
      badgeState = 'offline_queued';
    }

    return {
      isOnline,
      pendingCount,
      syncingCount,
      failedCount,
      totalQueuedCount: items.length,
      isSyncing,
      lastSyncedAt: this.lastSyncedAt,
      badgeState,
    };
  }

  /**
   * Mutex-locked FIFO queue processor. Replays pending items against the cloud backend
   * and removes successfully synced items from IndexedDB.
   */
  async syncQueue(syncHandler: OfflineTransactionSyncHandler): Promise<SyncBatchSummary> {
    if (this.activeSyncPromise) {
      return this.activeSyncPromise;
    }

    const runner = async (): Promise<SyncBatchSummary> => {
      const summary: SyncBatchSummary = {
        attempted: 0,
        synced: 0,
        retried: 0,
        failed: 0,
      };

      if (!getNavigatorOnline()) {
        await this.emitStatus();
        return summary;
      }

      const items = await this.getQueuedTransactions();
      // Recover any items left in 'syncing' state from an interrupted browser tab crash
      const actionable = items.filter(
        (item) => item.status === 'pending' || item.status === 'syncing'
      );

      if (actionable.length === 0) {
        await this.emitStatus();
        return summary;
      }

      for (const item of actionable) {
        if (!getNavigatorOnline()) {
          break;
        }

        summary.attempted += 1;
        await this.storage.put({
          ...item,
          status: 'syncing',
          updatedAt: new Date().toISOString(),
        });
        await this.emitStatus();

        try {
          const result = await syncHandler(item);
          if (result.outcome === 'synced') {
            await this.storage.delete(item.clientTxId);
            this.lastSyncedAt = new Date().toISOString();
            summary.synced += 1;
          } else if (result.outcome === 'permanent_error') {
            await this.storage.put({
              ...item,
              status: 'failed',
              retryCount: item.retryCount + 1,
              lastError: result.message,
              updatedAt: new Date().toISOString(),
            });
            summary.failed += 1;
          } else {
            await this.storage.put({
              ...item,
              status: 'pending',
              retryCount: item.retryCount + 1,
              lastError: result.message,
              updatedAt: new Date().toISOString(),
            });
            summary.retried += 1;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unexpected sync failure';
          await this.storage.put({
            ...item,
            status: 'pending',
            retryCount: item.retryCount + 1,
            lastError: message,
            updatedAt: new Date().toISOString(),
          });
          summary.retried += 1;
        }

        await this.emitStatus();
      }

      return summary;
    };

    this.activeSyncPromise = runner().finally(() => {
      this.activeSyncPromise = null;
      void this.emitStatus();
    });

    return this.activeSyncPromise;
  }

  /**
   * Resets permanently failed items back to `pending` and immediately attempts sync.
   */
  async retryFailedTransactions(
    syncHandler: OfflineTransactionSyncHandler
  ): Promise<SyncBatchSummary> {
    const all = await this.getQueuedTransactions();
    const nowIso = new Date().toISOString();

    for (const item of all) {
      if (item.status === 'failed') {
        await this.storage.put({
          ...item,
          status: 'pending',
          updatedAt: nowIso,
        });
      }
    }

    await this.emitStatus();
    return this.syncQueue(syncHandler);
  }

  async removeQueuedTransaction(clientTxId: string): Promise<void> {
    await this.storage.delete(clientTxId);
    await this.emitStatus();
  }

  async clearQueue(): Promise<void> {
    await this.storage.clear();
    await this.emitStatus();
  }

  subscribe(listener: QueueStatusListener): () => void {
    this.listeners.add(listener);
    void this.getQueueStatus().then((snapshot) => {
      if (this.listeners.has(listener)) {
        listener(snapshot);
      }
    });

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Attaches browser `online` / `offline` listeners and a periodic sync timer.
   * Returns an idempotent teardown callback.
   */
  startAutoSync(
    syncHandler: OfflineTransactionSyncHandler,
    intervalMs = AUTO_SYNC_INTERVAL_MS
  ): () => void {
    this.stopAutoSync();

    const handleOnline = () => {
      void this.emitStatus();
      void this.syncQueue(syncHandler);
    };

    const handleOffline = () => {
      void this.emitStatus();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    const timerId = globalThis.setInterval(() => {
      if (getNavigatorOnline()) {
        void this.syncQueue(syncHandler);
      }
    }, intervalMs);

    if (getNavigatorOnline()) {
      void this.syncQueue(syncHandler);
    }

    const teardown = () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
      globalThis.clearInterval(timerId);
      if (this.autoSyncCleanup === teardown) {
        this.autoSyncCleanup = null;
      }
    };

    this.autoSyncCleanup = teardown;
    return teardown;
  }

  stopAutoSync(): void {
    if (this.autoSyncCleanup) {
      this.autoSyncCleanup();
      this.autoSyncCleanup = null;
    }
  }

  private async emitStatus(): Promise<void> {
    if (this.listeners.size === 0) return;
    const snapshot = await this.getQueueStatus();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const offlineQueue = new OfflineQueueManager();