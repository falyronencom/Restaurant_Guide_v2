/**
 * The one rule for a user's display name, on every path that writes it:
 * registration by e-mail and by phone (validators/authValidation.js), the
 * profile edit from the app and the site (authService.updateUserProfile), and
 * the name a Google or Yandex login brings (authService.authenticateWithOAuth).
 * Decision of the Coordinator, 17.10.2026 (В4, В8): letters of any alphabet —
 * «ё», «і», «ў» included — with a space, hyphen or apostrophe only between
 * letters, 2 to 50 characters, and no мат (utils/profanity.js).
 *
 * The rule applies to what is written; names stored before it stay as they are
 * until their owner changes them. The texts are what the person reads: the app
 * and the site show them as the server sends them.
 */

import { containsProfanity } from './profanity.js';

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 50;

/** The refusal of a name, by the code the profile edit throws. */
export const NAME_REFUSALS = {
  NAME_EMPTY: 'Укажите имя',
  NAME_LENGTH: `Имя должно быть от ${NAME_MIN_LENGTH} до ${NAME_MAX_LENGTH} символов`,
  NAME_CHARS: 'Имя может содержать только буквы, пробел, дефис и апостроф',
  NAME_PROFANE: 'Имя содержит недопустимые слова',
};

/**
 * What a Google or Yandex login stores when the provider's name cannot pass
 * the rule even cleaned: the login never fails over a name, and the person can
 * change it in the profile.
 */
export const PROVIDER_NAME_FALLBACK = 'Пользователь';

/** A letter, with at most two combining marks (a decomposed «й» is one). */
const LETTER = '\\p{L}\\p{M}{0,2}';
/** The apostrophes a keyboard types for ', each stored as '. */
const APOSTROPHES = /[\u2019\u02BC]/gu;
/** The signs allowed between letters, after normalization. */
const SIGNS = "'-";
const NAME_SHAPE = new RegExp(`^${LETTER}(?:[ ${SIGNS}]?${LETTER})*$`, 'u');

/**
 * The name as stored: NFC, trimmed, every run of whitespace one space, the
 * typographic hyphens (U+2010, U+2011) the plain one, and the apostrophes
 * the plain one too — the iPhone types ’ (U+2019), the app sends ' (it
 * replaces ’ and ʼ before sending), and one name must be one spelling.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeUserName(raw) {
  return String(raw).normalize('NFC')
    .replace(/[\u2010\u2011]/gu, '-')
    .replace(APOSTROPHES, "'")
    .trim()
    .replace(/\s+/gu, ' ');
}

/**
 * @param {*} raw - the name as received
 * @returns {{ name: string } | { code: string, message: string }} the name
 *   to store, or the refusal
 */
export function checkUserName(raw) {
  const name = typeof raw === 'string' ? normalizeUserName(raw) : '';
  const refuse = (code) => ({ code, message: NAME_REFUSALS[code] });
  if (name.length === 0) return refuse('NAME_EMPTY');
  const length = [...name].length;
  if (length < NAME_MIN_LENGTH || length > NAME_MAX_LENGTH) return refuse('NAME_LENGTH');
  if (!NAME_SHAPE.test(name)) return refuse('NAME_CHARS');
  if (containsProfanity(name)) return refuse('NAME_PROFANE');
  return { name };
}

/**
 * The name a provider login stores. The provider's name — or the part of the
 * e-mail before «@» it falls back to — is cleaned: everything but letters,
 * hyphens and apostrophes becomes a space, the signs at the edges of a word go,
 * a name too long is cut at a word. A name that still fails the rule — too
 * short, or obscene — gives way to PROVIDER_NAME_FALLBACK.
 *
 * @param {*} raw - the provider's name
 * @returns {string}
 */
export function providerDisplayName(raw) {
  if (typeof raw !== 'string') return PROVIDER_NAME_FALLBACK;
  const words = normalizeUserName(raw)
    .replace(new RegExp(`[^\\p{L}\\p{M}${SIGNS}]+`, 'gu'), ' ')
    .split(' ')
    .map((word) => word.replace(/['-]{2,}/gu, (signs) => signs[0]).replace(/^['-]+|['-]+$/gu, ''))
    .filter((word) => word.length > 0);

  let cleaned = '';
  for (const word of words) {
    const next = cleaned ? `${cleaned} ${word}` : word;
    if ([...next].length > NAME_MAX_LENGTH) break;
    cleaned = next;
  }
  if (!cleaned && words.length > 0) cleaned = [...words[0]].slice(0, NAME_MAX_LENGTH).join('');

  const verdict = checkUserName(cleaned);
  return verdict.name ?? PROVIDER_NAME_FALLBACK;
}
