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

/** Any of the moderator's suspension marks present? */
export const hasModeratorSuspensionMarks = (notes) => MODERATOR_SUSPENSION_KEYS.some((key) => key in notes);

/** The notes without the moderator's suspension marks; other keys kept. */
export const withoutModeratorSuspension = (notes) => Object.fromEntries(
  Object.entries(notes).filter(([key]) => !MODERATOR_SUSPENSION_KEYS.includes(key)),
);
