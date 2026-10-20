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
