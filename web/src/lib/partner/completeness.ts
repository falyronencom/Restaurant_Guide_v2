/**
 * Client mirror of backend calculateCompletenessScore (establishmentModel.js:30-69).
 *
 * Drives the sticky-sidebar completeness % BEFORE a server draft exists. Once the
 * draft is created the server's `base_score` is authoritative (the sidebar swaps
 * to it). Keep this formula IN SYNC with the backend:
 *
 *   description 25 · price_range 25 · attributes 20 · phone 15 · email 10 · website 5
 *
 * The backend counts `attributes` when the object has ≥1 key (any value); our
 * form only ever emits selected (truthy) keys, so a non-empty selection ⇒ +20.
 */

import type { WizardFormState } from '@/lib/partner/form';

export function clientCompleteness(form: WizardFormState): number {
  let score = 0;
  if (form.description.trim().length > 0) score += 25;
  if (form.priceRange) score += 25;
  if (form.attributes.length > 0) score += 20;
  if (form.phone.trim().length > 0) score += 15;
  if (form.email.trim().length > 0) score += 10;
  if (form.website.trim().length > 0) score += 5;
  return score;
}
