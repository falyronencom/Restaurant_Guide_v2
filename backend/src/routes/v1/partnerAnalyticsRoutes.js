/**
 * Partner Analytics Routes
 *
 * Partner-facing analytics endpoints:
 *   GET  /api/v1/partner/analytics/overview    — per-establishment metrics
 *   GET  /api/v1/partner/analytics/trends      — time-series for charts
 *   GET  /api/v1/partner/analytics/ratings     — rating distribution
 *
 * All endpoints require authentication and partner role.
 * Ownership is verified at the service level for single-establishment queries.
 */

import express from 'express';
import * as PartnerAnalyticsController from '../../controllers/partnerAnalyticsController.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = express.Router();

// All partner analytics routes require authenticated partner
router.use(authenticate);
router.use(authorize('partner'));

router.get('/overview', PartnerAnalyticsController.getOverview);
router.get('/trends', PartnerAnalyticsController.getTrends);
router.get('/ratings', PartnerAnalyticsController.getRatings);

export default router;
