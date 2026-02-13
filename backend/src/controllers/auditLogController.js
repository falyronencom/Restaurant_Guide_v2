/**
 * Audit Log Controller
 *
 * HTTP handler for audit log viewer endpoint.
 * Thin layer: extracts query params, delegates to service, formats response.
 *
 * Endpoint (Segment E):
 *   GET /api/v1/admin/audit-log — list audit log entries with filters
 */

import * as auditLogService from '../services/auditLogService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * GET /api/v1/admin/audit-log
 *
 * Returns paginated audit log entries with admin info and action summary.
 * Query params: page, per_page, action, entity_type, user_id, from, to, sort, include_metadata
 */
export const listAuditLog = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;
  const {
    action,
    entity_type,
    user_id,
    from,
    to,
    sort,
    include_metadata,
  } = req.query;

  const result = await auditLogService.getAuditLog({
    page,
    perPage,
    action,
    entity_type,
    user_id,
    from,
    to,
    sort,
    include_metadata: include_metadata === 'true',
  });

  logger.info('Admin fetched audit log', {
    adminId: req.user.userId,
    count: result.entries.length,
    total: result.meta.total,
    filters: { action, entity_type, user_id, from, to },
    endpoint: 'GET /api/v1/admin/audit-log',
  });

  res.status(200).json({
    success: true,
    data: result.entries,
    meta: result.meta,
  });
});
