'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  DeleteAccountSection,
  DeletionEndedPanel,
  type DeletionOutcome,
} from '@/components/account/DeleteAccountSection';
import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { loadProfile, updateProfileAction } from '@/lib/account/client';
import type { AuthUserData } from '@/lib/api/types';
import { verifyEmailHref } from '@/lib/auth/verify-email-href';
import { cn } from '@/lib/utils';

/*
 * Profile hub island (user-ЛК Slice 1). Loads the fresh auth-surface user via
 * the buffered Route Handler — the rg_user display cookie carries no
 * emailVerified/authMethod, so /auth/me is the source. Anonymous → client
 * redirect to /login?returnTo=/profile (the (account) shell is static, the
 * guard lives here).
 *
 * Name editing is a controlled input + explicit save (no Server Action → no
 * React 19 uncontrolled-field reset concern). A successful save re-stamps
 * rg_user server-side and syncs AuthProvider via applySession, so the header
 * name updates without a reload. «Сменить пароль» rides the existing
 * /forgot-password email flow and only shows for password accounts
 * (authMethod=email) — OAuth accounts have no password to change.
 *
 * Once the account is deleted (brief В1, 18.10.2026), the hub shows only how
 * the deletion ended: the name, the e-mail, «Сохранить» and «Выйти» belonged
 * to an account that is gone.
 */

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; profile: AuthUserData };

const AUTH_METHOD_LABELS: Record<string, string> = {
  google: 'Google',
  yandex: 'Яндекс',
};

function saveMessageForCode(code: string): string {
  if (code === 'VALIDATION_ERROR') {
    return 'Имя: от 2 до 50 символов — только буквы, пробел, дефис и апостроф.';
  }
  if (code === 'NETWORK') {
    return 'Не удалось сохранить: проверьте соединение и попробуйте ещё раз.';
  }
  return 'Не удалось сохранить. Попробуйте ещё раз.';
}

export function ProfileHub() {
  const router = useRouter();
  const { applySession, logout, markAnonymous } = useAuth();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [ended, setEnded] = useState<DeletionOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProfile()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (res.code === 'NO_SESSION') {
            // Sync the client auth context first: /login's AuthRedirect would
            // bounce a stale 'authenticated' status straight back here
            // (redirect ping-pong). The session is already gone: the server
            // refused the refresh (cookies cleared) or there was nothing to
            // refresh. A refresh that merely got no answer arrives as
            // SESSION_REFRESH_UNAVAILABLE and lands on the error state below.
            markAnonymous();
            router.replace('/login?returnTo=/profile');
            return; // keep the skeleton while the redirect lands
          }
          setState({ phase: 'error' });
          return;
        }
        setState({ phase: 'ready', profile: res.profile });
        setName(res.profile.name);
        setSavedName(res.profile.name);
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [router, markAnonymous]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || saving) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const res = await updateProfileAction(trimmed);
    setSaving(false);
    if (res.ok) {
      applySession(res.user);
      setName(res.user.name);
      setSavedName(res.user.name);
      setSaved(true);
      return;
    }
    if (res.code === 'NO_SESSION') {
      markAnonymous(); // see the load-path comment — breaks the login bounce
      router.replace('/login?returnTo=/profile');
      return;
    }
    setSaveError(res.message ?? saveMessageForCode(res.code));
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await logout();
    router.replace('/');
  };

  if (ended) {
    return <DeletionEndedPanel outcome={ended} />;
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex max-w-3xl flex-col gap-m">
        <Skeleton className="h-64 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="max-w-3xl rounded-[var(--radius-l)] border border-border bg-background p-l text-center">
        <p className="text-body-m text-foreground">
          Не удалось загрузить профиль. Обновите страницу.
        </p>
      </div>
    );
  }

  const { profile } = state;
  const nameChanged = name.trim() !== savedName;

  return (
    <div className="flex max-w-3xl flex-col gap-m">
      <section className="flex flex-col gap-l rounded-card bg-figma-bg-warm p-l">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="profile-name"
            className="text-body-s text-figma-text-dark"
          >
            Имя
          </label>
          <div className="flex flex-col gap-s sm:flex-row">
            <Input
              id="profile-name"
              value={name}
              maxLength={50}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
                setSaveError(null);
              }}
              className="sm:w-80"
            />
            <Button
              size="cta"
              onClick={() => void handleSave()}
              disabled={saving || !nameChanged || name.trim().length === 0}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
          {saved && (
            <p className="text-body-s text-figma-text-dark">Сохранено.</p>
          )}
          {saveError && (
            <p className="text-body-s text-destructive">{saveError}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-body-s text-figma-text-dark">Email</span>
          <div className="flex flex-wrap items-center gap-s">
            {/* min-w-0 + wrap-anywhere: an address has no spaces, and «.»/«@»
                give the browser no break point, so a long one ran past the
                card on a phone (п. 22). It now wraps inside the card. */}
            <span
              data-testid="profile-email"
              className="min-w-0 max-w-full text-body-m text-foreground wrap-anywhere"
            >
              {profile.email}
            </span>
            {profile.emailVerified ? (
              <Badge variant="secondary">Подтверждён</Badge>
            ) : (
              <>
                <Badge variant="outline">Не подтверждён</Badge>
                <Link
                  href={verifyEmailHref('/profile')}
                  className="text-body-s font-medium text-brand-dark hover:underline"
                >
                  Подтвердить
                </Link>
              </>
            )}
          </div>
          {/* No e-mail change on the server yet (PUT /auth/profile takes the
              name only) — say so instead of leaving the visitor to look for
              it (п. 24). No support address: there is no mailbox yet
              (Координатор, 18.10). */}
          <p className="text-body-s text-figma-text-dark">
            Сменить почту пока нельзя.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-body-s text-figma-text-dark">Пароль</span>
          {profile.authMethod === 'email' ? (
            <div className="flex flex-col items-start gap-2">
              <Link
                href="/forgot-password"
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                Сменить пароль
              </Link>
              <p className="text-body-s text-figma-text-dark">
                Пришлём на email ссылку для смены пароля.
              </p>
            </div>
          ) : (
            <p className="text-body-m text-foreground">
              Вход через{' '}
              {AUTH_METHOD_LABELS[profile.authMethod] ?? profile.authMethod} —
              пароль не используется.
            </p>
          )}
        </div>
      </section>

      <section className="flex items-center justify-between gap-m rounded-card bg-figma-bg-warm p-l">
        <span className="text-body-m text-foreground">Выйти из учётной записи</span>
        <Button
          variant="outline"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
        >
          {loggingOut ? 'Выход…' : 'Выйти'}
        </Button>
      </section>

      <DeleteAccountSection onEnded={setEnded} />
    </div>
  );
}
