'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import type { EstablishmentStatus } from '@/lib/api/types';
import {
  createEstablishmentAction,
  loadEstablishmentForEdit,
  resumeEstablishmentAction,
  retryOcrAction,
  submitEstablishmentAction,
  updateEstablishmentAction,
} from '@/lib/partner/client';
import { clientCompleteness } from '@/lib/partner/completeness';
import { isCuisineRequired } from '@/lib/partner/constants';
import { CONTACT_LABELS, acceptedForm, contactErrors } from '@/lib/partner/contacts';
import {
  WIZARD_DRAFT_PREFIX,
  forgetWizardDraft,
  wizardDraftKey,
} from '@/lib/partner/draft-storage';
import { refusalMessage, type Refusal } from '@/lib/partner/errors';
import {
  emptyForm,
  fromDetail,
  toCreatePayload,
  toUpdatePayload,
  type WizardFormState,
} from '@/lib/partner/form';
import { evaluateE1, meetsValidatorMinimum } from '@/lib/partner/validation';

import { AddressSection } from './AddressSection';
import { BasicInfoSection } from './BasicInfoSection';
import { ClassificationSection } from './ClassificationSection';
import { CopyFromPrevious } from './CopyFromPrevious';
import { HoursSection } from './HoursSection';
import { MediaSection } from './MediaSection';
import { StickySidebar } from './StickySidebar';

/*
 * Wizard orchestrator (Phase C Slice 1, Segment B). One controlled form serves
 * create AND edit (the live sidebar + autosave demand controlled inputs, which
 * also sidesteps the React-19 uncontrolled-reset gotcha).
 *
 * Create — two-stage draft (Decision 5): localStorage until the validator
 *   minimum, then a server draft + debounced PUT autosave. The FIRST create
 *   upgrades user→partner; the create operation re-stamps rg_user, applied here.
 *   A kept form is restored only while its server draft is still a draft of
 *   this account (draft-storage.ts, С1).
 * Edit — seeded from the server record (no localStorage); autosave PUTs directly.
 *   Submit shows for draft/rejected/admin-suspended (E1-gated); active edits
 *   autosave without a status change; self-suspended is read-only until the
 *   partner resumes it here (С3).
 *
 * Autosave (С2): one save at a time; an edit made while a save is under way is
 * sent right after it, and a pending edit is sent when the wizard closes.
 */

type Props =
  | { mode: 'create' }
  | {
      mode: 'edit';
      establishmentId: string;
      initial: WizardFormState;
      status: EstablishmentStatus;
      readOnly: boolean;
      /** The partner resumed a self-paused card: the loader switches to editing. */
      onResumed?: () => void;
    };

type KeptDraft = { form?: Partial<WizardFormState>; draftId?: string | null };

const AUTOSAVE_MS = 800;

/**
 * The kept draft's card is gone for this account: deleted (404), or refused by
 * the ownership check (403 without a role — deleted, or another account's).
 * The role gate's 403 (details.your_role — a stale token) is not «gone».
 */
function draftGone(r: Refusal): boolean {
  return (
    r.code === 'ESTABLISHMENT_NOT_FOUND' ||
    (r.code === 'FORBIDDEN' && r.role === undefined)
  );
}

