/**
 * Pure gate logic (Phase C Slice 1, Segment B). Two distinct thresholds:
 *
 *   meetsValidatorMinimum — Decision 5 two-stage draft: the fields needed to
 *     materialize a SERVER draft. Mirrors the backend create validator's hard
 *     requirements MINUS lat/lng (auto-assisted from city-center). Hours must be
 *     partner-set (≥1 open day, every open day with both times) — no silent
 *     defaults (Q10). Below this threshold the draft stays client-only
 *     (localStorage).
 *
 *   evaluateE1 — the sticky-sidebar checklist that gates Submit. Stricter than the
 *     backend submit-gate (which ignores media) in the media dimension, but NOT in
 *     the description one: `description` is reported for progress and deliberately
 *     EXCLUDED from `passed` (SDL CAT-E-2.3 Amendment, 2026-07-17 — the description
 *     requirement moved from the import/submit gate to the pre-flip gate: cards are
 *     created without one, OCR runs, then descriptions are batch-generated and
 *     reviewed before the NOINDEX flip). The backend agrees — its create/update
 *     validators mark description `.optional()`. Mobile has always treated it as
 *     optional; this keeps the three targets aligned.
 */

import {
  DAY_KEYS,
  E1_MIN_DESCRIPTION,
  E1_MIN_PHOTOS,
  isCuisineRequired,
  type DayKey,
} from '@/lib/partner/constants';
import type { WizardFormState } from '@/lib/partner/form';
import { clockMinutes } from '@/lib/working-hours';

/** ≥1 cuisine, or none needed — a cuisine-optional category (decision В5, Ш17). */
function hasCuisineIfRequired(form: WizardFormState): boolean {
  return form.cuisines.length >= 1 || !isCuisineRequired(form.categories);
}

/**
 * Days marked open without both proper times, in week order. Such a day is not
 * sent to the server at all (toUpdatePayload) and holds Submit: the server refuses
 * it on a submit and on an edit of a card that is not a draft, and a guest would
 * read «Часы не указаны» for it.
 */
export function incompleteDays(form: WizardFormState): DayKey[] {
  return DAY_KEYS.filter((d) => {
    const day = form.workingHours[d];
    return (
      day.isOpen &&
      (clockMinutes(day.open) == null || clockMinutes(day.close) == null)
    );
  });
}

function hasObservedHours(form: WizardFormState): boolean {
  return (
    incompleteDays(form).length === 0 &&
    DAY_KEYS.some((d) => form.workingHours[d].isOpen)
  );
}

export function meetsValidatorMinimum(form: WizardFormState): boolean {
  const hasName = form.name.trim().length > 0;
  const hasCity = form.city.trim().length > 0;
  const hasAddress =
    form.street.trim().length > 0 || form.building.trim().length > 0;
  const hasCategory = form.categories.length >= 1;
  const hasCuisine = hasCuisineIfRequired(form);
  return (
    hasName &&
    hasCity &&
    hasAddress &&
    hasCategory &&
    hasCuisine &&
    hasObservedHours(form)
  );
}

export type E1Checklist = {
  photos: boolean; // ≥ E1_MIN_PHOTOS establishment (interior) photos
  menu: boolean; // ≥1 menu photo OR PDF
  hours: boolean; // ≥1 open day, every open day with both times
  classification: boolean; // ≥1 category AND ≥1 cuisine (none needed for a cuisine-optional category)
  /** ≥ E1_MIN_DESCRIPTION chars — PROGRESS ONLY, never gates Submit (see header). */
  description: boolean;
  passed: boolean; // every gating item above (description excluded)
};

export function evaluateE1(form: WizardFormState): E1Checklist {
  const photos = form.interiorPhotos.length >= E1_MIN_PHOTOS;
  const menu = form.menuPhotos.length >= 1 || form.menuPdfs.length >= 1;
  const hours = hasObservedHours(form);
  const classification =
    form.categories.length >= 1 && hasCuisineIfRequired(form);
  const description = form.description.trim().length >= E1_MIN_DESCRIPTION;
  return {
    photos,
    menu,
    hours,
    classification,
    description,
    // `description` is intentionally absent — it is a pre-flip requirement, not a
    // submit-time one (CAT-E-2.3 Amendment). Collectors would otherwise be forced
    // to invent 120 chars per card on site, which is the slowest field to fill.
    passed: photos && menu && hours && classification,
  };
}
