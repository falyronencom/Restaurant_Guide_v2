/**
 * A card parked by an account takeover is not changed until the moderator
 * decides whom it belongs to (Coordinator, 01.11.2026, «Р2»;
 * authService.takeOverUnverifiedAccount). Lifting that suspension returns the
 * card to the guests directly, so whatever the new holder adds meanwhile would
 * reach them with nobody's look at it.
 *
 * The card's own edit and its submission refused it from the start
 * (establishmentService.updateEstablishment, submitEstablishmentForModeration);
 * the photos and the promotions did not (DISCOVERY 09.11.2026, finding 3): an
 * upload, a delete, a new cover, a promotion created, changed or taken off went
 * through on ownership alone. They are refused here with the text and the code
 * of the edit.
 */

import { AppError } from '../middleware/errorHandler.js';
import { ESTABLISHMENT_REFUSALS } from '../constants/establishmentRefusals.js';
import * as EstablishmentModel from '../models/establishmentModel.js';
import { isAccountTakeoverSuspension, parseModerationNotes } from '../utils/moderationNotes.js';

/**
 * Refuse a change of this card while its ownership is disputed.
 *
 * @param {Object|null} establishment - a row with status and moderation_notes
 * @throws {AppError} 403 OWNERSHIP_DISPUTE
 */
export const refuseChangeOfDisputedCard = (establishment) => {
  if (!establishment) return;
  const notes = parseModerationNotes(establishment.moderation_notes);
  if (isAccountTakeoverSuspension(establishment.status, notes)) {
    throw new AppError(ESTABLISHMENT_REFUSALS.editOwnershipDispute, 403, 'OWNERSHIP_DISPUTE');
  }
};

/**
 * The same, reading the card by its id — for the paths that hold only the id.
 *
 * @param {string} establishmentId
 * @returns {Promise<void>}
 * @throws {AppError} 403 OWNERSHIP_DISPUTE
 */
export const refuseChangeOfDisputedCardById = async (establishmentId) => {
  const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);
  refuseChangeOfDisputedCard(establishment);
};
