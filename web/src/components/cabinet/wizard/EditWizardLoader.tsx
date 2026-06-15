'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { EstablishmentStatus } from '@/lib/api/types';
import { loadEstablishmentForEdit } from '@/lib/partner/actions';
import { fromDetail, type WizardFormState } from '@/lib/partner/form';
import { isAdminSuspended } from '@/lib/partner/status';
import { cn } from '@/lib/utils';

import { EstablishmentWizard } from './EstablishmentWizard';

/*
 * Edit-route loader (Phase C Slice 1, Segment B). authedFetch cannot run in RSC
 * render, so the establishment is loaded client-side via a Server Action (as the
 * dashboard does) and the wizard is seeded in edit mode. Self-suspended (no
 * suspend_reason) → read-only.
 */
export function EditWizardLoader({ id }: { id: string }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; code: string }
    | {
        phase: 'ready';
        initial: WizardFormState;
        status: EstablishmentStatus;
        readOnly: boolean;
      }
  >({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadEstablishmentForEdit(id)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setState({ phase: 'error', code: r.code });
          return;
        }
        const d = r.establishment;
        const readOnly =
          d.status === 'suspended' && !isAdminSuspended(d.moderation_notes);
        setState({
          phase: 'ready',
          initial: fromDetail(d),
          status: d.status,
          readOnly,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error', code: 'NETWORK' });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.phase === 'loading') return <WizardSkeleton />;

  if (state.phase === 'error') {
    return (
      <div className="rounded-l border border-border bg-background p-l text-center">
        <p className="text-body-m text-foreground">
          {state.code === 'NO_SESSION'
            ? 'Сессия истекла.'
            : 'Не удалось загрузить заведение.'}
        </p>
        <Link
          href="/cabinet"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-m')}
        >
          В кабинет
        </Link>
      </div>
    );
  }

  return (
    <EstablishmentWizard
      mode="edit"
      establishmentId={id}
      initial={state.initial}
      status={state.status}
      readOnly={state.readOnly}
    />
  );
}

function WizardSkeleton() {
  return (
    <div className="flex flex-col gap-l">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-l lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-l">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-l" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-l" />
      </div>
    </div>
  );
}
