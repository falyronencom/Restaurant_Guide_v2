'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

/*
 * Android install sticky-bar. iOS gets the NATIVE Apple Smart App Banner from
 * the `itunes` metadata in the root layout, so this component is Android-only —
 * Android has no native smart-banner equivalent.
 *
 * Coordinator decision (2026-06-17): visible immediately. Until the app is
 * published on Google Play the link lands on a Play placeholder — accepted.
 *
 * Hydration: render nothing on the server (visible=false), then after mount
 * detect Android + the dismissed flag and show via a deferred setState. A lazy
 * initializer would diverge from the server HTML (SSR mismatch); a synchronous
 * setState in the effect body trips react-hooks/set-state-in-effect
 * (feedback_react_localstorage_hydration_defer). Mirrors useSelectedCity.
 */

const PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.nirivio.app';
const DISMISS_KEY = 'nirivio:app-banner-dismissed';

export function AppBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!/Android/i.test(navigator.userAgent)) return undefined;

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      dismissed = false;
    }
    if (dismissed) return undefined;

    const timer = setTimeout(() => setVisible(true), 0);
    return () => clearTimeout(timer);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode / quota — non-fatal */
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background px-m py-s shadow-[0_-2px_12px_rgb(0_0_0_/_8%)] sm:hidden">
      <div className="mx-auto flex max-w-3xl items-center gap-m">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Закрыть"
          className="shrink-0 text-text-tertiary transition-colors hover:text-foreground"
        >
          <X className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-m text-foreground">
            Приложение Nirivio
          </p>
          <p className="truncate text-caption-m text-text-secondary">
            Удобнее в приложении — вход, избранное, карта
          </p>
        </div>
        <a
          href={PLAY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full bg-brand px-l py-s text-label-m text-text-on-primary transition-colors hover:bg-brand-dark"
        >
          Установить
        </a>
      </div>
    </div>
  );
}
