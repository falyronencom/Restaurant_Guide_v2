/**
 * Does a text carry мат? The check behind the refusals of an obscene user name,
 * review and owner's reply (decision of the Coordinator, 17.10.2026, В8; the
 * vocabulary — utils/profanityLexicon.js).
 *
 * It holds the usual ways round a word list (tester's walkthrough 17.10):
 *   - characters between the letters: «х.у.й», «х-у-й», «х_у_й», «х'у'й» —
 *     anything but a letter inside a word is dropped;
 *   - spaces between the letters: «х у й», «ху й» — words of one or two letters
 *     in a row are also read joined;
 *   - Latin letters and digits for look-alike Cyrillic ones, mixed alphabets:
 *     «xyй», «cyka», «3ае6ал» — read through a look-alike table, both ways;
 *   - transliteration: «pizda», «nahuy»;
 *   - stretched letters: «хуууй» — every letter of a pattern is `+`;
 *   - invisible and combining characters, full-width and styled letters
 *     (NFKC, then they are removed).
 *
 * Not held: a word split into two long halves («пиз да»), a letter replaced by
 * a star («х*й»), pictures drawn with characters. The name rule
 * (utils/userName.js) keeps all three out of a name: only letters, space,
 * hyphen and apostrophe.
 */

import { CYRILLIC_PATTERNS, LATIN_PATTERNS, TRANSLIT_PATTERNS } from './profanityLexicon.js';

