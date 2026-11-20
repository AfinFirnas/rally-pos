import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Award,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Flame,
  Gift,
  Lock,
  Maximize2,
  QrCode,
  Sparkles,
  Store,
  TrendingUp,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import {
  computeLeaderboardStanding,
  evaluateSixtyMinuteStreak,
  formatIdr,
} from '../../lib/ledgerEngine';
import type {
  DemoSeedDataset,
  Event,
  EventParticipant,
  LeaderboardEntry,
  Tenant,
} from '../../types/types';

interface BuyerDashboardPanelProps {
  event: Event;
  participant: EventParticipant | null;
  dataset: DemoSeedDataset;
}

type AlbumFilter = 'all' | 'unlocked' | 'remaining' | 'bounty';

function formatCountdownMmSs(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function makeFallbackBoothBadge(boothNumber: string, boothName: string): string {
  const initials = boothName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="22" fill="#1e293b"/><text x="60" y="56" font-family="system-ui,sans-serif" font-weight="800" font-size="28" fill="#a5b4fc" text-anchor="middle">${initials || 'BOOTH'}</text><text x="60" y="96" font-family="monospace" font-weight="700" font-size="14" fill="#34d399" text-anchor="middle">${boothNumber}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const BuyerDashboardPanel: React.FC<BuyerDashboardPanelProps> = ({
  event,
  participant,
  dataset,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [albumFilter, setAlbumFilter] = useState<AlbumFilter>('all');
  const [copiedQr, setCopiedQr] = useState(false);
  const [enlargedQrOpen, setEnlargedQrOpen] = useState(false);
  const [selectedBooth, setSelectedBooth] = useState<Tenant | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const userNameMap = useMemo(
    () => new Map(dataset.users.map((u) => [u.id, u.username])),
    [dataset.users]
  );

  const eventBooths = useMemo(
    () =>
      dataset.tenants
        .filter((t) => t.event_id === event.id)
        .sort((a, b) => a.booth_number.localeCompare(b.booth_number)),
    [dataset.tenants, event.id]
  );

  const participantStamps = useMemo(() => {
    if (!participant) return [];
    return dataset.stamps.filter(
      (s) => s.event_id === event.id && s.participant_id === participant.id
    );
  }, [dataset.stamps, event.id, participant]);

  const checkInStamp = useMemo(
    () => participantStamps.find((s) => s.stamp_type === 'checkin') ?? null,
    [participantStamps]
  );

  const stampedBoothIds = useMemo(
    () =>
      new Set(
        participantStamps
          .filter((s) => s.stamp_type === 'booth' && s.tenant_id !== null)
          .map((s) => s.tenant_id as string)
      ),
    [participantStamps]
  );

  const participantTxs = useMemo(() => {
    if (!participant) return [];
    return dataset.transactions
      .filter((tx) => tx.event_id === event.id && tx.participant_id === participant.id)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [dataset.transactions, event.id, participant]);

  const standing = useMemo(() => {
    const entries: LeaderboardEntry[] = dataset.event_participants
      .filter((p) => p.event_id === event.id)
      .map((p) => ({
        participant_id: p.id,
        event_id: p.event_id,
        user_id: p.user_id,
        username: userNameMap.get(p.user_id) ?? 'Attendee',
        leaderboard_idr: p.leaderboard_idr,
        streak_expires_at: p.streak_expires_at,
        stamps_count: dataset.stamps.filter(
          (s) => s.event_id === event.id && s.participant_id === p.id
        ).length,
        rank_position: 0,
      }));

    return computeLeaderboardStanding(entries, participant?.id);
  }, [dataset.event_participants, dataset.stamps, event.id, participant?.id, userNameMap]);

  const streakInfo = useMemo(() => {
    if (!participant) {
      return {
        isActive: false,
        remainingMs: 0,
        progressPct: 0,
        distinctLast60m: 0,
      };
    }

    const expiresMs = participant.streak_expires_at
      ? Date.parse(participant.streak_expires_at)
      : 0;
    const remainingMs = Math.max(0, expiresMs - nowMs);
    const isActive = remainingMs > 0;

    const windowStartMs = nowMs - 60 * 60_000;
    const distinctRecentBooths = new Set<string>();
    for (const tx of participantTxs) {
      if (tx.status !== 'completed') continue;
      const tMs = Date.parse(tx.created_at);
      if (tMs >= windowStartMs && tMs <= nowMs) {
        distinctRecentBooths.add(tx.tenant_id);
      }
    }

    if (isActive) {
      evaluateSixtyMinuteStreak({
        currentTenantId: participantTxs[0]?.tenant_id ?? '',
        currentStreakExpiresAt: participant.streak_expires_at,
        recentParticipantTransactions: participantTxs,
        now: nowMs,
      });
    }

    return {
      isActive,
      remainingMs,
      progressPct: isActive ? Math.min(100, (remainingMs / (60 * 60_000)) * 100) : 0,
      distinctLast60m: distinctRecentBooths.size,
    };
  }, [participant, participantTxs, nowMs]);

  const filteredBooths = useMemo(() => {
    return eventBooths.filter((booth) => {
      const unlocked = stampedBoothIds.has(booth.id);
      const coldActive =
        booth.is_cold_bounty &&
        (!booth.cold_bounty_expires_at ||
          Date.parse(booth.cold_bounty_expires_at) > nowMs);

      if (albumFilter === 'unlocked') return unlocked;
      if (albumFilter === 'remaining') return !unlocked;
      if (albumFilter === 'bounty') return coldActive;
      return true;
    });
  }, [eventBooths, stampedBoothIds, albumFilter, nowMs]);

  const selectedBoothItems = useMemo(() => {
    if (!selectedBooth) return [];
    return dataset.tenant_items
      .filter((i) => i.tenant_id === selectedBooth.id && i.is_active)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [dataset.tenant_items, selectedBooth]);

  const handleCopyQr = async () => {
    if (!participant) return;
    try {
      await navigator.clipboard.writeText(participant.qr_code);
      setCopiedQr(true);
      window.setTimeout(() => setCopiedQr(false), 1800);
    } catch {
      // Ignore clipboard permission denials
    }
  };

  if (!participant) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center">
        <QrCode className="mx-auto h-10 w-10 text-slate-500" />
        <h2 className="mt-3 text-lg font-bold text-white">Event Pass Inactive</h2>
        <p className="mt-1 text-xs text-slate-400">
          Complete Event Check-In with your Event Ticket Code to receive your Attendee Checkout QR
          and Stamp #1.
        </p>
      </div>
    );
  }

  const totalStampSlots = eventBooths.length + 1;
  const boostDeltaIdr = Math.max(
    0,
    participant.leaderboard_idr - participant.actual_spent_idr
  );

  return (
    <div className="space-y-5">
      {/* ABOVE THE FOLD: Compact Horizontal Attendee Checkout QR Card */}
      <section className="rounded-2xl border border-indigo-500/40 bg-gradient-to-r from-indigo-950/75 via-slate-900 to-slate-900 p-3.5 sm:p-5 shadow-xl">
        <div className="flex items-center gap-3.5 sm:gap-5">
          {/* Left: Tap-to-Enlarge QR Thumbnail */}
          <button
            type="button"
            onClick={() => setEnlargedQrOpen(true)}
            className="group relative shrink-0 rounded-xl bg-white p-2 shadow-lg transition active:scale-[0.98]"
            aria-label="Enlarge Attendee Checkout QR"
          >
            <QRCodeSVG
              value={participant.qr_code}
              size={84}
              level="M"
              bgColor="#ffffff"
              fgColor="#0f172a"
            />
            <span className="mt-1 flex items-center justify-center gap-1 text-[10px] font-bold text-slate-600 group-hover:text-indigo-600">
              <Maximize2 className="h-2.5 w-2.5" />
              Enlarge
            </span>
          </button>

          {/* Right: Pass ID + 1-Tap Copy + Enlarge CTA */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-semibold text-indigo-300">Attendee Checkout QR</span>
              <span className="hidden sm:inline text-slate-500" aria-hidden="true">
                &middot;
              </span>
              <span className="hidden sm:inline text-slate-400">Show at booths</span>
            </div>

            <p className="mt-1 text-[11px] font-medium text-slate-400">Your Event Pass ID</p>
            <p className="truncate font-mono text-xl font-extrabold tracking-widest text-white sm:text-2xl tabular-nums">
              {participant.qr_code}
            </p>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyQr()}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/90 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-indigo-400 hover:bg-slate-800"
              >
                {copiedQr ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-indigo-300" />
                    <span>Copy ID</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setEnlargedQrOpen(true)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-indigo-500"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Full Brightness QR</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Personal Spend Summary · Private & Core Metrics (Above the Fold on Mobile) */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-300">
            <Lock className="h-3.5 w-3.5 text-emerald-400" />
            Personal Spend Summary &middot; Private
          </span>
          <span className="hidden sm:inline text-slate-400">
            Live standings &amp; stamp progress
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* Total Spent (Private) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-400">
              <span>Total Spent (Private)</span>
              <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            </div>
            <p className="mt-1.5 truncate font-mono text-lg font-extrabold text-white sm:text-xl tabular-nums">
              {formatIdr(participant.actual_spent_idr)}
            </p>
            <p className="mt-1 text-[11px] text-slate-400 truncate">Only visible to you</p>
          </div>

          {/* Leaderboard Score (IDR) */}
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-slate-900 to-amber-950/20 p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-amber-300">
              <span className="truncate">Leaderboard Score (IDR)</span>
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            </div>
            <p className="mt-1.5 truncate font-mono text-lg font-extrabold text-amber-300 sm:text-xl tabular-nums">
              {formatIdr(participant.leaderboard_idr)}
            </p>
            <p className="mt-1 truncate text-[11px] text-slate-300 tabular-nums">
              {boostDeltaIdr > 0
                ? `+${formatIdr(boostDeltaIdr)} boost bonus`
                : 'Public rally ranking'}
            </p>
          </div>

          {/* Event Rank */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-400">
              <span>Event Rank</span>
              <Trophy className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-indigo-300 sm:text-xl tabular-nums">
              #{standing.targetEntry?.rank_position ?? '-'}
              <span className="ml-1.5 font-sans text-[11px] font-medium text-slate-400">
                / {standing.ranked.length}
              </span>
            </p>
            <p className="mt-1 truncate text-[11px] text-slate-300 tabular-nums">
              {standing.leaderAhead
                ? `${formatIdr(standing.gapToOvertakeIdr)} to pass #${standing.leaderAhead.rank_position}`
                : 'Leading the rally'}
            </p>
          </div>

          {/* Stamps Collected */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-400">
              <span>Booth Stamps</span>
              <Award className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            </div>
            <p className="mt-1.5 font-mono text-lg font-extrabold text-emerald-300 sm:text-xl tabular-nums">
              {participantStamps.length} / {totalStampSlots}
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-500"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((participantStamps.length / Math.max(1, totalStampSlots)) * 100)
                  )}%`,
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 60-Minute Streak Multiplier Bar */}
      <div
        className={`rounded-2xl border p-4 transition ${
          streakInfo.isActive
            ? 'border-orange-400/50 bg-gradient-to-r from-orange-950/55 via-slate-900 to-amber-950/45'
            : 'border-slate-800 bg-slate-900/80'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                streakInfo.isActive
                  ? 'bg-orange-500/25 text-orange-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <Flame className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">
                {streakInfo.isActive
                  ? '1.25x Speedrunner Streak Active'
                  : '60-Minute Streak Bonus (1.25x)'}
              </p>
              <p className="text-xs text-slate-300">
                {streakInfo.isActive
                  ? 'Purchases earn 1.25x Leaderboard Score (stacks with Gold Boosts).'
                  : `Shop at 3 distinct booths within 60 min (${Math.min(3, streakInfo.distinctLast60m)}/3 so far).`}
              </p>
            </div>
          </div>

          {streakInfo.isActive ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-orange-400/40 bg-slate-950/80 px-3 py-1.5 font-mono text-sm font-extrabold text-orange-300 tabular-nums">
              <Clock className="h-4 w-4" />
              <span>{formatCountdownMmSs(streakInfo.remainingMs)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold tabular-nums ${
                    streakInfo.distinctLast60m >= step
                      ? 'bg-orange-500 text-slate-950'
                      : 'border border-slate-700 bg-slate-950 text-slate-500'
                  }`}
                >
                  {step}
                </span>
              ))}
            </div>
          )}
        </div>

        {streakInfo.isActive && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-950/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-300 transition-all duration-1000"
              style={{ width: `${streakInfo.progressPct}%` }}
            />
          </div>
        )}
      </div>

      {/* 2-Column 1:1 Stamp Passport Grid & Floor Directory */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              Stamp Passport &amp; Booths
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Spend{' '}
              <strong className="text-emerald-300 tabular-nums">
                {formatIdr(event.min_stamp_spend_idr)}
              </strong>{' '}
              at a booth to stamp its 1:1 badge. Tap any booth to preview its menu.
            </p>
          </div>

          <div className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
            {(
              [
                { id: 'all', label: `All (${eventBooths.length})` },
                { id: 'unlocked', label: `Stamped (${stampedBoothIds.size})` },
                {
                  id: 'remaining',
                  label: `Left (${Math.max(0, eventBooths.length - stampedBoothIds.size)})`,
                },
                { id: 'bounty', label: 'Gold Boost' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setAlbumFilter(f.id)}
                className={`min-h-[34px] shrink-0 rounded-lg px-2.5 py-1 font-semibold transition whitespace-nowrap ${
                  albumFilter === f.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* 2-Column Square Stamp Grid on Mobile */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {/* Stamp #1: Event Check-In */}
          {albumFilter === 'all' || albumFilter === 'unlocked' ? (
            <div className="flex flex-col items-center justify-between rounded-2xl border border-indigo-400/60 bg-gradient-to-b from-indigo-950/60 to-slate-950 p-3 text-center">
              <div className="flex w-full items-center justify-between text-[11px] font-semibold">
                <span className="font-mono text-indigo-300">#01</span>
                <span className="inline-flex items-center gap-0.5 text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  Checked In
                </span>
              </div>
              <div className="my-2.5 flex aspect-square w-full max-w-[96px] items-center justify-center rounded-2xl border-2 border-dashed border-indigo-400/60 bg-indigo-500/20 text-indigo-200">
                <div className="text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
                  <span className="mt-1 block text-[10px] font-extrabold uppercase tracking-wide">
                    Check-In
                  </span>
                </div>
              </div>
              <div className="w-full">
                <p className="truncate text-xs font-bold text-white sm:text-sm">
                  Event Check-In
                </p>
                <p className="mt-0.5 truncate text-[11px] text-slate-400 tabular-nums">
                  {checkInStamp
                    ? new Date(checkInStamp.unlocked_at).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Pass Active'}
                </p>
              </div>
            </div>
          ) : null}

          {/* Participating Booth Stamps */}
          {filteredBooths.map((booth) => {
            const unlocked = stampedBoothIds.has(booth.id);
            const coldExpiresMs = booth.cold_bounty_expires_at
              ? Date.parse(booth.cold_bounty_expires_at)
              : null;
            const coldRemainingMs =
              coldExpiresMs !== null ? Math.max(0, coldExpiresMs - nowMs) : null;
            const isColdBoosted =
              booth.is_cold_bounty && (coldRemainingMs === null || coldRemainingMs > 0);
            const stampImg =
              booth.stamp_image_url ||
              makeFallbackBoothBadge(booth.booth_number, booth.booth_name);

            return (
              <button
                key={booth.id}
                type="button"
                onClick={() => setSelectedBooth(booth)}
                className={`group flex flex-col items-center justify-between rounded-2xl border p-3 text-center transition active:scale-[0.98] ${
                  isColdBoosted
                    ? 'border-amber-400/80 bg-gradient-to-b from-amber-950/40 via-slate-900 to-slate-950 shadow-[0_0_20px_rgba(251,191,36,0.16)]'
                    : unlocked
                      ? 'border-emerald-500/60 bg-gradient-to-b from-emerald-950/25 to-slate-950'
                      : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-1 text-[11px] font-semibold">
                  <span className="font-mono text-slate-300">{booth.booth_number}</span>
                  {isColdBoosted ? (
                    <span className="inline-flex items-center gap-0.5 text-amber-300">
                      <Zap className="h-3 w-3" />
                      {booth.cold_bounty_multiplier}x
                    </span>
                  ) : unlocked ? (
                    <span className="inline-flex items-center gap-0.5 text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      Stamped
                    </span>
                  ) : (
                    <span className="text-slate-500">Locked</span>
                  )}
                </div>

                {/* 1:1 Stamp Artwork */}
                <div
                  className={`relative my-2.5 aspect-square w-full max-w-[96px] overflow-hidden rounded-2xl border-2 transition ${
                    isColdBoosted
                      ? 'border-amber-400'
                      : unlocked
                        ? 'border-emerald-400/70'
                        : 'border-slate-800 grayscale opacity-45 group-hover:opacity-75'
                  }`}
                >
                  <img
                    src={stampImg}
                    alt={`${booth.booth_name} stamp`}
                    className="h-full w-full object-cover"
                  />
                  {!unlocked && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/45">
                      <Lock className="h-5 w-5 text-slate-200" />
                    </div>
                  )}
                </div>

                <div className="w-full">
                  <p className="truncate text-xs font-bold text-white sm:text-sm">
                    {booth.booth_name}
                  </p>
                  {isColdBoosted && coldRemainingMs !== null ? (
                    <p className="mt-0.5 truncate font-mono text-[11px] font-semibold text-amber-300 tabular-nums">
                      {formatCountdownMmSs(coldRemainingMs)} left
                    </p>
                  ) : (
                    <p className="mt-0.5 truncate text-[11px] text-slate-400 tabular-nums">
                      {unlocked
                        ? 'In passport'
                        : `Min ${formatIdr(event.min_stamp_spend_idr)}`}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Personal Purchase History */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white">
            Your Purchase History ({participantTxs.length})
          </h3>
          <span className="text-xs text-slate-400">
            Personal Spend Summary &middot; Private
          </span>
        </div>

        {participantTxs.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">
            No booth purchases recorded yet. Show your Attendee Checkout QR at any booth to start
            collecting stamps.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {participantTxs.map((tx) => {
              const booth = eventBooths.find((b) => b.id === tx.tenant_id);
              const isVoided = tx.status === 'voided';
              return (
                <div
                  key={tx.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${
                    isVoided
                      ? 'border-slate-800/60 bg-slate-950/30 opacity-55'
                      : 'border-slate-800 bg-slate-950/70'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-indigo-300">
                        {booth?.booth_number ?? 'BOOTH'}
                      </span>
                      <span className="font-bold text-white">
                        {booth?.booth_name ?? 'Creator Booth'}
                      </span>
                      {tx.multiplier_applied > 1 && !isVoided && (
                        <span className="text-[11px] font-bold text-amber-300">
                          &middot; {tx.multiplier_applied}x Boost
                        </span>
                      )}
                      {tx.hit_hidden_bounty && !isVoided && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-violet-300">
                          <Gift className="h-3 w-3" />
                          Secret Bonus
                        </span>
                      )}
                      {isVoided && (
                        <span className="text-[11px] font-bold text-rose-300">
                          &middot; Voided
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                      {new Date(tx.created_at).toLocaleString('id-ID')}
                    </p>
                  </div>

                  <div className="text-right font-mono tabular-nums">
                    <p className="font-bold text-white">
                      Paid: {formatIdr(tx.actual_amount_idr)}
                    </p>
                    <p className="text-[11px] text-amber-300">
                      Score: {formatIdr(tx.leaderboard_amount_idr)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Enlarged Full-Brightness Attendee Checkout QR Modal */}
      {enlargedQrOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-sm"
          onClick={() => setEnlargedQrOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Full brightness Attendee Checkout QR"
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-slate-200/20 bg-white p-6 text-center text-slate-950 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-left">
                <p className="text-xs font-bold text-indigo-600">Attendee Checkout QR</p>
                <p className="text-xs font-medium text-slate-500">{event.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setEnlargedQrOpen(false)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close enlarged QR"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mx-auto my-4 inline-block rounded-2xl border border-slate-200 bg-white p-4">
              <QRCodeSVG
                value={participant.qr_code}
                size={236}
                level="M"
                bgColor="#ffffff"
                fgColor="#020617"
              />
            </div>

            <p className="text-xs font-medium text-slate-500">Your Event Pass ID</p>
            <p className="mt-0.5 font-mono text-2xl font-extrabold tracking-widest text-slate-950 tabular-nums">
              {participant.qr_code}
            </p>

            <button
              type="button"
              onClick={() => void handleCopyQr()}
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800"
            >
              {copiedQr ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span>Copied Pass ID</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Copy Event Pass ID</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Booth Directory & Merch Catalog Modal */}
      {selectedBooth && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setSelectedBooth(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-t-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src={
                    selectedBooth.stamp_image_url ||
                    makeFallbackBoothBadge(
                      selectedBooth.booth_number,
                      selectedBooth.booth_name
                    )
                  }
                  alt={selectedBooth.booth_name}
                  className="h-14 w-14 rounded-xl border border-slate-700 object-cover"
                />
                <div>
                  <span className="font-mono text-xs font-bold text-indigo-300">
                    Booth {selectedBooth.booth_number}
                  </span>
                  <h3 className="text-lg font-bold text-white">
                    {selectedBooth.booth_name}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBooth(null)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close booth details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-300">
              {selectedBooth.description || 'Creator booth participating in this event rally.'}
            </p>

            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                <Store className="h-3.5 w-3.5" />
                Booth Menu
              </p>
              {selectedBoothItems.length === 0 ? (
                <p className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
                  No menu items listed yet &mdash; visit the booth in person!
                </p>
              ) : (
                <div className="space-y-2">
                  {selectedBoothItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-xs"
                    >
                      <span className="font-medium text-white">{item.item_name}</span>
                      <span className="font-mono font-bold text-emerald-300 tabular-nums">
                        {formatIdr(item.price_idr)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};