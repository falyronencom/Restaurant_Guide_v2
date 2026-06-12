'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import type { EstablishmentStatus } from '@/lib/api/types';
import {
  createEstablishmentAction,
  retryOcrAction,
  submitEstablishmentAction,
  updateEstablishmentAction,
} from '@/lib/partner/actions';
import { clientCompleteness } from '@/lib/partner/completeness';
import { messageForEstablishmentError } from '@/lib/partner/errors';
import {
  emptyForm,
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
 *   upgrades user→partner; the action re-stamps rg_user, applied here.
 * Edit — seeded from the server record (no localStorage); autosave PUTs directly.
 *   Submit shows for draft/rejected/admin-suspended (E1-gated); active edits
 *   autosave without a status change; self-suspended is read-only.
 */

type Props =
  | { mode: 'create' }
  | {
      mode: 'edit';
      establishmentId: string;
      initial: WizardFormState;
      status: EstablishmentStatus;
      readOnly: boolean;
    };

const LS_KEY = 'nirivio:wizard:new';
const AUTOSAVE_MS = 800;

export function EstablishmentWizard(props: Props) {
  const isEdit = props.mode === 'edit';
  const readOnly = props.mode === 'edit' && props.readOnly;
  const editStatus = props.mode === 'edit' ? props.status : null;
  const establishmentId =
    props.mode === 'edit' ? props.establishmentId : undefined;

  const router = useRouter();
  const { applySession } = useAuth();

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
  // Edit is seeded synchronously from `initial`; only create hydrates from LS.
  const [hydrated, setHydrated] = useState(isEdit);

  const draftIdRef = useRef<string | null>(establishmentId ?? null);
  const inFlight = useRef(false);
  const submittingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistLocal = useCallback(
    (f: WizardFormState, id: string | null) => {
      if (isEdit) return; // edit operates directly on the server record
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ form: f, draftId: id }));
      } catch {
        /* private mode / quota — non-fatal */
      }
    },
    [isEdit],
  );

  // Hydrate: create → localStorage (deferred a tick, avoiding set-state-in-effect);
  // edit → already seeded from `initial`.
  useEffect(() => {
    if (isEdit) return undefined; // edit is already seeded — nothing in LS
    let saved:
      | { form?: Partial<WizardFormState>; draftId?: string | null }
      | null = null;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
    const timer = setTimeout(() => {
      if (saved?.form) setForm({ ...emptyForm(), ...saved.form });
      if (saved?.draftId) {
        setDraftId(saved.draftId);
        draftIdRef.current = saved.draftId;
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [isEdit]);

  const patch = useCallback(
    (partial: Partial<WizardFormState>) => {
      if (readOnly) return;
      setForm((prev) => ({ ...prev, ...partial }));
    },
    [readOnly],
  );

  // Debounced persist + server sync on change.
  useEffect(() => {
    if (!hydrated || readOnly) return undefined;
    const timer = setTimeout(() => {
      persistLocal(form, draftIdRef.current);
      if (inFlight.current || submittingRef.current) return;
      const id = draftIdRef.current;
      void (async () => {
        inFlight.current = true;
        setSaveState('saving');
        setError(null);
        if (id) {
          const r = await updateEstablishmentAction(id, toUpdatePayload(form));
          if (r.ok) {
            setSaveState('saved');
            if (r.base_score != null) setServerScore(r.base_score);
          } else {
            setSaveState('error');
            setError(messageForEstablishmentError(r.code));
          }
        } else if (meetsValidatorMinimum(form)) {
          const r = await createEstablishmentAction(toCreatePayload(form));
          if (r.ok) {
            draftIdRef.current = r.id;
            setDraftId(r.id);
            persistLocal(form, r.id);
            if (r.base_score != null) setServerScore(r.base_score);
            if (r.user) applySession(r.user); // role re-stamp → partner
            setSaveState('saved');
          } else {
            setSaveState('error');
            setError(messageForEstablishmentError(r.code));
          }
        } else {
          setSaveState('idle');
        }
        inFlight.current = false;
      })();
    }, AUTOSAVE_MS);
    debounceRef.current = timer;
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, hydrated, readOnly]);

  const e1 = evaluateE1(form);
  const completeness = clientCompleteness(form);
  const showSubmit =
    !readOnly && (props.mode === 'create' || editStatus !== 'active');

  const onSubmit = useCallback(async () => {
    const id = draftIdRef.current;
    if (!id || !e1.passed || submittingRef.current) return;
    // Cancel any armed autosave so a debounced PUT cannot fire mid-submit (it
    // would race the status transition and flash a spurious save error).
    if (debounceRef.current) clearTimeout(debounceRef.current);
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const saved = await updateEstablishmentAction(id, toUpdatePayload(form));
    if (!saved.ok) {
      submittingRef.current = false;
      setSubmitting(false);
      setError(messageForEstablishmentError(saved.code));
      return;
    }
    const r = await submitEstablishmentAction(id);
    submittingRef.current = false;
    setSubmitting(false);
    if (r.ok) {
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* non-fatal */
      }
      router.push('/cabinet');
    } else {
      setError(messageForEstablishmentError(r.code));
    }
  }, [e1.passed, form, router]);

  const onRetryOcr = useCallback(async () => {
    const id = draftIdRef.current;
    if (!id) return;
    setNotice(null);
    const r = await retryOcrAction(id);
    setNotice(
      r.ok
        ? 'Распознавание меню запущено — обновите страницу через минуту.'
        : messageForEstablishmentError(r.code),
    );
  }, []);

  const saveLabel = readOnly
    ? 'Только просмотр'
    : !draftId
      ? meetsValidatorMinimum(form)
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
        <p className="rounded-m border border-border bg-background p-m text-body-s text-figma-text-dark">
          Заведение приостановлено вами. Возобновите его в списке кабинета, чтобы
          снова редактировать.
        </p>
      )}

      <div className="grid gap-l lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-l">
          {props.mode === 'create' && <CopyFromPrevious onApply={patch} />}
          <ClassificationSection form={form} patch={patch} disabled={readOnly} />
          <BasicInfoSection form={form} patch={patch} disabled={readOnly} />
          <MediaSection
            form={form}
            patch={patch}
            disabled={readOnly}
            establishmentId={establishmentId}
            onRetryOcr={isEdit ? onRetryOcr : undefined}
          />
          <AddressSection form={form} patch={patch} disabled={readOnly} />
          <HoursSection form={form} patch={patch} disabled={readOnly} />
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
          />
        </div>
      </div>
    </div>
  );
}