/** Invisible characters a word can be cut with; removed before reading (the combining ones go with the marks). */
const INVISIBLE = /[\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/gu;

/**
 * What a letter outside a reading's alphabet becomes («ж» read as Latin): it
 * breaks any match through it. A digit or sign outside the tables is dropped.
 */
const BLOCK = '·';

/** Look-alikes read as Cyrillic: Latin, Greek, digits and signs. */
const TO_CYRILLIC = {
  a: 'а', b: 'б', c: 'с', e: 'е', h: 'н', i: 'и', k: 'к', m: 'м', n: 'п', o: 'о',
  p: 'р', r: 'г', t: 'т', u: 'и', x: 'х', y: 'у', z: 'з',
  α: 'а', ε: 'е', η: 'н', ι: 'и', κ: 'к', μ: 'м', ο: 'о', π: 'п', ρ: 'р', τ: 'т',
  υ: 'у', χ: 'х',
  0: 'о', 3: 'з', 4: 'ч', 6: 'б', '@': 'а',
};

/** Cyrillic letters reduced to one spelling: Belarusian and Ukrainian forms, ё. */
const CYRILLIC_FOLD = { ё: 'е', є: 'е', і: 'и', ї: 'и', ў: 'у', ґ: 'г' };

/** Look-alikes read as Latin: Cyrillic, digits and signs (leetspeak). */
const TO_LATIN = {
  а: 'a', в: 'b', е: 'e', ё: 'e', з: 'e', и: 'u', к: 'k', м: 'm', н: 'h', о: 'o',
  п: 'n', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i',
  0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i',
};

/** Latin spelt as Russian sounds, longest first. */
const TRANSLIT = [
  ['shch', 'щ'], ['sch', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['kh', 'х'],
  ['ts', 'ц'], ['yo', 'е'], ['jo', 'е'], ['yu', 'ю'], ['ju', 'ю'], ['ya', 'я'],
  ['ja', 'я'], ['ye', 'е'],
  ['a', 'а'], ['b', 'б'], ['c', 'ц'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'],
  ['h', 'х'], ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'],
  ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'],
  ['v', 'в'], ['w', 'в'], ['x', 'х'], ['z', 'з'],
  ['0', 'о'], ['3', 'з'], ['4', 'ч'], ['6', 'б'],
];
const TRANSLIT_VOWELS = new Set(['а', 'е', 'и', 'о', 'у', 'ы', 'э', 'ю', 'я']);

const LETTER = /\p{L}/u;
const CYRILLIC_LETTER = /\p{Script=Cyrillic}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

/**
 * Characters a reading keeps: letters, and the digits and signs of the tables.
 * A modifier letter is not one: ʼ (U+02BC) is an apostrophe to a reader, and
 * «хʼуʼй» must read as «х'у'й».
 */
const MODIFIER_LETTER = /\p{Lm}/u;
const kept = (ch) => (LETTER.test(ch) && !MODIFIER_LETTER.test(ch)) || ch in TO_CYRILLIC || ch in TO_LATIN;

function toCyrillic(chars) {
  return chars.map((ch) => {
    if (CYRILLIC_LETTER.test(ch)) return CYRILLIC_FOLD[ch] ?? ch;
    return TO_CYRILLIC[ch] ?? (LETTER.test(ch) ? BLOCK : '');
  }).join('');
}

function toLatin(chars) {
  return chars.map((ch) => {
    if (LATIN_LETTER.test(ch)) return ch;
    return TO_LATIN[ch] ?? (LETTER.test(ch) ? BLOCK : '');
  }).join('');
}

/** Latin letters as Russian sounds; Cyrillic letters stay, anything else blocks. */
function transliterate(chars) {
  const src = chars.map((ch) => (CYRILLIC_LETTER.test(ch) ? CYRILLIC_FOLD[ch] ?? ch : ch)).join('');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // «y» is «й» after a vowel («huy»), «ы» otherwise («pizdy»)
    if (ch === 'y' && !['yo', 'yu', 'ya', 'ye'].includes(src.slice(i, i + 2))) {
      out += TRANSLIT_VOWELS.has(out.at(-1)) ? 'й' : 'ы';
      i += 1;
      continue;
    }
    const pair = TRANSLIT.find(([lat]) => src.startsWith(lat, i));
    if (pair) {
      out += pair[1];
      i += pair[0].length;
    } else {
      if (CYRILLIC_LETTER.test(ch)) out += ch;
      else if (LETTER.test(ch)) out += BLOCK;
      i += 1;
    }
  }
  return out;
}

/** Does one word — its kept characters — read as an obscene one? */
function wordIsProfane(chars) {
  if (chars.length === 0) return false;
  const hasCyrillic = chars.some((ch) => CYRILLIC_LETTER.test(ch));
  const hasLatin = chars.some((ch) => LATIN_LETTER.test(ch));
  const latinOnly = hasLatin && !hasCyrillic;

  const cyr = toCyrillic(chars);
  if (CYRILLIC_PATTERNS.some((p) => !(latinOnly && p.latin === false) && p.re.test(cyr))) return true;
  if (!hasLatin) return false;

  const lat = toLatin(chars);
  if (LATIN_PATTERNS.some((p) => p.re.test(lat))) return true;

  const tr = transliterate(chars);
  return TRANSLIT_PATTERNS.some((p) => p.re.test(tr));
}

/**
 * The words of a text as the patterns read them: each run of non-space
 * characters with everything but letters and look-alike digits dropped; and
 * every run of two or more such words of one or two letters, joined («х у й»,
 * «ху й»). A word with nothing kept («—», «***») does not break a run.
 */
function readWords(text) {
  const prepared = String(text).normalize('NFKC').toLowerCase().replace(INVISIBLE, '')
    .normalize('NFD').replace(/\p{M}/gu, (m, offset, s) => (
      // keep the marks that make й, ё, ў, ї, і — recomposed below
      /[\u0306\u0308]/u.test(m) && /[иеуі]/u.test(s[offset - 1] ?? '') ? m : ''
    ))
    .normalize('NFC');

  const words = prepared.split(/\s+/u).map((chunk) => [...chunk].filter(kept)).filter((w) => w.length > 0);
  const readings = [...words];
  let run = [];
  const closeRun = () => {
    if (run.length >= 2) readings.push(run.flat());
    run = [];
  };
  for (const word of words) {
    if (word.length <= 2) run.push(word);
    else closeRun();
  }
  closeRun();
  return readings;
}

/**
 * @param {string} text - a name, a review, an owner's reply
 * @returns {boolean} true when any word of it reads as мат
 */
export function containsProfanity(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return readWords(text).some(wordIsProfane);
}
