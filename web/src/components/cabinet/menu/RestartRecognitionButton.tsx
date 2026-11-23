'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

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
import { RESTART_TEXTS } from '@/lib/partner/cabinet-texts';
import { retryOcrAction } from '@/lib/partner/client';
import type { RetryOcrResult } from '@/lib/partner/results';

/*
 * «Перезапустить распознавание» of the «Меню» section, behind the window T1:
 * the restart reads every menu file again, and what the partner corrected goes
 * back to the recognised (backend replaceForMedia keeps only the moderator's
 * «Скрыть»). The answer goes to the section — it shows the result and reads
 * the menu again.
 */
export function RestartRecognitionButton({
  establishmentId,
  onDone,
}: {
  establishmentId: string;
  onDone: (result: RetryOcrResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const r = await retryOcrAction(establishmentId);
    setBusy(false);
    setOpen(false);
    onDone(r);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <RefreshCw />
        {RESTART_TEXTS.button}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{RESTART_TEXTS.title}</DialogTitle>
          <DialogDescription>{RESTART_TEXTS.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>
            {RESTART_TEXTS.cancel}
          </DialogClose>
          <Button onClick={confirm} disabled={busy}>
            {busy ? RESTART_TEXTS.busy : RESTART_TEXTS.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