export function EstablishmentWizard(props: Props) {
  const isEdit = props.mode === 'edit';
  const readOnly = props.mode === 'edit' && props.readOnly;
  const editStatus = props.mode === 'edit' ? props.status : null;
  const establishmentId =
    props.mode === 'edit' ? props.establishmentId : undefined;
  const onResumed = props.mode === 'edit' ? props.onResumed : undefined;

  const router = useRouter();
  const { applySession, user, status } = useAuth();
  // Per-account draft key (B2, CAT-C-3.x): scope localStorage to the current user
  // so a different account in the same browser can neither see nor overwrite this
  // draft (the cross-account bleed Discovery surfaced).
  const lsKey = user?.id ? wizardDraftKey(user.id) : null;

  const [form, setForm] = useState<WizardFormState>(() =>
    props.mode === 'edit' ? props.initial : emptyForm(),
  );
  const [draftId, setDraftId] = useState<string | null>(establishmentId ?? null);
  const [serverScore, setServerScore] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Create: a kept form was restored — offer to start a new card instead.
  const [restored, setRestored] = useState<{ name: string; onServer: boolean } | null>(
    null,
  );
  // Create: the draft this form saved into is gone (С1) — saving waits for the
  // partner's choice: a new draft, or a new card.
  const [orphaned, setOrphaned] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // Edit is seeded synchronously from `initial`; only create hydrates from LS.
  const [hydrated, setHydrated] = useState(isEdit);

  const draftIdRef = useRef<string | null>(establishmentId ?? null);
  // The latest form, and the form the server last accepted (erasing, С7).
  const formRef = useRef<WizardFormState>(form);
  const savedRef = useRef<WizardFormState | null>(
    props.mode === 'edit' ? props.initial : null,
  );
  const inFlight = useRef(false);
  const flight = useRef<Promise<void> | null>(null);
  const pendingRef = useRef(false);
  const armedRef = useRef(false);
  const submittingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);
  // Create: nothing is saved until the partner changes something — opening
  // the wizard must not write a restored form over its draft.
  const touchedRef = useRef(false);
  const haltedRef = useRef(false);
  // Bumped by «Начать новое заведение»: a save of the dropped form that
  // returns later is not applied to the new one.
  const genRef = useRef(0);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const persistLocal = useCallback(
    (f: WizardFormState, id: string | null) => {
      if (isEdit || !lsKey) return; // edit → server record; no key until auth known
      try {
        localStorage.setItem(lsKey, JSON.stringify({ form: f, draftId: id }));
      } catch {
        /* private mode / quota — non-fatal */
      }
    },
    [isEdit, lsKey],
  );

  /** Forget the kept server draft id: the next save creates a new draft. */
  const forgetDraftId = useCallback(() => {
    draftIdRef.current = null;
    savedRef.current = null;
    setDraftId(null);
    try {
      if (lsKey) localStorage.removeItem(lsKey);
    } catch {
      /* non-fatal */
    }
  }, [lsKey]);

  // Hydrate: create → per-account localStorage; edit → already seeded from
  // `initial`. Gated on auth resolution (status !== 'loading') so the key is
  // the CURRENT user's, and the legacy unscoped key is dropped on the way (B2 —
  // no cross-account bleed). A kept draft id is checked first (С1): its card
  // must still be this account's draft — a deleted card (403/404) or one sent
  // to moderation drops the kept form, and the wizard opens empty. A live
  // draft opens as the server holds it — it may have been edited since on its
  // edit page or in the app; the browser copy is used only without a server
  // draft, or when the check could not reach the server.
  useEffect(() => {
    if (isEdit || hydratedRef.current || status === 'loading') return;
    hydratedRef.current = true;
    try {
      localStorage.removeItem(WIZARD_DRAFT_PREFIX); // pre-scoping bled key — remove once
    } catch {
      /* ignore */
    }
    let kept: KeptDraft | null = null;
    if (lsKey) {
      try {
        const raw = localStorage.getItem(lsKey);
        if (raw) kept = JSON.parse(raw) as KeptDraft;
      } catch {
        kept = null;
      }
    }
    void (async () => {
      await Promise.resolve(); // set state after the effect, not in it
      let server: WizardFormState | null = null;
      if (kept?.draftId) {
        const r = await loadEstablishmentForEdit(kept.draftId);
        const gone = r.ok
          ? r.establishment.status !== 'draft'
          : draftGone(r);
        if (gone) {
          kept = null;
          try {
            if (lsKey) localStorage.removeItem(lsKey);
          } catch {
            /* non-fatal */
          }
        } else if (r.ok) {
          server = fromDetail(r.establishment);
        }
        // Any other failure (network): keep the form — the autosave will say.
      }
      if (kept?.form || server) {
        const restoredForm = server ?? { ...emptyForm(), ...kept?.form };
        setForm(restoredForm);
        formRef.current = restoredForm;
        // Offer «start anew» only for a form with something in it.
        if (kept?.draftId || JSON.stringify(restoredForm) !== JSON.stringify(emptyForm())) {
          setRestored({ name: restoredForm.name.trim(), onServer: !!kept?.draftId });
        }
      }
      if (kept?.draftId) {
        setDraftId(kept.draftId);
        draftIdRef.current = kept.draftId;
        savedRef.current = server;
      }
      setHydrated(true);
    })();
  }, [isEdit, status, lsKey]);

  const patch = useCallback(
    (partial: Partial<WizardFormState>) => {
      if (readOnly) return;
      touchedRef.current = true;
      setForm((prev) => ({ ...prev, ...partial }));
    },
    [readOnly],
  );

  /**
   * Save the latest form. One save at a time: called while one is under way, it
   * marks the form pending, and the running save sends it next (С2 — the edit
   * was lost when the timer fired mid-save and nothing re-armed it).
   */
  const flush = useCallback(async () => {
    if (haltedRef.current) {
      // Saving waits for the partner's choice; the edit is kept in this
      // browser meanwhile.
      persistLocal(formRef.current, null);
      return;
    }
    if (submittingRef.current) return;
    if (inFlight.current) {
      pendingRef.current = true;
      return;
    }
    inFlight.current = true;
    const run = (async () => {
      do {
        pendingRef.current = false;
        const gen = genRef.current;
        const f = formRef.current;
        const id = draftIdRef.current;
        persistLocal(f, id);
        if (id) {
          setSaveState('saving');
          setError(null);
          const r = await updateEstablishmentAction(id, toUpdatePayload(f, savedRef.current));
          // The form was dropped meanwhile («Начать новое заведение»): this
          // result is not the new form's; an edit of the new form made during
          // the wait is sent by the next turn of the loop.
          if (gen !== genRef.current) continue;
          if (r.ok) {
            savedRef.current = acceptedForm(f, savedRef.current);
            setSaveState('saved');
            if (r.base_score != null) setServerScore(r.base_score);
          } else if (!isEdit && draftGone(r)) {
            // The draft was deleted while this page was open — or this tab
            // now runs under another account. The form stays on screen and
            // in this account's browser copy; saving waits for the partner's
            // choice rather than writing it anywhere on its own (С1).
            forgetDraftId();
            persistLocal(formRef.current, null);
            haltedRef.current = true;
            pendingRef.current = false;
            setOrphaned(true);
            setSaveState('idle');
          } else {
            setSaveState('error');
            setError(refusalMessage(r));
          }
        } else if (meetsValidatorMinimum(f)) {
          setSaveState('saving');
          setError(null);
          const r = await createEstablishmentAction(toCreatePayload(f));
          // The form was dropped meanwhile («Начать новое заведение»): this
          // result is not the new form's; an edit of the new form made during
          // the wait is sent by the next turn of the loop.
          if (gen !== genRef.current) continue;
          if (r.ok) {
            draftIdRef.current = r.id;
            savedRef.current = acceptedForm(f, null);
            setDraftId(r.id);
            persistLocal(formRef.current, r.id);
            if (r.base_score != null) setServerScore(r.base_score);
            if (r.user) applySession(r.user); // role re-stamp → partner
            setSaveState('saved');
          } else {
            setSaveState('error');
            setError(refusalMessage(r));
          }
        } else {
          setSaveState('idle');
        }
      } while (pendingRef.current && !submittingRef.current);
    })();
    flight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = false;
      flight.current = null;
    }
  }, [persistLocal, isEdit, forgetDraftId, applySession]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  /** Create, after the draft was gone: save the form as a new draft (С1). */
  const saveAsNew = useCallback(() => {
    haltedRef.current = false;
    setOrphaned(false);
    void flushRef.current();
  }, []);

  // Debounced persist + server sync on change.
  useEffect(() => {
    if (!hydrated || readOnly || (!isEdit && !touchedRef.current)) return undefined;
    armedRef.current = true;
    const timer = setTimeout(() => {
      armedRef.current = false;
      void flushRef.current();
    }, AUTOSAVE_MS);
    debounceRef.current = timer;
    return () => clearTimeout(timer);
  }, [form, hydrated, readOnly, isEdit]);

  // Leaving with an edit not yet sent (the «Кабинет» link within the debounce):
  // send it now rather than drop it.
  useEffect(
    () => () => {
      if (armedRef.current) {
        armedRef.current = false;
        void flushRef.current();
      }
    },
    [],
  );

  const e1 = evaluateE1(form);
  const completeness = clientCompleteness(form);
  const showSubmit =
    !readOnly && (props.mode === 'create' || editStatus !== 'active');

  const onSubmit = useCallback(async () => {
    const id = draftIdRef.current;
    if (!id || !e1.passed || submittingRef.current) return;
    const contacts = Object.keys(contactErrors(form)) as (keyof typeof CONTACT_LABELS)[];
    if (contacts.length) {
      setError(
        `Исправьте ${contacts.map((c) => CONTACT_LABELS[c]).join(', ')} или очистите поле — тогда карточку можно отправить.`,
      );
      return;
    }
    // Cancel any armed autosave so a debounced PUT cannot fire mid-submit (it
    // would race the status transition and flash a spurious save error), and
    // let a save under way land first — it may carry an older form.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    armedRef.current = false;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    if (flight.current) await flight.current;
    const sent = formRef.current;
    const saved = await updateEstablishmentAction(id, toUpdatePayload(sent, savedRef.current));
    if (!saved.ok) {
      submittingRef.current = false;
      setSubmitting(false);
      setError(refusalMessage(saved));
      return;
    }
    savedRef.current = acceptedForm(sent, savedRef.current);
    const r = await submitEstablishmentAction(id);
    submittingRef.current = false;
    setSubmitting(false);
    if (r.ok) {
      try {
        if (lsKey) localStorage.removeItem(lsKey);
      } catch {
        /* non-fatal */
      }
      // Sent from its edit page: the create wizard must not revive it (С1).
      if (isEdit) forgetWizardDraft(user?.id, id);
      router.push('/cabinet');
    } else {
      setError(refusalMessage(r));
    }
  }, [e1.passed, form, router, lsKey, isEdit, user?.id]);

  const onRetryOcr = useCallback(async () => {
    const id = draftIdRef.current;
    if (!id) return;
    setNotice(null);
    const r = await retryOcrAction(id);
    setNotice(
      r.ok
        ? 'Распознавание меню запущено — обновите страницу через минуту.'
        : refusalMessage(r),
    );
  }, []);

  const onResume = useCallback(async () => {
    if (!establishmentId) return;
    setResuming(true);
    setResumeError(null);
    const r = await resumeEstablishmentAction(establishmentId);
    setResuming(false);
    if (r.ok) onResumed?.();
    else setResumeError(refusalMessage(r));
  }, [establishmentId, onResumed]);

  /** Create: drop the restored form and start a new card (С1). */
  const startOver = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    armedRef.current = false;
    genRef.current += 1;
    haltedRef.current = false;
    pendingRef.current = false;
    setOrphaned(false);
    forgetDraftId();
    const fresh = emptyForm();
    formRef.current = fresh;
    setForm(fresh);
    setRestored(null);
    setSaveState('idle');
    setError(null);
    setNotice(null);
    setServerScore(null);
  }, [forgetDraftId]);

  const saveLabel = readOnly
    ? 'Только просмотр'
    : !draftId
      ? saveState === 'error'
        ? 'Не удалось сохранить черновик'
        : meetsValidatorMinimum(form)
          ? 'Сохранение черновика…'
          : 'Заполните название, город, адрес, классификацию и часы — черновик сохранится сам'
      : saveState === 'saving'
        ? 'Сохранение…'
        : saveState === 'error'
          ? 'Ошибка сохранения'
          : isEdit
            ? 'Изменения сохранены'
            : 'Черновик сохранён';

  const title =
    props.mode === 'create'
      ? 'Новое заведение'
      : readOnly
        ? `${form.name || 'Заведение'} — просмотр`
        : `Редактирование${form.name ? `: ${form.name}` : ''}`;

  // Create waits for the kept draft's check before the form takes input.
  const inputsDisabled = readOnly || !hydrated;

  return (
    <div className="flex flex-col gap-l">
      <Link
        href="/cabinet"
        className="inline-flex w-fit items-center gap-1 text-body-s text-figma-text-grey transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Кабинет
      </Link>
      <h1 className="font-display text-display-s text-foreground">{title}</h1>
      {readOnly && (
        <div className="flex flex-col gap-s rounded-m border border-border bg-background p-m sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-s text-figma-text-dark">
            Показ заведения приостановлен вами. Возобновите показ, чтобы
            карточка снова была в каталоге и её можно было редактировать.
          </p>
          <div className="flex shrink-0 flex-col gap-1">
            <Button type="button" size="sm" onClick={onResume} disabled={resuming}>
              {resuming ? 'Возобновление…' : 'Возобновить показ'}
            </Button>
          </div>
          {resumeError && (
            <p className="text-body-s text-error-dark" role="alert">
              {resumeError}
            </p>
          )}
        </div>
      )}
      {orphaned && (
        <div className="flex flex-col gap-s rounded-m border border-error-light/40 bg-error/5 p-m">
          <p className="text-body-s text-figma-text-dark" role="alert">
            Черновик, в который сохранялась эта форма, удалён или недоступен при
            текущем входе. Введённое осталось на экране — сохраните его как новый
            черновик или начните заново.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={saveAsNew}>
              Сохранить как новый черновик
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={startOver}>
              Начать заново
            </Button>
          </div>
        </div>
      )}
      {restored && !orphaned && (
        <div className="flex flex-col gap-s rounded-m border border-border bg-background p-m sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-s text-figma-text-dark">
            {restored.onServer
              ? `Вы продолжаете свой черновик${restored.name ? ` «${restored.name}»` : ''}. Он сохранён и в списке кабинета.`
              : 'Вы продолжаете незаконченную карточку — она хранится только в этом браузере.'}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={startOver}>
            Начать новое заведение
          </Button>
        </div>
      )}

      <div className="grid gap-l lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-l">
          {props.mode === 'create' && hydrated && <CopyFromPrevious onApply={patch} />}
          <ClassificationSection form={form} patch={patch} disabled={inputsDisabled} />
          <BasicInfoSection form={form} patch={patch} disabled={inputsDisabled} />
          <MediaSection
            form={form}
            patch={patch}
            disabled={inputsDisabled}
            establishmentId={establishmentId}
            onRetryOcr={isEdit ? onRetryOcr : undefined}
          />
          <AddressSection form={form} patch={patch} disabled={inputsDisabled} />
          <HoursSection form={form} patch={patch} disabled={inputsDisabled} />
        </div>
        <div>
          <StickySidebar
            e1={e1}
            completeness={completeness}
            serverScore={serverScore}
            canSubmit={e1.passed && draftId != null}
            showSubmit={showSubmit}
            submitting={submitting}
            onSubmit={onSubmit}
            saveLabel={saveLabel}
            error={error}
            notice={notice}
            cuisineOptional={
              form.categories.length > 0 && !isCuisineRequired(form.categories)
            }
          />
        </div>
      </div>
    </div>
  );
}
