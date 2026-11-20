import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  CreditCard,
  MessageSquare,
  QrCode,
  Settings2,
  Store,
  Ticket,
  Trophy,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatIdr } from '../lib/ledgerEngine';
import { soundFeedback } from '../lib/soundFeedback';
import { EventCheckInModal } from '../components/EventCheckInModal';
import { BuyerDashboardPanel } from '../components/buyer/BuyerDashboardPanel';
import { BoothSetupPanel } from '../components/merchant/BoothSetupPanel';
import { MerchantPosTerminal } from '../components/merchant/MerchantPosTerminal';
import { BoothAnalyticsPanel } from '../components/merchant/BoothAnalyticsPanel';
import { EventLeaderboardPanel } from '../components/event/EventLeaderboardPanel';
import { EventGroupChatPanel } from '../components/event/EventGroupChatPanel';

type HubTab =
  | 'buyer_dashboard'
  | 'merchant_pos'
  | 'merchant_analytics'
  | 'merchant_setup'
  | 'leaderboard'
  | 'chat';

export const EventHubPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    currentUser,
    activeViewMode,
    dataset,
    updateDataset,
    setActiveEventId,
    joinEventWithTicketUid,
  } = useApp();

  const liveDataset = dataset;
  const [checkInModalOpen, setCheckInModalOpen] = useState(true);

  useEffect(() => {
    if (eventId) {
      setActiveEventId(eventId);
      setCheckInModalOpen(true);
    }
  }, [eventId, setActiveEventId]);

  const updateLiveDataset = updateDataset;

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
          This event may have ended or the link is no longer valid.
        </p>
        <Link
          to="/events"
          className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Events
        </Link>
      </div>
    );
  }

  const isEnrolled = Boolean(participant || tenant || currentUser?.is_admin);
  const meetupCount = liveDataset.event_chat_messages.filter(
    (m) => m.event_id === event.id
  ).length;

  if (!isEnrolled && event.status === 'active') {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-center shadow-xl">
          <Ticket className="mx-auto h-10 w-10 text-indigo-400" />
          <p className="mt-3 text-xs font-semibold text-indigo-300">Event Check-In</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">{event.name}</h1>
          <p className="mt-2 text-sm text-slate-400">{event.description}</p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => setCheckInModalOpen(true)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500"
            >
              <Ticket className="h-4 w-4" />
              <span>Enter Event Ticket Code</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/events')}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>All Events</span>
            </button>
          </div>
        </div>

        <EventCheckInModal
          event={event}
          isOpen={checkInModalOpen}
          onClose={() => setCheckInModalOpen(false)}
          onSuccessEnter={() => setCheckInModalOpen(false)}
          closeLabel="Dismiss"
        />
      </div>
    );
  }

  return (
    <div className="pb-10">
      {/* Compact Event Header */}
      <section className="border-b border-slate-800/80 bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="mx-auto max-w-7xl px-4 py-3.5 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <Link
                  to="/events"
                  className="inline-flex items-center gap-1 font-medium text-slate-300 hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Events</span>
                </Link>
                <span aria-hidden="true">&middot;</span>
                <span
                  className={
                    event.status === 'active'
                      ? 'font-semibold text-emerald-300'
                      : 'inline-flex items-center gap-1 text-slate-400'
                  }
                >
                  {event.status === 'active' ? (
                    'Live Event'
                  ) : (
                    <>
                      <Archive className="h-3 w-3" />
                      Past Event
                    </>
                  )}
                </span>
                <span aria-hidden="true">&middot;</span>
                <span className="tabular-nums">
                  Stamp Min {formatIdr(event.min_stamp_spend_idr)}
                </span>
              </div>

              <h1 className="mt-1 truncate text-lg font-extrabold tracking-tight text-white sm:text-2xl">
                {event.name}
              </h1>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {participant && (
                <div className="hidden sm:block text-right tabular-nums">
                  <p className="text-[11px] font-medium text-slate-400">Your Event Pass ID</p>
                  <p className="font-mono text-sm font-bold text-indigo-300">
                    {participant.qr_code}{' '}
                    <span className="font-sans text-xs text-emerald-300">
                      &middot; {participantStamps.length}/{eventBooths.length + 1} Stamps
                    </span>
                  </p>
                </div>
              )}

              {tenant && activeViewMode === 'merchant' && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-right">
                  <p className="text-[10px] font-semibold text-emerald-300">
                    Booth {tenant.booth_number}
                  </p>
                  <p className="max-w-[130px] truncate text-xs font-bold text-white">
                    {tenant.booth_name}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Sticky Horizontal Segmented Tab Bar */}
      <div className="sticky top-0 md:top-14 z-30 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-3 py-2 sm:px-4">
          {activeViewMode === 'buyer' ? (
            <nav
              className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1"
              aria-label="Event hub sections"
            >
              <button
                type="button"
                onClick={() => setActiveTab('buyer_dashboard')}
                className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                  activeTab === 'buyer_dashboard'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <QrCode className="h-3.5 w-3.5 shrink-0" />
                <span>My Pass</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('leaderboard')}
                className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                  activeTab === 'leaderboard'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Trophy className="h-3.5 w-3.5 shrink-0" />
                <span>Leaderboard</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                  activeTab === 'chat'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span>Meetups ({meetupCount})</span>
              </button>
            </nav>
          ) : (
            <nav
              className="no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-1"
              aria-label="Booth workspace sections"
            >
              <button
                type="button"
                onClick={() => setActiveTab('merchant_pos')}
                className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                  activeTab === 'merchant_pos'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>POS</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('merchant_analytics')}
                className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                  activeTab === 'merchant_analytics'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span>Analytics</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('merchant_setup')}
                className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                  activeTab === 'merchant_setup'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>Booth Setup</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('leaderboard')}
                className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                  activeTab === 'leaderboard'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Trophy className="h-3.5 w-3.5" />
                <span>Leaderboard</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition whitespace-nowrap ${
                  activeTab === 'chat'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Meetups ({meetupCount})</span>
              </button>
            </nav>
          )}
        </div>
      </div>

      {/* Active Workspace Tab Panels */}
      <div className="mx-auto max-w-7xl px-4 pt-5">
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
    if (!uid.trim()) {
      setError('Please enter your Booth Event Ticket Code.');
      return;
    }
    if (boothName.trim().length < 2) {
      setError('Please enter a Booth Name (at least 2 characters).');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await onJoinBooth({
        eventId,
        uidCode: uid.trim(),
        boothName: boothName.trim(),
        boothNumber: boothNumber.trim(),
      });
      await soundFeedback.playSuccessChime();
    } catch (err) {
      await soundFeedback.playErrorTone();
      const raw = err instanceof Error ? err.message : 'Unable to link booth.';
      setError(raw.replace(/Ticket UID/gi, 'Event Ticket Code'));
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
        You haven&apos;t registered a booth in this event yet. Enter a Booth Event Ticket Code
        (e.g. <code className="text-emerald-300">TKT-DEMO-SLR</code>).
      </p>
      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200"
        >
          {error}
        </div>
      )}
      <form onSubmit={handleLinkBooth} noValidate className="mt-4 space-y-3">
        <input
          type="text"
          value={uid}
          onChange={(e) => {
            setUid(e.target.value.toUpperCase());
            if (error) setError(null);
          }}
          placeholder="Booth Event Ticket Code (TKT-DEMO-SLR)"
          className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 font-mono text-sm uppercase text-white"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            type="text"
            value={boothName}
            onChange={(e) => {
              setBoothName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Booth Name"
            className="min-h-[44px] sm:col-span-2 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white"
          />
          <input
            type="text"
            value={boothNumber}
            onChange={(e) => setBoothNumber(e.target.value.toUpperCase())}
            placeholder="No. (E-04)"
            className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs uppercase text-white"
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => {
              setUid('TKT-DEMO-SLR');
              if (error) setError(null);
            }}
            className="min-h-[38px] text-xs font-semibold text-emerald-300 hover:underline"
          >
            Fill TKT-DEMO-SLR
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {loading ? 'Linking...' : 'Open Booth POS'}
          </button>
        </div>
      </form>
    </div>
  );
};