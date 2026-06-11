'use client';

import Script from 'next/script';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import type { SessionUser } from '@/lib/api/types';
import {
  establishGoogleSession,
  getSessionSummary,
  logoutAction,
  prepareLogin,
} from '@/lib/auth/actions';

/*
 * Handrolled-minimal auth context (DECISION #3) — no auth library, no state
 * manager. Awareness only: exposes login state + the Google sign-in / logout
 * triggers to islands (AuthMenu, FavoriteButton).
 *
 * Hydration: the session cookies are httpOnly (unreadable by client JS), so the
 * provider learns its initial state by calling the getSessionSummary Server
 * Action on mount. Reading server-side keeps the root layout static (ISR
 * preserved per DECISION C) at the cost of a brief logged-out → logged-in
 * settle on first paint, exactly mirroring the OpenStatusBadge placeholder.
 *
 * GIS is centralised here (loaded once) so requestLogin() is callable from
 * anywhere — the header AuthMenu AND the FavoriteButton proving-action.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

type GoogleCredentialResponse = { credential: string };
type GoogleIdApi = {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce?: string;
    cancel_on_tap_outside?: boolean;
  }): void;
  prompt(): void;
  cancel(): void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: AuthStatus;
  user: SessionUser | null;
  isAuthenticated: boolean;
  /** Trigger the Google sign-in flow (One Tap account chooser). */
  requestLogin: () => void;
  logout: () => Promise<void>;
  /** Last login error message, if any. */
  loginError: string | null;
  /**
   * Apply a session established outside this provider (email/password form
   * actions on /login and /register). The Server Action has already set the
   * httpOnly cookies; this syncs the client context, which never remounts on
   * soft navigation.
   */
  applySession: (user: SessionUser) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}

/** Poll briefly for the GIS global, which loads asynchronously via next/script. */
async function waitForGoogleId(timeoutMs = 4000): Promise<GoogleIdApi | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const id = window.google?.accounts?.id;
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return window.google?.accounts?.id ?? null;
}

export function AuthProvider({
  googleClientId,
  children,
}: {
  googleClientId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Hydrate session on mount (httpOnly cookie → ask the server).
  useEffect(() => {
    let cancelled = false;
    getSessionSummary()
      .then((summary) => {
        if (cancelled) return;
        setUser(summary);
        setStatus(summary ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (!cancelled) setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      const result = await establishGoogleSession(response.credential);
      if (result.ok) {
        setUser(result.user);
        setStatus('authenticated');
        setLoginError(null);
        router.refresh();
      } else {
        setLoginError(result.message);
      }
    },
    [router],
  );

  const requestLogin = useCallback(() => {
    if (!googleClientId) {
      console.error(
        '[auth] GOOGLE_CLIENT_ID is not set on the web app — Google sign-in is unavailable. ' +
          'Set GOOGLE_CLIENT_ID in web/.env.local (dev) or in the deploy platform (prod).',
      );
      setLoginError('Вход через Google временно недоступен.');
      return;
    }
    setLoginError(null);
    void (async () => {
      try {
        const gis = await waitForGoogleId();
        if (!gis) {
          setLoginError('Не удалось загрузить Google. Проверьте подключение.');
          return;
        }
        const { nonce } = await prepareLogin();
        gis.initialize({
          client_id: googleClientId,
          callback: (response) => {
            void handleCredential(response);
          },
          nonce,
          cancel_on_tap_outside: true,
        });
        gis.prompt();
      } catch {
        // prepareLogin() / GIS init can reject (network, mid-load) — surface it
        // instead of leaving an unhandled rejection + a silent dead button.
        setLoginError('Не удалось начать вход. Попробуйте ещё раз.');
      }
    })();
  }, [googleClientId, handleCredential]);

  const logout = useCallback(async () => {
    await logoutAction();
    setUser(null);
    setStatus('anonymous');
    window.google?.accounts?.id?.cancel();
    router.refresh();
  }, [router]);

  const applySession = useCallback((nextUser: SessionUser) => {
    setUser(nextUser);
    setStatus('authenticated');
    setLoginError(null);
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    isAuthenticated: status === 'authenticated',
    requestLogin,
    logout,
    loginError,
    applySession,
  };

  return (
    <AuthContext.Provider value={value}>
      {googleClientId ? (
        <Script src={GIS_SRC} strategy="afterInteractive" />
      ) : null}
      {children}
    </AuthContext.Provider>
  );
}
