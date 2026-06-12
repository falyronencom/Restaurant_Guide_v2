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
 *     backend submit-gate (which ignores media). Submit is enabled only when every
 *     item passes.
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
  description: boolean; // ≥ E1_MIN_DESCRIPTION chars
  passed: boolean; // all of the above
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
    passed: photos && menu && hours && classification && description,
  };
}
