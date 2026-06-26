'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

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
import { deleteEstablishmentAction } from '@/lib/partner/client';
import { messageForEstablishmentError } from '@/lib/partner/errors';

/*
 * Delete control for a draft/rejected cabinet card (CAT-C-3.x B4). Confirm dialog
 * → buffered Route Handler (same-origin guarded) → onDeleted removes the card
 * from the dashboard list. Permanent (the backend cascades media); the caller
 * gates rendering to draft/rejected — active/with-reviews cards are not deletable
 * from the cabinet by design.
 */
export function DeleteEstablishmentButton({
  establishmentId,
  establishmentName,
  onDeleted,
}: {
  establishmentId: string;
  establishmentName: string;
  onDeleted: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    const r = await deleteEstablishmentAction(establishmentId);
    if (r.ok) {
      setOpen(false);
      onDeleted(establishmentId); // unmounts this card — no further state needed
    } else {
      setDeleting(false);
      setError(messageForEstablishmentError(r.code));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return; // don't dismiss mid-delete
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="destructive"
            size="icon-sm"
            aria-label={`Удалить «${establishmentName}»`}
          />
        }
      >
        <Trash2 />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить заведение?</DialogTitle>
          <DialogDescription>
            «{establishmentName}» будет удалено безвозвратно вместе с фото и меню.
            Это действие нельзя отменить.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-body-s text-error-dark">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={deleting} />}>
            Отмена
          </DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={deleting}>
            {deleting ? 'Удаление…' : 'Удалить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
