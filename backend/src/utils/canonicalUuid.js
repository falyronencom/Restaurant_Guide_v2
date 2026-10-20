/**
 * An id as the database writes it: a UUID in lower-case hex, 8-4-4-4-12.
 *
 * Postgres reads a uuid in capitals or in braces as the same id, but the
 * cloud's folders are named after the id as the request wrote it
 * (config/cloudinary.js ownedFolders): a promotion created with a card id in
 * capitals put its picture in a folder the ownership rule does not recognise,
 * and deleting that picture later was refused — the file stayed (review of
 * PR #86, finding 4). Anything that is no UUID at all reached the database
 * and came back as its English 400 (22P02).
 *
 * @param {*} value
 * @returns {boolean}
 */
export const isCanonicalUuid = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
