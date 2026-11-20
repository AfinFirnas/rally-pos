import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  Crown,
  Eye,
  EyeOff,
  Flame,
  Maximize2,
  Minimize2,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { computeLeaderboardStanding, formatIdr } from '../../lib/ledgerEngine';
import type { DemoSeedDataset, Event, LeaderboardEntry } from '../../types/types';

interface EventLeaderboardPanelProps {
  event: Event;
  dataset: DemoSeedDataset;
  currentParticipantId?: string | null;
}

/**
- Masks display names for public venue TV displays (e.g., "RizkyPratama" -> "Rizky P.").
 */
function formatMaskedDisplayName(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return 'Attendee';

  // Split by whitespace first
  const spaceParts = trimmed.split(/\s+/);
  if (spaceParts.length >= 2) {
    return `${spaceParts[0]} ${spaceParts[1][0].toUpperCase()}.`;
  }

  // Split CamelCase (e.g., "RizkyPratama" -> ["Rizky", "Pratama"])
  const camelParts = trimmed.split(/(?=[A-Z])/).filter(Boolean);
  if (camelParts.length >= 2 && camelParts[0].length >= 2) {
    return `${camelParts[0]} ${camelParts[1][0].toUpperCase()}.`;
  }

  if (trimmed.length <= 3) return `${trimmed[0]}***`;
  return `${trimmed.slice(0, Math.min(5, trimmed.length - 1))}***`;
}

