import React, { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const DISMISS_STORAGE_KEY = 'rallypos_pwa_banner_dismissed_v1';

function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
}

function detectIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() =>
    detectStandaloneMode()
  );
  const [isIosSafari] = useState<boolean>(() => detectIosSafari());

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery.addEventListener('change', handleDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener('change', handleDisplayChange);
    };
  }, []);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) {
      return 'unavailable';
    }
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
    return choice.outcome;
  };

  return {
    canNativeInstall: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    isIosSafari: isIosSafari && !isInstalled,
    promptInstall,
  };
}

interface InstallAppButtonProps {
  className?: string;
}

export const InstallAppButton: React.FC<InstallAppButtonProps> = ({ className = '' }) => {
  const { canNativeInstall, isInstalled, isIosSafari, promptInstall } = usePwaInstall();
  const [showIosTip, setShowIosTip] = useState(false);

  if (isInstalled || (!canNativeInstall && !isIosSafari)) {
    return null;
  }

  const handleClick = async () => {
    if (canNativeInstall) {
      await promptInstall();
    } else if (isIosSafari) {
      setShowIosTip((prev) => !prev);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/25 ${className}`}
      >
        <Download className="h-3.5 w-3.5" />
        <span>Install App</span>
      </button>

      {showIosTip && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 shadow-2xl">
          <div className="mb-1 flex items-center justify-between font-semibold text-white">
            <span>Install on iPhone / iPad</span>
            <button
              type="button"
              onClick={() => setShowIosTip(false)}
              className="rounded p-0.5 text-slate-400 hover:text-white"
              aria-label="Close iOS install instructions"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-slate-300">
            Tap the Safari <Share className="mx-0.5 inline h-3.5 w-3.5 text-indigo-400" />{' '}
            <strong>Share</strong> button, then select{' '}
            <strong>Add to Home Screen</strong>.
          </p>
        </div>
      )}
    </div>
  );
};

export const InstallPwaBanner: React.FC = () => {
  const { canNativeInstall, isInstalled, isIosSafari, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(DISMISS_STORAGE_KEY) === '1';
  });

  if (isInstalled || dismissed || (!canNativeInstall && !isIosSafari)) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    window.localStorage.setItem(DISMISS_STORAGE_KEY, '1');
  };

  const handleInstall = async () => {
    await promptInstall();
  };

  return (
    <div className="border-b border-indigo-500/30 bg-gradient-to-r from-indigo-950/90 via-slate-900/95 to-emerald-950/80 px-4 py-2.5 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30">
            <Smartphone className="h-4 w-4" />
          </div>
          <div className="text-xs sm:text-sm">
            <p className="font-semibold text-white">
              Install RallyPOS as an App for Offline POS &amp; Fast QR Scanning
            </p>
            {isIosSafari ? (
              <p className="text-slate-300">
                In Safari, tap <Share className="mx-0.5 inline h-3.5 w-3.5 text-indigo-300" />{' '}
                <strong>Share</strong> &rarr; <strong>Add to Home Screen</strong>.
              </p>
            ) : (
              <p className="text-slate-300">
                Works on desktop &amp; mobile with offline IndexedDB sync and instant camera access.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canNativeInstall && (
            <button
              type="button"
              onClick={handleInstall}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            >
              <Download className="h-3.5 w-3.5" />
              Install App
            </button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label="Dismiss install banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};