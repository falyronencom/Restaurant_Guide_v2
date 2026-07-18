/**
 * Pure gate logic (Phase C Slice 1, Segment B). Two distinct thresholds:
 *
 *   meetsValidatorMinimum — Decision 5 two-stage draft: the fields needed to
 *     materialize a SERVER draft. Mirrors the backend create validator's hard
 *     requirements MINUS lat/lng (auto-assisted from city-center). Hours must be
 *     partner-set (≥1 open day with times) — no silent defaults (Q10). Below this
 *     threshold the draft stays client-only (localStorage).
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

import { DAY_KEYS, E1_MIN_DESCRIPTION, E1_MIN_PHOTOS } from '@/lib/partner/constants';
import type { WizardFormState } from '@/lib/partner/form';

function hasObservedHours(form: WizardFormState): boolean {
  return DAY_KEYS.some((d) => {
    const day = form.workingHours[d];
    return day.isOpen && day.open.length > 0 && day.close.length > 0;
  });
}

export function meetsValidatorMinimum(form: WizardFormState): boolean {
  const hasName = form.name.trim().length > 0;
  const hasCity = form.city.trim().length > 0;
  const hasAddress =
    form.street.trim().length > 0 || form.building.trim().length > 0;
  const hasCategory = form.categories.length >= 1;
  const hasCuisine = form.cuisines.length >= 1;
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
  hours: boolean; // ≥1 open day with times
  classification: boolean; // ≥1 category AND ≥1 cuisine
  /** ≥ E1_MIN_DESCRIPTION chars — PROGRESS ONLY, never gates Submit (see header). */
  description: boolean;
  passed: boolean; // every gating item above (description excluded)
};

export function evaluateE1(form: WizardFormState): E1Checklist {
  const photos = form.interiorPhotos.length >= E1_MIN_PHOTOS;
  const menu = form.menuPhotos.length >= 1 || form.menuPdfs.length >= 1;
  const hours = hasObservedHours(form);
  const classification =
    form.categories.length >= 1 && form.cuisines.length >= 1;
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
