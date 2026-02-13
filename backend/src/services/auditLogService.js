/**
 * Audit Log Service
 *
 * Business logic for audit log viewing.
 * Provides paginated, filterable access to admin action history.
 *
 * Architecture: Controller → Service → Model
 */

import * as AuditLogModel from '../models/auditLogModel.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Get paginated audit log entries with filters
 *
 * @param {Object} params
 * @param {number} [params.page=1] - Page number (1-based)
 * @param {number} [params.perPage=20] - Items per page (max 50)
 * @param {string} [params.action] - Filter by action type
 * @param {string} [params.entity_type] - Filter by entity type
 * @param {string} [params.user_id] - Filter by admin user ID
 * @param {string} [params.from] - Date range start
 * @param {string} [params.to] - Date range end
 * @param {string} [params.sort='newest'] - Sort order
 * @param {boolean} [params.include_metadata=false] - Include IP/user-agent
 * @returns {Promise<Object>} { entries, meta: { total, page, per_page, pages } }
 */
export const getAuditLog = async ({
  page = 1,
  perPage = 20,
  action,
  entity_type,
  user_id,
  from,
  to,
  sort = 'newest',
  include_metadata = false,
} = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;

    const filters = {
      action,
      entity_type,
      user_id,
      from,
      to,
      sort,
      include_metadata,
    };

    const [entries, total] = await Promise.all([
      AuditLogModel.getAuditLogEntries(filters, effectivePerPage, offset),
      AuditLogModel.countAuditLogEntries(filters),
    ]);

    return {
      entries,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage),
      },
    };
  } catch (error) {
    logger.error('Error in getAuditLog service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch audit log',
      500,
      'AUDIT_LOG_FETCH_FAILED',
    );
  }
};
