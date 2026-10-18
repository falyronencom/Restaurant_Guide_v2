/**
 * The card's contacts checked in the form, before the save (сверка находок
 * тестировщика с сайтом, 18.10, пункт С6). The backend checks the phone,
 * email and website of a save and refuses the WHOLE save for one wrong value
 * (validators/establishmentValidation.js) — so a half-typed phone held back
 * every other edit. A contact that does not pass here is left out of the save
 * (the stored value stays) and its field says why; the rest is saved.
 *
 * The checks mirror the backend's: the phone — BELARUS_PHONE_RE (constants.ts,
 * the mirror of constants/belarusPhone.js); the email and the website — the
 * shapes express-validator's isEmail / isURL accept in practice. The backend
 * stays the judge: a value that passes here and fails there comes back as a
 * field refusal that names its field (errors.ts).
 */

import { BELARUS_PHONE_RE } from '@/lib/partner/constants';
import type { WizardFormState } from '@/lib/partner/form';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Scheme in any case (a phone keyboard capitalises «Https»), ftp as isURL
// allows, a punycode top-level domain (xn--90ais — .бел).
const WEBSITE_RE =
  /^((https?|ftp):\/\/)?([\p{L}\p{N}-]+\.)+(\p{L}{2,}|xn--[a-z0-9-]+)(:\d{1,5})?([/?#]\S*)?$/iu;

/** The phone as the backend expects it: spaces, dashes and brackets dropped. */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s()-]/g, '');
}

export type ContactField = 'phone' | 'email' | 'website';

/** The value to send for a contact: trimmed, '' when empty, null when it does not pass. */
export function contactValue(form: WizardFormState, field: ContactField): string | null {
  switch (field) {
    case 'phone': {
      const v = normalizePhone(form.phone);
      return !v || BELARUS_PHONE_RE.test(v) ? v : null;
    }
    case 'email': {
      const v = form.email.trim();
      return !v || EMAIL_RE.test(v) ? v : null;
    }
    case 'website': {
      const v = form.website.trim();
      return !v || WEBSITE_RE.test(v) ? v : null;
    }
  }
}

const CONTACT_ERRORS: Record<ContactField, string> = {
  phone: 'Номер не сохраняется: нужен формат +375XXXXXXXXX — 9 цифр после +375.',
  email: 'Почта не сохраняется: нужен адрес вида name@example.by.',
  website: 'Адрес не сохраняется: нужен вид example.by или https://example.by.',
};

/** Every contact that does not pass, each with its own text — one does not hide another. */
export function contactErrors(
  form: WizardFormState,
): Partial<Record<ContactField, string>> {
  const errors: Partial<Record<ContactField, string>> = {};
  for (const field of ['phone', 'email', 'website'] as const) {
    if (contactValue(form, field) === null) errors[field] = CONTACT_ERRORS[field];
  }
  return errors;
}

/**
 * The form as the server holds it after a save of `sent`: a contact left out
 * of the save (it did not pass) keeps the value the server had — `before`
 * (С7 erases only what the server really holds).
 */
export function acceptedForm(
  sent: WizardFormState,
  before: WizardFormState | null,
): WizardFormState {
  const accepted = { ...sent };
  for (const field of ['phone', 'email', 'website'] as const) {
    if (contactValue(sent, field) === null) accepted[field] = before?.[field] ?? '';
  }
  return accepted;
}

/** Field names for a submit held back by a contact that does not pass. */
export const CONTACT_LABELS: Record<ContactField, string> = {
  phone: 'телефон',
  email: 'почту',
  website: 'сайт',
};
