import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  CreditCard,
  MessageSquare,
  QrCode,
  Settings2,
  ShoppingBag,
  Store,
  Ticket,
  Trophy,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatIdr } from '../lib/ledgerEngine';
import { soundFeedback } from '../lib/soundFeedback';
import { BuyerDashboardPanel } from '../components/buyer/BuyerDashboardPanel';
import { BoothSetupPanel } from '../components/merchant/BoothSetupPanel';
import { MerchantPosTerminal } from '../components/merchant/MerchantPosTerminal';
import { BoothAnalyticsPanel } from '../components/merchant/BoothAnalyticsPanel';
import { EventLeaderboardPanel } from '../components/event/EventLeaderboardPanel';
import { EventGroupChatPanel } from '../components/event/EventGroupChatPanel';
import type { DemoSeedDataset } from '../types/types';

type HubTab =
  | 'buyer_dashboard'
  | 'merchant_pos'
  | 'merchant_analytics'
  | 'merchant_setup'
  | 'leaderboard'
  | 'chat';

const DEMO_STORE_KEY = 'rallypos_demo_dataset_v1';

function readLatestDataset(fallback: DemoSeedDataset, isDemoMode: boolean): DemoSeedDataset {
  if (!isDemoMode || typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(DEMO_STORE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as DemoSeedDataset;
    return Array.isArray(parsed.events) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export const EventHubPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const {
    currentUser,
    activeViewMode,
    switchViewMode,
    dataset,
    isDemoMode,
    setActiveEventId,
    joinEventWithTicketUid,
  } = useApp();

  const [liveDataset, setLiveDataset] = useState<DemoSeedDataset>(() =>
    readLatestDataset(dataset, isDemoMode)
  );

  useEffect(() => {
    setLiveDataset(readLatestDataset(dataset, isDemoMode));
  }, [dataset, isDemoMode]);

  useEffect(() => {
    if (eventId) {
      setActiveEventId(eventId);
    }
  }, [eventId, setActiveEventId]);

  const updateLiveDataset = useCallback(
    (updater: (prev: DemoSeedDataset) => DemoSeedDataset) => {
      setLiveDataset((prev) => {
        const next = updater(prev);
        if (isDemoMode && typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(next));
          } catch {
            // Ignore quota errors
          }
        }
        return next;
      });
    },
    [isDemoMode]
  );

  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<HubTab>(() => {
    if (requestedTab === 'leaderboard') return 'leaderboard';
    if (requestedTab === 'chat') return 'chat';
    return activeViewMode === 'merchant' ? 'merchant_pos' : 'buyer_dashboard';
  });

  useEffect(() => {
    if (requestedTab === 'leaderboard') {
      setActiveTab('leaderboard');
    } else if (requestedTab === 'chat') {
      setActiveTab('chat');
    }
  }, [requestedTab]);

  useEffect(() => {
    setActiveTab((prev) => {
      if (activeViewMode === 'merchant') {
        return prev === 'buyer_dashboard' ? 'merchant_pos' : prev;
      }
      if (
        prev === 'merchant_pos' ||
        prev === 'merchant_analytics' ||
        prev === 'merchant_setup'
      ) {
        return 'buyer_dashboard';
      }
      return prev;
    });
  }, [activeViewMode]);

  // Inline Ticket Gate state if user lands directly on /event/:eventId before joining
  const [gateUid, setGateUid] = useState('');
  const [gateBoothName, setGateBoothName] = useState('');
  const [gateBoothNumber, setGateBoothNumber] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateSubmitting, setGateSubmitting] = useState(false);

  const event = useMemo(
    () => liveDataset.events.find((e) => e.id === eventId) ?? null,
    [liveDataset.events, eventId]
  );

  const participant = useMemo(() => {
    if (!currentUser || !event) return null;
    return (
      liveDataset.event_participants.find(
        (p) => p.event_id === event.id && p.user_id === currentUser.id
      ) ?? null
    );
  }, [liveDataset.event_participants, currentUser, event]);

  const tenant = useMemo(() => {
    if (!currentUser || !event) return null;
    return (
      liveDataset.tenants.find(
        (t) => t.event_id === event.id && t.user_id === currentUser.id
      ) ?? null
    );
  }, [liveDataset.tenants, currentUser, event]);

  const eventBooths = useMemo(() => {
    if (!event) return [];
    return liveDataset.tenants.filter((t) => t.event_id === event.id);
  }, [liveDataset.tenants, event]);

  const participantStamps = useMemo(() => {
    if (!event || !participant) return [];
    return liveDataset.stamps.filter(
      (s) => s.event_id === event.id && s.participant_id === participant.id
    );
  }, [liveDataset.stamps, event, participant]);

  if (!event) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-white">Event Not Found</h1>
        <p className="mt-2 text-sm text-slate-400">
          This event may have been removed or the URL is invalid.
        </p>
        <Link
          to="/events"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Event Directory
        </Link>
      </div>
    );
  }

  const isEnrolled = Boolean(participant || tenant || currentUser?.is_admin);

  const handleGateJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateError(null);
    setGateSubmitting(true);
    try {
      await soundFeedback.unlockAudioContext();
      await joinEventWithTicketUid({
        eventId: event.id,
        uidCode: gateUid,
        boothName: gateBoothName || undefined,
        boothNumber: gateBoothNumber || undefined,
      });
      await soundFeedback.playSuccessChime();
    } catch (err) {
      await soundFeedback.playErrorTone();
      setGateError(err instanceof Error ? err.message : 'Ticket UID verification failed.');
    } finally {
      setGateSubmitting(false);
    }
  };

  if (!isEnrolled && event.status === 'active') {
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="rounded-2xl border border-indigo-500/35 bg-slate-900/90 p-6 shadow-2xl">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
            <Ticket className="h-4 w-4" />
            <span>Ticket UID Verification Required</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white">{event.name}</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter your Buyer or Merchant Ticket UID to unlock this Event Hub, mint your{' '}
            <code className="text-indigo-300">EV-XXXXXX</code> QR badge, and claim Stamp #1.
          </p>

          {gateError && (
            <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-medium text-rose-200">
              {gateError}
            </div>
          )}

          <form onSubmit={handleGateJoin} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="hub-gate-uid"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                Ticket UID
              </label>
              <input
                id="hub-gate-uid"
                type="text"
                required
                value={gateUid}
                onChange={(e) => setGateUid(e.target.value.toUpperCase())}
                placeholder="TKT-DEMO-BYR or TKT-DEMO-SLR"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm uppercase text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setGateUid('TKT-DEMO-BYR')}
                  className="rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-300 hover:bg-indigo-500/20"
                >
                  Use TKT-DEMO-BYR
                </button>
                <button
                  type="button"
                  onClick={() => setGateUid('TKT-DEMO-SLR')}
                  className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                >
                  Use TKT-DEMO-SLR
                </button>
              </div>
            </div>

            {gateUid.toUpperCase().includes('SLR') && (
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={gateBoothName}
                  onChange={(e) => setGateBoothName(e.target.value)}
                  placeholder="Booth Name"
                  className="sm:col-span-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500"
                />
                <input
                  type="text"
                  value={gateBoothNumber}
                  onChange={(e) => setGateBoothNumber(e.target.value)}
                  placeholder="Booth No. (E-04)"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs uppercase text-white placeholder-slate-500"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2">
              <Link
                to="/events"
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Back to Directory
              </Link>
              <button
                type="submit"
                disabled={gateSubmitting}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {gateSubmitting ? 'Verifying...' : 'Verify & Enter Hub'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      {/* Event Hub Header */}
      <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/events"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950/70 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Events
              </Link>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                  event.status === 'active'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {event.status === 'active' ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live Event Hub
                  </>
                ) : (
                  <>
                    <Archive className="h-3 w-3" />
                    Archived Event
                  </>
                )}
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-0.5 text-[11px] font-medium text-slate-300">
                Min Stamp Spend: {formatIdr(event.min_stamp_spend_idr)}
              </span>
            </div>

            <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {event.name}
            </h1>
            <p className="text-xs text-slate-400 sm:text-sm">{event.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {participant && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                  Your Event QR &middot; Stamps
                </p>
                <p className="font-mono text-sm font-extrabold text-white">
                  {participant.qr_code}{' '}
                  <span className="ml-1 font-sans text-xs font-semibold text-emerald-300">
                    ({participantStamps.length}/{eventBooths.length + 1})
                  </span>
                </p>
              </div>
            )}

            {tenant && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  Your Booth ({tenant.booth_number})
                </p>
                <p className="text-sm font-bold text-white">{tenant.booth_name}</p>
              </div>
            )}

            {currentUser?.is_merchant && (
              <div className="flex items-center rounded-xl border border-slate-700 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => void switchViewMode('buyer')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    activeViewMode === 'buyer'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  Buyer
                </button>
                <button
                  type="button"
                  onClick={() => void switchViewMode('merchant')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    activeViewMode === 'merchant'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Store className="h-3.5 w-3.5" />
                  Merchant
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Unified Event Hub Tabs */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-800/80 pt-4">
          {activeViewMode === 'buyer' ? (
            <button
              type="button"
              onClick={() => setActiveTab('buyer_dashboard')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === 'buyer_dashboard'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                  : 'border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <QrCode className="h-4 w-4" />
              Buyer Dashboard &amp; Stamp Album
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('merchant_pos')}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                  activeTab === 'merchant_pos'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                    : 'border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <CreditCard className="h-4 w-4" />
                POS Terminal
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('merchant_analytics')}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                  activeTab === 'merchant_analytics'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                    : 'border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <BarChart3 className="h-4 w-4" />
                Booth Analytics
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('merchant_setup')}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                  activeTab === 'merchant_setup'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                    : 'border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Settings2 className="h-4 w-4" />
                Booth Setup &amp; Catalog
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('leaderboard')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
              activeTab === 'leaderboard'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Trophy className="h-4 w-4" />
            Top 10 Leaderboard
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
              activeTab === 'chat'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-500/20'
                : 'border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            Event Chat (
            {liveDataset.event_chat_messages.filter((m) => m.event_id === event.id).length})
          </button>
        </div>
      </section>

      {/* Active Workspace Tab Panels */}
      {activeTab === 'buyer_dashboard' && activeViewMode === 'buyer' && (
        <BuyerDashboardPanel
          event={event}
          participant={participant}
          dataset={liveDataset}
        />
      )}

      {activeTab === 'merchant_pos' && activeViewMode === 'merchant' && (
        tenant ? (
          <MerchantPosTerminal
            event={event}
            tenant={tenant}
            dataset={liveDataset}
            onDatasetChange={updateLiveDataset}
          />
        ) : (
          <MissingEventBoothNotice
            eventName={event.name}
            eventId={event.id}
            onJoinBooth={joinEventWithTicketUid}
          />
        )
      )}

      {activeTab === 'merchant_analytics' && activeViewMode === 'merchant' && (
        tenant ? (
          <BoothAnalyticsPanel event={event} tenant={tenant} dataset={liveDataset} />
        ) : (
          <MissingEventBoothNotice
            eventName={event.name}
            eventId={event.id}
            onJoinBooth={joinEventWithTicketUid}
          />
        )
      )}

      {activeTab === 'merchant_setup' && activeViewMode === 'merchant' && (
        tenant ? (
          <BoothSetupPanel
            event={event}
            tenant={tenant}
            dataset={liveDataset}
            onDatasetChange={updateLiveDataset}
          />
        ) : (
          <MissingEventBoothNotice
            eventName={event.name}
            eventId={event.id}
            onJoinBooth={joinEventWithTicketUid}
          />
        )
      )}

      {activeTab === 'leaderboard' && (
        <EventLeaderboardPanel
          event={event}
          dataset={liveDataset}
          currentParticipantId={participant?.id}
        />
      )}

      {activeTab === 'chat' && (
        <EventGroupChatPanel
          event={event}
          dataset={liveDataset}
          onDatasetChange={updateLiveDataset}
        />
      )}
    </div>
  );
};

const MissingEventBoothNotice: React.FC<{
  eventName: string;
  eventId: string;
  onJoinBooth: (params: {
    eventId: string;
    uidCode: string;
    boothName?: string;
    boothNumber?: string;
  }) => Promise<unknown>;
}> = ({ eventName, eventId, onJoinBooth }) => {
  const [uid, setUid] = useState('');
  const [boothName, setBoothName] = useState('');
  const [boothNumber, setBoothNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLinkBooth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onJoinBooth({ eventId, uidCode: uid, boothName, boothNumber });
      await soundFeedback.playSuccessChime();
    } catch (err) {
      await soundFeedback.playErrorTone();
      setError(err instanceof Error ? err.message : 'Unable to link booth.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-6">
      <div className="flex items-center gap-2 text-emerald-300">
        <Store className="h-5 w-5" />
        <h2 className="text-lg font-bold text-white">Link Booth for {eventName}</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        You are in Merchant Mode, but haven&apos;t registered a booth in this event yet. Enter a
        Merchant Ticket UID (e.g. <code className="text-emerald-300">TKT-DEMO-SLR</code>).
      </p>
      {error && (
        <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}
      <form onSubmit={handleLinkBooth} className="mt-4 space-y-3">
        <input
          type="text"
          required
          value={uid}
          onChange={(e) => setUid(e.target.value.toUpperCase())}
          placeholder="Merchant Ticket UID (TKT-DEMO-SLR)"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 font-mono text-sm uppercase text-white"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            type="text"
            required
            value={boothName}
            onChange={(e) => setBoothName(e.target.value)}
            placeholder="Booth Name"
            className="sm:col-span-2 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white"
          />
          <input
            type="text"
            value={boothNumber}
            onChange={(e) => setBoothNumber(e.target.value)}
            placeholder="No. (E-04)"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs uppercase text-white"
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setUid('TKT-DEMO-SLR')}
            className="text-xs font-semibold text-emerald-300 hover:underline"
          >
            Fill TKT-DEMO-SLR
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {loading ? 'Linking...' : 'Open Booth POS'}
          </button>
        </div>
      </form>
    </div>
  );
};