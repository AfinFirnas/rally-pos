import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  Calendar,
  CheckCircle2,
  QrCode,
  Sparkles,
  Store,
  Ticket,
  Users,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { EventCheckInModal } from '../components/EventCheckInModal';
import { formatIdr } from '../lib/ledgerEngine';
import type { Event } from '../types/types';

export const EventsDirectoryPage: React.FC = () => {
  const {
    dataset,
    getParticipantForEvent,
    getTenantForEvent,
    setActiveEventId,
  } = useApp();
  const navigate = useNavigate();

  const [checkInTargetEvent, setCheckInTargetEvent] = useState<Event | null>(null);

  const { activeEvents, archivedEvents } = useMemo(() => {
    return {
      activeEvents: dataset.events.filter((e) => e.status === 'active'),
      archivedEvents: dataset.events.filter((e) => e.status === 'archived'),
    };
  }, [dataset.events]);

  const handleEnterJoinedEvent = (eventId: string) => {
    setActiveEventId(eventId);
    navigate(`/event/${eventId}`);
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
        className={`flex flex-col justify-between rounded-2xl border p-5 sm:p-6 shadow-xl transition ${
          ev.status === 'active'
            ? 'border-indigo-500/35 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/35'
            : 'border-slate-800 bg-slate-900/60 opacity-90'
        }`}
      >
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span
              className={`font-semibold ${
                ev.status === 'active' ? 'text-emerald-300' : 'text-slate-400'
              }`}
            >
              {ev.status === 'active' ? (
                'Live Event'
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Archive className="h-3.5 w-3.5" />
                  Past Event
                </span>
              )}
            </span>

            {isJoined && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Checked In
              </span>
            )}
          </div>

          <h2 className="mt-2 text-xl font-bold text-white">{ev.name}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{ev.description}</p>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-slate-800/90 bg-slate-950/60 p-3 text-xs tabular-nums">
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
              <span className="text-slate-400">Stamp Min</span>
              <p className="mt-0.5 font-bold text-emerald-300">
                {formatIdr(ev.min_stamp_spend_idr)}
              </p>
            </div>
          </div>

          {participant && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2.5 text-xs tabular-nums">
              <div className="flex items-center gap-2 text-indigo-200">
                <QrCode className="h-4 w-4 text-indigo-400" />
                <span>
                  Pass ID: <strong className="font-mono text-white">{participant.qr_code}</strong>
                </span>
              </div>
              <span className="font-semibold text-emerald-300">
                Stamps: {participantStamps.length}/{totalStampSlots}
              </span>
            </div>
          )}

          {tenant && (
            <div className="mt-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-200">
              Your Booth: <strong>{tenant.booth_number}</strong> &middot; {tenant.booth_name}
            </div>
          )}
        </div>

        <div className="mt-5">
          {isJoined ? (
            <button
              type="button"
              onClick={() => handleEnterJoinedEvent(ev.id)}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500"
            >
              <span>Open Event Hub</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : ev.status === 'active' ? (
            <button
              type="button"
              onClick={() => setCheckInTargetEvent(ev)}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-500 hover:to-emerald-500"
            >
              <Ticket className="h-4 w-4" />
              <span>Event Check-In</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleEnterJoinedEvent(ev.id)}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              <span>View Past Stamps</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-indigo-300">Convention Directory</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white sm:text-3xl">
            Events &amp; Stamp Rallies
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Check in with your Event Ticket Code to unlock your{' '}
            <span className="font-mono text-indigo-300">EV-XXXXXX</span> Attendee Checkout QR
            and Stamp #1.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-2 text-xs text-slate-300">
          Demo Codes:{' '}
          <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-indigo-300">
            TKT-DEMO-BYR
          </code>
          <span className="text-slate-500">Attendee</span> &middot;{' '}
          <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-emerald-300">
            TKT-DEMO-SLR
          </code>
          <span className="text-slate-500">Booth</span>
        </div>
      </div>

      {/* Live Active Events */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-bold text-white">Live Events</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {activeEvents.map(renderEventCard)}
        </div>
      </section>

      {/* Past Events */}
      {archivedEvents.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-slate-400" />
            <h2 className="text-lg font-bold text-slate-200">Past Events</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {archivedEvents.map(renderEventCard)}
          </div>
        </section>
      )}

      {/* Unified Event Check-In Modal */}
      <EventCheckInModal
        event={checkInTargetEvent}
        isOpen={Boolean(checkInTargetEvent)}
        onClose={() => setCheckInTargetEvent(null)}
        onSuccessEnter={(joinedEventId) => {
          setCheckInTargetEvent(null);
          handleEnterJoinedEvent(joinedEventId);
        }}
      />
    </div>
  );
};