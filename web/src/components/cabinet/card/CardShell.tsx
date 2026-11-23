'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ExternalLink } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { EstablishmentStatus, ModerationNotes, PartnerEstablishmentDetail } from '@/lib/api/types';
import { CARD_TEXTS } from '@/lib/partner/cabinet-texts';
import { cardSectionOf } from '@/lib/partner/card-sections';
import { loadEstablishmentForEdit } from '@/lib/partner/client';
import { STATUS_BADGE, STATUS_LABELS, isAdminSuspended, notesAfterOwnPause } from '@/lib/partner/status';
import { cn } from '@/lib/utils';

import { ResumeEstablishmentButton } from '../ResumeEstablishmentButton';
import { SuspendEstablishmentButton } from '../SuspendEstablishmentButton';
import { CardSectionNav } from './CardSectionNav';
import { SessionExpired } from './SessionExpired';

/*
 * The card in the cabinet: its header (back to the cabinet, name, status,
 * «Посмотреть на сайте», «Приостановить показ» / «Возобновить показ») and the
 * row of its sections (part 1 of «Кабинет партнёра на сайте», directive 1.1).
 *
 * One load of the card per view of a section: the shell loads it through the
 * buffered load route every time the section's address changes, and renders
 * the section only with the load made for that address — so the card's form
 * is never seeded from a copy loaded before the partner went to «Меню» and
 * back. The section reads the card from the context (useCabinetCard); the
 * header keeps showing the card meanwhile.
 *
 * An expired session shows «Сессия истекла.» with «Войти снова», as the
 * cabinet's list does — no redirect of its own, no markAnonymous() (the
 * cabinet's sign-in loop is not this thread's to fix).
 */

export type CabinetCardState =
  | { phase: 'loading' }
  | { phase: 'error'; code: string }
  | { phase: 'ready'; card: PartnerEstablishmentDetail; publicPath: string | null };

export type CabinetCard = {
  id: string;
  state: CabinetCardState;
  /** The card's status changed here (a pause or a resume). */
  setStatus: (status: EstablishmentStatus, change?: { publicPath?: string | null; notes?: ModerationNotes }) => void;
};

const CabinetCardContext = createContext<CabinetCard | null>(null);

/** The card of the shell around this section, or null outside one. */
export function useCabinetCard(): CabinetCard | null {
  return useContext(CabinetCardContext);
}

type Loaded = { pathname: string; state: CabinetCardState };

export function CardShell({ id, children }: { id: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadEstablishmentForEdit(id)
      .then((r) => {
        if (cancelled) return;
        setLoaded({
          pathname,
          state: r.ok
            ? { phase: 'ready', card: r.establishment, publicPath: r.publicPath ?? null }
            : { phase: 'error', code: r.code },
        });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ pathname, state: { phase: 'error', code: 'NETWORK' } });
      });
    return () => {
      cancelled = true;
    };
  }, [id, pathname]);

  const setStatus = useCallback<CabinetCard['setStatus']>((status, change = {}) => {
    setLoaded((prev) => {
      if (!prev || prev.state.phase !== 'ready') return prev;
      const { card } = prev.state;
      const publicPath =
        status === 'active'
          ? (change.publicPath ?? prev.state.publicPath)
          : null;
      return {
        ...prev,
        state: {
          phase: 'ready',
          card: {
            ...card,
            status,
            moderation_notes: change.notes !== undefined ? change.notes : card.moderation_notes,
          },
          publicPath,
        },
      };
    });
  }, []);

  // The section sees only the load made for its own address.
  const fresh = useMemo<CabinetCardState>(
    () => (loaded && loaded.pathname === pathname ? loaded.state : { phase: 'loading' }),
    [loaded, pathname],
  );
  const value = useMemo<CabinetCard>(() => ({ id, state: fresh, setStatus }), [id, fresh, setStatus]);

  // The header shows the card it has, fresh or not; the first load shows a skeleton.
  const header = loaded?.state.phase === 'ready' ? loaded.state : null;
  const section = cardSectionOf(pathname) ?? 'edit';

  if (fresh.phase === 'error') {
    return (
      <div className="flex flex-col gap-l">
        <BackLink />
        {fresh.code === 'NO_SESSION' ? (
          <SessionExpired returnTo={`/cabinet/${id}/${section}`} />
        ) : (
          <div className="rounded-[var(--radius-l)] border border-border bg-background p-l text-center">
            <p className="text-body-m text-foreground">{CARD_TEXTS.loadFailed}</p>
            <Link
              href="/cabinet"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-m')}
            >
              {CARD_TEXTS.toCabinet}
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <CabinetCardContext.Provider value={value}>
      <div className="flex flex-col gap-l">
        <header className="flex flex-col gap-m">
          <BackLink />
          {header ? (
            <CardHeader
              id={id}
              card={header.card}
              publicPath={header.publicPath}
              onSuspended={() =>
                setStatus('suspended', { notes: notesAfterOwnPause(header.card.moderation_notes) })
              }
              onResumed={(publicPath) => setStatus('active', { publicPath })}
            />
          ) : (
            <Skeleton className="h-9 w-72" />
          )}
          <CardSectionNav id={id} />
        </header>
        {fresh.phase === 'ready' ? children : <SectionSkeleton />}
      </div>
    </CabinetCardContext.Provider>
  );
}

function BackLink() {
  return (
    <Link
      href="/cabinet"
      className="inline-flex w-fit items-center gap-1 text-body-s text-figma-text-grey transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      {CARD_TEXTS.backToCabinet}
    </Link>
  );
}

function CardHeader({
  id,
  card,
  publicPath,
  onSuspended,
  onResumed,
}: {
  id: string;
  card: PartnerEstablishmentDetail;
  publicPath: string | null;
  onSuspended: () => void;
  onResumed: (publicPath: string | undefined) => void;
}) {
  const selfPaused = card.status === 'suspended' && !isAdminSuspended(card.moderation_notes);
  return (
    <div className="flex flex-wrap items-center justify-between gap-m">
      <div className="flex min-w-0 flex-wrap items-center gap-s">
        <h1 className="min-w-0 font-display text-display-s text-foreground wrap-anywhere">
          {card.name || 'Заведение'}
        </h1>
        <span
          className={cn(
            'rounded-[var(--radius-s)] px-2 py-1 text-caption-m font-medium',
            STATUS_BADGE[card.status],
          )}
        >
          {STATUS_LABELS[card.status]}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {card.status === 'active' && publicPath && (
          <a
            href={publicPath}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1')}
          >
            {CARD_TEXTS.viewOnSite}
            <ExternalLink className="size-3.5" />
          </a>
        )}
        {card.status === 'active' && (
          <SuspendEstablishmentButton
            establishmentId={id}
            onSuspended={onSuspended}
            className="flex-none"
          />
        )}
        {selfPaused && (
          <div className="flex flex-col items-end gap-1">
            <ResumeEstablishmentButton
              establishmentId={id}
              onResumed={(_, resumed) => onResumed(resumed.publicPath)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-l">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-32 w-full rounded-[var(--radius-l)]" />
      ))}
    </div>
  );
}
