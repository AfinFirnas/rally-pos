import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Award,
  Calendar,
  CheckCircle2,
  Crown,
  Flame,
  Lock,
  Package,
  QrCode,
  ShoppingBag,
  Sparkles,
  Store,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BecomeMerchantModal } from '../components/BecomeMerchantModal';
import { formatIdr } from '../lib/ledgerEngine';

interface BadgeDefinition {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
}

const BUYER_TROPHY_BADGES: BadgeDefinition[] = [
  {
    id: 'Completionist',
    title: 'Completionist',
    description: 'Collected every participating booth stamp in an event album.',
    icon: Trophy,
    accentClass: 'from-amber-500/25 to-yellow-500/10 border-amber-400/50 text-amber-300',
  },
  {
    id: 'Speedrunner Streak',
    title: 'Speedrunner Streak',
    description: 'Visited 3 distinct booths within 60 minutes to trigger 1.25x.',
    icon: Flame,
    accentClass: 'from-orange-500/25 to-rose-500/10 border-orange-400/50 text-orange-300',
  },
  {
    id: 'Bounty Hunter',
    title: 'Bounty Hunter',
    description: 'Purchased from a Gold Cold-Booth or Secret Hourly Bounty booth.',
    icon: Zap,
    accentClass: 'from-emerald-500/25 to-teal-500/10 border-emerald-400/50 text-emerald-300',
  },
  {
    id: 'Patron Whale',
    title: 'Patron Whale',
    description: 'Spent Rp 1.000.000+ in real IDR supporting event creators.',
    icon: Crown,
    accentClass: 'from-indigo-500/25 to-violet-500/10 border-indigo-400/50 text-indigo-300',
  },
];

