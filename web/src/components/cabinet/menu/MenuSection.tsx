'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CloudOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MENU_TEXTS, RESTART_TEXTS } from '@/lib/partner/cabinet-texts';
import { cardSectionHref } from '@/lib/partner/card-sections';
import { loadMenuItems, refreshCardPageAction } from '@/lib/partner/client';
import { refusalMessage } from '@/lib/partner/errors';
import {
  groupBySection,
  replaceItem,
  sectionsOf,
  type MenuRecognitionStatus,
  type PartnerMenu,
  type PartnerMenuItem,
} from '@/lib/partner/menu';
import { followPageRefresh } from '@/lib/partner/page-refresh-client';
import type { MenuLoadResult, PageRefresh, RetryOcrResult } from '@/lib/partner/results';

import { SessionExpired } from '../card/SessionExpired';
import { MenuItemRow } from './MenuItemRow';
import {
  ConfirmEmailLine,
  EmptyMenuState,
  HiddenItemsNote,
  MenuBanner,
} from './MenuStates';
import { RestartRecognitionButton } from './RestartRecognitionButton';

/*
 * The card's «Меню» section (part 1 of «Кабинет партнёра на сайте», directive
 * 1.2–1.4): the recognised dishes by section with their prices, the state of
 * the recognition, the marks «Требует внимания» with their reasons, the edit
 * of a line, «Перезапустить распознавание». Adding or removing a dish is not
 * offered — as in the app.
 *
 * After an edit the line from the server's answer takes its place at once, and
 * the menu is read again: the server changes the line's copies in the other
 * menu files too and does not return them (registry item «…блюдо до ~30 с
 * стоит дважды» — not here).
 *
 * While the recognition runs, the menu is read again every 30 s with the tab
 * visible; the reading stops when the state changes, or after an hour — then
 * «Обновить». The end of a re-recognition drops the card's public page
 * (refresh-page): the dishes changed in the background.
 */

const POLL_MS = 30_000;
const POLL_LIMIT_MS = 60 * 60_000;
/** Background readings that failed in a row before the screen says it may be stale. */
const STALE_AFTER_FAILURES = 2;

type Loaded = { menu: PartnerMenu; emailUnconfirmed: boolean };

type State =
  | { phase: 'loading' }
  | { phase: 'error'; code: string }
  | { phase: 'ready'; data: Loaded };

type Notice = { kind: 'success' | 'error'; text: string; emailHint?: boolean };

