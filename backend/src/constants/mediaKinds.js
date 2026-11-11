/**
 * The two kinds of a card's photos — «Фото заведения» and «Меню» (thread «Фото
 * людей», PR 2; decision log, amendments of CAT-E-2.1 and CAT-E-2.3; the
 * Coordinator's word 09.11.2026 21:22:55Z).
 *
 * The room, the facade and the dishes are one kind, stored as `interior`, the
 * value the partner's app and site have always sent: the wizard brief already
 * folded them into one bucket («2 бакета, не 4»). The facade and the dishes had
 * their own values only for the team's own photo shoot (CAT-E-2.1), and the
 * cost was real: the moderator's card and the partner's cabinet showed
 * `interior` only, so the team's facade and dish photos were seen by nobody but
 * the guests, and a save from the cabinet replaced a facade cover with the
 * first room photo.
 *
 * `exterior` and `dishes` stay readable: rows written before migration 042
 * carry them until it is applied, and a client sending them gets a photo of the
 * venue, not a refusal (directive §3 п. 7). Nothing writes them any more.
 */

/** The stored kind of «Фото заведения». */
export const VENUE_PHOTO = 'interior';

/** Values the venue photos carried before migration 042. */
export const LEGACY_VENUE_TYPES = Object.freeze(['exterior', 'dishes']);

/** Every value a venue photo row may carry today. */
export const VENUE_PHOTO_TYPES = Object.freeze([VENUE_PHOTO, ...LEGACY_VENUE_TYPES]);

/**
 * Is this media row's type a photo of the venue (not the menu)?
 *
 * @param {string} type
 * @returns {boolean}
 */
export const isVenuePhoto = (type) => VENUE_PHOTO_TYPES.includes(type);

/**
 * The kind a new photo is stored as: a legacy value becomes a venue photo.
 *
 * @param {string} type - as the client sent it
 * @returns {string}
 */
export const storedMediaType = (type) => (LEGACY_VENUE_TYPES.includes(type) ? VENUE_PHOTO : type);
