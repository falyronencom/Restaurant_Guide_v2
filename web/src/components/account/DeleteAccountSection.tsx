'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  checkAccountDeletionAction,
  deleteAccountAction,
} from '@/lib/account/client';
import {
  ACCOUNT_DELETION_WORD,
  DELETED_ITEMS,
  DRAFTS_ITEM,
  KEPT_ITEMS,
  SUPPORT_EMAIL,
  isDeletionWord,
} from '@/lib/account/deletion';
import { forgetWizardDraft } from '@/lib/partner/draft-storage';

/*
 * «Удалить учётную запись» in the profile (brief В1, 18.10.2026; Google Play asks for
 * a way to delete the account without the app). The same steps as the app:
 * ask the backend first — a holder of cards reads its «напишите в поддержку»
 * before typing anything; otherwise a plain warning, the word УДАЛИТЬ and a
 * button that works only with it. The word goes to the backend as typed: the
 * backend checks it again.
 *
 * How it ends is the hub's to show (onEnded): the profile above — name, e-mail,
 * «Сохранить», «Выйти» — belongs to an account that is gone, so the hub puts
 * DeletionEndedPanel in its place. Before that the session cookies are gone
 * (the operation clears them), AuthProvider is told the visitor is anonymous,
 * and the wizard's local draft of the deleted account is removed.
 *
 * A session found dead at the deletion itself ends as «Сеанс завершён», not as
 * a trip to the login: on a retry after an answer that never arrived, the
 * deletion went through and ended the session — the login would only say the
 * account does not exist. The site cannot tell this from a session that
 * expired on its own; the panel says both.
 *
 * A refusal of the DELETE itself (the cards appeared between the check and
 * the click, the panel blocked the account meanwhile) asks the check again:
 * its answer carries the refusal's text and the state the account is in now.
 */

/** How the deletion ended, for the hub's panel. */
export type DeletionOutcome = 'deleted' | 'sessionEnded';

type Phase =
  | { kind: 'closed' }
  | { kind: 'checking' }
  | { kind: 'checkFailed' }
  | { kind: 'refused'; message: string }
  | { kind: 'ready'; error: string | null }
  | { kind: 'deleting' };

const FALLBACK_REFUSAL = `Сейчас учётную запись удалить нельзя. Напишите в поддержку: ${SUPPORT_EMAIL}`;
const DELETE_FAILED = 'Не удалось удалить учётную запись. Проверьте соединение и попробуйте ещё раз.';

const REFUSAL_CODES = new Set(['ACCOUNT_OWNS_ESTABLISHMENTS', 'ACCOUNT_OPERATOR_MANAGED', 'ACCOUNT_INACTIVE']);

type Props = {
  onEnded: (outcome: DeletionOutcome) => void;
};

