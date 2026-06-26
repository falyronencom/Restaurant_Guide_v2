'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import type {
  EstablishmentStatus,
  PartnerEstablishmentListing,
} from '@/lib/api/types';
import { loadEstablishments } from '@/lib/partner/client';
import { STATUS_LABELS, STATUS_ORDER } from '@/lib/partner/status';
import { cn } from '@/lib/utils';

import { EstablishmentVignette } from './EstablishmentVignette';

/*
 * Cabinet dashboard (Phase C Slice 1, Segment B). Client island: hydrates the
 * authed list via the loadEstablishments Route Handler fetch on mount (httpOnly tokens
 * → ask the server, mirroring AuthProvider), then groups by status into tabs.
 */

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; code: string }
  | { phase: 'ready'; items: PartnerEstablishmentListing[] };

export function CabinetDashboard() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [tab, setTab] = useState<EstablishmentStatus>('active');

  useEffect(() => {
    let cancelled = false;
    loadEstablishments()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ phase: 'error', code: res.code });
          return;
        }
        setState({ phase: 'ready', items: res.establishments });
        // Open the first status (in tab order) that actually has cards.
        const firstNonEmpty = STATUS_ORDER.find((s) =>
          res.establishments.some((e) => e.status === s),
        );
        if (firstNonEmpty) setTab(firstNonEmpty);
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error', code: 'NETWORK' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop a deleted card from the list in place (B4) — no refetch needed.
  const handleDeleted = useCallback((id: string) => {
    setState((prev) =>
      prev.phase === 'ready'
        ? { ...prev, items: prev.items.filter((item) => item.id !== id) }
        : prev,
    );
  }, []);

  return (
    <div className="flex flex-col gap-l">
      <div className="flex items-center justify-between gap-m">
        <h1 className="font-display text-display-s text-foreground">
          Мои заведения
        </h1>
        <Link
          href="/cabinet/new"
          className={cn(buttonVariants({ size: 'lg' }), 'gap-1.5')}
        >
          <Plus className="size-4" />
          Создать заведение
        </Link>
      </div>

      {state.phase === 'loading' && <DashboardSkeleton />}

      {state.phase === 'error' && <DashboardError code={state.code} />}

      {state.phase === 'ready' &&
        (state.items.length === 0 ? (
          <EmptyState />
        ) : (
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as EstablishmentStatus)}
          >
            <TabsList variant="line" className="flex-wrap">
              {STATUS_ORDER.map((s) => {
                const count = state.items.filter((e) => e.status === s).length;
                return (
                  <TabsTrigger key={s} value={s}>
                    {STATUS_LABELS[s]}
                    {count > 0 && (
                      <span className="ml-1 text-figma-text-grey">{count}</span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {STATUS_ORDER.map((s) => {
              const items = state.items.filter((e) => e.status === s);
              return (
                <TabsContent key={s} value={s} className="pt-m">
                  {items.length === 0 ? (
                    <p className="py-xl text-center text-body-m text-figma-text-grey">
                      Нет заведений в этом статусе.
                    </p>
                  ) : (
                    <div className="grid gap-m sm:grid-cols-2">
                      {items.map((e) => (
                        <EstablishmentVignette
                          key={e.id}
                          establishment={e}
                          onDeleted={handleDeleted}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-m sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-l border border-border bg-background"
        >
          <Skeleton className="aspect-[16/9] w-full rounded-none" />
          <div className="flex flex-col gap-s p-m">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardError({ code }: { code: string }) {
  if (code === 'NO_SESSION') {
    return (
      <div className="rounded-l border border-border bg-background p-l text-center">
        <p className="text-body-m text-foreground">Сессия истекла.</p>
        <Link
          href="/login?returnTo=/cabinet"
          className={cn(buttonVariants({ size: 'sm' }), 'mt-m')}
        >
          Войти снова
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-l border border-border bg-background p-l text-center">
      <p className="text-body-m text-foreground">
        Не удалось загрузить заведения. Обновите страницу.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-m rounded-l border border-dashed border-border bg-background p-xl text-center">
      <p className="text-headline-s text-foreground">
        У вас пока нет заведений
      </p>
      <p className="max-w-md text-body-m text-figma-text-grey">
        Создайте первую карточку заведения — заполните классификацию, фото, меню
        и часы работы, затем отправьте на модерацию.
      </p>
      <Link
        href="/cabinet/new"
        className={cn(buttonVariants({ size: 'lg' }), 'gap-1.5')}
      >
        <Plus className="size-4" />
        Создать заведение
      </Link>
    </div>
  );
}
