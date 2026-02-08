/**
 * Admin Moderation Controller
 *
 * HTTP handlers for admin moderation endpoints.
 * Thin layer: extracts request data, delegates to adminService, formats response.
 *
 * Endpoints:
 *   GET  /api/v1/admin/establishments/pending     — list pending queue
 *   GET  /api/v1/admin/establishments/:id          — full details for review
 *   POST /api/v1/admin/establishments/:id/moderate — approve or reject
 */

import * as adminService from '../services/adminService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * GET /api/v1/admin/establishments/pending
 *
 * Returns paginated list of establishments awaiting moderation.
 * Query params: page (default 1), per_page (default 20, max 50)
 */
export const listPendingEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;

  const result = await adminService.getPendingEstablishments({ page, perPage });

  logger.info('Admin fetched pending establishments', {
    adminId: req.user.userId,
    count: result.establishments.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/pending',
  });

  res.status(200).json({
    success: true,
    data: result.establishments,
    meta: result.meta,
  });
});

/**
 * GET /api/v1/admin/establishments/:id
 *
 * Returns complete establishment data for moderation review.
 * Organized for four-tab display: Данные, О заведении, Медиа, Адрес.
 */
export const getEstablishmentDetails = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;

  const establishment = await adminService.getEstablishmentForModeration(
    establishmentId,
  );

  logger.info('Admin fetched establishment details for moderation', {
    adminId: req.user.userId,
    establishmentId,
    status: establishment.status,
    endpoint: 'GET /api/v1/admin/establishments/:id',
  });

  res.status(200).json({
    success: true,
    data: establishment,
  });
});

/**
 * POST /api/v1/admin/establishments/:id/moderate
 *
 * Execute moderation action (approve or reject).
 * Body: { action: "approve"|"reject", moderation_notes: { field: "comment" } }
 */
export const moderateEstablishment = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const { action, moderation_notes } = req.body;

  const result = await adminService.moderateEstablishment(
    establishmentId,
    {
      action,
      moderation_notes: moderation_notes || {},
      adminUserId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  );

  const message = action === 'approve'
    ? 'Establishment approved and published'
    : 'Establishment rejected and returned to draft';

  logger.info('Admin moderated establishment', {
    adminId: req.user.userId,
    establishmentId,
    action,
    newStatus: result.status,
    endpoint: 'POST /api/v1/admin/establishments/:id/moderate',
  });

  res.status(200).json({
    success: true,
    data: result,
    message,
  });
});