export function DeleteAccountSection({ onEnded }: Props) {
  const router = useRouter();
  const { markAnonymous, user } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const [word, setWord] = useState('');

  const deletedItems = user?.role === 'partner' ? [...DELETED_ITEMS, DRAFTS_ITEM] : DELETED_ITEMS;

  const check = async () => {
    setPhase({ kind: 'checking' });
    const res = await checkAccountDeletionAction();
    if (!res.ok) {
      if (res.code === 'NO_SESSION') {
        markAnonymous();
        router.replace('/login?returnTo=/profile');
        return;
      }
      setPhase({ kind: 'checkFailed' });
      return;
    }
    if (!res.allowed) {
      setPhase({ kind: 'refused', message: res.refusal?.message ?? FALLBACK_REFUSAL });
      return;
    }
    setPhase({ kind: 'ready', error: null });
  };

  const remove = async () => {
    if (!isDeletionWord(word)) return;
    setPhase({ kind: 'deleting' });
    const res = await deleteAccountAction(word);
    if (res.ok) {
      // The id before markAnonymous takes the user away.
      forgetWizardDraft(user?.id);
      markAnonymous();
      onEnded('deleted');
      return;
    }
    if (res.code === 'NO_SESSION') {
      // The draft stays: the account may be alive, with a session that
      // simply expired.
      markAnonymous();
      onEnded('sessionEnded');
      return;
    }
    if (REFUSAL_CODES.has(res.code)) {
      await check();
      return;
    }
    setPhase({ kind: 'ready', error: DELETE_FAILED });
  };

  return (
    <section className="flex flex-col gap-m rounded-card bg-figma-bg-warm p-l">
      <div className="flex items-center justify-between gap-m">
        <span className="text-body-m text-foreground">Удалить учётную запись</span>
        {phase.kind === 'closed' && (
          <Button variant="destructive" onClick={() => void check()}>
            Удалить…
          </Button>
        )}
      </div>

      {phase.kind === 'checking' && (
        <p className="text-body-s text-figma-text-dark">Проверяем учётную запись…</p>
      )}

      {phase.kind === 'checkFailed' && (
        <div className="flex flex-col items-start gap-s">
          <p className="text-body-s text-destructive">
            Не удалось проверить учётную запись. Проверьте соединение.
          </p>
          <Button variant="outline" onClick={() => void check()}>
            Повторить
          </Button>
        </div>
      )}

      {phase.kind === 'refused' && (
        <div className="flex flex-col items-start gap-s">
          <p className="text-body-m text-foreground">{phase.message}</p>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Удаление учётной записи')}`}
            className="text-body-m font-medium text-brand hover:text-brand-dark"
          >
            Написать в поддержку
          </a>
        </div>
      )}

      {(phase.kind === 'ready' || phase.kind === 'deleting') && (
        <div className="flex flex-col gap-m">
          <div className="flex flex-col gap-2">
            <span className="text-body-m font-medium text-foreground">Что удалится</span>
            <ul className="list-disc pl-l text-body-m text-foreground">
              {deletedItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-body-m font-medium text-foreground">
              Что останется без вашего имени
            </span>
            <ul className="list-disc pl-l text-body-m text-foreground">
              {KEPT_ITEMS.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <p className="text-body-m text-foreground">
            Вернуть учётную запись будет нельзя. Новую можно завести на ту же почту или телефон.
          </p>
          <div className="flex flex-col gap-2">
            <label htmlFor="delete-account-word" className="text-body-s text-figma-text-dark">
              Чтобы подтвердить, введите слово {ACCOUNT_DELETION_WORD}
            </label>
            <div className="flex flex-col gap-s sm:flex-row">
              <Input
                id="delete-account-word"
                value={word}
                autoComplete="off"
                disabled={phase.kind === 'deleting'}
                onChange={(event) => setWord(event.target.value)}
                className="sm:w-80"
              />
              <Button
                variant="destructive"
                onClick={() => void remove()}
                disabled={phase.kind === 'deleting' || !isDeletionWord(word)}
              >
                {phase.kind === 'deleting' ? 'Удаление…' : 'Удалить учётную запись'}
              </Button>
            </div>
            {phase.kind === 'ready' && phase.error && (
              <p className="text-body-s text-destructive">{phase.error}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** What the hub shows in place of the profile once the deletion has ended. */
export function DeletionEndedPanel({ outcome }: { outcome: DeletionOutcome }) {
  return (
    <section
      className="flex max-w-3xl flex-col items-start gap-s rounded-card bg-figma-bg-warm p-l"
      aria-live="polite"
    >
      {outcome === 'deleted' ? (
        <p className="text-body-m font-medium text-foreground">Учётная запись удалена.</p>
      ) : (
        <>
          <p className="text-body-m font-medium text-foreground">Сеанс завершён.</p>
          <p className="text-body-m text-foreground">
            Если удаление успело пройти, учётной записи больше нет и войти в неё не получится.
            Если нет — войдите и удалите её снова.
          </p>
          <Link
            href="/login?returnTo=/profile"
            className="text-body-m font-medium text-brand hover:text-brand-dark"
          >
            Войти
          </Link>
        </>
      )}
      <Link href="/" className="text-body-m font-medium text-brand hover:text-brand-dark">
        На главную
      </Link>
    </section>
  );
}
