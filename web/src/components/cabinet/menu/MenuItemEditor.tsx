'use client';

import { useId, useState } from 'react';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MENU_TEXTS } from '@/lib/partner/cabinet-texts';
import { updateMenuItemAction } from '@/lib/partner/client';
import { refusalMessage } from '@/lib/partner/errors';
import type { PartnerMenuItem } from '@/lib/partner/menu';
import { changesOf, priceInputOf } from '@/lib/partner/menu-format';
import type { PageRefresh } from '@/lib/partner/results';

/*
 * The edit of one menu line: name, price, section (part 1 of «Кабинет
 * партнёра на сайте», directive 1.3). The server checks none of the fields
 * and answers an overlong one with 500, so they are checked here
 * (lib/partner/menu-format.ts); only the changed fields are sent. The line is
 * the server's to answer with; its copies in the other menu files the
 * section re-reads (onSaved).
 */
export function MenuItemEditor({
  item,
  sections,
  onSaved,
  onGone,
}: {
  item: PartnerMenuItem;
  /** The card's sections, for the suggestions. */
  sections: readonly string[];
  onSaved: (item: PartnerMenuItem, page: PageRefresh | undefined) => void;
  /** The line is gone (MENU_ITEM_NOT_FOUND): the section says so and re-reads. */
  onGone: () => void;
}) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item.item_name);
  const [price, setPrice] = useState(priceInputOf(item.price_byn));
  const [section, setSection] = useState(item.category_raw ?? '');
  const [errors, setErrors] = useState<{ name?: string; price?: string; section?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName(item.item_name);
    setPrice(priceInputOf(item.price_byn));
    setSection(item.category_raw ?? '');
    setErrors({});
    setError(null);
  };

  const save = async () => {
    if (busy) return;
    const checked = changesOf(item, { name, price, section });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    if (Object.keys(checked.changes).length === 0) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await updateMenuItemAction(item.id, checked.changes);
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      onSaved(r.item, r.page);
      return;
    }
    if (r.code === 'MENU_ITEM_NOT_FOUND') {
      setOpen(false);
      onGone();
      return;
    }
    setError(refusalMessage(r));
  };

  const listId = `${ids}-sections`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="sm" aria-label={`${MENU_TEXTS.edit}: ${item.item_name}`} />}
      >
        <Pencil />
        {MENU_TEXTS.edit}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{MENU_TEXTS.editTitle}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-m"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          <EditorField label={MENU_TEXTS.nameField} id={`${ids}-name`} error={errors.name}>
            <Input
              id={`${ids}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              autoComplete="off"
            />
          </EditorField>
          <EditorField
            label={MENU_TEXTS.priceField}
            id={`${ids}-price`}
            error={errors.price}
            hint={MENU_TEXTS.noPriceHint}
          >
            <Input
              id={`${ids}-price`}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder={MENU_TEXTS.pricePlaceholder}
              aria-invalid={errors.price ? true : undefined}
              autoComplete="off"
            />
          </EditorField>
          <EditorField label={MENU_TEXTS.sectionField} id={`${ids}-section`} error={errors.section}>
            <Input
              id={`${ids}-section`}
              value={section}
              onChange={(e) => setSection(e.target.value)}
              list={listId}
              aria-invalid={errors.section ? true : undefined}
              autoComplete="off"
            />
            <datalist id={listId}>
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </EditorField>
          {error && (
            <p className="text-body-s text-error-dark" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
              {MENU_TEXTS.cancel}
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? MENU_TEXTS.saving : MENU_TEXTS.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditorField({
  label,
  id,
  error,
  hint,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label-m text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-caption-m text-error-dark">{error}</p>
      ) : (
        hint && <p className="text-caption-m text-figma-text-grey">{hint}</p>
      )}
    </div>
  );
}
