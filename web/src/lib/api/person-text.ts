/*
 * A refusal the backend wrote for a person — Russian — is shown as it comes;
 * its English field texts are developer texts and stay replaced by the site's
 * own (the convention of the review, register and profile forms). The name
 * rule and the мат refusal of a name, a review and an owner's reply (backend
 * utils/userName.js, validators/reviewValidation.js, 17.10.2026) are such
 * texts: the site has no copy of the vocabulary and cannot say it itself.
 */

const CYRILLIC = /[А-Яа-яЁё]/;

/** The text when it is one written for a person, otherwise undefined. */
export function personText(message: unknown): string | undefined {
  return typeof message === 'string' && CYRILLIC.test(message)
    ? message
    : undefined;
}

/**
 * The backend's one name rule (utils/userName.js), for the forms' instant
 * check: letters of any alphabet, a space, hyphen or apostrophe only between
 * letters, 2–50 characters. The backend stays the judge — it also refuses мат.
 */
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 50;
const NAME_SHAPE = /^\p{L}\p{M}{0,2}(?:[ '’-]?\p{L}\p{M}{0,2})*$/u;

export function normalizeName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function isRuleName(raw: string): boolean {
  const name = normalizeName(raw);
  const length = [...name].length;
  return (
    length >= NAME_MIN_LENGTH &&
    length <= NAME_MAX_LENGTH &&
    NAME_SHAPE.test(name)
  );
}
