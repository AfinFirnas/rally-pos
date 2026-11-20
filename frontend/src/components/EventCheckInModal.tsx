import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Ticket, X } from 'lucide-react';
import { type JoinEventResult, useApp } from '../context/AppContext';
import { soundFeedback } from '../lib/soundFeedback';
import type { Event } from '../types/types';

interface EventCheckInModalProps {
  event: Event | null;
  isOpen: boolean;
  onClose?: () => void;
  onSuccessEnter?: (eventId: string, result: JoinEventResult) => void;
  closeLabel?: string;
}

function humanizeCheckInError(rawMessage: string): string {
  const lower = rawMessage.toLowerCase();
  if (lower.includes('already been claimed')) {
    return 'This Event Ticket Code has already been claimed by another attendee.';
  }
  if (lower.includes('invalid for')) {
    return 'That Event Ticket Code is not valid for this event. Try TKT-DEMO-BYR or TKT-DEMO-SLR.';
  }
  if (lower.includes('only active events')) {
    return 'Check-in is closed because this event has already ended.';
  }
  if (lower.includes('enter your ticket')) {
    return 'Please enter your Event Ticket Code to check in.';
  }
  return rawMessage.replace(/Ticket UID/gi, 'Event Ticket Code');
}

export const EventCheckInModal: React.FC<EventCheckInModalProps> = ({
  event,
  isOpen,
  onClose,
  onSuccessEnter,
  closeLabel = 'Cancel',
}) => {
  const { currentUser, dataset, joinEventWithTicketUid } = useApp();

  const [ticketCodeInput, setTicketCodeInput] = useState('');
  const [boothNameInput, setBoothNameInput] = useState(
    currentUser?.merchant_brand_name ?? ''
  );
  const [boothNumberInput, setBoothNumberInput] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkInResult, setCheckInResult] = useState<JoinEventResult | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTicketCodeInput('');
      setBoothNameInput(currentUser?.merchant_brand_name ?? '');
      setBoothNumberInput('');
      setInlineError(null);
      setCheckInResult(null);
    }
  }, [isOpen, event?.id, currentUser?.merchant_brand_name]);

  const isMerchantCodePreview = useMemo(() => {
    if (!event || !ticketCodeInput.trim()) return false;
    const normalized = ticketCodeInput.trim().toUpperCase();
    const found = dataset.ticket_uids.find(
      (t) => t.event_id === event.id && t.uid_code.toUpperCase() === normalized
    );
    return found?.role_type === 'merchant' || normalized.includes('SLR');
  }, [event, ticketCodeInput, dataset.ticket_uids]);

  if (!isOpen || !event) return null;

  const totalStampSlots =
    dataset.tenants.filter((t) => t.event_id === event.id).length + 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = ticketCodeInput.trim().toUpperCase();
    if (!cleanCode) {
      setInlineError('Please enter your Event Ticket Code to check in.');
      return;
    }
    if (isMerchantCodePreview && boothNameInput.trim().length > 0 && boothNameInput.trim().length < 2) {
      setInlineError('Booth Name must be at least 2 characters.');
      return;
    }

    setInlineError(null);
    setSubmitting(true);
    try {
      await soundFeedback.unlockAudioContext();
      const result = await joinEventWithTicketUid({
        eventId: event.id,
        uidCode: cleanCode,
        boothName: boothNameInput.trim() || undefined,
        boothNumber: boothNumberInput.trim() || undefined,
      });
      await soundFeedback.playSuccessChime();
      setCheckInResult(result);
    } catch (err) {
      await soundFeedback.playErrorTone();
      const raw = err instanceof Error ? err.message : 'Unable to verify Event Ticket Code.';
      setInlineError(humanizeCheckInError(raw));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unified-checkin-title"
    >
      <div className="w-full max-w-md rounded-t-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-indigo-300">Event Check-In</p>
            <h2
              id="unified-checkin-title"
              className="mt-0.5 text-lg font-bold text-white"
            >
              {event.name}
            </h2>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-white"
              aria-label="Close check-in dialog"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {checkInResult ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <h3 className="mt-2 text-base font-bold text-white">
                Checked In &amp; Stamp #1 Unlocked
              </h3>
              <p className="mt-1 text-xs text-emerald-200">
                Your event passport is ready ({1}/{totalStampSlots} stamps collected).
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-center">
              <p className="text-xs font-medium text-slate-400">Your Event Pass ID</p>
              <p className="mt-1 font-mono text-2xl font-extrabold tracking-widest text-indigo-300 tabular-nums">
                {checkInResult.participant.qr_code}
              </p>
              {checkInResult.tenant && (
                <p className="mt-2 text-xs text-emerald-300">
                  Booth Activated: <strong>{checkInResult.tenant.booth_name}</strong> (
                  {checkInResult.tenant.booth_number})
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => onSuccessEnter?.(event.id, checkInResult)}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500"
            >
              <span>Open My Pass</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            {inlineError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-medium text-rose-200"
              >
                {inlineError}
              </div>
            )}

            <div>
              <label
                htmlFor="unified-ticket-code-input"
                className="mb-1.5 block text-xs font-semibold text-slate-200"
              >
                Event Ticket Code
              </label>
              <div className="relative">
                <Ticket className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="unified-ticket-code-input"
                  type="text"
                  value={ticketCodeInput}
                  onChange={(e) => {
                    setTicketCodeInput(e.target.value.toUpperCase());
                    if (inlineError) setInlineError(null);
                  }}
                  placeholder="Enter code (e.g. TKT-DEMO-BYR)"
                  className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-10 font-mono text-sm uppercase text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                {ticketCodeInput && (
                  <button
                    type="button"
                    onClick={() => setTicketCodeInput('')}
                    className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
                    aria-label="Clear ticket code"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTicketCodeInput('TKT-DEMO-BYR');
                    setInlineError(null);
                  }}
                  className="min-h-[38px] rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/20"
                >
                  Attendee Demo: TKT-DEMO-BYR
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTicketCodeInput('TKT-DEMO-SLR');
                    setInlineError(null);
                  }}
                  className="min-h-[38px] rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Booth Demo: TKT-DEMO-SLR
                </button>
              </div>
            </div>

            {isMerchantCodePreview && (
              <div className="space-y-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
                <p className="text-xs font-semibold text-emerald-200">
                  Booth Creator Code Detected
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    value={boothNameInput}
                    onChange={(e) => setBoothNameInput(e.target.value)}
                    placeholder="Booth Name"
                    className="min-h-[44px] sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={boothNumberInput}
                    onChange={(e) => setBoothNumberInput(e.target.value.toUpperCase())}
                    placeholder="Booth No. (E-04)"
                    className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs uppercase text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <p className="text-xs leading-relaxed text-slate-400">
              Checking in generates your <span className="font-mono text-indigo-300">EV-XXXXXX</span>{' '}
              Attendee Checkout QR, unlocks Stamp #1, and opens the Meetup board &amp; Leaderboard.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                >
                  {closeLabel}
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-60"
              >
                <span>{submitting ? 'Checking In...' : 'Complete Check-In'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
