/**
 * establishments.moderation_notes — a TEXT column holding JSON
 * (feedback_moderation_notes_text): per-field rejection comments, and the
 * marks of a moderator's suspension.
 *
 * Two pauses, two owners (Coordinator, 2026-10-07, option A). A card in
 * status 'suspended' is either paused by its partner — no marks — or
 * suspended by a moderator — suspend_reason present. The partner switches
 * the first on; only the moderator lifts the second. The moderator's marks:
 *   suspend_reason  — why (required to suspend)
 *   suspended_at    — when
 *   suspended_from  — the status the card had before, where lifting returns
 *                     it (absent on suspensions made before 2026-10-07: all
 *                     of them were made from 'active')
 */

export const MODERATOR_SUSPENSION_KEYS = Object.freeze(['suspend_reason', 'suspended_at', 'suspended_from']);

/**
 * Read the column whatever form it arrives in: string, object, null, or a
 * string that is not JSON — the last two are "no notes".
 *
 * @param {string|Object|null|undefined} raw
 * @returns {Object}
 */
export const parseModerationNotes = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Is the card held by a moderator's suspension (rather than the partner's
 * own pause, or not suspended at all)?
 *
 * @param {string} status
 * @param {Object} notes - parsed moderation_notes
 */
export const isModeratorSuspension = (status, notes) => (
  status === 'suspended' && typeof notes.suspend_reason === 'string' && notes.suspend_reason.trim() !== ''
);

/**
 * The reason the system writes when an account passes to the owner of its
 * e-mail after a Google or Yandex sign-in (authService.takeOverUnverifiedAccount).
 * The moderator reads it on the card, the account's new holder too. Literal:
 * both read it as is — and the text itself is the mark of such a suspension
 * (isAccountTakeoverSuspension): a changed wording leaves the cards parked
 * under the old one unrecognised, so keep the old text beside a new one.
 */
export const TAKEOVER_SUSPEND_REASON =
  'Учётная запись перешла к владельцу адреса e-mail после входа через Google или Яндекс. '
  + 'Карточка приостановлена до решения модератора: кому она принадлежит.';

/**
 * Is the card parked by an account takeover — held until a moderator decides
 * whom it belongs to (Coordinator, 01.11.2026, «А+В»)? Such a suspension has
 * the moderator's marks and the system's reason; its new holder may not send
 * the card to moderation and so get past that decision.
 *
 * @param {string} status
 * @param {Object} notes - parsed moderation_notes
 */
export const isAccountTakeoverSuspension = (status, notes) => (
  isModeratorSuspension(status, notes) && notes.suspend_reason === TAKEOVER_SUSPEND_REASON
);

/** Any of the moderator's suspension marks present? */
export const hasModeratorSuspensionMarks = (notes) => MODERATOR_SUSPENSION_KEYS.some((key) => key in notes);

/** The notes without the moderator's suspension marks; other keys kept. */
export const withoutModeratorSuspension = (notes) => Object.fromEntries(
  Object.entries(notes).filter(([key]) => !MODERATOR_SUSPENSION_KEYS.includes(key)),
);
