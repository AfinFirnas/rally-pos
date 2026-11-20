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
import { apiClient } from '../../services/apiClient';
import type { DemoSeedDataset, Event, LeaderboardEntry } from '../../types/types';

interface EventLeaderboardPanelProps {
  event: Event;
  dataset: DemoSeedDataset;
  currentParticipantId?: string | null;
}

function formatMaskedDisplayName(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return 'Attendee';

  const spaceParts = trimmed.split(/\s+/);
  if (spaceParts.length >= 2) {
    return `${spaceParts[0]} ${spaceParts[1][0].toUpperCase()}.`;
  }

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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tvMode) {
        setTvMode(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [tvMode]);

  const [remoteEntries, setRemoteEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    setRemoteEntries(null);
    void apiClient
      .getEventLeaderboard(event.id)
      .then((res) => {
        if (active && apiClient.isRemoteConfigured() && !apiClient.isFallbackActive()) {
          setRemoteEntries(res.entries);
        }
      })
      .catch(() => {
        // Fallback seamlessly to local dataset standings
      });
    return () => {
      active = false;
    };
  }, [event.id]);

  const userMap = useMemo(
    () => new Map(dataset.users.map((u) => [u.id, u.username])),
    [dataset.users]
  );

  const totalBoothSlots = useMemo(
    () => dataset.tenants.filter((t) => t.event_id === event.id).length + 1,
    [dataset.tenants, event.id]
  );

  const standing = useMemo(() => {
    if (remoteEntries && remoteEntries.length > 0) {
      return computeLeaderboardStanding(remoteEntries, currentParticipantId ?? undefined);
    }

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
  }, [
    remoteEntries,
    dataset.event_participants,
    dataset.stamps,
    event.id,
    currentParticipantId,
    userMap,
  ]);

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

  const top3 = standing.top10.slice(0, 3);
  const restTop10 = standing.top10.slice(3);

  // Olympic Podium visual order: #2 (left) | #1 (center, tallest) | #3 (right)
  const podiumOrder = useMemo(() => {
    const r1 = top3.find((e) => e.rank_position === 1);
    const r2 = top3.find((e) => e.rank_position === 2);
    const r3 = top3.find((e) => e.rank_position === 3);
    return [r2, r1, r3].filter((e): e is LeaderboardEntry => Boolean(e));
  }, [top3]);

  const getPodiumStyles = (rank: number) => {
    if (rank === 1) {
      return {
        card: 'order-2 min-h-[168px] sm:min-h-[188px] border-amber-400/75 bg-gradient-to-b from-amber-500/20 via-amber-950/30 to-slate-900 shadow-[0_0_24px_rgba(251,191,36,0.18)]',
        medal: 'bg-amber-400 text-slate-950',
        amount: 'text-amber-300',
      };
    }
    if (rank === 2) {
      return {
        card: 'order-1 min-h-[144px] sm:min-h-[160px] border-slate-300/50 bg-gradient-to-b from-slate-400/15 via-slate-900 to-slate-950',
        medal: 'bg-slate-200 text-slate-950',
        amount: 'text-slate-100',
      };
    }
    return {
      card: 'order-3 min-h-[132px] sm:min-h-[148px] border-orange-500/55 bg-gradient-to-b from-orange-600/20 via-slate-900 to-slate-950',
      medal: 'bg-orange-400 text-slate-950',
      amount: 'text-orange-300',
    };
  };

  return (
    <div
      ref={containerRef}
      className={
        tvMode
          ? 'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-slate-950 p-6 sm:p-10'
          : 'space-y-5'
      }
    >
      {/* Header & Display Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-400" />
            <h2
              className={`font-extrabold text-white ${
                tvMode ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl'
              }`}
            >
              {event.name} &mdash; Top 10
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Ranked by <strong className="text-amber-300">Leaderboard Score (IDR)</strong>{' '}
            including streak and Gold Boost bonuses.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPrivacyMask((prev) => !prev)}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              privacyMask
                ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-200'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            {privacyMask ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            <span>{privacyMask ? 'Names Hidden' : 'Hide Names'}</span>
          </button>

          {tvMode ? (
            <button
              type="button"
              onClick={() => void exitTvMode()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
            >
              <Minimize2 className="h-4 w-4" />
              <span>Exit TV</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void launchTvMode()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"
            >
              <Maximize2 className="h-4 w-4" />
              <span>TV Display</span>
            </button>
          )}
        </div>
      </div>

      {/* 3-Column Olympic Podium (#2 | #1 | #3) */}
      {podiumOrder.length > 0 && (
        <div className="grid grid-cols-3 items-end gap-2 sm:gap-4">
          {podiumOrder.map((entry) => {
            const style = getPodiumStyles(entry.rank_position);
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
                className={`flex flex-col justify-between rounded-2xl border p-2.5 sm:p-4 text-center transition-all duration-500 ${
                  style.card
                } ${isYou ? 'ring-2 ring-indigo-400' : ''}`}
              >
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-1">
                    {entry.rank_position === 1 && (
                      <Crown className="h-4 w-4 text-amber-400 sm:h-5 sm:w-5" />
                    )}
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg font-mono text-xs font-extrabold tabular-nums sm:h-8 sm:w-8 sm:text-sm ${style.medal}`}
                    >
                      #{entry.rank_position}
                    </span>
                  </div>

                  <p
                    className={`mt-2 w-full truncate font-bold text-white ${
                      tvMode ? 'text-lg sm:text-xl' : 'text-xs sm:text-base'
                    }`}
                  >
                    {displayName}
                  </p>
                  {isYou && (
                    <span className="mt-0.5 text-[10px] font-bold text-indigo-300">You</span>
                  )}
                </div>

                <div className="mt-2.5 space-y-1">
                  <p
                    className={`truncate font-mono font-extrabold tabular-nums ${style.amount} ${
                      tvMode ? 'text-lg sm:text-2xl' : 'text-xs sm:text-lg'
                    }`}
                  >
                    {formatIdr(entry.leaderboard_idr)}
                  </p>
                  <div className="flex items-center justify-center gap-1 text-[10px] text-slate-300 sm:text-xs tabular-nums">
                    <Award className="h-3 w-3 shrink-0 text-emerald-400" />
                    <span>
                      {entry.stamps_count}/{totalBoothSlots}
                    </span>
                    {hasActiveStreak && (
                      <Flame className="h-3 w-3 shrink-0 text-orange-400" aria-label="1.25x streak active" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ranked List #4 to #10 (Never duplicates #1–#3) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5 shadow-xl">
        {standing.top10.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            No attendees have checked out at booths yet.
          </p>
        ) : restTop10.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">
            All ranked attendees are shown on the podium above.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {restTop10.map((entry) => {
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
                  className={`flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1 ${
                    isYou ? 'rounded-xl bg-indigo-500/10 px-2.5 -mx-2.5' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 font-mono text-xs font-extrabold text-slate-300 tabular-nums">
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
                          <span className="text-[11px] font-bold text-indigo-300">
                            &middot; You
                          </span>
                        )}
                        {hasActiveStreak && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-orange-300">
                            <Flame className="h-3 w-3" />
                            1.25x
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        {entry.stamps_count}/{totalBoothSlots} stamps
                      </p>
                    </div>
                  </div>

                  <span
                    className={`shrink-0 font-mono font-extrabold text-emerald-300 tabular-nums ${
                      tvMode ? 'text-xl' : 'text-sm sm:text-base'
                    }`}
                  >
                    {formatIdr(entry.leaderboard_idr)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Outside Top 10 Personal Standing Banner */}
        {standing.targetEntry && standing.targetEntry.rank_position > 10 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-3 text-xs tabular-nums">
            <div className="flex items-center gap-2 text-indigo-100">
              <Sparkles className="h-4 w-4 text-indigo-300" />
              <span>
                Your Rank: <strong>#{standing.targetEntry.rank_position}</strong> &middot;{' '}
                {standing.targetEntry.stamps_count}/{totalBoothSlots} stamps
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