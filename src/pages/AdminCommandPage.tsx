import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  Flame,
  Gift,
  KeyRound,
  Play,
  Plus,
  Radar,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  Shuffle,
  Sparkles,
  Ticket,
  Upload,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatIdr, parseIdrInput } from '../lib/ledgerEngine';
import { soundFeedback } from '../lib/soundFeedback';
import { apiClient } from '../services/apiClient';
import type {
  DemoSeedDataset,
  Event,
  TicketRoleType,
  Transaction,
} from '../types/types';

type AdminTab = 'lifecycle' | 'tickets' | 'radar' | 'bounty_fraud';

function csvEscape(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const AdminCommandPage: React.FC = () => {
  const { currentUser, dataset, updateDataset } = useApp();
  const liveDataset = dataset;

  const updateLiveDataset = (updater: (prev: DemoSeedDataset) => DemoSeedDataset) => {
    updateDataset(updater);
  };

  const [activeTab, setActiveTab] = useState<AdminTab>('radar');
  const [selectedEventId, setSelectedEventId] = useState<string>(() => {
    const active = liveDataset.events.find((e) => e.status === 'active');
    return active?.id ?? liveDataset.events[0]?.id ?? '';
  });

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Create Event Form State
  const [newEventName, setNewEventName] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventMinSpend, setNewEventMinSpend] = useState('20000');
  const [newEventPin, setNewEventPin] = useState('123456');
  const [creatingEvent, setCreatingEvent] = useState(false);

  // Ticket UID Generator & CSV State
  const [ticketRole, setTicketRole] = useState<TicketRoleType>('buyer');
  const [ticketBatchCount, setTicketBatchCount] = useState(5);
  const [ticketSearch, setTicketSearch] = useState('');
  const [csvBulkText, setCsvBulkText] = useState('');
  const [copiedTicketId, setCopiedTicketId] = useState<string | null>(null);

  // Cold-Booth Bounty Selection (max 3 booths)
  const [selectedColdBoothIds, setSelectedColdBoothIds] = useState<string[]>([]);
  const [coldMultiplierInput, setColdMultiplierInput] = useState('1.25');

  // Master Ledger Filters
  const [ledgerEventFilter, setLedgerEventFilter] = useState<string>('ALL');
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState<
    'all' | 'completed' | 'voided' | 'flagged'
  >('all');
  const [ledgerSearch, setLedgerSearch] = useState('');

  const selectedEvent = useMemo(
    () =>
      liveDataset.events.find((e) => e.id === selectedEventId) ??
      liveDataset.events[0] ??
      null,
    [liveDataset.events, selectedEventId]
  );

  const userMap = useMemo(
    () => new Map(liveDataset.users.map((u) => [u.id, u])),
    [liveDataset.users]
  );

  const eventTickets = useMemo(() => {
    if (!selectedEvent) return [];
    const q = ticketSearch.trim().toLowerCase();
    return liveDataset.ticket_uids
      .filter((t) => t.event_id === selectedEvent.id)
      .filter((t) => {
        if (!q) return true;
        const claimer = t.claimed_by_user_id
          ? userMap.get(t.claimed_by_user_id)?.username.toLowerCase() ?? ''
          : '';
        return t.uid_code.toLowerCase().includes(q) || claimer.includes(q);
      })
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [liveDataset.ticket_uids, selectedEvent, ticketSearch, userMap]);

  // Floor Traffic Radar: booths sorted strictly from lowest to highest unique_stamps_count
  const radarBooths = useMemo(() => {
    if (!selectedEvent) return [];
    return liveDataset.tenants
      .filter((t) => t.event_id === selectedEvent.id)
      .sort((a, b) => {
        if (a.unique_stamps_count !== b.unique_stamps_count) {
          return a.unique_stamps_count - b.unique_stamps_count;
        }
        return a.event_sales_idr - b.event_sales_idr;
      });
  }, [liveDataset.tenants, selectedEvent]);

  const flaggedTransactions = useMemo(() => {
    if (!selectedEvent) return [];
    return liveDataset.transactions
      .filter((tx) => tx.event_id === selectedEvent.id && tx.is_flagged)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [liveDataset.transactions, selectedEvent]);

  const masterLedgerRows = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    const eventMap = new Map(liveDataset.events.map((e) => [e.id, e]));
    const tenantMap = new Map(liveDataset.tenants.map((t) => [t.id, t]));
    const participantMap = new Map(liveDataset.event_participants.map((p) => [p.id, p]));

    return liveDataset.transactions
      .filter((tx) => {
        if (ledgerEventFilter !== 'ALL' && tx.event_id !== ledgerEventFilter) {
          return false;
        }
        if (ledgerStatusFilter === 'completed' && tx.status !== 'completed') return false;
        if (ledgerStatusFilter === 'voided' && tx.status !== 'voided') return false;
        if (ledgerStatusFilter === 'flagged' && !tx.is_flagged) return false;
        return true;
      })
      .map((tx) => {
        const ev = eventMap.get(tx.event_id);
        const tenant = tenantMap.get(tx.tenant_id);
        const part = participantMap.get(tx.participant_id);
        const buyer = part ? userMap.get(part.user_id) : undefined;
        return {
          tx,
          eventName: ev?.name ?? 'Event',
          boothNumber: tenant?.booth_number ?? '-',
          boothName: tenant?.booth_name ?? 'Booth',
          buyerUsername: buyer?.username ?? 'Attendee',
          buyerQr: part?.qr_code ?? '-',
        };
      })
      .filter((row) => {
        if (!q) return true;
        return (
          row.buyerUsername.toLowerCase().includes(q) ||
          row.buyerQr.toLowerCase().includes(q) ||
          row.boothName.toLowerCase().includes(q) ||
          row.boothNumber.toLowerCase().includes(q) ||
          row.eventName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => Date.parse(b.tx.created_at) - Date.parse(a.tx.created_at));
  }, [
    liveDataset.transactions,
    liveDataset.events,
    liveDataset.tenants,
    liveDataset.event_participants,
    ledgerEventFilter,
    ledgerStatusFilter,
    ledgerSearch,
    userMap,
  ]);

  const showToast = (msg: string) => {
    setErrorMsg(null);
    setNotice(msg);
    window.setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  // --------------------------------------------------------------------------
  // 1. MULTI-EVENT LIFECYCLE HANDLERS
  // --------------------------------------------------------------------------

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newEventName.trim();
    const cleanPin = newEventPin.trim();
    const minSpend = Math.max(0, parseIdrInput(newEventMinSpend));

    if (cleanName.length < 3) {
      setErrorMsg('Event name must be at least 3 characters.');
      return;
    }
    if (cleanPin.length < 4) {
      setErrorMsg('Global Void Admin PIN must be at least 4 characters.');
      return;
    }

    setCreatingEvent(true);
    setErrorMsg(null);
    try {
      const { event: newEvent } = await apiClient.createEvent(
        {
          name: cleanName,
          description:
            newEventDesc.trim() || 'Live Dual-IDR POS & Stamp Rally event.',
          min_stamp_spend_idr: minSpend,
          admin_void_pin: cleanPin,
        },
        currentUser?.id
      );

      updateLiveDataset((prev) => ({
        ...prev,
        events: [newEvent, ...prev.events],
      }));
      setSelectedEventId(newEvent.id);
      setNewEventName('');
      setNewEventDesc('');
      await soundFeedback.playSuccessChime(false);
      showToast(`Created draft event "${newEvent.name}". Click Start Event to go live!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create event.');
    } finally {
      setCreatingEvent(false);
    }
  };

  const handleSetEventStatus = async (ev: Event, nextStatus: 'active' | 'archived') => {
    try {
      const { event: updatedEvent, welcome_announcement } =
        await apiClient.updateEventStatus(
          ev.id,
          nextStatus,
          currentUser ?? undefined
        );

      updateLiveDataset((prev) => ({
        ...prev,
        events: prev.events.map((item) =>
          item.id === updatedEvent.id ? updatedEvent : item
        ),
        event_chat_messages: welcome_announcement
          ? [welcome_announcement, ...prev.event_chat_messages]
          : prev.event_chat_messages,
      }));

      await soundFeedback.playTapTick();
      showToast(
        nextStatus === 'active'
          ? `${ev.name} is now LIVE! Event Hub, POS & Group Chat activated.`
          : `${ev.name} has been archived and final standings locked.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update event status.');
    }
  };

  // --------------------------------------------------------------------------
  // 2. TICKET CODE GENERATOR & CSV BULK IMPORT
  // --------------------------------------------------------------------------

  const handleGenerateTickets = async () => {
    if (!selectedEvent) return;
    const count = Math.max(1, Math.min(50, ticketBatchCount));

    try {
      const { tickets: newRows } = await apiClient.createEventTickets(
        selectedEvent.id,
        { mode: 'generate', role_type: ticketRole, count }
      );

      updateLiveDataset((prev) => ({
        ...prev,
        ticket_uids: [...newRows, ...prev.ticket_uids],
      }));
      await soundFeedback.playTapTick();
      showToast(
        `Generated ${newRows.length} ${ticketRole.toUpperCase()} Event Ticket Code(s) for ${selectedEvent.name}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to generate tickets.');
    }
  };

  const processCsvTicketLines = async (rawText: string) => {
    if (!selectedEvent) return;
    const existingSet = new Set(liveDataset.ticket_uids.map((t) => t.uid_code.toUpperCase()));

    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const parsedTickets: Array<{ uid_code: string; role_type: TicketRoleType }> = [];
    for (const line of lines) {
      const [rawCode, rawRole] = line.split(/[,\t;]/).map((s) => s.trim());
      if (!rawCode || rawCode.toLowerCase() === 'uid_code') continue;
      const cleanCode = rawCode.toUpperCase();
      if (existingSet.has(cleanCode)) continue;
      existingSet.add(cleanCode);

      const role: TicketRoleType =
        rawRole?.toLowerCase() === 'merchant' || cleanCode.endsWith('SLR')
          ? 'merchant'
          : 'buyer';

      parsedTickets.push({
        uid_code: cleanCode,
        role_type: role,
      });
    }

    if (parsedTickets.length === 0) {
      setErrorMsg('No new unique Event Ticket Codes found in CSV input.');
      return;
    }

    try {
      const { tickets: createdTickets } = await apiClient.createEventTickets(
        selectedEvent.id,
        { mode: 'import', tickets: parsedTickets }
      );

      updateLiveDataset((prev) => ({
        ...prev,
        ticket_uids: [...createdTickets, ...prev.ticket_uids],
      }));
      setCsvBulkText('');
      await soundFeedback.playTapTick();
      showToast(
        `Imported ${createdTickets.length} Event Ticket Code(s) into ${selectedEvent.name}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import CSV ticket codes.');
    }
  };

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await processCsvTicketLines(text);
    e.target.value = '';
  };

  // --------------------------------------------------------------------------
  // 3. FLOOR TRAFFIC RADAR & COLD-BOOTH BOUNTY (MAX 3 BOOTHS, 30 MIN)
  // --------------------------------------------------------------------------

  const toggleColdBoothSelection = (tenantId: string) => {
    setSelectedColdBoothIds((prev) => {
      if (prev.includes(tenantId)) {
        return prev.filter((id) => id !== tenantId);
      }
      if (prev.length >= 3) {
        setErrorMsg('You can select up to 3 quiet booths at a time for Cold-Booth Bounty.');
        return prev;
      }
      setErrorMsg(null);
      return [...prev, tenantId];
    });
  };

  const handleActivateColdBounty = async () => {
    if (!selectedEvent || selectedColdBoothIds.length === 0) return;
    const parsedMult = Number.parseFloat(coldMultiplierInput);
    const multiplier =
      Number.isFinite(parsedMult) && parsedMult >= 1.05 && parsedMult <= 3.0
        ? Math.round(parsedMult * 100) / 100
        : 1.25;

    try {
      const { tenants: updatedBooths, announcement } =
        await apiClient.activateColdBounty(
          selectedEvent.id,
          {
            tenant_ids: selectedColdBoothIds,
            multiplier,
            duration_minutes: 30,
          },
          currentUser ?? undefined
        );

      const updatedMap = new Map(updatedBooths.map((t) => [t.id, t]));
      updateLiveDataset((prev) => ({
        ...prev,
        tenants: prev.tenants.map((t) => updatedMap.get(t.id) ?? t),
        event_chat_messages: announcement
          ? [announcement, ...prev.event_chat_messages]
          : prev.event_chat_messages,
      }));

      setSelectedColdBoothIds([]);
      await soundFeedback.playBountyFanfare(false);
      showToast(
        `Activated 30-min ${multiplier}x Gold Cold-Booth Bounty on ${updatedBooths.length} booth(s)!`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to activate Cold-Booth Bounty.');
    }
  };

  const handleClearColdBounty = async (tenantId: string) => {
    if (!selectedEvent) return;
    try {
      const { tenant: updatedTenant } = await apiClient.clearColdBounty(
        selectedEvent.id,
        tenantId
      );
      updateLiveDataset((prev) => ({
        ...prev,
        tenants: prev.tenants.map((t) =>
          t.id === updatedTenant.id ? updatedTenant : t
        ),
      }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to stop boost.');
    }
  };

  // --------------------------------------------------------------------------
  // 4. HOURLY HIDDEN BOUNTY SCHEDULER, FRAUD QUEUE & MASTER LEDGER CSV
  // --------------------------------------------------------------------------

  const handleToggleHiddenBounty = async (tenantId: string, nextValue: boolean) => {
    try {
      const { tenant: updatedTenant } = await apiClient.toggleHiddenBounty(
        tenantId,
        nextValue
      );
      updateLiveDataset((prev) => ({
        ...prev,
        tenants: prev.tenants.map((t) =>
          t.id === updatedTenant.id ? updatedTenant : t
        ),
      }));
      await soundFeedback.playTapTick();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to toggle hidden bounty.');
    }
  };

  const handleRotateHourlyHiddenBounties = async () => {
    if (!selectedEvent || radarBooths.length === 0) return;
    const targetCount = Math.min(
      radarBooths.length,
      Math.max(3, Math.min(5, Math.ceil(radarBooths.length / 2)))
    );

    try {
      const { tenants: rotatedBooths } = await apiClient.rotateHiddenBounties(
        selectedEvent.id,
        targetCount
      );
      const updatedMap = new Map(rotatedBooths.map((t) => [t.id, t]));
      updateLiveDataset((prev) => ({
        ...prev,
        tenants: prev.tenants.map((t) => updatedMap.get(t.id) ?? t),
      }));

      const activeCount = rotatedBooths.filter((b) => b.is_hidden_bounty).length;
      await soundFeedback.playBountyFanfare(false);
      showToast(
        `Rotated ${activeCount} secret Hourly Hidden Bounty booths for ${selectedEvent.name}!`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to rotate hidden bounties.');
    }
  };

  const handleDismissFraudFlag = async (txId: string) => {
    try {
      const { transaction: updatedTx } = await apiClient.dismissTransactionFlag(txId);
      updateLiveDataset((prev) => ({
        ...prev,
        transactions: prev.transactions.map((tx) =>
          tx.id === updatedTx.id ? updatedTx : tx
        ),
      }));
      showToast('Flag dismissed after organizer review.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to dismiss flag.');
    }
  };

  const handleAdminVoidTransaction = async (tx: Transaction) => {
    const ev = liveDataset.events.find((e) => e.id === tx.event_id);
    if (!ev) return;

    try {
      const reverseRes = await apiClient.reversePosTransaction(
        {
          transaction_id: tx.id,
          admin_void_pin: ev.admin_void_pin,
        },
        currentUser?.id
      );

      updateLiveDataset((prev) => ({
        ...prev,
        transactions: prev.transactions.map((item) =>
          item.id === reverseRes.transaction.id ? reverseRes.transaction : item
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

      showToast(`Voided flagged transaction (${formatIdr(tx.actual_amount_idr)}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to void transaction.');
    }
  };

  const handleExportMasterLedgerCsv = () => {
    const headers = [
      'transaction_id',
      'event_name',
      'created_at',
      'booth_number',
      'booth_name',
      'buyer_username',
      'buyer_qr_code',
      'actual_amount_idr',
      'leaderboard_amount_idr',
      'multiplier_applied',
      'hit_hidden_bounty',
      'hidden_bounty_bonus_idr',
      'status',
      'is_flagged',
      'flag_reason',
    ];

    const csvLines = [
      headers.join(','),
      ...masterLedgerRows.map((row) =>
        [
          row.tx.id,
          row.eventName,
          row.tx.created_at,
          row.boothNumber,
          row.boothName,
          row.buyerUsername,
          row.buyerQr,
          row.tx.actual_amount_idr,
          row.tx.leaderboard_amount_idr,
          row.tx.multiplier_applied,
          row.tx.hit_hidden_bounty,
          row.tx.hidden_bounty_bonus_idr,
          row.tx.status,
          row.tx.is_flagged,
          row.tx.flag_reason ?? '',
        ]
          .map(csvEscape)
          .join(',')
      ),
    ];

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rallypos-master-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${masterLedgerRows.length} Dual-IDR ledger row(s) to CSV.`);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      {/* Header & Target Event Selector */}
      <section className="rounded-2xl border border-amber-500/35 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/30 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300">
              <Shield className="h-3.5 w-3.5" />
              Organizer Command Center
            </div>
            <h1 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
              Live Operations &amp; Master Ledger
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label
                htmlFor="admin-target-event"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400"
              >
                Managing Event
              </label>
              <select
                id="admin-target-event"
                value={selectedEvent?.id ?? ''}
                onChange={(e) => setSelectedEventId(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white focus:border-amber-400 focus:outline-none"
              >
                {liveDataset.events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} ({ev.status.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Sub-navigation Tabs */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
          {(
            [
              { id: 'radar', label: 'Floor Traffic Radar & Cold Bounty', icon: Radar },
              {
                id: 'bounty_fraud',
                label: `Hidden Bounties, Fraud (${flaggedTransactions.length}) & Ledger`,
                icon: ShieldAlert,
              },
              { id: 'tickets', label: 'Event Ticket Codes & CSV Import', icon: Ticket },
              { id: 'lifecycle', label: 'Multi-Event Lifecycle', icon: Sparkles },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                  activeTab === tab.id
                    ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                    : 'border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-xs font-semibold text-emerald-200">
          {notice}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-xs font-semibold text-rose-200">
          {errorMsg}
        </div>
      )}

      {/* TAB 1: FLOOR TRAFFIC RADAR & COLD-BOOTH BOUNTY SWITCH */}
      {activeTab === 'radar' && selectedEvent && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-6 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                  <Radar className="h-5 w-5 text-amber-400" />
                  Floor Traffic Radar &mdash; {selectedEvent.name}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Sorted from lowest to highest unique stamps. Select up to 3 quiet booths to
                  launch a 30-minute Gold Cold-Booth Bounty.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs">
                  <span className="text-slate-400">Boost:</span>
                  <input
                    type="number"
                    step="0.05"
                    min="1.10"
                    max="3.00"
                    value={coldMultiplierInput}
                    onChange={(e) => setColdMultiplierInput(e.target.value)}
                    className="w-14 bg-transparent font-mono font-bold text-amber-300 focus:outline-none"
                  />
                  <span className="text-slate-400">x</span>
                </div>

                <button
                  type="button"
                  disabled={selectedColdBoothIds.length === 0}
                  onClick={() => void handleActivateColdBounty()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-45"
                >
                  <Zap className="h-4 w-4" />
                  Trigger 30m Gold Bounty ({selectedColdBoothIds.length}/3)
                </button>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 pr-3">Select</th>
                    <th className="py-2.5 pr-3">Booth</th>
                    <th className="py-2.5 pr-3">Unique Stamps</th>
                    <th className="py-2.5 pr-3">Real Sales (IDR)</th>
                    <th className="py-2.5 pr-3">Cold-Booth Bounty Status</th>
                    <th className="py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {radarBooths.map((booth) => {
                    const checked = selectedColdBoothIds.includes(booth.id);
                    const coldRemainingMs = booth.cold_bounty_expires_at
                      ? Math.max(0, Date.parse(booth.cold_bounty_expires_at) - nowMs)
                      : 0;
                    const isColdActive =
                      booth.is_cold_bounty &&
                      (!booth.cold_bounty_expires_at || coldRemainingMs > 0);

                    return (
                      <tr key={booth.id} className="hover:bg-slate-950/50">
                        <td className="py-3 pr-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleColdBoothSelection(booth.id)}
                            className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-amber-500"
                            aria-label={`Select ${booth.booth_name}`}
                          />
                        </td>
                        <td className="py-3 pr-3">
                          <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 font-mono font-bold text-indigo-300">
                            {booth.booth_number}
                          </span>
                          <span className="font-semibold text-white">{booth.booth_name}</span>
                        </td>
                        <td className="py-3 pr-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 font-mono font-bold ${
                              booth.unique_stamps_count <= 2
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            {booth.unique_stamps_count} stamps
                          </span>
                        </td>
                        <td className="py-3 pr-3 font-mono font-semibold text-slate-200">
                          {formatIdr(booth.event_sales_idr)}
                        </td>
                        <td className="py-3 pr-3">
                          {isColdActive ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-500/15 px-2.5 py-0.5 font-bold text-amber-300">
                              <Flame className="h-3 w-3" />
                              {booth.cold_bounty_multiplier}x Gold (
                              {Math.ceil(coldRemainingMs / 60_000)}m left)
                            </span>
                          ) : (
                            <span className="text-slate-500">Standard 1.0x</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {isColdActive && (
                            <button
                              type="button"
                              onClick={() => void handleClearColdBounty(booth.id)}
                              className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-800"
                            >
                              Stop Boost
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: HOURLY HIDDEN BOUNTIES, FRAUD QUEUE & MASTER LEDGER CSV */}
      {activeTab === 'bounty_fraud' && selectedEvent && (
        <div className="space-y-6">
          {/* Hourly Hidden Bounty Scheduler */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/85 p-6 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                  <Gift className="h-5 w-5 text-violet-400" />
                  Hourly Hidden Bounty Scheduler (3–5 Secret Booths)
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Secret booths trigger surprise prize alerts at POS checkout and award +
                  {formatIdr(selectedEvent.hidden_bounty_bonus_idr)} Leaderboard IDR.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void handleRotateHourlyHiddenBounties()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
              >
                <Shuffle className="h-4 w-4" />
                Rotate 3–5 Secret Booths
              </button>
            </div>

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {radarBooths.map((booth) => (
                <button
                  key={booth.id}
                  type="button"
                  onClick={() =>
                    void handleToggleHiddenBounty(booth.id, !booth.is_hidden_bounty)
                  }
                  className={`flex items-center justify-between rounded-xl border p-3 text-left text-xs transition ${
                    booth.is_hidden_bounty
                      ? 'border-violet-400/60 bg-violet-500/15 text-white'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <span className="font-mono text-[10px] font-bold text-indigo-300">
                      {booth.booth_number}
                    </span>
                    <p className="truncate font-semibold text-white">{booth.booth_name}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      booth.is_hidden_bounty
                        ? 'bg-violet-500 text-white'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {booth.is_hidden_bounty ? 'SECRET ON' : 'OFF'}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Flagged Rapid-Fire Fraud Queue */}
          <section className="rounded-2xl border border-rose-500/30 bg-slate-900/85 p-6 shadow-xl">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <AlertTriangle className="h-5 w-5 text-rose-400" />
              Flagged Activity Queue ({flaggedTransactions.length})
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Rapid-fire cross-booth scan anomalies or unusual high-value orders awaiting review.
            </p>

            {flaggedTransactions.length === 0 ? (
              <p className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
                No flagged anomalies in {selectedEvent.name}.
              </p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {flaggedTransactions.map((tx) => {
                  const booth = liveDataset.tenants.find((t) => t.id === tx.tenant_id);
                  const part = liveDataset.event_participants.find(
                    (p) => p.id === tx.participant_id
                  );
                  const buyer = part ? userMap.get(part.user_id) : undefined;
                  return (
                    <div
                      key={tx.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/35 bg-rose-950/20 px-4 py-3 text-xs"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-white">
                            {buyer?.username ?? 'Attendee'} ({part?.qr_code ?? '-'})
                          </span>
                          <span className="text-slate-400">&rarr;</span>
                          <span className="font-semibold text-indigo-300">
                            {booth?.booth_number} {booth?.booth_name}
                          </span>
                          <span className="rounded bg-rose-500/20 px-2 py-0.5 font-bold text-rose-200">
                            {tx.flag_reason ?? 'ANOMALY'}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Actual: {formatIdr(tx.actual_amount_idr)} &middot; Leaderboard:{' '}
                          {formatIdr(tx.leaderboard_amount_idr)} &middot;{' '}
                          {new Date(tx.created_at).toLocaleString('id-ID')}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleDismissFraudFlag(tx.id)}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700"
                        >
                          Dismiss Flag
                        </button>
                        {tx.status === 'completed' && (
                          <button
                            type="button"
                            onClick={() => void handleAdminVoidTransaction(tx)}
                            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 font-bold text-white hover:bg-rose-500"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Void Order
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Searchable Master Dual-IDR Ledger + CSV Export */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/85 p-6 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                  Master Dual-IDR Ledger ({masterLedgerRows.length})
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Full audit log comparing real <code>actual_amount_idr</code> vs boosted{' '}
                  <code>leaderboard_amount_idr</code>.
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportMasterLedgerCsv}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  placeholder="Search buyer, QR, or booth..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-8 pr-3 text-xs text-white"
                />
              </div>
              <select
                value={ledgerEventFilter}
                onChange={(e) => setLedgerEventFilter(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              >
                <option value="ALL">All Events (Active &amp; Archived)</option>
                {liveDataset.events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
              <select
                value={ledgerStatusFilter}
                onChange={(e) =>
                  setLedgerStatusFilter(
                    e.target.value as 'all' | 'completed' | 'voided' | 'flagged'
                  )
                }
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              >
                <option value="all">All Statuses</option>
                <option value="completed">Completed Only</option>
                <option value="voided">Voided Only</option>
                <option value="flagged">Flagged Only</option>
              </select>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="py-2 pr-3">Time / Event</th>
                    <th className="py-2 pr-3">Buyer</th>
                    <th className="py-2 pr-3">Booth</th>
                    <th className="py-2 pr-3">Actual IDR</th>
                    <th className="py-2 pr-3">Leaderboard IDR</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {masterLedgerRows.slice(0, 50).map((row) => (
                    <tr key={row.tx.id} className="hover:bg-slate-950/50">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-white">{row.eventName}</p>
                        <p className="text-[11px] text-slate-400">
                          {new Date(row.tx.created_at).toLocaleString('id-ID')}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <p className="font-semibold text-white">{row.buyerUsername}</p>
                        <p className="font-mono text-[10px] text-indigo-300">{row.buyerQr}</p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-mono text-[11px] text-slate-400">
                          {row.boothNumber}
                        </span>{' '}
                        <span className="text-slate-200">{row.boothName}</span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono font-bold text-white">
                        {formatIdr(row.tx.actual_amount_idr)}
                      </td>
                      <td className="py-2.5 pr-3 font-mono font-bold text-amber-300">
                        {formatIdr(row.tx.leaderboard_amount_idr)}
                        {row.tx.multiplier_applied > 1 && (
                          <span className="ml-1 text-[10px] text-emerald-300">
                            ({row.tx.multiplier_applied}x)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            row.tx.status === 'voided'
                              ? 'bg-slate-800 text-slate-400'
                              : row.tx.is_flagged
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                        >
                          {row.tx.status === 'voided'
                            ? 'Voided'
                            : row.tx.is_flagged
                              ? 'Flagged'
                              : 'Completed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: TICKET UID GENERATOR & CSV IMPORT */}
      {activeTab === 'tickets' && selectedEvent && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5">
              <h2 className="flex items-center gap-2 text-base font-bold text-white">
                <Ticket className="h-5 w-5 text-indigo-400" />
                Generate Event Ticket Codes
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Create Attendee or Booth Event Ticket Codes for <strong>{selectedEvent.name}</strong>.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <select
                  value={ticketRole}
                  onChange={(e) => setTicketRole(e.target.value as TicketRoleType)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                >
                  <option value="buyer">Buyer Ticket (BYR)</option>
                  <option value="merchant">Merchant Booth (SLR)</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={ticketBatchCount}
                  onChange={(e) => setTicketBatchCount(Number(e.target.value) || 1)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>

              <button
                type="button"
                onClick={() => void handleGenerateTickets()}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"
              >
                <Plus className="h-4 w-4" />
                Generate {ticketBatchCount} Ticket(s)
              </button>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <Upload className="h-4 w-4 text-emerald-400" />
                Bulk CSV Import
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Format: <code>TKT-9001-BYR,buyer</code> or <code>TKT-9002-SLR,merchant</code>
              </p>

              <textarea
                rows={4}
                value={csvBulkText}
                onChange={(e) => setCsvBulkText(e.target.value)}
                placeholder={'TKT-9001-BYR,buyer\nTKT-9002-SLR,merchant'}
                className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white"
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="cursor-pointer rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
                  Upload .CSV File
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleCsvFileUpload}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  disabled={!csvBulkText.trim()}
                  onClick={() => void processCsvTicketLines(csvBulkText)}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Import Pasted Lines
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-bold text-white">
                Ticket Registry ({eventTickets.length})
              </h3>
              <input
                type="text"
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                placeholder="Search Event Ticket Code or claimer..."
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
              />
            </div>

            <div className="mt-4 max-h-[460px] space-y-2 overflow-y-auto pr-1">
              {eventTickets.map((t) => {
                const claimer = t.claimed_by_user_id
                  ? userMap.get(t.claimed_by_user_id)
                  : undefined;
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/75 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-white">{t.uid_code}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          t.role_type === 'merchant'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-indigo-500/20 text-indigo-300'
                        }`}
                      >
                        {t.role_type}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {claimer ? (
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Claimed by {claimer.username}
                        </span>
                      ) : (
                        <span className="text-slate-400">Unclaimed</span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(t.uid_code);
                          setCopiedTicketId(t.id);
                          window.setTimeout(() => setCopiedTicketId(null), 1200);
                        }}
                        className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:text-white"
                        title="Copy Event Ticket Code"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {copiedTicketId === t.id && (
                        <span className="text-[10px] text-emerald-300">Copied</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: MULTI-EVENT LIFECYCLE MANAGER */}
      {activeTab === 'lifecycle' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleCreateEvent}
            className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/85 p-6 lg:col-span-5"
          >
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Plus className="h-5 w-5 text-emerald-400" />
              Create New Event
            </h2>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Event Name
              </label>
              <input
                type="text"
                required
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                placeholder="e.g. Comifuro 21"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Description
              </label>
              <textarea
                rows={2}
                value={newEventDesc}
                onChange={(e) => setNewEventDesc(e.target.value)}
                placeholder="Convention theme, venue & stamp rally rules..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Min Spend / Stamp
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatIdr(parseIdrInput(newEventMinSpend))}
                  onChange={(e) => setNewEventMinSpend(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-300">
                  <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                  Global Void PIN
                </label>
                <input
                  type="text"
                  required
                  minLength={4}
                  value={newEventPin}
                  onChange={(e) => setNewEventPin(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={creatingEvent}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {creatingEvent ? 'Creating...' : 'Create Draft Event'}
            </button>
          </form>

          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/85 p-6 lg:col-span-7">
            <h2 className="text-lg font-bold text-white">
              All Events ({liveDataset.events.length})
            </h2>
            {liveDataset.events.map((ev) => (
              <div
                key={ev.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-white">{ev.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        ev.status === 'active'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : ev.status === 'draft'
                            ? 'bg-indigo-500/20 text-indigo-300'
                            : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {ev.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Min Stamp: {formatIdr(ev.min_stamp_spend_idr)} &middot; Void PIN:{' '}
                    <code className="text-amber-300">{ev.admin_void_pin}</code>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {ev.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => void handleSetEventStatus(ev, 'active')}
                      className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Start Event
                    </button>
                  )}
                  {ev.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => void handleSetEventStatus(ev, 'archived')}
                      className="inline-flex items-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-bold text-amber-200 hover:bg-amber-500/25"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      End &amp; Archive
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};