export const EventLeaderboardPanel: React.FC<EventLeaderboardPanelProps> = ({
  event,
  dataset,
  currentParticipantId,
}) => {
  const [privacyMask, setPrivacyMask] = useState(false);
  const [tvMode, setTvMode] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && tvMode) {
        // Allow user to stay in CSS fullscreen overlay or sync Esc
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tvMode) {
        setTvMode(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [tvMode]);

  const userMap = useMemo(
    () => new Map(dataset.users.map((u) => [u.id, u.username])),
    [dataset.users]
  );

  const totalBoothSlots = useMemo(
    () => dataset.tenants.filter((t) => t.event_id === event.id).length + 1,
    [dataset.tenants, event.id]
  );

  const standing = useMemo(() => {
    const entries: LeaderboardEntry[] = dataset.event_participants
      .filter((p) => p.event_id === event.id)
      .map((p) => ({
        participant_id: p.id,
        event_id: p.event_id,
        user_id: p.user_id,
        username: userMap.get(p.user_id) ?? 'Attendee',
        leaderboard_idr: p.leaderboard_idr,
        streak_expires_at: p.streak_expires_at,
        stamps_count: dataset.stamps.filter(
          (s) => s.event_id === event.id && s.participant_id === p.id
        ).length,
        rank_position: 0,
      }));

    return computeLeaderboardStanding(entries, currentParticipantId ?? undefined);
  }, [dataset.event_participants, dataset.stamps, event.id, currentParticipantId, userMap]);

  const launchTvMode = async () => {
    setTvMode(true);
    try {
      if (containerRef.current?.requestFullscreen) {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // Fixed fullscreen overlay fallback works seamlessly on all devices
    }
  };

  const exitTvMode = async () => {
    setTvMode(false);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen exit errors
    }
  };

  const getRankBadgeStyle = (rank: number) => {
    if (rank === 1) {
      return {
        row: 'border-amber-400/70 bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-slate-900 shadow-[0_0_20px_rgba(251,191,36,0.16)]',
        medal: 'bg-amber-400 text-slate-950',
        amount: 'text-amber-300',
      };
    }
    if (rank === 2) {
      return {
        row: 'border-slate-300/60 bg-gradient-to-r from-slate-400/15 via-slate-800/40 to-slate-900',
        medal: 'bg-slate-200 text-slate-950',
        amount: 'text-slate-100',
      };
    }
    if (rank === 3) {
      return {
        row: 'border-orange-500/60 bg-gradient-to-r from-orange-600/20 via-amber-900/15 to-slate-900',
        medal: 'bg-orange-400 text-slate-950',
        amount: 'text-orange-300',
      };
    }
    return {
      row: 'border-slate-800 bg-slate-950/75',
      medal: 'bg-slate-800 text-slate-300',
      amount: 'text-emerald-300',
    };
  };

  const top3 = standing.top10.slice(0, 3);

  return (
    <div
      ref={containerRef}
      className={
        tvMode
          ? 'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-slate-950 p-6 sm:p-10'
          : 'space-y-6'
      }
    >
      {/* Leaderboard Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6 text-amber-400" />
            <h2 className={`font-extrabold text-white ${tvMode ? 'text-2xl sm:text-3xl' : 'text-xl'}`}>
              {event.name} &mdash; Live Top 10 Spenders
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Ranked strictly by public <strong className="text-amber-300">Leaderboard IDR</strong>{' '}
            (includes 1.25x streak, Gold Cold-Booth boosts &amp; Hidden Bounties).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPrivacyMask((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              privacyMask
                ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-200'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            {privacyMask ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            <span>{privacyMask ? 'Privacy Mask: ON' : 'Privacy Mask: OFF'}</span>
          </button>

          {tvMode ? (
            <button
              type="button"
              onClick={() => void exitTvMode()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500"
            >
              <Minimize2 className="h-4 w-4" />
              Exit TV Mode
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void launchTvMode()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"
            >
              <Maximize2 className="h-4 w-4" />
              Launch Fullscreen TV Mode
            </button>
          )}
        </div>
      </div>

      {/* Top 3 Podium Cards */}
      {top3.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {top3.map((entry) => {
            const style = getRankBadgeStyle(entry.rank_position);
            const displayName = privacyMask
              ? formatMaskedDisplayName(entry.username)
              : entry.username;
            const hasActiveStreak =
              entry.streak_expires_at !== null &&
              Date.parse(entry.streak_expires_at) > nowMs;
            const isYou = entry.participant_id === currentParticipantId;

            return (
              <div
                key={entry.participant_id}
                className={`relative rounded-2xl border p-5 transition-all duration-500 ${style.row} ${
                  isYou ? 'ring-2 ring-indigo-400' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-xl text-sm font-extrabold ${style.medal}`}
                  >
                    #{entry.rank_position}
                  </span>
                  {entry.rank_position === 1 && (
                    <Crown className="h-6 w-6 text-amber-400" />
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <p className={`truncate font-extrabold text-white ${tvMode ? 'text-xl' : 'text-lg'}`}>
                    {displayName}
                  </p>
                  {isYou && (
                    <span className="rounded-full bg-indigo-500/25 px-2 py-0.5 text-[10px] font-bold text-indigo-200">
                      YOU
                    </span>
                  )}
                </div>

                <p className={`mt-2 font-mono font-extrabold ${style.amount} ${tvMode ? 'text-2xl' : 'text-xl'}`}>
                  {formatIdr(entry.leaderboard_idr)}
                </p>

                <div className="mt-3 flex items-center justify-between text-xs text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    <Award className="h-3.5 w-3.5 text-emerald-400" />
                    {entry.stamps_count}/{totalBoothSlots} Stamps
                  </span>
                  {hasActiveStreak && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/20 px-2 py-0.5 text-[11px] font-bold text-orange-300">
                      <Flame className="h-3 w-3" />
                      1.25x Streak
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full Top 10 Ranked Rows */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl">
        <div className="space-y-2.5">
          {standing.top10.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No spenders recorded in this event yet.
            </p>
          ) : (
            standing.top10.map((entry) => {
              const style = getRankBadgeStyle(entry.rank_position);
              const displayName = privacyMask
                ? formatMaskedDisplayName(entry.username)
                : entry.username;
              const isYou = entry.participant_id === currentParticipantId;
              const hasActiveStreak =
                entry.streak_expires_at !== null &&
                Date.parse(entry.streak_expires_at) > nowMs;

              return (
                <div
                  key={entry.participant_id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-all duration-500 ${style.row} ${
                    isYou ? 'ring-2 ring-indigo-400' : ''
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-extrabold ${style.medal}`}
                    >
                      #{entry.rank_position}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate font-bold text-white ${
                            tvMode ? 'text-lg' : 'text-sm'
                          }`}
                        >
                          {displayName}
                        </span>
                        {isYou && (
                          <span className="rounded bg-indigo-500/30 px-1.5 py-0.5 text-[10px] font-bold text-indigo-200">
                            YOU
                          </span>
                        )}
                        {hasActiveStreak && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold text-orange-300">
                            <Flame className="h-3 w-3" />
                            1.25x
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Stamps Collected: {entry.stamps_count}/{totalBoothSlots}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`font-mono font-extrabold ${style.amount} ${
                        tvMode ? 'text-xl' : 'text-base'
                      }`}
                    >
                      {formatIdr(entry.leaderboard_idr)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Outside Top 10 Personal Standing Banner */}
        {standing.targetEntry && standing.targetEntry.rank_position > 10 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-3 text-xs">
            <div className="flex items-center gap-2 text-indigo-100">
              <Sparkles className="h-4 w-4 text-indigo-300" />
              <span>
                Your Current Rank: <strong>#{standing.targetEntry.rank_position}</strong> (
                {standing.targetEntry.stamps_count}/{totalBoothSlots} stamps)
              </span>
            </div>
            <span className="font-mono font-bold text-amber-300">
              {formatIdr(standing.targetEntry.leaderboard_idr)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};