import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  QrCode,
  Shield,
  ShoppingBag,
  Sparkles,
  Store,
  Zap,
} from 'lucide-react';
import { type DemoPresetRole, useApp } from '../context/AppContext';
import { soundFeedback } from '../lib/soundFeedback';

export const AuthPage: React.FC = () => {
  const {
    currentUser,
    isDemoMode,
    registerWithEmail,
    loginWithEmail,
    loginWithGoogle,
    loginWithDemoAccount,
  } = useApp();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [demoPreset, setDemoPreset] = useState<DemoPresetRole>('fresh_buyer');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (currentUser) {
    return <Navigate to="/events" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'register' && username.trim().length < 3) {
      setError('Display Name must be at least 3 characters.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await soundFeedback.unlockAudioContext();
      if (mode === 'register') {
        await registerWithEmail({ email, username, password });
      } else {
        await loginWithEmail({ email, password });
      }
      navigate('/events');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoContinue = async (chosenPreset: DemoPresetRole = demoPreset) => {
    setError(null);
    setSubmitting(true);
    try {
      await soundFeedback.unlockAudioContext();
      await loginWithDemoAccount(chosenPreset);
      navigate('/events');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to launch Interactive Demo Preview.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in unavailable.');
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center px-4 py-8 sm:py-10">
      <div className="grid w-full gap-8 lg:grid-cols-12 lg:items-center">
        {/* Left Hero Column */}
        <div className="space-y-5 lg:col-span-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Convention Pass &amp; Digital Stamp Rally</span>
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl [text-wrap:balance]">
            Every Booth Visited.
            <span className="block bg-gradient-to-r from-indigo-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">
              Every Stamp Collected.
            </span>
          </h1>

          <p className="text-sm leading-relaxed text-slate-300 sm:text-base">
            Check in with your Event Ticket Code, collect 1:1 custom booth stamps, trigger
            60-minute <strong className="text-white">1.25x</strong> leaderboard streaks, or
            unlock a booth terminal anytime.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-indigo-300">
                <ShoppingBag className="h-4 w-4" />
                <span>Attendee Pass Ready</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Get your personal Attendee Checkout QR, private spend summary, and digital stamp
                passport immediately.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                <Store className="h-4 w-4" />
                <span>Optional Booth Switch</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Link a Booth Event Ticket Code anytime to switch seamlessly between{' '}
                <strong className="text-slate-200">Buyer &hArr; Booth</strong> views.
              </p>
            </div>
          </div>

          {/* Interactive Demo Preview Panel */}
          <div className="rounded-2xl border border-indigo-500/35 bg-gradient-to-br from-indigo-950/60 via-slate-900 to-slate-900 p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Zap className="h-4 w-4 text-amber-400" />
                <span>Interactive Demo Preview</span>
              </div>
              <span className="text-[11px] font-semibold text-emerald-300">
                {isDemoMode ? 'Offline-Ready' : 'Quick Preview'}
              </span>
            </div>

            <p className="mt-1.5 text-xs text-slate-300">
              Explore Comifuro Demo with sample booths, attendees, and Event Ticket Codes{' '}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-indigo-300">
                TKT-DEMO-BYR
              </code>{' '}
              &amp;{' '}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-300">
                TKT-DEMO-SLR
              </code>
              .
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'fresh_buyer', label: 'New Attendee (Code)', icon: QrCode },
                  { id: 'active_buyer', label: 'Rizky (#1 Patron)', icon: ShoppingBag },
                  { id: 'merchant', label: 'KitsuneInk (Booth)', icon: Store },
                  { id: 'admin', label: 'Event Organizer', icon: Shield },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const selected = demoPreset === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDemoPreset(item.id)}
                    className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition ${
                      selected
                        ? 'border-indigo-400 bg-indigo-500/20 text-white'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleDemoContinue(demoPreset)}
              className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-60"
            >
              <span>Launch Demo Preview</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Right Auth Form Column */}
        <div className="lg:col-span-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl sm:p-8">
            <div className="grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`min-h-[40px] rounded-lg py-2 text-sm font-semibold transition ${
                  mode === 'login'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`min-h-[40px] rounded-lg py-2 text-sm font-semibold transition ${
                  mode === 'register'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>

            <h2 className="mt-6 text-xl font-bold text-white">
              {mode === 'login' ? 'Welcome back' : 'Create your convention pass'}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {mode === 'login'
                ? 'Sign in with your email and password to open your Event Hubs.'
                : 'Your Display Name appears on event leaderboards and the meetup board.'}
            </p>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-medium text-rose-200"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-username"
                    className="mb-1.5 block text-xs font-semibold text-slate-300"
                  >
                    Display Name
                  </label>
                  <input
                    id="auth-username"
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="e.g. AkiraCosplay"
                    className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="mb-1.5 block text-xs font-semibold text-slate-300"
                >
                  Email Address
                </label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="you@example.com"
                  className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="mb-1.5 block text-xs font-semibold text-slate-300"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Minimum 6 characters"
                    className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pr-11 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-200"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {mode === 'register' && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    Starts as an <strong>Attendee Pass</strong>. Unlock a booth anytime with a booth
                    ticket code.
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
              >
                <span>
                  {submitting
                    ? 'Please wait...'
                    : mode === 'login'
                      ? 'Sign In'
                      : 'Create Account'}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-800" />
              <span className="text-[11px] font-medium text-slate-500">Or</span>
              <div className="h-px flex-1 bg-slate-800" />
            </div>

            <button
              type="button"
              onClick={() => void handleGoogleLogin()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.8C6.2 7.2 8.9 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6l3.7 2.9c2.2-2 3.7-5 3.7-8.7z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.3 14.8c-.2-.8-.4-1.6-.4-2.5s.2-1.7.4-2.5L1.6 7C.6 8.9 0 10.9 0 13s.6 4.1 1.6 6l3.7-2.9z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.1-6.7-5l-3.7 2.9C3.5 21.4 7.4 24 12 24z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};