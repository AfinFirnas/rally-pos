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

  // Live 1-second timer for 60-min streak & 30-min Cold-Booth countdowns
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

  // Event-scoped Leaderboard Rank & exact gap to overtake the buyer directly ahead
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

  // 60-Minute Streak State & Progress
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

    // Count distinct booths purchased in the last 60m from completed transactions
    const windowStartMs = nowMs - 60 * 60_000;
    const distinctRecentBooths = new Set<string>();
    for (const tx of participantTxs) {
      if (tx.status !== 'completed') continue;
      const tMs = Date.parse(tx.created_at);
      if (tMs >= windowStartMs && tMs <= nowMs) {
        distinctRecentBooths.add(tx.tenant_id);
      }
    }

    // Also inspect via engine using last booth if any
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
        <h2 className="mt-3 text-lg font-bold text-white">Buyer Rally Profile Inactive</h2>
        <p className="mt-1 text-xs text-slate-400">
          Join this event with a Ticket UID to receive your cryptographic QR pass and Stamp #1.
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
    <div className="space-y-6">
      {/* Top Row: Event-Scoped Dual-IDR KPIs + Scannable Cryptographic QR Pass */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left 8 Cols: 4 Dual-IDR Event KPIs & 60-Min Streak Bar */}
        <div className="space-y-4 lg:col-span-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Private Actual Money Spent */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5 shadow-lg">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-slate-400">
                  Private Actual Spent
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <Lock className="h-3 w-3" />
                  Only You
                </span>
              </div>
              <p className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
                {formatIdr(participant.actual_spent_idr)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Exact real IDR spent in <strong>{event.name}</strong>
              </p>
            </div>

            {/* Public Boosted Leaderboard Spend */}
            <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-slate-900 to-amber-950/25 p-5 shadow-lg">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-amber-300">
                  Public Leaderboard Spend
                </span>
                <TrendingUp className="h-4 w-4 text-amber-400" />
              </div>
              <p className="mt-2 text-2xl font-extrabold text-amber-300 sm:text-3xl">
                {formatIdr(participant.leaderboard_idr)}
              </p>
              <p className="mt-1 text-xs text-slate-300">
                {boostDeltaIdr > 0 ? (
                  <>
                    Includes <strong className="text-emerald-300">+{formatIdr(boostDeltaIdr)}</strong>{' '}
                    from multipliers &amp; bounties
                  </>
                ) : (
                  'Shown publicly on the Top 10 Leaderboard'
                )}
              </p>
            </div>

            {/* Current Event Rank & Gap to Overtake */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5 shadow-lg">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-slate-400">
                  Current Event Rank
                </span>
                <Trophy className="h-4 w-4 text-indigo-400" />
              </div>
              <p className="mt-2 text-2xl font-extrabold text-indigo-300">
                #{standing.targetEntry?.rank_position ?? '-'}
                <span className="ml-2 text-xs font-medium text-slate-400">
                  of {standing.ranked.length} attendees
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-300">
                {standing.leaderAhead ? (
                  <>
                    Spend{' '}
                    <strong className="text-amber-300">
                      {formatIdr(standing.gapToOvertakeIdr)}
                    </strong>{' '}
                    Leaderboard IDR to pass <strong>{standing.leaderAhead.username}</strong> (#
                    {standing.leaderAhead.rank_position})
                  </>
                ) : (
                  <span className="font-semibold text-amber-300">
                    You hold Rank #1 in {event.name}!
                  </span>
                )}
              </p>
            </div>

            {/* Stamps Collected (X/N) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5 shadow-lg">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-slate-400">
                  Stamps Collected
                </span>
                <Award className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="mt-2 text-2xl font-extrabold text-emerald-300">
                {participantStamps.length} / {totalStampSlots}
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
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

          {/* 60-Minute Streak Multiplier Countdown Bar */}
          <div
            className={`rounded-2xl border p-4 shadow-lg transition ${
              streakInfo.isActive
                ? 'border-orange-400/50 bg-gradient-to-r from-orange-950/60 via-slate-900 to-amber-950/50'
                : 'border-slate-800 bg-slate-900/80'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${
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
                      ? '1.25x Speedrunner Streak ACTIVE!'
                      : '60-Minute Streak Multiplier (1.25x)'}
                  </p>
                  <p className="text-xs text-slate-300">
                    {streakInfo.isActive
                      ? 'Every purchase now earns 1.25x Leaderboard IDR (stacks with Gold Cold-Booth bounties).'
                      : `Visit 3 distinct booths within 60 minutes (${Math.min(3, streakInfo.distinctLast60m)}/3 in current window).`}
                  </p>
                </div>
              </div>

              {streakInfo.isActive ? (
                <div className="flex items-center gap-1.5 rounded-xl border border-orange-400/40 bg-slate-950/80 px-3 py-1.5 font-mono text-sm font-extrabold text-orange-300">
                  <Clock className="h-4 w-4" />
                  <span>{formatCountdownMmSs(streakInfo.remainingMs)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3].map((step) => (
                    <span
                      key={step}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
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
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-950/80">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-300 transition-all duration-1000"
                  style={{ width: `${streakInfo.progressPct}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right 4 Cols: Scannable Cryptographic QR Pass */}
        <div className="flex flex-col items-center justify-between rounded-2xl border border-indigo-500/35 bg-gradient-to-b from-indigo-950/50 via-slate-900 to-slate-900 p-6 text-center shadow-xl lg:col-span-4">
          <div className="w-full">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-300">
              <QrCode className="h-3.5 w-3.5" />
              Booth Checkout Pass
            </span>
            <p className="mt-2 text-xs text-slate-300">
              Show this code to merchants to record IDR &amp; unlock 1:1 stamps.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setEnlargedQrOpen(true)}
            className="group relative my-4 rounded-2xl bg-white p-4 shadow-xl transition hover:scale-[1.02]"
            title="Tap to enlarge QR code"
          >
            <QRCodeSVG
              value={participant.qr_code}
              size={156}
              level="M"
              bgColor="#ffffff"
              fgColor="#0f172a"
            />
            <span className="mt-2 flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 group-hover:text-indigo-600">
              <Maximize2 className="h-3 w-3" />
              Tap to enlarge
            </span>
          </button>

          <div className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5">
            <span className="font-mono text-lg font-extrabold tracking-widest text-indigo-300">
              {participant.qr_code}
            </span>
            <button
              type="button"
              onClick={() => void handleCopyQr()}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              {copiedQr ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Interactive 1:1 Stamp Album & Floor Directory */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Sparkles className="h-5 w-5 text-emerald-400" />
              Interactive 1:1 Stamp Album &amp; Floor Directory
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Spend at least <strong className="text-emerald-300">{formatIdr(event.min_stamp_spend_idr)}</strong>{' '}
              at a booth to stamp its custom 1:1 mascot badge. Gold frames grant a live boost!
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
            {(
              [
                { id: 'all', label: `All (${eventBooths.length})` },
                { id: 'unlocked', label: `Unlocked (${stampedBoothIds.size})` },
                {
                  id: 'remaining',
                  label: `Remaining (${Math.max(0, eventBooths.length - stampedBoothIds.size)})`,
                },
                { id: 'bounty', label: 'Gold Boost' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setAlbumFilter(f.id)}
                className={`rounded-lg px-2.5 py-1 font-semibold transition ${
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

        <div className="mt-5 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {/* Stamp #1: Pre-Unlocked Event Check-In */}
          {albumFilter === 'all' || albumFilter === 'unlocked' ? (
            <div className="flex flex-col items-center justify-between rounded-2xl border-2 border-indigo-400/70 bg-gradient-to-b from-indigo-950/60 to-slate-950 p-4 text-center shadow-lg">
              <div className="flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                <span>Stamp #1</span>
                <span className="inline-flex items-center gap-0.5 text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  Checked In
                </span>
              </div>
              <div className="my-3 flex aspect-square w-24 items-center justify-center rounded-2xl border-2 border-dashed border-indigo-400/60 bg-indigo-500/20 text-indigo-200">
                <div className="text-center">
                  <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" />
                  <span className="mt-1 block text-[10px] font-extrabold uppercase">
                    Check-In
                  </span>
                </div>
              </div>
              <div>
                <p className="text-sm font-bold text-white">Event Check-In</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {checkInStamp
                    ? `Unlocked ${new Date(checkInStamp.unlocked_at).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : 'Ticket Verified'}
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
                className={`group flex flex-col items-center justify-between rounded-2xl border-2 p-4 text-center transition hover:-translate-y-0.5 ${
                  isColdBoosted
                    ? 'border-amber-400 bg-gradient-to-b from-amber-950/45 via-slate-900 to-slate-950 shadow-[0_0_24px_rgba(251,191,36,0.22)]'
                    : unlocked
                      ? 'border-emerald-500/60 bg-gradient-to-b from-emerald-950/30 to-slate-950'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-slate-200">
                    {booth.booth_number}
                  </span>
                  {isColdBoosted ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400/20 px-2 py-0.5 text-amber-300">
                      <Zap className="h-3 w-3" />
                      {booth.cold_bounty_multiplier}x Boost
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
                  className={`relative my-3 aspect-square w-24 overflow-hidden rounded-2xl border-2 transition ${
                    isColdBoosted
                      ? 'border-amber-400'
                      : unlocked
                        ? 'border-emerald-400/70'
                        : 'border-slate-800 grayscale opacity-45 group-hover:opacity-70'
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
                  <p className="line-clamp-1 text-sm font-bold text-white">
                    {booth.booth_name}
                  </p>
                  {isColdBoosted && coldRemainingMs !== null ? (
                    <p className="mt-0.5 font-mono text-[11px] font-semibold text-amber-300">
                      Boost ends in {formatCountdownMmSs(coldRemainingMs)}
                    </p>
                  ) : (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">
                      {unlocked
                        ? 'Collected in album'
                        : `Min ${formatIdr(event.min_stamp_spend_idr)}`}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Private Event Purchase History */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white">
            Your Private Purchase History ({participantTxs.length})
          </h3>
          <span className="text-xs text-slate-400">
            Shows exact actual_spent_idr vs boosted leaderboard_idr
          </span>
        </div>

        {participantTxs.length === 0 ? (
          <p className="mt-4 text-xs text-slate-400">
            No booth purchases recorded yet. Show your QR pass at any booth to start collecting
            stamps!
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {participantTxs.map((tx) => {
              const booth = eventBooths.find((b) => b.id === tx.tenant_id);
              const isVoided = tx.status === 'voided';
              return (
                <div
                  key={tx.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs ${
                    isVoided
                      ? 'border-slate-800/60 bg-slate-950/30 opacity-55'
                      : 'border-slate-800 bg-slate-950/70'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-indigo-300">
                        {booth?.booth_number ?? 'BOOTH'}
                      </span>
                      <span className="font-bold text-white">
                        {booth?.booth_name ?? 'Creator Booth'}
                      </span>
                      {tx.multiplier_applied > 1 && !isVoided && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                          {tx.multiplier_applied}x Boost
                        </span>
                      )}
                      {tx.hit_hidden_bounty && !isVoided && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
                          <Gift className="h-3 w-3" />
                          Hidden Bounty
                        </span>
                      )}
                      {isVoided && (
                        <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                          VOIDED
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {new Date(tx.created_at).toLocaleString('id-ID')}
                    </p>
                  </div>

                  <div className="text-right font-mono">
                    <p className="font-bold text-white">
                      Actual: {formatIdr(tx.actual_amount_idr)}
                    </p>
                    <p className="text-[11px] text-amber-300">
                      Leaderboard: {formatIdr(tx.leaderboard_amount_idr)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Enlarged Fullscreen QR Pass Modal */}
      {enlargedQrOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm"
          onClick={() => setEnlargedQrOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-indigo-500/40 bg-slate-900 p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                {event.name} QR Pass
              </span>
              <button
                type="button"
                onClick={() => setEnlargedQrOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close enlarged QR"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mx-auto my-5 inline-block rounded-2xl bg-white p-5">
              <QRCodeSVG
                value={participant.qr_code}
                size={240}
                level="M"
                bgColor="#ffffff"
                fgColor="#0f172a"
              />
            </div>
            <p className="font-mono text-2xl font-extrabold tracking-widest text-white">
              {participant.qr_code}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Increase screen brightness if scanner struggles at booth counter.
            </p>
          </div>
        </div>
      )}

      {/* Booth Directory & Merch Catalog Modal */}
      {selectedBooth && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
          onClick={() => setSelectedBooth(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
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
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close booth details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-300">
              {selectedBooth.description || 'Creator booth participating in this event rally.'}
            </p>

            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Store className="h-3.5 w-3.5" />
                Booth Merchandise Menu
              </p>
              {selectedBoothItems.length === 0 ? (
                <p className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
                  No catalog items listed yet — visit the booth in person!
                </p>
              ) : (
                <div className="space-y-2">
                  {selectedBoothItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2 text-xs"
                    >
                      <span className="font-medium text-white">{item.item_name}</span>
                      <span className="font-mono font-bold text-emerald-300">
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