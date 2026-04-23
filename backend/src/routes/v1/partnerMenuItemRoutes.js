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
import { authenticate, authorize } from '../../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

/**
 * PATCH /api/v1/partner/menu-items/:id
 *
 * Inline-edit a parsed menu item. Body may include item_name, price_byn,
 * category_raw. Clears sanity_flag on success — partner vouches for the values.
 */
router.patch(
  '/:id',
  authorize(['partner']),
  partnerMenuItemController.updateMenuItem,
);

export default router;
