import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  AlertOctagon,
  AlertTriangle,
  Award,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Delete,
  Flashlight,
  Gift,
  Lock,
  QrCode,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  calculateDualIdrCheckout,
  extractEventQrCode,
  formatIdr,
  validateAntiFraudAndCooldown,
} from '../../lib/ledgerEngine';
import { generateClientTxId, offlineQueue } from '../../lib/offlineQueue';
import { soundFeedback } from '../../lib/soundFeedback';
import { apiClient } from '../../services/apiClient';
import type {
  DemoSeedDataset,
  Event,
  EventParticipant,
  Tenant,
  Transaction,
  TransactionItemSummary,
} from '../../types/types';

interface MerchantPosTerminalProps {
  event: Event;
  tenant: Tenant;
  dataset: DemoSeedDataset;
  onDatasetChange: (updater: (prev: DemoSeedDataset) => DemoSeedDataset) => void;
}

const QUICK_ADD_AMOUNTS = [10_000, 25_000, 50_000, 100_000] as const;

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

function formatSecondsMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const MerchantPosTerminal: React.FC<MerchantPosTerminalProps> = ({
  event,
  tenant,
  dataset,
  onDatasetChange,
}) => {
  const { currentUser, offlineStatus } = useApp();

  // Amount & Catalog Basket State
  const [amountIdr, setAmountIdr] = useState<number>(0);
  const [itemCart, setItemCart] = useState<TransactionItemSummary[]>([]);

  // Scanned / Selected Buyer State
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Camera Scanner State
  const [scannerActive, setScannerActive] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerMountId = useMemo(
    () => `qr-reader-${tenant.id.slice(0, 8)}`,
    [tenant.id]
  );

  // Sensory Feedback State (500ms border flash, mute, hidden bounty modal, status toast)
  const [borderFlash, setBorderFlash] = useState<'emerald' | 'crimson' | null>(null);
  const [soundMuted, setSoundMuted] = useState<boolean>(() => soundFeedback.getMuted());
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [lastReceiptBanner, setLastReceiptBanner] = useState<{
    type: 'success' | 'error' | 'offline';
    title: string;
    detail: string;
  } | null>(null);
  const [hiddenBountyAlert, setHiddenBountyAlert] = useState<{
    buyerName: string;
    bonusIdr: number;
  } | null>(null);

  // 1-second ticking clock for live 180s cooldown & bounty countdowns
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Void Modal State
  const [voidTargetTx, setVoidTargetTx] = useState<Transaction | null>(null);
  const [voidPinInput, setVoidPinInput] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);

  const userNameMap = useMemo(
    () => new Map(dataset.users.map((u) => [u.id, u.username])),
    [dataset.users]
  );

  const eventParticipants = useMemo(
    () => dataset.event_participants.filter((p) => p.event_id === event.id),
    [dataset.event_participants, event.id]
  );

  const activeCatalogItems = useMemo(
    () =>
      dataset.tenant_items
        .filter((i) => i.tenant_id === tenant.id && i.is_active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [dataset.tenant_items, tenant.id]
  );

  const boothTransactions = useMemo(
    () =>
      dataset.transactions
        .filter((tx) => tx.event_id === event.id && tx.tenant_id === tenant.id)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [dataset.transactions, event.id, tenant.id]
  );

  const selectedParticipant = useMemo(
    () => eventParticipants.find((p) => p.id === selectedParticipantId) ?? null,
    [eventParticipants, selectedParticipantId]
  );

  const selectedParticipantUsername = selectedParticipant
    ? userNameMap.get(selectedParticipant.user_id) ?? 'Attendee'
    : null;

  // Manual search candidates (QR code or Username)
  const searchCandidates = useMemo(() => {
    const q = manualQuery.trim().toLowerCase();
    if (!q) return [];
    return eventParticipants
      .filter((p) => {
        const uname = (userNameMap.get(p.user_id) ?? '').toLowerCase();
        return p.qr_code.toLowerCase().includes(q) || uname.includes(q);
      })
      .slice(0, 5);
  }, [manualQuery, eventParticipants, userNameMap]);

  // Live cooldown & anti-fraud preview for currently selected buyer
  const selectedBuyerGuardrail = useMemo(() => {
    if (!selectedParticipant) return null;
    const recentBuyerTxs = dataset.transactions.filter(
      (tx) =>
        tx.event_id === event.id && tx.participant_id === selectedParticipant.id
    );
    return validateAntiFraudAndCooldown({
      participantId: selectedParticipant.id,
      tenantId: tenant.id,
      actualAmountIdr: Math.max(1, amountIdr),
      recentParticipantTransactions: recentBuyerTxs,
      recentTenantTransactions: boothTransactions,
      now: nowMs,
    });
  }, [
    selectedParticipant,
    dataset.transactions,
    event.id,
    tenant.id,
    amountIdr,
    boothTransactions,
    nowMs,
  ]);

  const triggerBorderFlash = useCallback((color: 'emerald' | 'crimson') => {
    setBorderFlash(color);
    window.setTimeout(() => {
      setBorderFlash((current) => (current === color ? null : current));
    }, 500);
  }, []);

  const toggleSoundMute = () => {
    const next = !soundMuted;
    soundFeedback.setMuted(next);
    setSoundMuted(next);
  };

  // Amount Keypad Helpers
  const appendDigit = useCallback((digits: string) => {
    void soundFeedback.playTapTick();
    setAmountIdr((prev) => {
      const nextStr = `${prev === 0 ? '' : prev}${digits}`;
      const parsed = Number.parseInt(nextStr, 10);
      if (!Number.isSafeInteger(parsed) || parsed > 999_999_999) return prev;
      return parsed;
    });
  }, []);

  const backspaceDigit = useCallback(() => {
    void soundFeedback.playTapTick();
    setAmountIdr((prev) => Math.floor(prev / 10));
  }, []);

  const clearTransactionAmount = useCallback(() => {
    void soundFeedback.playTapTick();
    setAmountIdr(0);
    setItemCart([]);
  }, []);

  const addQuickAmount = useCallback((deltaIdr: number) => {
    void soundFeedback.playTapTick();
    setAmountIdr((prev) => Math.min(999_999_999, prev + deltaIdr));
  }, []);

  const tapCatalogItem = (item: (typeof activeCatalogItems)[number]) => {
    void soundFeedback.playTapTick();
    setAmountIdr((prev) => Math.min(999_999_999, prev + item.price_idr));
    setItemCart((prev) => {
      const existing = prev.find((c) => c.item_id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.item_id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          item_id: item.id,
          item_name: item.item_name,
          quantity: 1,
          unit_price_idr: item.price_idr,
        },
      ];
    });
  };

  // Handle Buyer Selection via QR Scan or Manual Lookup
  const selectBuyerByCodeOrId = useCallback(
    async (rawQrOrId: string) => {
      setLookupError(null);
      const extracted = extractEventQrCode(rawQrOrId);

      const matchByCode = eventParticipants.find(
        (p) =>
          p.id === rawQrOrId ||
          (extracted !== null && p.qr_code.toUpperCase() === extracted)
      );

      if (!matchByCode) {
        await soundFeedback.playErrorTone();
        triggerBorderFlash('crimson');
        setLookupError(
          `QR code "${rawQrOrId}" is not enrolled in ${event.name}.`
        );
        return;
      }

      setSelectedParticipantId(matchByCode.id);
      setManualQuery('');

      // Check immediate cooldown status on scan
      const recentTxs = dataset.transactions.filter(
        (tx) => tx.event_id === event.id && tx.participant_id === matchByCode.id
      );
      const check = validateAntiFraudAndCooldown({
        participantId: matchByCode.id,
        tenantId: tenant.id,
        actualAmountIdr: Math.max(1, amountIdr),
        recentParticipantTransactions: recentTxs,
      });

      if (check.cooldownBlocked) {
        await soundFeedback.playCooldownBuzz();
        triggerBorderFlash('crimson');
        setLastReceiptBanner({
          type: 'error',
          title: '3-Minute Cooldown Active',
          detail: `Wait ${formatSecondsMmSs(check.remainingCooldownSeconds)} before re-scanning ${userNameMap.get(matchByCode.user_id) ?? matchByCode.qr_code}.`,
        });
      } else {
        await soundFeedback.playTapTick();
      }
    },
    [
      eventParticipants,
      event.name,
      event.id,
      dataset.transactions,
      tenant.id,
      amountIdr,
      triggerBorderFlash,
      userNameMap,
    ]
  );

  // Built-in Camera QR Scanner Lifecycle (html5-qrcode)
  const stopCameraScanner = useCallback(async () => {
    const instance = scannerRef.current;
    scannerRef.current = null;
    setTorchOn(false);
    setTorchSupported(false);
    setScannerActive(false);

    if (instance) {
      try {
        if (instance.isScanning) {
          await instance.stop();
        }
        instance.clear();
      } catch {
        // Ignore scanner teardown race errors
      }
    }
  }, []);

  const startCameraScanner = useCallback(async () => {
    setCameraError(null);
    await soundFeedback.unlockAudioContext();
    setScannerActive(true);

    // Wait 1 frame for mount container div
    await new Promise((resolve) => window.setTimeout(resolve, 40));

    try {
      const scanner = new Html5Qrcode(scannerMountId);
      scannerRef.current = scanner;

      const onDecoded = (decodedText: string) => {
        const extracted = extractEventQrCode(decodedText);
        if (extracted) {
          void selectBuyerByCodeOrId(extracted);
          void stopCameraScanner();
        }
      };

      const scanConfig = { fps: 10, qrbox: { width: 220, height: 220 } };

      try {
        await scanner.start({ facingMode: 'environment' }, scanConfig, onDecoded, () => {});
      } catch {
        // Laptop/desktop webcam fallback if environment constraint unavailable
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || cameras.length === 0) {
          throw new Error('No camera device detected on this browser.');
        }
        await scanner.start(cameras[0].id, scanConfig, onDecoded, () => {});
      }

      try {
        const capabilities = scanner.getRunningTrackCapabilities() as MediaTrackCapabilities & {
          torch?: boolean;
        };
        setTorchSupported(Boolean(capabilities?.torch));
      } catch {
        setTorchSupported(false);
      }
    } catch (err) {
      setScannerActive(false);
      scannerRef.current = null;
      setCameraError(
        err instanceof Error
          ? err.message
          : 'Unable to access camera. Check permissions or use manual QR lookup.'
      );
    }
  }, [scannerMountId, selectBuyerByCodeOrId, stopCameraScanner]);

  const handleToggleTorch = async () => {
    const instance = scannerRef.current;
    if (!instance || !torchSupported) return;
    const next = !torchOn;
    try {
      await instance.applyVideoConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  useEffect(() => {
    return () => {
      void stopCameraScanner();
    };
  }, [stopCameraScanner]);

  // Complete Dual-IDR Checkout (Online RPC / Demo Engine + IndexedDB Offline Queue)
  const handleCompleteCheckout = useCallback(async () => {
    if (!selectedParticipant || amountIdr <= 0 || checkoutBusy) return;

    setCheckoutBusy(true);
    setLookupError(null);
    await soundFeedback.unlockAudioContext();

    try {
      const recentBuyerTxs = dataset.transactions.filter(
        (tx) =>
          tx.event_id === event.id && tx.participant_id === selectedParticipant.id
      );
      const existingStamp = dataset.stamps.some(
        (s) =>
          s.event_id === event.id &&
          s.participant_id === selectedParticipant.id &&
          s.tenant_id === tenant.id &&
          s.stamp_type === 'booth'
      );

      const calc = calculateDualIdrCheckout({
        actualAmountIdr: amountIdr,
        event,
        participant: selectedParticipant,
        tenant,
        recentParticipantTransactions: recentBuyerTxs,
        recentTenantTransactions: boothTransactions,
        existingBoothStamp: existingStamp,
        now: Date.now(),
      });

      if (!calc.allowed) {
        await soundFeedback.playCooldownBuzz();
        triggerBorderFlash('crimson');
        setLastReceiptBanner({
          type: 'error',
          title: 'Cooldown Block (180s Rule)',
          detail: calc.blockReason ?? 'Same-booth duplicate scan blocked.',
        });
        return;
      }

      const clientTxId = generateClientTxId();
      const buyerName = userNameMap.get(selectedParticipant.user_id) ?? selectedParticipant.qr_code;
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

      // Offline Queue Path: venue Wi-Fi dropped -> store in IndexedDB immediately
      if (!isOnline) {
        await offlineQueue.enqueueTransaction({
          clientTxId,
          eventId: event.id,
          tenantId: tenant.id,
          participantId: selectedParticipant.id,
          buyerQrCode: selectedParticipant.qr_code,
          buyerUsernameHint: buyerName,
          actualAmountIdr: calc.actualAmountIdr,
          leaderboardAmountIdr: calc.leaderboardAmountIdr,
          multiplierApplied: calc.multiplierApplied,
          hitHiddenBounty: calc.hiddenBounty.triggered,
          hiddenBountyBonusIdr: calc.hiddenBounty.bonusIdr,
          isFlagged: calc.cooldown.isFlagged,
          flagReason: calc.cooldown.flagDescription,
          itemSummary: itemCart.length > 0 ? itemCart : null,
        });

        await applyLocalTransactionState(calc, clientTxId);
        await soundFeedback.playSuccessChime();
        triggerBorderFlash('emerald');
        setLastReceiptBanner({
          type: 'offline',
          title: `Queued Offline (${formatIdr(calc.actualAmountIdr)})`,
          detail: `Saved to IndexedDB for ${buyerName}. Will auto-sync when connection returns.`,
        });
        resetCheckoutInputs();
        return;
      }

      const checkoutRes = await apiClient.processPosCheckout({
        client_tx_id: clientTxId,
        event_id: event.id,
        tenant_id: tenant.id,
        buyer_qr_code: selectedParticipant.qr_code,
        actual_amount_idr: amountIdr,
        item_summary: itemCart.length > 0 ? itemCart : null,
      });

      onDatasetChange((prev) => ({
        ...prev,
        transactions: [
          checkoutRes.transaction,
          ...prev.transactions.filter((tx) => tx.id !== checkoutRes.transaction.id),
        ],
        event_participants: prev.event_participants.map((p) =>
          p.id === checkoutRes.participant.id ? checkoutRes.participant : p
        ),
        tenants: prev.tenants.map((t) =>
          t.id === checkoutRes.tenant.id ? checkoutRes.tenant : t
        ),
        stamps: checkoutRes.unlocked_stamp
          ? [...prev.stamps, checkoutRes.unlocked_stamp]
          : prev.stamps,
        users: prev.users.map((u) => {
          if (u.id === selectedParticipant.user_id) {
            return {
              ...u,
              lifetime_actual_spent_idr:
                u.lifetime_actual_spent_idr + checkoutRes.transaction.actual_amount_idr,
            };
          }
          if (u.id === tenant.user_id) {
            return {
              ...u,
              lifetime_sales_idr:
                u.lifetime_sales_idr + checkoutRes.transaction.actual_amount_idr,
            };
          }
          return u;
        }),
      }));

      if (checkoutRes.hidden_bounty_triggered) {
        await soundFeedback.playBountyFanfare();
        setHiddenBountyAlert({
          buyerName,
          bonusIdr: checkoutRes.hidden_bounty_bonus_idr,
        });
      } else {
        await soundFeedback.playSuccessChime();
      }

      triggerBorderFlash('emerald');
      setLastReceiptBanner({
        type: 'success',
        title: `Sale Completed: ${formatIdr(checkoutRes.transaction.actual_amount_idr)}`,
        detail: `${buyerName} (+${formatIdr(checkoutRes.transaction.leaderboard_amount_idr)} Leaderboard IDR${
          checkoutRes.transaction.multiplier_applied > 1
            ? ` @ ${checkoutRes.transaction.multiplier_applied}x`
            : ''
        })${checkoutRes.unlocked_stamp ? ' • Booth Stamp Unlocked!' : ''}`,
      });
      resetCheckoutInputs();
    } catch (err) {
      await soundFeedback.playErrorTone();
      triggerBorderFlash('crimson');
      setLastReceiptBanner({
        type: 'error',
        title: 'Checkout Rejected',
        detail: err instanceof Error ? err.message : 'Unable to process transaction.',
      });
    } finally {
      setCheckoutBusy(false);
    }

    function resetCheckoutInputs() {
      setAmountIdr(0);
      setItemCart([]);
      setSelectedParticipantId(null);
    }

    async function applyLocalTransactionState(
      calc: ReturnType<typeof calculateDualIdrCheckout>,
      clientTxId: string
    ) {
      const txTimestamp = new Date().toISOString();
      const newTx: Transaction = {
        id: createUuid(),
        client_tx_id: clientTxId,
        event_id: event.id,
        participant_id: selectedParticipant!.id,
        tenant_id: tenant.id,
        actual_amount_idr: calc.actualAmountIdr,
        leaderboard_amount_idr: calc.leaderboardAmountIdr,
        multiplier_applied: calc.multiplierApplied,
        hit_hidden_bounty: calc.hiddenBounty.triggered,
        hidden_bounty_bonus_idr: calc.hiddenBounty.bonusIdr,
        status: 'completed',
        is_flagged: calc.cooldown.isFlagged,
        flag_reason: calc.cooldown.flagDescription,
        item_summary: itemCart.length > 0 ? itemCart : null,
        voided_at: null,
        voided_by_user_id: null,
        created_at: txTimestamp,
      };

      onDatasetChange((prev) => ({
        ...prev,
        transactions: [newTx, ...prev.transactions],
        event_participants: prev.event_participants.map((p) =>
          p.id === selectedParticipant!.id
            ? {
                ...p,
                actual_spent_idr: calc.newParticipantActualSpentIdr,
                leaderboard_idr: calc.newParticipantLeaderboardIdr,
                streak_expires_at: calc.newStreakExpiresAt,
                updated_at: txTimestamp,
              }
            : p
        ),
        tenants: prev.tenants.map((t) =>
          t.id === tenant.id
            ? {
                ...t,
                event_sales_idr: t.event_sales_idr + calc.actualAmountIdr,
                unique_stamps_count:
                  t.unique_stamps_count + (calc.shouldUnlockBoothStamp ? 1 : 0),
                updated_at: txTimestamp,
              }
            : t
        ),
        stamps: calc.shouldUnlockBoothStamp
          ? [
              ...prev.stamps,
              {
                id: createUuid(),
                event_id: event.id,
                participant_id: selectedParticipant!.id,
                tenant_id: tenant.id,
                stamp_type: 'booth',
                unlocked_at: txTimestamp,
              },
            ]
          : prev.stamps,
        users: prev.users.map((u) => {
          if (u.id === selectedParticipant!.user_id) {
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
      }));
    }
  }, [
    selectedParticipant,
    amountIdr,
    checkoutBusy,
    dataset.transactions,
    dataset.stamps,
    event,
    tenant,
    boothTransactions,
    triggerBorderFlash,
    userNameMap,
    itemCart,
    onDatasetChange,
  ]);

  // Physical Keyboard Numpad Support (0-9, Backspace, Escape -> Clear, Enter -> Submit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (voidTargetTx || hiddenBountyAlert) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspaceDigit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearTransactionAmount();
      } else if (e.key === 'Enter' && selectedParticipant && amountIdr > 0) {
        e.preventDefault();
        void handleCompleteCheckout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    appendDigit,
    backspaceDigit,
    clearTransactionAmount,
    handleCompleteCheckout,
    selectedParticipant,
    amountIdr,
    voidTargetTx,
    hiddenBountyAlert,
  ]);

  // Organizer-PIN-Protected Transaction Void
  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTargetTx) return;
    setVoidError(null);
    setVoidBusy(true);

    try {
      const reverseRes = await apiClient.reversePosTransaction(
        {
          transaction_id: voidTargetTx.id,
          admin_void_pin: voidPinInput.trim(),
        },
        currentUser?.id
      );

      onDatasetChange((prev) => ({
        ...prev,
        transactions: prev.transactions.map((tx) =>
          tx.id === reverseRes.transaction.id ? reverseRes.transaction : tx
        ),
        event_participants: prev.event_participants.map((p) =>
          p.id === reverseRes.participant.id ? reverseRes.participant : p
        ),
        tenants: prev.tenants.map((t) =>
          t.id === reverseRes.tenant.id ? reverseRes.tenant : t
        ),
        stamps: reverseRes.reversed_stamp_id
          ? prev.stamps.filter((s) => s.id !== reverseRes.reversed_stamp_id)
          : prev.stamps,
      }));

      await soundFeedback.playTapTick();
      setVoidTargetTx(null);
      setVoidPinInput('');
      setLastReceiptBanner({
        type: 'success',
        title: `Voided ${formatIdr(reverseRes.deduct_actual_idr)}`,
        detail: `Deducted Dual-IDR totals${
          reverseRes.reversed_stamp_id ? ' & reversed booth stamp.' : '.'
        }`,
      });
    } catch (err) {
      await soundFeedback.playErrorTone();
      const raw = err instanceof Error ? err.message : 'Void failed.';
      setVoidError(
        raw.includes('INVALID_VOID_PIN') ? 'Invalid Organizer Admin PIN.' : raw
      );
    } finally {
      setVoidBusy(false);
    }
  };

  return (
    <>
      {/* 500ms Full-Screen Border Flash Overlay */}
      {borderFlash && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed inset-0 z-50 border-[10px] transition-opacity duration-300 ${
            borderFlash === 'emerald' ? 'border-emerald-400' : 'border-rose-500'
          }`}
        />
      )}

      {/* POS Header Status Strip */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-lg bg-emerald-500/20 px-2.5 py-1 font-mono text-xs font-bold text-emerald-300">
            {tenant.booth_number}
          </span>
          <span className="text-sm font-bold text-white">{tenant.booth_name}</span>
          {tenant.is_cold_bounty && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
              <Sparkles className="h-3 w-3" />
              Cold-Booth {tenant.cold_bounty_multiplier}x Active
            </span>
          )}
          {tenant.is_hidden_bounty && (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 py-0.5 text-[11px] font-bold text-violet-200">
              <Gift className="h-3 w-3" />
              Hidden Bounty Active
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* IndexedDB Offline Queue Badge */}
          {offlineStatus.badgeState === 'offline_queued' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">
              <WifiOff className="h-3.5 w-3.5" />
              Offline — {offlineStatus.pendingCount} Scans Queued
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Synced
            </span>
          )}

          <button
            type="button"
            onClick={toggleSoundMute}
            className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"
            title={soundMuted ? 'Unmute POS Chimes' : 'Mute POS Chimes'}
            aria-label={soundMuted ? 'Unmute POS Chimes' : 'Mute POS Chimes'}
          >
            {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {lastReceiptBanner && (
        <div
          className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            lastReceiptBanner.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
              : lastReceiptBanner.type === 'offline'
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-100'
                : 'border-rose-500/40 bg-rose-500/15 text-rose-100'
          }`}
        >
          <div>
            <p className="text-sm font-bold">{lastReceiptBanner.title}</p>
            <p className="opacity-90">{lastReceiptBanner.detail}</p>
          </div>
          <button
            type="button"
            onClick={() => setLastReceiptBanner(null)}
            className="rounded p-1 hover:bg-black/20"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Split-Screen POS Workspace (Desktop 12-Col, Stacked on Mobile) */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN: IDR Display, Quick-Tap Catalog & Numpad */}
        <div className="space-y-4 lg:col-span-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold uppercase tracking-wider">
                Transaction Amount (IDR)
              </span>
              <span>Stamp min: {formatIdr(event.min_stamp_spend_idr)}</span>
            </div>

            <div className="mt-2 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-4">
              <span className="font-mono text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                {formatIdr(amountIdr)}
              </span>
              <button
                type="button"
                onClick={clearTransactionAmount}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Clear (Esc)
              </button>
            </div>

            {/* Stamp Eligibility Pill */}
            <div className="mt-2 flex items-center justify-between text-xs">
              {amountIdr >= event.min_stamp_spend_idr ? (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Qualifies for Booth Stamp
                </span>
              ) : (
                <span className="text-slate-400">
                  Add {formatIdr(event.min_stamp_spend_idr - amountIdr)} more to unlock buyer
                  stamp
                </span>
              )}
              <span className="text-slate-500">Keyboard 0–9 supported</span>
            </div>

            {/* Active Catalog Basket Chips */}
            {itemCart.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                {itemCart.map((c) => (
                  <span
                    key={c.item_name}
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-500/20 px-2 py-1 text-[11px] font-semibold text-indigo-200"
                  >
                    {c.quantity}&times; {c.item_name}
                  </span>
                ))}
              </div>
            )}

            {/* Quick-Add IDR Presets */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {QUICK_ADD_AMOUNTS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => addQuickAmount(val)}
                  className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 py-2 text-xs font-bold text-indigo-200 transition hover:bg-indigo-500/20 active:scale-95"
                >
                  +{formatIdr(val)}
                </button>
              ))}
            </div>

            {/* 1-Tap Booth Merchandise Catalog */}
            {activeCatalogItems.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Quick-Tap Booth Items
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {activeCatalogItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => tapCatalogItem(item)}
                      className="flex flex-col items-start rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 text-left transition hover:border-emerald-500/50 hover:bg-slate-800 active:scale-95"
                    >
                      <span className="line-clamp-1 text-xs font-semibold text-white">
                        {item.item_name}
                      </span>
                      <span className="mt-0.5 font-mono text-xs font-bold text-emerald-300">
                        {formatIdr(item.price_idr)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Touch Numpad */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => appendDigit(key)}
                  className="rounded-xl border border-slate-800 bg-slate-950 py-3 font-mono text-lg font-bold text-white transition hover:bg-slate-800 active:scale-95"
                >
                  {key}
                </button>
              ))}
              <button
                type="button"
                onClick={backspaceDigit}
                className="flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950 py-3 text-slate-300 transition hover:bg-slate-800 active:scale-95"
                aria-label="Backspace digit"
              >
                <Delete className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Camera QR Scanner, Buyer Checkout & Live Order Feed */}
        <div className="space-y-4 lg:col-span-6">
          {/* Buyer QR Scanner & Manual Lookup Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-emerald-400" />
                <h2 className="text-base font-bold text-white">Scan Buyer QR Badge</h2>
              </div>

              <div className="flex items-center gap-2">
                {scannerActive && (
                  <button
                    type="button"
                    disabled={!torchSupported}
                    onClick={() => void handleToggleTorch()}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                      torchOn
                        ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                        : 'border-slate-700 bg-slate-800 text-slate-300 disabled:opacity-40'
                    }`}
                    title={
                      torchSupported
                        ? 'Toggle Flashlight / Torch'
                        : 'Flashlight unavailable on this camera'
                    }
                  >
                    <Flashlight className="h-3.5 w-3.5" />
                    <span>{torchOn ? 'Torch On' : 'Torch'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    scannerActive ? void stopCameraScanner() : void startCameraScanner()
                  }
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold text-white transition ${
                    scannerActive
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {scannerActive ? (
                    <>
                      <CameraOff className="h-3.5 w-3.5" />
                      Stop Camera
                    </>
                  ) : (
                    <>
                      <Camera className="h-3.5 w-3.5" />
                      Open Camera Scanner
                    </>
                  )}
                </button>
              </div>
            </div>

            {cameraError && (
              <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
                {cameraError}
              </div>
            )}

            {/* Live Camera Preview Mount */}
            {scannerActive && (
              <div className="mt-3 overflow-hidden rounded-xl border border-indigo-500/40 bg-black">
                <div id={scannerMountId} className="w-full" />
              </div>
            )}

            {/* Manual QR / Username Fallback Search */}
            <div className="mt-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={manualQuery}
                  onChange={(e) => {
                    setManualQuery(e.target.value);
                    setLookupError(null);
                  }}
                  placeholder="Manual fallback: search Username or EV-XXXXXX..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {lookupError && (
                <p className="mt-1.5 text-xs font-medium text-rose-300">{lookupError}</p>
              )}

              {searchCandidates.length > 0 && (
                <div className="mt-2 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950">
                  {searchCandidates.map((cand: EventParticipant) => (
                    <button
                      key={cand.id}
                      type="button"
                      onClick={() => void selectBuyerByCodeOrId(cand.qr_code)}
                      className="flex w-full items-center justify-between px-3.5 py-2 text-left text-xs hover:bg-slate-800"
                    >
                      <span className="font-semibold text-white">
                        {userNameMap.get(cand.user_id) ?? 'Attendee'}
                      </span>
                      <span className="font-mono font-bold text-indigo-300">
                        {cand.qr_code}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Buyer Summary & Cooldown Countdown */}
            {selectedParticipant && (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-400">Selected Buyer</p>
                    <p className="text-base font-bold text-white">
                      {selectedParticipantUsername}{' '}
                      <span className="ml-1 font-mono text-xs text-indigo-300">
                        ({selectedParticipant.qr_code})
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedParticipantId(null)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                    aria-label="Clear selected buyer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {selectedBuyerGuardrail?.cooldownBlocked ? (
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
                    <div className="flex items-center gap-2 font-semibold">
                      <Clock className="h-4 w-4 text-rose-400" />
                      <span>Same-Booth 3-Min Cooldown Active</span>
                    </div>
                    <span className="font-mono text-sm font-extrabold text-rose-300">
                      {formatSecondsMmSs(selectedBuyerGuardrail.remainingCooldownSeconds)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Ready for checkout</span>
                    {selectedBuyerGuardrail?.isFlagged && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                        <AlertTriangle className="h-3 w-3" />
                        Will flag rapid-fire anomaly
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Primary Charge Button */}
            <button
              type="button"
              disabled={
                !selectedParticipant ||
                amountIdr <= 0 ||
                checkoutBusy ||
                Boolean(selectedBuyerGuardrail?.cooldownBlocked)
              }
              onClick={() => void handleCompleteCheckout()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-indigo-600 px-4 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span>
                {checkoutBusy
                  ? 'Processing...'
                  : selectedParticipant
                    ? `Complete Sale • ${formatIdr(amountIdr)}`
                    : 'Scan or Select Buyer to Charge'}
              </span>
            </button>
          </div>

          {/* Live Booth Order Feed (with PIN-Protected Voids) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                Booth Live Order Feed ({boothTransactions.length})
              </h3>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <Lock className="h-3 w-3" />
                Voids require Organizer PIN
              </span>
            </div>

            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {boothTransactions.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  No orders recorded at this booth yet.
                </p>
              ) : (
                boothTransactions.slice(0, 20).map((tx) => {
                  const part = eventParticipants.find((p) => p.id === tx.participant_id);
                  const buyerLabel = part
                    ? userNameMap.get(part.user_id) ?? part.qr_code
                    : 'Buyer';
                  const isVoided = tx.status === 'voided';

                  return (
                    <div
                      key={tx.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${
                        isVoided
                          ? 'border-slate-800/60 bg-slate-950/30 opacity-55'
                          : 'border-slate-800 bg-slate-950/75'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`font-bold ${
                              isVoided ? 'line-through text-slate-400' : 'text-white'
                            }`}
                          >
                            {buyerLabel}
                          </span>
                          {part && (
                            <span className="font-mono text-[10px] text-slate-400">
                              {part.qr_code}
                            </span>
                          )}
                          {tx.multiplier_applied > 1 && !isVoided && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                              {tx.multiplier_applied}x
                            </span>
                          )}
                          {tx.hit_hidden_bounty && !isVoided && (
                            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
                              Bounty
                            </span>
                          )}
                          {tx.is_flagged && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300"
                              title={tx.flag_reason ?? 'Flagged anomaly'}
                            >
                              <ShieldAlert className="h-3 w-3" />
                              Flagged
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {new Date(tx.created_at).toLocaleTimeString('id-ID', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {isVoided && ' • VOIDED'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span
                          className={`font-mono text-sm font-extrabold ${
                            isVoided ? 'line-through text-slate-500' : 'text-emerald-300'
                          }`}
                        >
                          {formatIdr(tx.actual_amount_idr)}
                        </span>

                        {!isVoided && (
                          <button
                            type="button"
                            onClick={() => {
                              setVoidTargetTx(tx);
                              setVoidPinInput('');
                              setVoidError(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/25"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Void
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Hourly Hidden Bounty Celebratory Alert Modal */}
      {hiddenBountyAlert && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border-2 border-amber-400 bg-gradient-to-br from-amber-950/80 via-slate-900 to-violet-950/80 p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-300 ring-2 ring-amber-400/50">
              <Award className="h-8 w-8" />
            </div>
            <h3 className="mt-3 text-xl font-extrabold text-amber-300">
              HOURLY HIDDEN BOUNTY HIT!
            </h3>
            <p className="mt-2 text-sm text-white">
              <strong>{hiddenBountyAlert.buyerName}</strong> triggered this booth&apos;s secret
              hourly bounty!
            </p>
            <div className="mt-4 rounded-xl border border-amber-400/40 bg-slate-950/70 p-3.5 text-xs text-amber-100">
              <p className="font-bold">Cashier Action:</p>
              <p className="mt-1">
                Award a surprise physical prize at the counter!{' '}
                {hiddenBountyAlert.bonusIdr > 0 && (
                  <>
                    A flat <strong>+{formatIdr(hiddenBountyAlert.bonusIdr)}</strong> bonus was
                    also added to their Leaderboard IDR.
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHiddenBountyAlert(null)}
              className="mt-5 w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
            >
              Awesome — Prize Awarded!
            </button>
          </div>
        </div>
      )}

      {/* Organizer Admin PIN Void Confirmation Modal */}
      {voidTargetTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/40 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-300">
              <AlertOctagon className="h-5 w-5" />
              <h3 className="text-base font-bold text-white">PIN-Protected Void</h3>
            </div>
            <p className="mt-2 text-xs text-slate-300">
              Voiding <strong>{formatIdr(voidTargetTx.actual_amount_idr)}</strong> automatically
              deducts Dual-IDR totals and reverses any stamp unlocked solely by this order.
            </p>

            {voidError && (
              <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
                {voidError}
              </div>
            )}

            <form onSubmit={handleConfirmVoid} className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="void-admin-pin"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400"
                >
                  Organizer Admin Void PIN
                </label>
                <input
                  id="void-admin-pin"
                  type="password"
                  inputMode="numeric"
                  required
                  value={voidPinInput}
                  onChange={(e) => setVoidPinInput(e.target.value)}
                  placeholder="Enter Admin PIN (Demo: 123456)"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setVoidTargetTx(null)}
                  className="rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={voidBusy}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-60"
                >
                  {voidBusy ? 'Voiding...' : 'Authorize Void'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};