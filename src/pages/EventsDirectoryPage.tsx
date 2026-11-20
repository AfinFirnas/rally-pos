import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Compass,
  QrCode,
  Sparkles,
  Store,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import { type JoinEventResult, useApp } from '../context/AppContext';
import { formatIdr } from '../lib/ledgerEngine';
import { soundFeedback } from '../lib/soundFeedback';
import type { Event } from '../types/types';

export const EventsDirectoryPage: React.FC = () => {
  const {
    currentUser,
    dataset,
    getParticipantForEvent,
    getTenantForEvent,
    joinEventWithTicketUid,
    setActiveEventId,
  } = useApp();
  const navigate = useNavigate();

  const [joinTargetEvent, setJoinTargetEvent] = useState<Event | null>(null);
  const [ticketUidInput, setTicketUidInput] = useState('');
  const [boothNameInput, setBoothNameInput] = useState(
    currentUser?.merchant_brand_name ?? ''
  );
  const [boothNumberInput, setBoothNumberInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState<JoinEventResult | null>(null);

  const { activeEvents, archivedEvents } = useMemo(() => {
    return {
      activeEvents: dataset.events.filter((e) => e.status === 'active'),
      archivedEvents: dataset.events.filter((e) => e.status === 'archived'),
    };
  }, [dataset.events]);

  const isMerchantTicketPreview = useMemo(() => {
    if (!joinTargetEvent || !ticketUidInput.trim()) return false;
    const found = dataset.ticket_uids.find(
      (t) =>
        t.event_id === joinTargetEvent.id &&
        t.uid_code.toUpperCase() === ticketUidInput.trim().toUpperCase()
    );
    return found?.role_type === 'merchant' || ticketUidInput.trim().toUpperCase().includes('SLR');
  }, [joinTargetEvent, ticketUidInput, dataset.ticket_uids]);

  const openJoinModal = (ev: Event) => {
    setJoinTargetEvent(ev);
    setTicketUidInput('');
    setBoothNameInput(currentUser?.merchant_brand_name ?? '');
    setBoothNumberInput('');
    setJoinError(null);
    setJoinSuccess(null);
  };

  const closeJoinModal = () => {
    setJoinTargetEvent(null);
    setJoinError(null);
    setJoinSuccess(null);
  };

  const handleEnterJoinedEvent = (eventId: string) => {
    setActiveEventId(eventId);
    navigate(`/event/${eventId}`);
  };

  const handleVerifyTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinTargetEvent) return;

    setJoinError(null);
    setJoining(true);
    try {
      await soundFeedback.unlockAudioContext();
      const result = await joinEventWithTicketUid({
        eventId: joinTargetEvent.id,
        uidCode: ticketUidInput,
        boothName: boothNameInput || undefined,
        boothNumber: boothNumberInput || undefined,
      });
      await soundFeedback.playSuccessChime();
      setJoinSuccess(result);
    } catch (err) {
      await soundFeedback.playErrorTone();
      setJoinError(
        err instanceof Error ? err.message : 'Ticket UID verification failed.'
      );
    } finally {
      setJoining(false);
    }
  };

  const renderEventCard = (ev: Event) => {
    const participant = getParticipantForEvent(ev.id);
    const tenant = getTenantForEvent(ev.id);
    const isJoined = Boolean(participant || tenant);
    const eventBooths = dataset.tenants.filter((t) => t.event_id === ev.id);
    const eventAttendees = dataset.event_participants.filter(
      (p) => p.event_id === ev.id
    );
    const participantStamps = participant
      ? dataset.stamps.filter(
          (s) => s.event_id === ev.id && s.participant_id === participant.id
        )
      : [];

    const totalStampSlots = eventBooths.length + 1;

    return (
      <article
        key={ev.id}
        className={`flex flex-col justify-between rounded-2xl border p-6 shadow-xl transition ${
          ev.status === 'active'
            ? 'border-indigo-500/35 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40'
            : 'border-slate-800 bg-slate-900/60 opacity-90'
        }`}
      >
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                ev.status === 'active'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {ev.status === 'active' ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live Active Event
                </>
              ) : (
                <>
                  <Archive className="h-3.5 w-3.5" />
                  Archived Event
                </>
              )}
            </span>

            {isJoined && (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-xs font-semibold text-indigo-200">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                Enrolled
              </span>
            )}
          </div>

          <h2 className="mt-3 text-xl font-bold text-white">{ev.name}</h2>
          <p className="mt-1.5 text-sm text-slate-300">{ev.description}</p>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-slate-800/90 bg-slate-950/60 p-3 text-xs">
            <div>
              <span className="flex items-center gap-1 text-slate-400">
                <Users className="h-3.5 w-3.5" />
                Attendees
              </span>
              <p className="mt-0.5 font-bold text-white">{eventAttendees.length}</p>
            </div>
            <div>
              <span className="flex items-center gap-1 text-slate-400">
                <Store className="h-3.5 w-3.5" />
                Booths
              </span>
              <p className="mt-0.5 font-bold text-white">{eventBooths.length}</p>
            </div>
            <div>
              <span className="text-slate-400">Min / Stamp</span>
              <p className="mt-0.5 font-bold text-emerald-300">
                {formatIdr(ev.min_stamp_spend_idr)}
              </p>
            </div>
          </div>

          {participant && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2 text-indigo-200">
                <QrCode className="h-4 w-4 text-indigo-400" />
                <span>
                  QR: <strong className="font-mono text-white">{participant.qr_code}</strong>
                </span>
              </div>
              <span className="font-semibold text-emerald-300">
                Stamps: {participantStamps.length}/{totalStampSlots}
              </span>
            </div>
          )}

          {tenant && (
            <div className="mt-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-200">
              Merchant Booth: <strong>{tenant.booth_number}</strong> &middot; {tenant.booth_name}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          {isJoined ? (
            <button
              type="button"
              onClick={() => handleEnterJoinedEvent(ev.id)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500"
            >
              <span>Enter Event Hub</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : ev.status === 'active' ? (
            <button
              type="button"
              onClick={() => openJoinModal(ev)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-500 hover:to-emerald-500"
            >
              <Ticket className="h-4 w-4" />
              <span>Join Event Hub</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleEnterJoinedEvent(ev.id)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              <span>View Archived Records</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300">
            <Compass className="h-3.5 w-3.5" />
            <span>Multi-Event Directory &amp; Ticket Gate</span>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
            Event Hubs
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter your Ticket UID to join an event hub, mint your cryptographic{' '}
            <code className="text-indigo-300">EV-XXXXXX</code> QR badge, and unlock Stamp #1.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2.5 text-xs text-slate-300">
          Demo Ticket UIDs:{' '}
          <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-indigo-300">
            TKT-DEMO-BYR
          </code>
          <span className="text-slate-500">(Buyer)</span> /{' '}
          <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-emerald-300">
            TKT-DEMO-SLR
          </code>
          <span className="text-slate-500">(Merchant)</span>
        </div>
      </div>

      {/* Live Active Events */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-bold text-white">Live Active Events</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {activeEvents.map(renderEventCard)}
        </div>
      </section>

      {/* Past Archived Events */}
      {archivedEvents.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-slate-400" />
            <h2 className="text-lg font-bold text-slate-200">Past Archived Events</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {archivedEvents.map(renderEventCard)}
          </div>
        </section>
      )}

      {/* Ticket UID Verification Modal */}
      {joinTargetEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-event-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                  Ticket UID Join Gate
                </span>
                <h2
                  id="join-event-modal-title"
                  className="mt-0.5 text-lg font-bold text-white"
                >
                  {joinTargetEvent.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeJoinModal}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close Ticket Gate modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {joinSuccess ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/15 p-4 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
                  <h3 className="mt-2 text-base font-bold text-white">
                    Enrolled &amp; Stamp #1 Unlocked!
                  </h3>
                  <p className="mt-1 text-xs text-emerald-200">
                    Event Check-In Stamp #1 has been added to your album (1/
                    {dataset.tenants.filter((t) => t.event_id === joinTargetEvent.id).length + 1}
                    ).
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-center">
                  <p className="text-xs uppercase tracking-wider text-slate-400">
                    Your Event Cryptographic QR Code
                  </p>
                  <p className="mt-1 font-mono text-2xl font-extrabold tracking-widest text-indigo-300">
                    {joinSuccess.participant.qr_code}
                  </p>
                  {joinSuccess.tenant && (
                    <p className="mt-2 text-xs text-emerald-300">
                      Booth Activated: <strong>{joinSuccess.tenant.booth_name}</strong> (
                      {joinSuccess.tenant.booth_number})
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleEnterJoinedEvent(joinTargetEvent.id)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500"
                >
                  <span>Open Event Hub</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <form onSubmit={handleVerifyTicket} className="mt-5 space-y-4">
                {joinError && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-medium text-rose-200">
                    {joinError}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="ticket-uid-input"
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Enter Ticket UID
                  </label>
                  <div className="relative">
                    <Ticket className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="ticket-uid-input"
                      type="text"
                      required
                      value={ticketUidInput}
                      onChange={(e) => setTicketUidInput(e.target.value.toUpperCase())}
                      placeholder="e.g. TKT-DEMO-BYR"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-3.5 font-mono text-sm uppercase text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  {/* Quick-fill demo ticket chips */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setTicketUidInput('TKT-DEMO-BYR')}
                      className="rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-300 hover:bg-indigo-500/20"
                    >
                      Demo Buyer: TKT-DEMO-BYR
                    </button>
                    <button
                      type="button"
                      onClick={() => setTicketUidInput('TKT-DEMO-SLR')}
                      className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Demo Merchant: TKT-DEMO-SLR
                    </button>
                  </div>
                </div>

                {isMerchantTicketPreview && (
                  <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
                    <p className="text-xs font-semibold text-emerald-200">
                      Merchant Ticket Detected — Booth Details
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        type="text"
                        value={boothNameInput}
                        onChange={(e) => setBoothNameInput(e.target.value)}
                        placeholder="Booth Name"
                        className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={boothNumberInput}
                        onChange={(e) => setBoothNumberInput(e.target.value)}
                        placeholder="Booth No. (E-04)"
                        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs uppercase text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-400">
                  Validating your Ticket UID enrolls you into the event group chat &amp;
                  leaderboard, issues your <code className="text-indigo-300">EV-XXXXXX</code>{' '}
                  QR code, and unlocks <strong>Stamp #1 (&ldquo;Event Check-In&rdquo;)</strong>.
                </p>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closeJoinModal}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={joining}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-60"
                  >
                    <span>{joining ? 'Verifying...' : 'Verify & Join Hub'}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};