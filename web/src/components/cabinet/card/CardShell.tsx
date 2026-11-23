'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
 * One load of the card per view of a section: every change of the address is
 * a new view with its own number, the shell loads the card for it through the
 * buffered load route, and renders the section only with the load made for
 * that view. «Карточка» → «Меню» → «Карточка» before the load of «Меню»
 * landed is a third view: the load of the first «Карточка» — the card as it
 * was before the partner's saves there — is not fresh for it. Seeded from it,
 * the form would save itself 800 ms later and put the old card back, the
 * photos added meanwhile deleted (the PUT is the card's whole desired state).
 * For the same reason a view's load starts only after the saves begun before
 * it have landed (the form saves as it closes): a load that overtook one
 * would read the card as it was before it. The section reads the card from
 * the context (useCabinetCard); the header keeps showing the card meanwhile.
 *
 * A pause or a resume made while a load is under way stays: the load read the
 * card before it, its status is older than the header's.
 *
 * An expired session shows «Сессия истекла.» with «Войти снова», as the
 * cabinet's list does — no redirect of its own, no markAnonymous() (the
 * cabinet's sign-in loop is not this thread's to fix).
 */

export type CabinetCardState =
  | { phase: 'loading' }
  | { phase: 'error'; code: string }
  | { phase: 'ready'; card: PartnerEstablishmentDetail; publicPath: string | null };

type StatusChange = { publicPath?: string | null; notes?: ModerationNotes };

export type CabinetCard = {
  id: string;
  state: CabinetCardState;
  /** The card's status changed here (a pause or a resume). */
  setStatus: (status: EstablishmentStatus, change?: StatusChange) => void;
  /** A save of the section's form began: the next view's load waits for it to land. */
  trackSave: (save: Promise<unknown>) => void;
};

const CabinetCardContext = createContext<CabinetCard | null>(null);

/** The card of the shell around this section, or null outside one. */
export function useCabinetCard(): CabinetCard | null {
  return useContext(CabinetCardContext);
}

type Loaded = { view: number; state: CabinetCardState };

/** The card with a status changed here. */
function withStatus(state: CabinetCardState, status: EstablishmentStatus, change: StatusChange): CabinetCardState {
  if (state.phase !== 'ready') return state;
  const { card } = state;
  return {
    phase: 'ready',
    card: {
      ...card,
      status,
      moderation_notes: change.notes !== undefined ? change.notes : card.moderation_notes,
    },
    publicPath: status === 'active' ? (change.publicPath ?? state.publicPath) : null,
  };
}

export function CardShell({ id, children }: { id: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  // The view of a section: a new number with every change of the address.
  const viewKey = `${id}\n${pathname}`;
  const [view, setView] = useState({ key: viewKey, n: 0 });
  if (view.key !== viewKey) setView({ key: viewKey, n: view.n + 1 });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The form's saves not landed yet.
  const saves = useRef(new Set<Promise<unknown>>());
  // The pause or resume made here last, and how many were made.
  const statusChanges = useRef<{ count: number; last: { status: EstablishmentStatus; change: StatusChange } | null }>(
    { count: 0, last: null },
  );

  const trackSave = useCallback<CabinetCard['trackSave']>((save) => {
    saves.current.add(save);
    const landed = () => {
      saves.current.delete(save);
    };
    save.then(landed, landed);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const forView = view.n;
    const changesBefore = statusChanges.current.count;
    const apply = (state: CabinetCardState) => {
      if (cancelled) return;
      // A pause or a resume made while this load was under way is newer than it.
      const { count, last } = statusChanges.current;
      setLoaded({
        view: forView,
        state: count !== changesBefore && last ? withStatus(state, last.status, last.change) : state,
      });
    };
    const load = () =>
      loadEstablishmentForEdit(id).then((r) =>
        apply(
          r.ok
            ? { phase: 'ready', card: r.establishment, publicPath: r.publicPath ?? null }
            : { phase: 'error', code: r.code },
        ),
      );
    const pending = [...saves.current];
    void (pending.length
      ? Promise.allSettled(pending).then(() => (cancelled ? undefined : load()))
      : load()
    ).catch(() => apply({ phase: 'error', code: 'NETWORK' }));
    return () => {
      cancelled = true;
    };
  }, [id, view.n]);

  const setStatus = useCallback<CabinetCard['setStatus']>((status, change = {}) => {
    statusChanges.current = { count: statusChanges.current.count + 1, last: { status, change } };
    setLoaded((prev) => (prev ? { ...prev, state: withStatus(prev.state, status, change) } : prev));
  }, []);

  // The section sees only the load made for its own view.
  const fresh = useMemo<CabinetCardState>(
    () => (loaded && loaded.view === view.n ? loaded.state : { phase: 'loading' }),
    [loaded, view.n],
  );
  const value = useMemo<CabinetCard>(
    () => ({ id, state: fresh, setStatus, trackSave }),
    [id, fresh, setStatus, trackSave],
  );

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
