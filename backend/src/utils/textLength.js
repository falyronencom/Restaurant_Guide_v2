/**
 * Text length as PostgreSQL counts it.
 *
 * A varchar(n) column holds n characters, and Postgres counts code points;
 * JavaScript's `length` counts UTF-16 units (an emoji is two), and
 * validator's isLength also skips the variation selectors U+FE0E/U+FE0F
 * («❤️» is one for it, two for the database). A text that passes either of
 * those checks can still be refused by the database (22001 → 500) — first
 * met on a promotion's title (PR #86), then on a card photo's caption.
 */

/**
 * Whether `text` has more than `max` code points, counted no further than
 * max + 1: a JSON body may carry megabytes in one field.
 *
 * @param {string} text
 * @param {number} max
 * @returns {boolean}
 */
export const longerThan = (text, max) => {
  let count = 0;
  for (let i = 0; i < text.length; i += text.codePointAt(i) > 0xFFFF ? 2 : 1) {
    count += 1;
    if (count > max) return true;
  }
  return false;
};

/**
 * A check for express-validator's custom(): the value is a string that a
 * varchar(max) column holds — from `min` to `max` characters as the database
 * counts them. It replaces isLength({ min, max }) where the field is written
 * to such a column (review of PR #112, finding 7). Anything but a string does
 * not fit: isLength judged each item of an array (a field sent twice in a
 * form, or an array in JSON), and pg wrote the array as its literal
 * {"a","b"} — a value nobody typed, or a 500 when the literal is longer than
 * the column (a card's name sent as an array was a 500 before 20.10.2026).
 *
 * @param {number} max
 * @param {{ min?: number }} [options]
 * @returns {(value: *) => boolean}
 */
export const fitsVarchar = (max, { min = 0 } = {}) => (value) => typeof value === 'string'
  && (min === 0 || longerThan(value, min - 1))
  && !longerThan(value, max);