export const GlobalProfilePage: React.FC = () => {
  const { currentUser, dataset, userParticipants, userTenants } = useApp();
  const [merchantModalOpen, setMerchantModalOpen] = useState(false);

  const profileStats = useMemo(() => {
    if (!currentUser) {
      return {
        lifetimeActualSpentIdr: 0,
        eventsAttendedCount: 0,
        uniqueBoothsStampedCount: 0,
        earnedBadgeSet: new Set<string>(),
        lifetimeMerchantSalesIdr: 0,
        totalMerchantOrders: 0,
        merchantAvgOrderIdr: 0,
        totalBoothStampsIssued: 0,
        merchantBadges: [] as string[],
        eventAlbums: [] as Array<{
          event: (typeof dataset.events)[number];
          participant: (typeof dataset.event_participants)[number] | null;
          tenant: (typeof dataset.tenants)[number] | null;
          stamps: typeof dataset.stamps;
          eventBooths: typeof dataset.tenants;
        }>,
      };
    }

    const participantIds = new Set(userParticipants.map((p) => p.id));
    const tenantIds = new Set(userTenants.map((t) => t.id));

    // Private actual_spent_idr computed across joined events (rolled up truthfully)
    const computedActualSpent = userParticipants.reduce(
      (sum, p) => sum + p.actual_spent_idr,
      0
    );
    const lifetimeActualSpentIdr = Math.max(
      currentUser.lifetime_actual_spent_idr,
      computedActualSpent
    );

    const joinedEventIds = new Set([
      ...userParticipants.map((p) => p.event_id),
      ...userTenants.map((t) => t.event_id),
    ]);

    const userBoothStamps = dataset.stamps.filter(
      (s) =>
        participantIds.has(s.participant_id) &&
        s.stamp_type === 'booth' &&
        s.tenant_id !== null
    );
    const uniqueBoothIds = new Set(userBoothStamps.map((s) => s.tenant_id as string));

    // Evaluate dynamic badge unlocks + persisted badges
    const earnedBadgeSet = new Set<string>(currentUser.earned_badges);
    if (lifetimeActualSpentIdr >= 1_000_000) {
      earnedBadgeSet.add('Patron Whale');
    }

    const userCompletedTxs = dataset.transactions.filter(
      (t) => participantIds.has(t.participant_id) && t.status === 'completed'
    );
    if (userCompletedTxs.some((t) => t.multiplier_applied > 1.0 || t.hit_hidden_bounty)) {
      earnedBadgeSet.add('Bounty Hunter');
    }
    if (
      userParticipants.some((p) => p.streak_expires_at !== null) ||
      userCompletedTxs.some((t) => t.multiplier_applied >= 1.25)
    ) {
      earnedBadgeSet.add('Speedrunner Streak');
    }

    // Check Completionist per event
    for (const p of userParticipants) {
      const totalEventBooths = dataset.tenants.filter(
        (t) => t.event_id === p.event_id
      ).length;
      const stampedHere = dataset.stamps.filter(
        (s) =>
          s.participant_id === p.id &&
          s.event_id === p.event_id &&
          s.stamp_type === 'booth'
      ).length;
      if (totalEventBooths > 0 && stampedHere >= totalEventBooths) {
        earnedBadgeSet.add('Completionist');
      }
    }

    // Merchant lifetime analytics (strictly real sales, never multiplied)
    const merchantCompletedTxs = dataset.transactions.filter(
      (t) => tenantIds.has(t.tenant_id) && t.status === 'completed'
    );
    const computedSales = userTenants.reduce((sum, t) => sum + t.event_sales_idr, 0);
    const lifetimeMerchantSalesIdr = Math.max(
      currentUser.lifetime_sales_idr,
      computedSales
    );
    const totalMerchantOrders = merchantCompletedTxs.length;
    const merchantAvgOrderIdr =
      totalMerchantOrders > 0
        ? Math.round(lifetimeMerchantSalesIdr / totalMerchantOrders)
        : 0;
    const totalBoothStampsIssued = userTenants.reduce(
      (sum, t) => sum + t.unique_stamps_count,
      0
    );

    const merchantBadges: string[] = [];
    if (totalMerchantOrders >= 1) merchantBadges.push('First Checkout');
    if (totalBoothStampsIssued >= 5) merchantBadges.push('5+ Rally Stamps Issued');
    if (lifetimeMerchantSalesIdr >= 1_000_000) merchantBadges.push('Rp 1M+ Booth Club');
    if (currentUser.earned_badges.includes('Top Booth Seller')) {
      merchantBadges.push('Top Booth Seller');
    }

    const eventAlbums = dataset.events
      .filter((ev) => joinedEventIds.has(ev.id))
      .sort((a, b) => {
        if (a.status === b.status) return 0;
        return a.status === 'active' ? -1 : 1;
      })
      .map((ev) => {
        const participant =
          userParticipants.find((p) => p.event_id === ev.id) ?? null;
        const tenant = userTenants.find((t) => t.event_id === ev.id) ?? null;
        const stamps = participant
          ? dataset.stamps.filter(
              (s) => s.event_id === ev.id && s.participant_id === participant.id
            )
          : [];
        const eventBooths = dataset.tenants.filter((t) => t.event_id === ev.id);
        return { event: ev, participant, tenant, stamps, eventBooths };
      });

    return {
      lifetimeActualSpentIdr,
      eventsAttendedCount: Math.max(currentUser.events_count, joinedEventIds.size),
      uniqueBoothsStampedCount: uniqueBoothIds.size,
      earnedBadgeSet,
      lifetimeMerchantSalesIdr,
      totalMerchantOrders,
      merchantAvgOrderIdr,
      totalBoothStampsIssued,
      merchantBadges,
      eventAlbums,
    };
  }, [currentUser, dataset, userParticipants, userTenants]);

  if (!currentUser) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      {/* Identity Header */}
      <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/50 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-500 text-2xl font-extrabold text-white shadow-lg">
              {currentUser.username.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-white">
                  {currentUser.username}
                </h1>
                <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-300">
                  Buyer
                </span>
                {currentUser.is_merchant && (
                  <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                    Merchant
                  </span>
                )}
                {currentUser.is_admin && (
                  <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                    Organizer Admin
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-slate-400">{currentUser.email}</p>
              {currentUser.merchant_brand_name && (
                <p className="mt-1 text-xs font-medium text-emerald-300">
                  Merchant Brand: {currentUser.merchant_brand_name}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!currentUser.is_merchant && (
              <button
                type="button"
                onClick={() => setMerchantModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
              >
                <Store className="h-4 w-4" />
                Become a Merchant
              </button>
            )}
            <Link
              to="/events"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
            >
              <Calendar className="h-4 w-4" />
              Browse Events
            </Link>
          </div>
        </div>
      </section>

      {/* Lifetime Buyer Stats (Private Financial Truth) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Lifetime Buyer Stats</h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] font-medium text-slate-300">
            <Lock className="h-3 w-3 text-emerald-400" />
            Private actual_spent_idr (visible only to you)
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              All-Time Actual Money Spent
            </p>
            <p className="mt-2 text-2xl font-extrabold text-white">
              {formatIdr(profileStats.lifetimeActualSpentIdr)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Exact unmultiplied IDR across all attended events
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total Events Attended
            </p>
            <p className="mt-2 text-2xl font-extrabold text-indigo-300">
              {profileStats.eventsAttendedCount}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Verified via Ticket UID enrollment
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Unique Booths Stamped
            </p>
            <p className="mt-2 text-2xl font-extrabold text-emerald-300">
              {profileStats.uniqueBoothsStampedCount}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Distinct creator booths stamped lifetime
            </p>
          </div>
        </div>
      </section>

      {/* Earned Badges Trophy Case */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-400" />
          <h2 className="text-lg font-bold text-white">Earned Badges Trophy Case</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BUYER_TROPHY_BADGES.map((badge) => {
            const Icon = badge.icon;
            const unlocked = profileStats.earnedBadgeSet.has(badge.id);

            return (
              <div
                key={badge.id}
                className={`rounded-2xl border p-4 transition ${
                  unlocked
                    ? `bg-gradient-to-br ${badge.accentClass}`
                    : 'border-slate-800 bg-slate-900/40 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950/60">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      unlocked
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {unlocked ? 'Unlocked' : 'Locked'}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-bold text-white">{badge.title}</h3>
                <p className="mt-1 text-xs text-slate-300">{badge.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Lifetime Merchant Stats (Visible for Merchant Accounts) */}
      {currentUser.is_merchant && (
        <section className="space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 text-emerald-400" />
              <h2 className="text-lg font-bold text-white">
                Lifetime Merchant Stats
              </h2>
            </div>
            <span className="text-xs font-medium text-emerald-300">
              {currentUser.merchant_brand_name ?? currentUser.username}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-500/25 bg-slate-950/70 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                <span>Cumulative Real Sales</span>
              </div>
              <p className="mt-2 text-2xl font-extrabold text-emerald-300">
                {formatIdr(profileStats.lifetimeMerchantSalesIdr)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Exact unmultiplied IDR revenue across all events
              </p>
            </div>

            <div className="rounded-xl border border-emerald-500/25 bg-slate-950/70 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Package className="h-3.5 w-3.5 text-sky-400" />
                <span>Total Orders Fulfilled</span>
              </div>
              <p className="mt-2 text-2xl font-extrabold text-white">
                {profileStats.totalMerchantOrders}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {profileStats.totalBoothStampsIssued} unique rally stamps issued
              </p>
            </div>

            <div className="rounded-xl border border-emerald-500/25 bg-slate-950/70 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span>Lifetime Average Order Value</span>
              </div>
              <p className="mt-2 text-2xl font-extrabold text-amber-300">
                {formatIdr(profileStats.merchantAvgOrderIdr)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Across {userTenants.length} booth event(s)
              </p>
            </div>
          </div>

          {profileStats.merchantBadges.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-slate-400">
                Merchant Milestones:
              </span>
              {profileStats.merchantBadges.map((mBadge) => (
                <span
                  key={mBadge}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {mBadge}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Historical Stamp Albums (Archived & Active Events) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">
              Event History &amp; Stamp Albums
            </h2>
          </div>
          <Link
            to="/events"
            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300"
          >
            Join another event &rarr;
          </Link>
        </div>

        {profileStats.eventAlbums.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
            <p className="text-sm font-medium text-slate-300">
              You haven&apos;t joined any events yet.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Head to the Event Directory and enter a Ticket UID (e.g.{' '}
              <code className="text-indigo-300">TKT-DEMO-BYR</code>) to unlock Stamp #1!
            </p>
            <Link
              to="/events"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Open Event Directory
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {profileStats.eventAlbums.map(
              ({ event, participant, tenant, stamps, eventBooths }) => {
                const totalAlbumSlots = eventBooths.length + 1;
                const checkInUnlocked = stamps.some((s) => s.stamp_type === 'checkin');
                const stampedBoothIds = new Set(
                  stamps
                    .filter((s) => s.stamp_type === 'booth' && s.tenant_id)
                    .map((s) => s.tenant_id as string)
                );

                return (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            event.status === 'active'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {event.status === 'active' ? 'Live Active' : 'Archived'}
                        </span>
                        <h3 className="mt-1.5 text-base font-bold text-white">
                          {event.name}
                        </h3>
                      </div>

                      <Link
                        to={`/event/${event.id}`}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                      >
                        Open Hub
                      </Link>
                    </div>

                    {participant && (
                      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs">
                        <div>
                          <span className="text-slate-400">Actual Spend</span>
                          <p className="font-bold text-white">
                            {formatIdr(participant.actual_spent_idr)}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">Leaderboard</span>
                          <p className="font-bold text-amber-300">
                            {formatIdr(participant.leaderboard_idr)}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">Stamps</span>
                          <p className="font-bold text-emerald-300">
                            {stamps.length} / {totalAlbumSlots}
                          </p>
                        </div>
                      </div>
                    )}

                    {tenant && (
                      <div className="mt-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                        Booth <strong>{tenant.booth_number}</strong> &middot; {tenant.booth_name} &mdash;
                        Real Sales: <strong>{formatIdr(tenant.event_sales_idr)}</strong>
                      </div>
                    )}

                    {/* Mini Stamp Grid */}
                    {participant && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <div
                          className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl border text-[10px] font-bold ${
                            checkInUnlocked
                              ? 'border-indigo-400/60 bg-indigo-500/20 text-indigo-200'
                              : 'border-slate-800 bg-slate-950 text-slate-600'
                          }`}
                          title="Stamp #1: Event Check-In"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>#1</span>
                        </div>

                        {eventBooths.map((booth) => {
                          const hasStamp = stampedBoothIds.has(booth.id);
                          return (
                            <div
                              key={booth.id}
                              className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border transition ${
                                hasStamp
                                  ? 'border-emerald-400/60 bg-slate-900 shadow-sm'
                                  : 'border-slate-800 bg-slate-950/60 opacity-40 grayscale'
                              }`}
                              title={`${booth.booth_number} ${booth.booth_name}${hasStamp ? ' (Stamped)' : ' (Locked)'}`}
                            >
                              {booth.stamp_image_url ? (
                                <img
                                  src={booth.stamp_image_url}
                                  alt={booth.booth_name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="text-[10px] font-bold text-slate-300">
                                  {booth.booth_number}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
            )}
          </div>
        )}
      </section>

      <BecomeMerchantModal
        isOpen={merchantModalOpen}
        onClose={() => setMerchantModalOpen(false)}
      />
    </div>
  );
};