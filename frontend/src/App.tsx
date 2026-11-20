import React, { useMemo } from 'react';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  LogOut,
  QrCode,
  RefreshCw,
  Shield,
  ShoppingBag,
  Store,
  User as UserIcon,
  WifiOff,
} from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { InstallAppButton, InstallPwaBanner } from './components/InstallPwaBanner';
import { AuthPage } from './pages/AuthPage';
import { GlobalProfilePage } from './pages/GlobalProfilePage';
import { EventsDirectoryPage } from './pages/EventsDirectoryPage';
import { EventHubPage } from './pages/EventHubPage';
import { AdminCommandPage } from './pages/AdminCommandPage';
import { formatIdr } from './lib/ledgerEngine';

// ============================================================================
// OFFLINE SYNC STATUS INDICATOR
// ============================================================================

const OfflineSyncBadge: React.FC = () => {
  const { offlineStatus, triggerManualSync } = useApp();

  if (offlineStatus.badgeState === 'syncing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300 whitespace-nowrap shrink-0">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        <span className="hidden sm:inline">Syncing</span>
      </span>
    );
  }

  if (offlineStatus.badgeState === 'error') {
    return (
      <button
        type="button"
        onClick={() => void triggerManualSync()}
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/25 whitespace-nowrap shrink-0"
        title="Tap to retry offline sync"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>{offlineStatus.failedCount} Sync Error</span>
      </button>
    );
  }

  if (offlineStatus.badgeState === 'offline_queued') {
    return (
      <button
        type="button"
        onClick={() => void triggerManualSync()}
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200 transition hover:bg-amber-500/25 whitespace-nowrap shrink-0"
        title="Saved offline and waiting to sync"
      >
        <WifiOff className="h-3.5 w-3.5" />
        <span>Offline · {offlineStatus.pendingCount}</span>
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300/90 whitespace-nowrap shrink-0">
      <CheckCircle2 className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Synced</span>
    </span>
  );
};

// ============================================================================
// PERSISTENT TOP NAVIGATION BAR & APP SHELL
// ============================================================================

const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    currentUser,
    activeViewMode,
    activeEventId,
    switchViewMode,
    logout,
    isDemoMode,
  } = useApp();
  const navigate = useNavigate();

  const handleModeToggle = async (targetMode: 'buyer' | 'merchant') => {
    try {
      await switchViewMode(targetMode);
    } catch {
      // Only shown when user has unlocked a booth
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <InstallPwaBanner />

      <header className="relative md:sticky md:top-0 z-40 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          {/* Zone 1: Brand Title */}
          <div className="flex items-center gap-4 min-w-0">
            <Link
              to={currentUser ? '/events' : '/auth'}
              className="flex items-center gap-2.5 font-bold tracking-tight text-white whitespace-nowrap shrink-0"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 shadow-md shadow-indigo-500/20">
                <QrCode className="h-4 w-4 text-white" />
              </div>
              <span className="text-base font-extrabold tracking-tight">RallyPOS</span>
              {isDemoMode && (
                <span className="text-[11px] font-medium text-indigo-300/90">
                  · Demo
                </span>
              )}
            </Link>

            {/* Zone 2: Desktop Nav Links (No duplicate Top 10 link) */}
            {currentUser && (
              <nav className="hidden md:flex items-center gap-1">
                <NavLink
                  to="/events"
                  className={({ isActive }) =>
                    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`
                  }
                >
                  <Calendar className="h-4 w-4" />
                  Events
                </NavLink>
                {activeEventId && (
                  <NavLink
                    to={`/event/${activeEventId}`}
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-indigo-500/20 text-indigo-200'
                          : 'text-indigo-300/80 hover:bg-indigo-500/10 hover:text-indigo-200'
                      }`
                    }
                  >
                    <QrCode className="h-4 w-4" />
                    Event Hub
                  </NavLink>
                )}
                <NavLink
                  to="/profile"
                  className={({ isActive }) =>
                    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`
                  }
                >
                  <UserIcon className="h-4 w-4" />
                  Profile
                </NavLink>
                {currentUser.is_admin && (
                  <NavLink
                    to="/admin"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-amber-500/20 text-amber-200'
                          : 'text-amber-300/80 hover:bg-amber-500/10 hover:text-amber-200'
                      }`
                    }
                  >
                    <Shield className="h-4 w-4" />
                    Organizer
                  </NavLink>
                )}
              </nav>
            )}
          </div>

          {/* Zone 3: Right Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <OfflineSyncBadge />
            <InstallAppButton />

            {currentUser ? (
              <>
                {/* Only show Buyer | Booth switcher after user has unlocked a booth */}
                {currentUser.is_merchant && (
                  <div
                    className="inline-flex items-center rounded-xl border border-slate-700/80 bg-slate-900 p-0.5"
                    role="group"
                    aria-label="Pass or Booth mode"
                  >
                    <button
                      type="button"
                      onClick={() => void handleModeToggle('buyer')}
                      className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                        activeViewMode === 'buyer'
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <ShoppingBag className="h-3.5 w-3.5" />
                      <span>Buyer</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleModeToggle('merchant')}
                      className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                        activeViewMode === 'merchant'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Store className="h-3.5 w-3.5" />
                      <span>Booth</span>
                    </button>
                  </div>
                )}

                <Link
                  to="/profile"
                  className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-700 whitespace-nowrap shrink-0"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/25 text-[11px] font-bold text-indigo-200">
                    {currentUser.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="max-w-[110px] truncate">{currentUser.username}</span>
                </Link>

                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-white"
                  title="Sign Out"
                  aria-label="Sign Out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <Link
                to="/auth"
                className="inline-flex min-h-[38px] items-center rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 whitespace-nowrap shrink-0"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>

        {/* Clean Mobile Navigation Strip (No duplicate Top 10 link) */}
        {currentUser && (
          <div className="flex items-center gap-1 border-t border-slate-800/70 px-3 py-1.5 md:hidden">
            <NavLink
              to="/events"
              className={({ isActive }) =>
                `flex-1 min-h-[36px] flex items-center justify-center rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`
              }
            >
              Events
            </NavLink>
            {activeEventId && (
              <NavLink
                to={`/event/${activeEventId}`}
                className={({ isActive }) =>
                  `flex-1 min-h-[36px] flex items-center justify-center rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                    isActive
                      ? 'bg-indigo-500/20 text-indigo-200'
                      : 'text-indigo-300/80 hover:text-indigo-200'
                  }`
                }
              >
                Event Hub
              </NavLink>
            )}
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `flex-1 min-h-[36px] flex items-center justify-center rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`
              }
            >
              Profile
            </NavLink>
            {currentUser.is_admin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `flex-1 min-h-[36px] flex items-center justify-center rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                    isActive ? 'bg-amber-500/20 text-amber-200' : 'text-amber-300/80'
                  }`
                }
              >
                Organizer
              </NavLink>
            )}
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
};

