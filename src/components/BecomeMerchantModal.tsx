import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Sparkles, Store, Ticket, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { soundFeedback } from '../lib/soundFeedback';

interface BecomeMerchantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BecomeMerchantModal: React.FC<BecomeMerchantModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { currentUser, dataset, becomeMerchant } = useApp();
  const navigate = useNavigate();

  const activeEvents = useMemo(
    () => dataset.events.filter((e) => e.status === 'active'),
    [dataset.events]
  );

  const [selectedEventId, setSelectedEventId] = useState<string>(
    () => activeEvents[0]?.id ?? ''
  );
  const [brandName, setBrandName] = useState(
    currentUser?.merchant_brand_name ?? ''
  );
  const [boothNumber, setBoothNumber] = useState('');
  const [bio, setBio] = useState(currentUser?.merchant_bio ?? '');
  const [ticketUid, setTicketUid] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !currentUser) return null;

  const targetEventId = selectedEventId || activeEvents[0]?.id || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEventId) {
      setError('No active event is currently open for booth setup.');
      return;
    }
    if (brandName.trim().length < 2) {
      setError('Please enter a Booth or Brand Name (at least 2 characters).');
      return;
    }
    if (!ticketUid.trim()) {
      setError('Please enter your Booth Event Ticket Code.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await soundFeedback.unlockAudioContext();
      await becomeMerchant({
        brandName: brandName.trim(),
        bio: bio.trim(),
        ticketUid: ticketUid.trim(),
        eventId: targetEventId,
        boothNumber: boothNumber.trim(),
      });
      await soundFeedback.playSuccessChime();
      onClose();
      navigate(`/event/${targetEventId}`);
    } catch (err) {
      await soundFeedback.playErrorTone();
      const raw = err instanceof Error ? err.message : 'Unable to activate booth access.';
      setError(raw.replace(/Ticket UID/gi, 'Event Ticket Code'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="become-merchant-title"
    >
      <div className="w-full max-w-lg rounded-t-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h2 id="become-merchant-title" className="text-lg font-bold text-white">
                Unlock Your Booth
              </h2>
              <p className="text-xs text-slate-400">
                Link your Booth Event Ticket Code to open your booth checkout terminal.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-medium text-rose-200"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="merchant-event"
              className="mb-1.5 block text-xs font-semibold text-slate-200"
            >
              Active Event
            </label>
            <select
              id="merchant-event"
              value={targetEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {activeEvents.length === 0 ? (
                <option value="">No active events available</option>
              ) : (
                activeEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label
                htmlFor="merchant-brand"
                className="mb-1.5 block text-xs font-semibold text-slate-200"
              >
                Booth / Circle Name
              </label>
              <input
                id="merchant-brand"
                type="text"
                value={brandName}
                onChange={(e) => {
                  setBrandName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. Tsukimi Doujin Circle"
                className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="merchant-booth-num"
                className="mb-1.5 block text-xs font-semibold text-slate-200"
              >
                Booth No.
              </label>
              <input
                id="merchant-booth-num"
                type="text"
                value={boothNumber}
                onChange={(e) => setBoothNumber(e.target.value.toUpperCase())}
                placeholder="e.g. E-04"
                className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm uppercase text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="merchant-bio"
              className="mb-1.5 block text-xs font-semibold text-slate-200"
            >
              Booth Summary
            </label>
            <textarea
              id="merchant-bio"
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Artbooks, holo keychains, acrylic standees & commissions..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="merchant-ticket-uid"
                className="text-xs font-semibold text-slate-200"
              >
                Booth Event Ticket Code
              </label>
              <button
                type="button"
                onClick={() => {
                  setTicketUid('TKT-DEMO-SLR');
                  if (error) setError(null);
                }}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
              >
                <Sparkles className="h-3 w-3" />
                Fill Demo: TKT-DEMO-SLR
              </button>
            </div>
            <div className="relative">
              <Ticket className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="merchant-ticket-uid"
                type="text"
                value={ticketUid}
                onChange={(e) => {
                  setTicketUid(e.target.value.toUpperCase());
                  if (error) setError(null);
                }}
                placeholder="TKT-DEMO-SLR"
                className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-10 font-mono text-sm uppercase text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              {ticketUid && (
                <button
                  type="button"
                  onClick={() => setTicketUid('')}
                  className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
                  aria-label="Clear booth ticket code"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              Unlocking a booth enables the{' '}
              <strong className="text-white">Buyer / Booth</strong> switcher in your top bar so
              you can manage booth sales and still collect stamps around the hall.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !targetEventId}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500 disabled:opacity-60"
            >
              <Store className="h-3.5 w-3.5" />
              <span>{submitting ? 'Unlocking...' : 'Unlock Booth Access'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};