export function MenuSection({ id }: { id: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [failures, setFailures] = useState(0);
  const [pollExpired, setPollExpired] = useState(false);
  const statusRef = useRef<MenuRecognitionStatus | null>(null);
  const pollStartRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  /** Take a reading's answer into the screen. */
  const apply = useCallback(
    (r: MenuLoadResult, silent: boolean) => {
      if (r.ok) {
        const before = statusRef.current;
        const now = r.menu.recognition?.status ?? null;
        statusRef.current = now;
        setFailures(0);
        if (now !== 'processing') {
          pollStartRef.current = null;
          setPollExpired(false);
        }
        setState({
          phase: 'ready',
          data: { menu: r.menu, emailUnconfirmed: r.emailUnconfirmed === true },
        });
        // The dishes changed in the background: the guest's page follows.
        if (before === 'processing' && (now === 'done' || now === 'failed')) {
          void refreshCardPageAction(id).then((page) => {
            if (page.ok) followPageRefresh(id, page.page);
          });
        }
        return;
      }
      if (r.code === 'NO_SESSION') {
        setState({ phase: 'error', code: 'NO_SESSION' });
        return;
      }
      setState((prev) => (prev.phase === 'ready' ? prev : { phase: 'error', code: r.code }));
      if (silent) setFailures((n) => n + 1);
    },
    [id],
  );

  /** Read the menu again; a later reading's answer wins over an earlier one's. */
  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const seq = ++seqRef.current;
      const r = await loadMenuItems(id);
      if (seq === seqRef.current) apply(r, silent);
    },
    [id, apply],
  );

  useEffect(() => {
    let cancelled = false;
    const seq = ++seqRef.current;
    void loadMenuItems(id).then((r) => {
      if (!cancelled && seq === seqRef.current) apply(r, false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, apply]);

  const processing =
    state.phase === 'ready' && state.data.menu.recognition?.status === 'processing';

  useEffect(() => {
    if (!processing || pollExpired) return undefined;
    if (pollStartRef.current === null) pollStartRef.current = Date.now();
    const timer = setInterval(() => {
      if (pollStartRef.current !== null && Date.now() - pollStartRef.current >= POLL_LIMIT_MS) {
        clearInterval(timer);
        setPollExpired(true);
        return;
      }
      if (document.visibilityState === 'visible') void load({ silent: true });
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [processing, pollExpired, load]);

  const onSaved = useCallback(
    (item: PartnerMenuItem, page: PageRefresh | undefined) => {
      setState((prev) =>
        prev.phase === 'ready'
          ? {
              ...prev,
              data: { ...prev.data, menu: { ...prev.data.menu, items: replaceItem(prev.data.menu.items, item) } },
            }
          : prev,
      );
      followPageRefresh(id, page);
      setNotice({ kind: 'success', text: MENU_TEXTS.saved });
      // The line's copies in the other menu files changed too: read them.
      void load({ silent: true });
    },
    [id, load],
  );

  const onGone = useCallback(() => {
    setNotice({ kind: 'error', text: MENU_TEXTS.itemGone });
    void load({ silent: true });
  }, [load]);

  const onRestarted = useCallback(
    (r: RetryOcrResult) => {
      if (r.ok) {
        setNotice({ kind: 'success', text: RESTART_TEXTS.started(r.enqueuedJobs, r.totalPdfs) });
        void load();
        return;
      }
      if (r.code === 'NO_SESSION') {
        setState({ phase: 'error', code: 'NO_SESSION' });
        return;
      }
      setNotice({
        kind: 'error',
        text: refusalMessage(r),
        emailHint: r.limit === 'ocr_allowance' && r.emailUnconfirmed === true,
      });
    },
    [load],
  );

  const refreshNow = useCallback(() => {
    pollStartRef.current = null;
    setPollExpired(false);
    void load();
  }, [load]);

  const menu = state.phase === 'ready' ? state.data.menu : null;
  const groups = useMemo(() => (menu ? groupBySection(menu.items) : []), [menu]);
  const sections = useMemo(() => (menu ? sectionsOf(menu.items) : []), [menu]);

  if (state.phase === 'loading') return <MenuSkeleton />;

  if (state.phase === 'error') {
    return state.code === 'NO_SESSION' ? (
      <SessionExpired returnTo={cardSectionHref(id, 'menu')} />
    ) : (
      <div className="flex flex-col items-center gap-m rounded-[var(--radius-l)] border border-border bg-background p-l text-center">
        <p className="text-body-m text-foreground">{MENU_TEXTS.loadFailed}</p>
        <Button type="button" size="sm" onClick={() => void load()}>
          {MENU_TEXTS.retryLoad}
        </Button>
      </div>
    );
  }

  const { emailUnconfirmed } = state.data;
  const items = state.data.menu.items;
  const recognition = state.data.menu.recognition;
  const hasHidden = state.data.menu.hasHiddenItems === true;
  const empty = items.length === 0;
  // «Позиции не показываются»: the file was read and every line is hidden —
  // a restart would read the same lines and spend a restart (the app's rule).
  const hiddenState = empty && recognition?.status === 'done' && hasHidden;
  const canRestart = recognition?.status !== 'none' && !hiddenState;
  const stale = failures >= STALE_AFTER_FAILURES || pollExpired || recognition === null;

  return (
    <section aria-label={MENU_TEXTS.title} className="flex flex-col gap-m">
      {canRestart && (
        <div className="flex justify-end">
          <RestartRecognitionButton establishmentId={id} onDone={onRestarted} />
        </div>
      )}

      {notice && (
        <div className="flex flex-col gap-1" role={notice.kind === 'error' ? 'alert' : 'status'}>
          <p
            className={
              notice.kind === 'error'
                ? 'text-body-s text-error-dark'
                : 'text-body-s text-success-dark'
            }
          >
            {notice.text}
          </p>
          {notice.emailHint && <ConfirmEmailLine cardId={id} />}
        </div>
      )}

      {stale && (
        <div className="flex flex-wrap items-center gap-s rounded-[var(--radius-m)] bg-muted px-m py-s">
          <CloudOff className="size-4 text-figma-text-grey" aria-hidden="true" />
          <p className="flex-1 text-body-s text-figma-text-dark">{MENU_TEXTS.stale}</p>
          <Button type="button" variant="ghost" size="sm" onClick={refreshNow}>
            {MENU_TEXTS.refresh}
          </Button>
        </div>
      )}

      {empty ? (
        recognition && (
          <EmptyMenuState
            recognition={recognition}
            hidden={hiddenState}
            emailUnconfirmed={emailUnconfirmed}
            cardId={id}
          />
        )
      ) : (
        <>
          {recognition && (
            <MenuBanner recognition={recognition} emailUnconfirmed={emailUnconfirmed} cardId={id} />
          )}
          {hasHidden && <HiddenItemsNote />}
          <div className="flex flex-col gap-m">
            {groups.map((group) => (
              <section
                key={group.key === '' ? 'no-section' : `section:${group.key}`}
                className="rounded-[var(--radius-l)] border border-border bg-background px-l py-m"
              >
                <h3 className="font-display text-headline-s text-foreground wrap-anywhere">
                  {group.key === '' ? MENU_TEXTS.noSection : group.key}
                </h3>
                <ul className="mt-s">
                  {group.items.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      sections={sections}
                      onSaved={onSaved}
                      onGone={onGone}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function MenuSkeleton() {
  return (
    <div className="flex flex-col gap-m">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-40 w-full rounded-[var(--radius-l)]" />
      ))}
    </div>
  );
}
