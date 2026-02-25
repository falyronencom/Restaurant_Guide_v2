/**
 * Admin Moderation Controller
 *
 * HTTP handlers for admin moderation endpoints.
 * Thin layer: extracts request data, delegates to adminService, formats response.
 *
 * Endpoints (Segment B):
 *   GET  /api/v1/admin/establishments/pending      — list pending queue
 *   GET  /api/v1/admin/establishments/:id           — full details for review
 *   POST /api/v1/admin/establishments/:id/moderate  — approve or reject
 *
 * Endpoints (Segment C):
 *   GET  /api/v1/admin/establishments/active        — list active establishments
 *   GET  /api/v1/admin/establishments/rejected      — rejection history
 *   POST /api/v1/admin/establishments/:id/suspend   — suspend active establishment
 *   POST /api/v1/admin/establishments/:id/unsuspend — reactivate suspended
 *   GET  /api/v1/admin/establishments/search        — search across all statuses
 */

import * as adminService from '../services/adminService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
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

// ============================================================================
// Segment C: Active, Rejected, Suspend, Unsuspend, Search
// ============================================================================

/**
 * GET /api/v1/admin/establishments/active
 *
 * Returns paginated list of active (approved) establishments.
 * Query params: page, per_page, sort (newest|oldest|rating|views), city, search
 */
export const listActiveEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;
  const { sort, city, search } = req.query;

  const result = await adminService.getActiveEstablishments({
    page,
    perPage,
    sort,
    city,
    search,
  });

  logger.info('Admin fetched active establishments', {
    adminId: req.user.userId,
    count: result.establishments.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/active',
  });

  res.status(200).json({
    success: true,
    data: result.establishments,
    meta: result.meta,
  });
});

/**
 * GET /api/v1/admin/establishments/rejected
 *
 * Returns paginated rejection history from audit log.
 * Query params: page, per_page
 */
export const listRejectedEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;

  const result = await adminService.getRejectedEstablishments({ page, perPage });

  logger.info('Admin fetched rejection history', {
    adminId: req.user.userId,
    count: result.rejections.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/rejected',
  });

  res.status(200).json({
    success: true,
    data: result.rejections,
    meta: result.meta,
  });
});

/**
 * GET /api/v1/admin/establishments/suspended
 *
 * Returns paginated list of suspended establishments.
 * Query params: page (default 1), per_page (default 20, max 50)
 */
export const listSuspendedEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;

  const result = await adminService.getSuspendedEstablishments({ page, perPage });

  logger.info('Admin fetched suspended establishments', {
    adminId: req.user.userId,
    count: result.establishments.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/suspended',
  });

  res.status(200).json({
    success: true,
    data: result.establishments,
    meta: result.meta,
  });
});

/**
 * POST /api/v1/admin/establishments/:id/suspend
 *
 * Suspend an active establishment.
 * Body: { reason: "string" }
 */
export const suspendEstablishment = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const { reason } = req.body;

  const result = await adminService.suspendEstablishment(
    establishmentId,
    {
      reason,
      adminUserId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  );

  logger.info('Admin suspended establishment', {
    adminId: req.user.userId,
    establishmentId,
    endpoint: 'POST /api/v1/admin/establishments/:id/suspend',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Establishment suspended',
  });
});

/**
 * POST /api/v1/admin/establishments/:id/unsuspend
 *
 * Reactivate a suspended establishment.
 */
export const unsuspendEstablishment = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;

  const result = await adminService.unsuspendEstablishment(
    establishmentId,
    {
      adminUserId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  );

  logger.info('Admin unsuspended establishment', {
    adminId: req.user.userId,
    establishmentId,
    endpoint: 'POST /api/v1/admin/establishments/:id/unsuspend',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Establishment reactivated',
  });
});

/**
 * PATCH /api/v1/admin/establishments/:id/coordinates
 *
 * Update establishment coordinates (admin correction).
 * Body: { latitude: number, longitude: number }
 */
export const updateCoordinates = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const { latitude, longitude } = req.body;

  if (latitude === undefined || longitude === undefined) {
    throw new AppError(
      'latitude and longitude are required',
      422,
      'MISSING_COORDINATES',
    );
  }

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new AppError(
      'latitude and longitude must be numbers',
      422,
      'INVALID_COORDINATES',
    );
  }

  const result = await adminService.updateEstablishmentCoordinates(
    establishmentId,
    {
      latitude,
      longitude,
      adminUserId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  );

  logger.info('Admin updated establishment coordinates', {
    adminId: req.user.userId,
    establishmentId,
    latitude,
    longitude,
    endpoint: 'PATCH /api/v1/admin/establishments/:id/coordinates',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Coordinates updated',
  });
});

/**
 * GET /api/v1/admin/establishments/search
 *
 * Search establishments across all statuses.
 * Query params: search (required), status, city, page, per_page
 */
export const searchEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;
  const { search, status, city } = req.query;

  const result = await adminService.searchAllEstablishments({
    search,
    status,
    city,
    page,
    perPage,
  });

  logger.info('Admin searched establishments', {
    adminId: req.user.userId,
    search,
    count: result.establishments.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/search',
  });

  res.status(200).json({
    success: true,
    data: result.establishments,
    meta: result.meta,
  });
});
