/**
 * Audit Log Model
 *
 * Database access methods for the audit_log table.
 * Records administrative actions for accountability and transparency.
 *
 * Table schema (from database_schema_v2.0.sql):
 *   id UUID, user_id UUID, action VARCHAR(100), entity_type VARCHAR(50),
 *   entity_id UUID, old_data JSONB, new_data JSONB, ip_address INET,
 *   user_agent TEXT, created_at TIMESTAMP
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Insert an audit log entry
 *
 * Non-critical: failures are logged but do not propagate.
 * This ensures audit logging never blocks the primary operation.
 *
 * @param {Object} data
 * @param {string} data.user_id - UUID of the admin performing the action
 * @param {string} data.action - Action type (e.g. 'moderate_approve', 'moderate_reject')
 * @param {string} data.entity_type - Entity type (e.g. 'establishment')
 * @param {string} data.entity_id - UUID of the affected entity
 * @param {Object} data.old_data - State before action (optional)
 * @param {Object} data.new_data - State after action / action details (optional)
 * @param {string} data.ip_address - Request IP address (optional)
 * @param {string} data.user_agent - Request user agent (optional)
 * @returns {Promise<Object|null>} Created record or null on failure
 */
export const createAuditLog = async (data) => {
  const {
    user_id,
    action,
    entity_type,
    entity_id,
    old_data = null,
    new_data = null,
    ip_address = null,
    user_agent = null,
  } = data;

  const query = `
    INSERT INTO audit_log (
      user_id,
      action,
      entity_type,
      entity_id,
      old_data,
      new_data,
      ip_address,
      user_agent
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, created_at
  `;

  const values = [
    user_id,
    action,
    entity_type,
    entity_id,
    old_data ? JSON.stringify(old_data) : null,
    new_data ? JSON.stringify(new_data) : null,
    ip_address,
    user_agent,
  ];

  try {
    const result = await pool.query(query, values);

    logger.info('Audit log entry created', {
      auditId: result.rows[0].id,
      userId: user_id,
      action,
      entityType: entity_type,
      entityId: entity_id,
    });

    return result.rows[0];
  } catch (error) {
    // Non-critical: log error but do not propagate
    logger.error('Failed to create audit log entry', {
      error: error.message,
      userId: user_id,
      action,
      entityType: entity_type,
      entityId: entity_id,
    });
    return null;
  }
};

/**
 * Get rejection history from audit log
 * Joins with establishments to show current state
 *
 * @param {number} limit - Max items per page
 * @param {number} offset - Pagination offset
 * @returns {Promise<Array>} Array of rejection event objects
 */
export const getRejectionHistory = async (limit = 20, offset = 0) => {
  const query = `
    SELECT
      al.id as audit_id,
      al.created_at as rejection_date,
      al.new_data,
      e.id as establishment_id,
      e.name,
      e.city,
      e.categories,
      e.cuisines,
      e.status as current_status,
      e.moderation_notes,
      (
        SELECT json_build_object(
          'url', em.url,
          'thumbnail_url', em.thumbnail_url
        )
        FROM establishment_media em
        WHERE em.establishment_id = e.id
          AND em.is_primary = true
        LIMIT 1
      ) as primary_photo
    FROM audit_log al
    JOIN establishments e ON al.entity_id::text = e.id::text
    WHERE al.action = 'moderate_reject'
      AND al.entity_type = 'establishment'
    ORDER BY al.created_at DESC
    LIMIT $1 OFFSET $2
  `;

  try {
    const result = await pool.query(query, [limit, offset]);

    logger.debug('Fetched rejection history', {
      count: result.rows.length,
      limit,
      offset,
    });

    return result.rows;
  } catch (error) {
    logger.error('Error fetching rejection history', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Count total rejection events (for pagination)
 *
 * @returns {Promise<number>} Total count
 */
export const countRejections = async () => {
  const query = `
    SELECT COUNT(*) as total
    FROM audit_log
    WHERE action = 'moderate_reject'
      AND entity_type = 'establishment'
  `;

  try {
    const result = await pool.query(query);
    return parseInt(result.rows[0].total, 10);
  } catch (error) {
    logger.error('Error counting rejections', {
      error: error.message,
    });
    throw error;
  }
};
