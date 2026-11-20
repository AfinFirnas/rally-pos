import React, { useMemo, useState } from 'react';
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
  Trophy,
  User as UserIcon,
  WifiOff,
} from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { InstallAppButton, InstallPwaBanner } from './components/InstallPwaBanner';
import { BecomeMerchantModal } from './components/BecomeMerchantModal';
import { AuthPage } from './pages/AuthPage';
import { GlobalProfilePage } from './pages/GlobalProfilePage';
import { EventsDirectoryPage } from './pages/EventsDirectoryPage';
import { EventHubPage } from './pages/EventHubPage';
import { AdminCommandPage } from './pages/AdminCommandPage';
import { formatIdr } from './lib/ledgerEngine';

// ============================================================================
// OFFLINE SYNC STATUS BADGE
// ============================================================================

const OfflineSyncBadge: React.FC = () => {
  const { offlineStatus, triggerManualSync } = useApp();

  if (offlineStatus.badgeState === 'syncing') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-200">
        <RefreshCw className="h-3 w-3 animate-spin" />
        <span className="hidden sm:inline">Syncing...</span>
      </span>
    );
  }

  if (offlineStatus.badgeState === 'error') {
    return (
      <button
        type="button"
        onClick={() => void triggerManualSync()}
        className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/25"
        title="Click to retry failed offline scans"
      >
        <AlertTriangle className="h-3 w-3" />
        <span>{offlineStatus.failedCount} Sync Error</span>
      </button>
    );
  }

  if (offlineStatus.badgeState === 'offline_queued') {
    return (
      <button
        type="button"
        onClick={() => void triggerManualSync()}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200 transition hover:bg-amber-500/25"
        title="Transactions queued locally in IndexedDB"
      >
        <WifiOff className="h-3 w-3" />
        <span>Offline — {offlineStatus.pendingCount} Queued</span>
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
      <CheckCircle2 className="h-3 w-3" />
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
  const [merchantModalOpen, setMerchantModalOpen] = useState(false);

  const handleModeToggle = async (targetMode: 'buyer' | 'merchant') => {
    try {
      await switchViewMode(targetMode);
    } catch {
      setMerchantModalOpen(true);
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <InstallPwaBanner />

      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-4 sm:gap-6">
            <Link
              to={currentUser ? '/events' : '/auth'}
              className="flex items-center gap-2.5 font-bold tracking-tight text-white"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 shadow-lg shadow-indigo-500/20">
                <QrCode className="h-5 w-5 text-white" />
              </div>
              <div className="leading-tight">
                <span className="text-base">RallyPOS</span>
                {isDemoMode && (
                  <span className="ml-1.5 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                    Demo
                  </span>
                )}
              </div>
            </Link>

            {currentUser && (
              <nav className="hidden md:flex items-center gap-1">
                <NavLink
                  to="/events"
                  className={({ isActive }) =>
                    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`
                  }
                >
                  <Calendar className="h-4 w-4" />
                  Events
                </NavLink>
                <NavLink
                  to="/leaderboard"
                  className={({ isActive }) =>
                    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`
                  }
                >
                  <Trophy className="h-4 w-4" />
                  Leaderboard
                </NavLink>
                <NavLink
                  to="/profile"
                  className={({ isActive }) =>
                    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`
                  }
                >
                  <UserIcon className="h-4 w-4" />
                  Global Profile
                </NavLink>
                {activeEventId && (
                  <NavLink
                    to={`/event/${activeEventId}`}
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        isActive
                          ? 'bg-indigo-500/20 text-indigo-200'
                          : 'text-indigo-300/80 hover:bg-indigo-500/10 hover:text-indigo-200'
                      }`
                    }
                  >
                    <QrCode className="h-4 w-4" />
                    Active Hub
                  </NavLink>
                )}
                {currentUser.is_admin && (
                  <NavLink
                    to="/admin"
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        isActive
                          ? 'bg-amber-500/20 text-amber-200'
                          : 'text-amber-300/80 hover:bg-amber-500/10 hover:text-amber-200'
                      }`
                    }
                  >
                    <Shield className="h-4 w-4" />
                    Admin HQ
                  </NavLink>
                )}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <OfflineSyncBadge />
            <InstallAppButton />

            {currentUser ? (
              <>
                {currentUser.is_merchant ? (
                  <div
                    className="inline-flex items-center rounded-xl border border-slate-700/80 bg-slate-900 p-0.5"
                    role="group"
                    aria-label="Workspace mode switcher"
                  >
                    <button
                      type="button"
                      onClick={() => void handleModeToggle('buyer')}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        activeViewMode === 'buyer'
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <ShoppingBag className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Buyer Mode</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleModeToggle('merchant')}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        activeViewMode === 'merchant'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Store className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Merchant Mode</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMerchantModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
                  >
                    <Store className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Become a Merchant</span>
                    <span className="sm:hidden">Merchant</span>
                  </button>
                )}

                <Link
                  to="/profile"
                  className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-700"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/25 text-[11px] font-bold text-indigo-200">
                    {currentUser.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="max-w-[110px] truncate">{currentUser.username}</span>
                </Link>

                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                  title="Sign Out"
                  aria-label="Sign Out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <Link
                to="/auth"
                className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>

        {/* Mobile Header Navigation Strip */}
        {currentUser && (
          <div className="flex items-center gap-1.5 border-t border-slate-800/70 px-3 py-1.5 md:hidden">
            <NavLink
              to="/events"
              className={({ isActive }) =>
                `flex-1 text-center rounded-lg py-1 text-xs font-medium ${
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`
              }
            >
              Events
            </NavLink>
            <NavLink
              to="/leaderboard"
              className={({ isActive }) =>
                `flex-1 text-center rounded-lg py-1 text-xs font-medium ${
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`
              }
            >
              Top 10
            </NavLink>
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `flex-1 text-center rounded-lg py-1 text-xs font-medium ${
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`
              }
            >
              Profile
            </NavLink>
            {currentUser.is_admin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `flex-1 text-center rounded-lg py-1 text-xs font-medium ${
                    isActive ? 'bg-amber-500/20 text-amber-200' : 'text-amber-300/80'
                  }`
                }
              >
                Admin
              </NavLink>
            )}
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <BecomeMerchantModal
        isOpen={merchantModalOpen}
        onClose={() => setMerchantModalOpen(false)}
      />
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
        <h1 className="mt-3 text-xl font-bold text-white">Pass Not Found</h1>
        <p className="mt-1 text-xs text-slate-400">
          No event pass matched code <code className="text-indigo-300">{normalizedCode}</code>.
        </p>
        <Link
          to="/events"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white"
        >
          Open Event Directory
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-3xl border border-indigo-500/35 bg-slate-900/90 p-6 text-center shadow-2xl">
        <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-300">
          {match.event?.name ?? 'Event Pass'}
        </span>
        <h1 className="mt-3 text-xl font-extrabold text-white">
          {match.user?.username ?? 'Attendee'}
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          Leaderboard Score: <strong className="text-amber-300">{formatIdr(match.participant.leaderboard_idr)}</strong>{' '}
          &middot; {match.stampsCount} Stamps
        </p>
        <div className="mx-auto my-5 inline-block rounded-2xl bg-white p-4">
          <QRCodeSVG value={match.participant.qr_code} size={200} level="M" />
        </div>
        <p className="font-mono text-2xl font-extrabold tracking-widest text-indigo-300">
          {match.participant.qr_code}
        </p>
        {match.event && (
          <Link
            to={`/event/${match.event.id}`}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"
          >
            <span>Open {match.event.name} Hub</span>
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
        Loading workspace...
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