'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import {
  createEstablishmentAction,
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
import { HoursSection } from './HoursSection';
import { MediaSection } from './MediaSection';
import { StickySidebar } from './StickySidebar';

/*
 * Wizard orchestrator (Phase C Slice 1, Segment B — create path). Controlled
 * state (the live sidebar + autosave demand it; this also sidesteps the React-19
 * uncontrolled-reset gotcha). Two-stage draft (Decision 5):
 *   stage 1 — client-only localStorage persist until the validator minimum;
 *   stage 2 — a server draft is created, then debounced PUT autosave per change.
 * The FIRST create upgrades the user → partner; the action re-stamps rg_user and
 * returns the fresh user, applied to the AuthProvider here.
 *
 * Edit mode (initial hydration, PUT semantics, copy-from-previous) lands in 4b.
 */

const LS_KEY = 'nirivio:wizard:new';
const AUTOSAVE_MS = 800;

export function EstablishmentWizard() {
  const router = useRouter();
  const { applySession } = useAuth();

  const [form, setForm] = useState<WizardFormState>(emptyForm);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [serverScore, setServerScore] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Refs read inside the debounced autosave to avoid stale closures / re-entry.
  const draftIdRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const submittingRef = useRef(false);

  const persistLocal = useCallback(
    (f: WizardFormState, id: string | null) => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ form: f, draftId: id }));
      } catch {
        /* private mode / quota — non-fatal */
      }
    },
    [],
  );

  // Hydrate from localStorage once (the two-stage persist's "return to draft").
  // Reads are synchronous; the state writes are deferred a tick so the mount
  // render commits first (avoids a synchronous set-state-in-effect cascade). LS
  // is client-only, so this cannot run as a lazy initializer without an SSR
  // hydration mismatch — the empty→restored transition is the correct pattern.
  useEffect(() => {
    let saved:
      | { form?: Partial<WizardFormState>; draftId?: string | null }
      | null = null;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = null; // corrupt — start fresh
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
  }, []);

  const patch = useCallback((partial: Partial<WizardFormState>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  }, []);

  // Debounced persist + server sync on every change (after hydration).
  useEffect(() => {
    if (!hydrated) return undefined;
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
    return () => clearTimeout(timer);
    // persistLocal/applySession are stable; form drives the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, hydrated]);

  const e1 = evaluateE1(form);
  const completeness = clientCompleteness(form);

  const onSubmit = useCallback(async () => {
    const id = draftIdRef.current;
    if (!id || !e1.passed || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    // Flush the latest edits before submitting (an autosave may be pending).
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

  const saveLabel = !draftId
    ? meetsValidatorMinimum(form)
      ? 'Сохранение черновика…'
      : 'Заполните название, город, адрес, классификацию и часы — черновик сохранится сам'
    : saveState === 'saving'
      ? 'Сохранение…'
      : saveState === 'error'
        ? 'Ошибка сохранения'
        : 'Черновик сохранён';

  return (
    <div className="flex flex-col gap-l">
      <div className="flex items-center gap-2">
        <Link
          href="/cabinet"
          className="inline-flex items-center gap-1 text-body-s text-figma-text-grey transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Кабинет
        </Link>
      </div>
      <h1 className="font-display text-display-s text-foreground">
        Новое заведение
      </h1>

      <div className="grid gap-l lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-l">
          <ClassificationSection form={form} patch={patch} />
          <BasicInfoSection form={form} patch={patch} />
          <MediaSection form={form} patch={patch} />
          <AddressSection form={form} patch={patch} />
          <HoursSection form={form} patch={patch} />
        </div>
        <div>
          <StickySidebar
            e1={e1}
            completeness={completeness}
            serverScore={serverScore}
            canSubmit={e1.passed && draftId != null}
            submitting={submitting}
            onSubmit={onSubmit}
            saveLabel={saveLabel}
            error={error}
          />
        </div>
      </div>
    </div>
  );
}
