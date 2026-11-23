'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { PAUSE_TEXTS } from '@/lib/partner/cabinet-texts';
import { suspendEstablishmentAction } from '@/lib/partner/client';
import { followPageRefresh } from '@/lib/partner/page-refresh-client';
import { refusalMessage } from '@/lib/partner/errors';
import { cn } from '@/lib/utils';

/*
 * «Приостановить показ» of a published card (part 1 of «Кабинет партнёра на
 * сайте»): the confirm window T6 → buffered Route Handler (same-origin
 * guarded) → active → suspended, the partner's own pause, which «Возобновить
 * показ» lifts without moderation. The card's public page is dropped by the
 * server's side of the site. The pattern of DeleteEstablishmentButton.
 */
export function SuspendEstablishmentButton({
  establishmentId,
  onSuspended,
  className,
}: {
  establishmentId: string;
  onSuspended: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const r = await suspendEstablishmentAction(establishmentId);
    setBusy(false);
    if (r.ok) {
      // A pause inside the card's interval drops the page a little later.
      followPageRefresh(establishmentId, r.page);
      setOpen(false);
      onSuspended(establishmentId);
    } else {
      setError(refusalMessage(r));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return; // not dismissed mid-request
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className={cn('flex-1', className)} />
        }
      >
        {PAUSE_TEXTS.button}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{PAUSE_TEXTS.title}</DialogTitle>
          <DialogDescription>{PAUSE_TEXTS.body}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-body-s text-error-dark" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>
            {PAUSE_TEXTS.cancel}
          </DialogClose>
          <Button onClick={confirm} disabled={busy}>
            {busy ? PAUSE_TEXTS.busy : PAUSE_TEXTS.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