// ============================================================================
// SHORTCUT ROUTES (/pass/:code & /leaderboard) & GUARDS
// ============================================================================

const QrPassShortcutPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const { dataset } = useApp();
  const normalizedCode = (code ?? '').trim().toUpperCase();

  const match = useMemo(() => {
    const participant = dataset.event_participants.find(
      (p) => p.qr_code.toUpperCase() === normalizedCode
    );
    if (!participant) return null;
    const event = dataset.events.find((e) => e.id === participant.event_id);
    const user = dataset.users.find((u) => u.id === participant.user_id);
    const stampsCount = dataset.stamps.filter(
      (s) => s.event_id === participant.event_id && s.participant_id === participant.id
    ).length;
    return { participant, event, user, stampsCount };
  }, [dataset, normalizedCode]);

  if (!match) {
    return (
      <div className="mx-auto max-w-md px-4 py-14 text-center">
        <QrCode className="mx-auto h-10 w-10 text-slate-500" />
        <h1 className="mt-3 text-xl font-bold text-white">Event Pass Not Found</h1>
        <p className="mt-1 text-xs text-slate-400">
          No pass matched ID <code className="text-indigo-300">{normalizedCode}</code>.
        </p>
        <Link
          to="/events"
          className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white"
        >
          Browse Events
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-3xl border border-indigo-500/35 bg-slate-900/90 p-6 text-center shadow-2xl">
        <p className="text-xs font-semibold text-indigo-300">
          {match.event?.name ?? 'Attendee Checkout QR'}
        </p>
        <h1 className="mt-2 text-xl font-extrabold text-white">
          {match.user?.username ?? 'Attendee'}
        </h1>
        <p className="mt-1 text-xs text-slate-400 tabular-nums">
          Leaderboard Score (IDR):{' '}
          <strong className="text-amber-300">
            {formatIdr(match.participant.leaderboard_idr)}
          </strong>{' '}
          &middot; {match.stampsCount} Stamps
        </p>
        <div className="mx-auto my-5 inline-block rounded-2xl bg-white p-4">
          <QRCodeSVG value={match.participant.qr_code} size={200} level="M" />
        </div>
        <p className="text-[11px] font-medium text-slate-400">Your Event Pass ID</p>
        <p className="mt-0.5 font-mono text-2xl font-extrabold tracking-widest text-indigo-300 tabular-nums">
          {match.participant.qr_code}
        </p>
        {match.event && (
          <Link
            to={`/event/${match.event.id}`}
            className="mt-5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"
          >
            <span>Open {match.event.name}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
};

const LeaderboardShortcutRedirect: React.FC = () => {
  const { activeEventId, dataset } = useApp();
  const targetEventId =
    activeEventId ??
    dataset.events.find((e) => e.status === 'active')?.id ??
    dataset.events[0]?.id;

  if (!targetEventId) {
    return <Navigate to="/events" replace />;
  }
  return <Navigate to={`/event/${targetEventId}?tab=leaderboard`} replace />;
};

const RequireAuth: React.FC<{
  children: React.ReactElement;
  requireAdmin?: boolean;
}> = ({ children, requireAdmin = false }) => {
  const { currentUser, isLoading } = useApp();
  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
        Loading your pass...
      </div>
    );
  }
  if (!currentUser) {
    return <Navigate to="/auth" replace />;
  }
  if (requireAdmin && !currentUser.is_admin) {
    return <Navigate to="/events" replace />;
  }
  return children;
};

const RootRedirect: React.FC = () => {
  const { currentUser, isLoading } = useApp();
  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
        Loading RallyPOS...
      </div>
    );
  }
  return <Navigate to={currentUser ? '/events' : '/auth'} replace />;
};

export const App: React.FC = () => {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <GlobalProfilePage />
                </RequireAuth>
              }
            />
            <Route
              path="/events"
              element={
                <RequireAuth>
                  <EventsDirectoryPage />
                </RequireAuth>
              }
            />
            <Route
              path="/event/:eventId"
              element={
                <RequireAuth>
                  <EventHubPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAuth requireAdmin>
                  <AdminCommandPage />
                </RequireAuth>
              }
            />
            <Route
              path="/leaderboard"
              element={
                <RequireAuth>
                  <LeaderboardShortcutRedirect />
                </RequireAuth>
              }
            />
            <Route path="/pass/:code" element={<QrPassShortcutPage />} />
            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </AppProvider>
  );
};

export default App;