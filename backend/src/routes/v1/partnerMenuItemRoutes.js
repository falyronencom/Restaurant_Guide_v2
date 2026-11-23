/**
 * Partner Menu-Item Routes
 *
 * Partner-scoped operations on parsed menu items (Segment B).
 * Mounted at /api/v1/partner/menu-items — operates on items regardless of
 * which establishment they belong to; ownership is enforced in the service layer.
 *
 * Endpoints here handle menu-item-level routes. Establishment-scoped menu
 * endpoints (list, retry-ocr) live in establishmentRoutes.js.
 */

import express from 'express';
import * as partnerMenuItemController from '../../controllers/partnerMenuItemController.js';
import { MENU_ITEM_REFUSALS } from '../../constants/partnerSectionRefusals.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { isCanonicalUuid } from '../../utils/canonicalUuid.js';

const router = express.Router();

router.use(authenticate);

/**
 * The line's id as the database writes it (utils/canonicalUuid.js), after the
 * role check and before anything else — as the card's routes check the card's
 * id (routes/v1/establishmentRoutes.js). An id that is no UUID reached the
 * database and came back as its English 400 INVALID_FORMAT; such an id, and
 * the same id in capitals or braces, is refused as a line that is not there —
 * the same status, code and text (from 23.11.2026, thread Н8, finding 4). No
 * client writes the id otherwise: it comes from the list's answer.
 */
const canonicalMenuItemId = (req, res, next) => (
  isCanonicalUuid(req.params.id)
    ? next()
    : next(new AppError(MENU_ITEM_REFUSALS.notFound, 404, 'MENU_ITEM_NOT_FOUND'))
);

/**
 * PATCH /api/v1/partner/menu-items/:id
 *
 * Inline-edit a parsed menu item. Body may include item_name, price_byn,
 * category_raw. Clears sanity_flag on success — partner vouches for the values.
 */
router.patch(
  '/:id',
  authorize(['partner']),
  canonicalMenuItemId,
  partnerMenuItemController.updateMenuItem,
);

export default router;
