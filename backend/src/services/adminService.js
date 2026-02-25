/**
 * Admin Service
 *
 * Business logic for admin-specific operations: moderation workflow.
 * Orchestrates model layer calls, enforces business rules, and manages
 * the approve/reject lifecycle for pending establishments.
 *
 * Architecture: Controller → Service → Model (same pattern as establishmentService.js)
 */

import * as EstablishmentModel from '../models/establishmentModel.js';
import * as MediaModel from '../models/mediaModel.js';
import * as PartnerDocumentsModel from '../models/partnerDocumentsModel.js';
import * as AuditLogModel from '../models/auditLogModel.js';
import { AppError } from '../middleware/errorHandler.js';
import { BELARUS_BOUNDS, CITY_BOUNDS, validateCityCoordinates } from './establishmentService.js';
import logger from '../utils/logger.js';

/**
 * Get paginated list of pending establishments for the moderation queue
 *
 * @param {Object} params
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @returns {Promise<Object>} { establishments, meta: { total, page, per_page, pages } }
 */
export const getPendingEstablishments = async ({ page = 1, perPage = 20 } = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;

    const [establishments, total] = await Promise.all([
      EstablishmentModel.getPendingEstablishments(effectivePerPage, offset),
      EstablishmentModel.countPendingEstablishments(),
    ]);

    return {
      establishments,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage),
      },
    };
  } catch (error) {
    logger.error('Error in getPendingEstablishments service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch pending establishments',
      500,
      'PENDING_FETCH_FAILED',
    );
  }
};

/**
 * Get full establishment details for moderation review
 *
 * Returns all data across the four moderation tabs:
 * - Данные (partner legal info, contacts)
 * - О заведении (description, hours, attributes)
 * - Медиа (photos, menu)
 * - Адрес (city, address, coordinates)
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<Object>} Complete establishment with media and partner docs
 */
export const getEstablishmentForModeration = async (establishmentId) => {
  try {
    // Fetch establishment (includeAll=true to see pending status)
    const establishment = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!establishment) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    // Fetch media and partner documents in parallel
    const [media, partnerDoc] = await Promise.all([
      MediaModel.getEstablishmentMedia(establishmentId),
      PartnerDocumentsModel.findByEstablishmentId(establishmentId),
    ]);

    // Organize media by type
    const interiorPhotos = media
      .filter(m => m.type === 'interior')
      .map(m => ({
        id: m.id,
        url: m.url,
        thumbnail_url: m.thumbnail_url,
        is_primary: m.is_primary,
      }));

    const menuMedia = media
      .filter(m => m.type === 'menu')
      .map(m => ({
        id: m.id,
        url: m.url,
        thumbnail_url: m.thumbnail_url,
      }));

    // Convert numeric types from PostgreSQL strings
    return {
      // Core fields
      id: establishment.id,
      partner_id: establishment.partner_id,
      name: establishment.name,
      description: establishment.description,
      status: establishment.status,

      // Address tab
      city: establishment.city,
      address: establishment.address,
      latitude: establishment.latitude ? parseFloat(establishment.latitude) : null,
      longitude: establishment.longitude ? parseFloat(establishment.longitude) : null,

      // About tab
      phone: establishment.phone,
      email: establishment.email,
      website: establishment.website,
      categories: establishment.categories,
      cuisines: establishment.cuisines,
      price_range: establishment.price_range,
      working_hours: establishment.working_hours,
      special_hours: establishment.special_hours,
      attributes: establishment.attributes,

      // Data tab (legal / partner info)
      legal_name: partnerDoc?.company_name || null,
      unp: partnerDoc?.tax_id || null,
      registration_doc_url: partnerDoc?.document_url || null,
      contact_person: partnerDoc?.contact_person || null,
      contact_email: partnerDoc?.contact_email || null,

      // Media tab
      interior_photos: interiorPhotos,
      menu_media: menuMedia,

      // Moderation metadata
      // moderation_notes is TEXT column — parse JSON string to object for API consistency
      moderation_notes: typeof establishment.moderation_notes === 'string'
        ? (() => { try { return JSON.parse(establishment.moderation_notes); } catch { return null; } })()
        : (establishment.moderation_notes || null),
      moderated_by: establishment.moderated_by,
      moderated_at: establishment.moderated_at,

      // Timestamps
      created_at: establishment.created_at,
      updated_at: establishment.updated_at,
      published_at: establishment.published_at,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Error fetching establishment for moderation', {
      error: error.message,
      establishmentId,
    });

    throw new AppError(
      'Failed to fetch establishment details',
      500,
      'ESTABLISHMENT_DETAIL_FAILED',
    );
  }
};

/**
 * Execute moderation action on a pending establishment
 *
 * Approve: status → 'active', set published_at, record audit log
 * Reject:  status → 'draft', store per-field notes, record audit log
 *
 * @param {string} establishmentId - UUID
 * @param {Object} params
 * @param {string} params.action - 'approve' or 'reject'
 * @param {Object} params.moderation_notes - Per-field comments { field_name: "comment" }
 * @param {string} params.adminUserId - UUID of the admin performing the action
 * @param {string} params.ipAddress - Request IP (for audit log)
 * @param {string} params.userAgent - Request User-Agent (for audit log)
 * @returns {Promise<Object>} Updated establishment
 */
export const moderateEstablishment = async (establishmentId, params) => {
  const { action, moderation_notes = {}, adminUserId, ipAddress, userAgent } = params;

  // Validate action
  if (!['approve', 'reject'].includes(action)) {
    throw new AppError(
      'Invalid moderation action. Must be "approve" or "reject".',
      400,
      'INVALID_MODERATION_ACTION',
    );
  }

  try {
    // Verify establishment exists and is pending
    const existing = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!existing) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    if (existing.status !== 'pending') {
      throw new AppError(
        `Cannot moderate establishment with status '${existing.status}'. Only pending establishments can be moderated.`,
        400,
        'INVALID_STATUS_FOR_MODERATION',
      );
    }

    // Determine new status and flags
    const newStatus = action === 'approve' ? 'active' : 'draft';
    const setPublishedAt = action === 'approve' && !existing.published_at;

    // Execute moderation
    const moderated = await EstablishmentModel.moderateEstablishment(
      establishmentId,
      {
        status: newStatus,
        moderated_by: adminUserId,
        moderation_notes,
        setPublishedAt,
      },
    );

    if (!moderated) {
      throw new AppError(
        'Moderation failed — establishment may have been modified concurrently',
        409,
        'MODERATION_CONFLICT',
      );
    }

    // Record audit log (non-blocking)
    await AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: `moderate_${action}`,
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: { status: existing.status },
      new_data: {
        status: newStatus,
        moderation_notes,
      },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    logger.info('Establishment moderation completed', {
      establishmentId,
      action,
      oldStatus: existing.status,
      newStatus,
      adminUserId,
    });

    return moderated;
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Unexpected error during moderation', {
      error: error.message,
      establishmentId,
      action,
    });

    throw new AppError(
      'Failed to moderate establishment',
      500,
      'MODERATION_FAILED',
    );
  }
};

// ============================================================================
// Segment C: Active, Rejected, Suspend, Unsuspend, Search
// ============================================================================

/**
 * Get paginated list of active (approved) establishments
 *
 * @param {Object} params
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @param {string} params.sort - Sort: 'newest', 'oldest', 'rating', 'views'
 * @param {string} params.city - City filter
 * @param {string} params.search - Name search (ILIKE)
 * @returns {Promise<Object>} { establishments, meta }
 */
export const getActiveEstablishments = async ({ page = 1, perPage = 20, sort, city, search } = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;
    const filters = { sort, city, search };

    const [establishments, total] = await Promise.all([
      EstablishmentModel.getActiveEstablishments(effectivePerPage, offset, filters),
      EstablishmentModel.countActiveEstablishments(filters),
    ]);

    return {
      establishments,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage) || 1,
      },
    };
  } catch (error) {
    logger.error('Error in getActiveEstablishments service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch active establishments',
      500,
      'ACTIVE_FETCH_FAILED',
    );
  }
};

/**
 * Get rejection history from audit log
 *
 * @param {Object} params
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @returns {Promise<Object>} { rejections, meta }
 */
export const getRejectedEstablishments = async ({ page = 1, perPage = 20 } = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;

    const [rejections, total] = await Promise.all([
      AuditLogModel.getRejectionHistory(effectivePerPage, offset),
      AuditLogModel.countRejections(),
    ]);

    // Normalize moderation_notes from TEXT column (string → object) for each rejection
    const normalizedRejections = rejections.map(r => ({
      ...r,
      moderation_notes: typeof r.moderation_notes === 'string'
        ? (() => { try { return JSON.parse(r.moderation_notes); } catch { return null; } })()
        : (r.moderation_notes || null),
    }));

    return {
      rejections: normalizedRejections,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage) || 1,
      },
    };
  } catch (error) {
    logger.error('Error in getRejectedEstablishments service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch rejected establishments',
      500,
      'REJECTED_FETCH_FAILED',
    );
  }
};

/**
 * Suspend an active establishment
 *
 * Changes status: active → suspended
 * Records reason in moderation_notes and audit log
 *
 * @param {string} establishmentId - UUID
 * @param {Object} params
 * @param {string} params.reason - Suspension reason
 * @param {string} params.adminUserId - Admin UUID
 * @param {string} params.ipAddress - Request IP
 * @param {string} params.userAgent - Request User-Agent
 * @returns {Promise<Object>} Updated establishment
 */
export const suspendEstablishment = async (establishmentId, params) => {
  const { reason, adminUserId, ipAddress, userAgent } = params;

  if (!reason || !reason.trim()) {
    throw new AppError(
      'Suspension reason is required',
      400,
      'REASON_REQUIRED',
    );
  }

  try {
    const existing = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!existing) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    if (existing.status !== 'active') {
      throw new AppError(
        `Cannot suspend establishment with status '${existing.status}'. Only active establishments can be suspended.`,
        400,
        'INVALID_STATUS_FOR_SUSPEND',
      );
    }

    // Merge suspend reason into existing moderation_notes
    const currentNotes = typeof existing.moderation_notes === 'string'
      ? JSON.parse(existing.moderation_notes || '{}')
      : (existing.moderation_notes || {});
    const updatedNotes = {
      ...currentNotes,
      suspend_reason: reason,
      suspended_at: new Date().toISOString(),
    };

    const updated = await EstablishmentModel.changeEstablishmentStatus(
      establishmentId,
      {
        fromStatus: 'active',
        toStatus: 'suspended',
        moderationNotes: updatedNotes,
      },
    );

    if (!updated) {
      throw new AppError(
        'Suspension failed — establishment may have been modified concurrently',
        409,
        'SUSPEND_CONFLICT',
      );
    }

    // Audit log (non-blocking)
    AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: 'suspend_establishment',
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: { status: 'active' },
      new_data: { status: 'suspended', reason },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    logger.info('Establishment suspended', {
      establishmentId,
      adminUserId,
      reason,
    });

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Unexpected error during suspension', {
      error: error.message,
      establishmentId,
    });

    throw new AppError(
      'Failed to suspend establishment',
      500,
      'SUSPEND_FAILED',
    );
  }
};

/**
 * Unsuspend (reactivate) a suspended establishment
 *
 * Changes status: suspended → active
 * Records event in audit log
 *
 * @param {string} establishmentId - UUID
 * @param {Object} params
 * @param {string} params.adminUserId - Admin UUID
 * @param {string} params.ipAddress - Request IP
 * @param {string} params.userAgent - Request User-Agent
 * @returns {Promise<Object>} Updated establishment
 */
export const unsuspendEstablishment = async (establishmentId, params) => {
  const { adminUserId, ipAddress, userAgent } = params;

  try {
    const existing = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!existing) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    if (existing.status !== 'suspended') {
      throw new AppError(
        `Cannot unsuspend establishment with status '${existing.status}'. Only suspended establishments can be reactivated.`,
        400,
        'INVALID_STATUS_FOR_UNSUSPEND',
      );
    }

    const updated = await EstablishmentModel.changeEstablishmentStatus(
      establishmentId,
      {
        fromStatus: 'suspended',
        toStatus: 'active',
      },
    );

    if (!updated) {
      throw new AppError(
        'Unsuspension failed — establishment may have been modified concurrently',
        409,
        'UNSUSPEND_CONFLICT',
      );
    }

    // Audit log (non-blocking)
    AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: 'unsuspend_establishment',
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: { status: 'suspended' },
      new_data: { status: 'active' },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    logger.info('Establishment unsuspended', {
      establishmentId,
      adminUserId,
    });

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Unexpected error during unsuspension', {
      error: error.message,
      establishmentId,
    });

    throw new AppError(
      'Failed to unsuspend establishment',
      500,
      'UNSUSPEND_FAILED',
    );
  }
};

/**
 * Get paginated list of suspended establishments
 *
 * @param {Object} params
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @returns {Promise<Object>} { establishments, meta: { total, page, per_page, pages } }
 */
export const getSuspendedEstablishments = async ({ page = 1, perPage = 20 } = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;

    const [establishments, total] = await Promise.all([
      EstablishmentModel.getSuspendedEstablishments(effectivePerPage, offset),
      EstablishmentModel.countSuspendedEstablishments(),
    ]);

    // Normalize moderation_notes from TEXT column (string → object)
    const normalizedEstablishments = establishments.map((e) => ({
      ...e,
      moderation_notes:
        typeof e.moderation_notes === 'string'
          ? (() => {
              try {
                return JSON.parse(e.moderation_notes);
              } catch {
                return null;
              }
            })()
          : e.moderation_notes || null,
    }));

    return {
      establishments: normalizedEstablishments,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage) || 1,
      },
    };
  } catch (error) {
    logger.error('Error in getSuspendedEstablishments service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch suspended establishments',
      500,
      'SUSPENDED_FETCH_FAILED',
    );
  }
};

/**
 * Update establishment coordinates (admin correction)
 *
 * Allows admin to fix geocoding errors by directly setting lat/lon.
 * Validates coordinates against Belarus bounds and city bounds.
 *
 * @param {string} establishmentId - UUID
 * @param {Object} params
 * @param {number} params.latitude - New latitude
 * @param {number} params.longitude - New longitude
 * @param {string} params.adminUserId - Admin UUID
 * @param {string} params.ipAddress - Request IP
 * @param {string} params.userAgent - Request User-Agent
 * @returns {Promise<Object>} Updated establishment
 */
export const updateEstablishmentCoordinates = async (establishmentId, params) => {
  const { latitude, longitude, adminUserId, ipAddress, userAgent } = params;

  try {
    const existing = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!existing) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    // Validate Belarus bounds
    if (latitude < BELARUS_BOUNDS.LAT_MIN || latitude > BELARUS_BOUNDS.LAT_MAX) {
      throw new AppError(
        `Latitude must be between ${BELARUS_BOUNDS.LAT_MIN} and ${BELARUS_BOUNDS.LAT_MAX} (Belarus bounds)`,
        422,
        'INVALID_LATITUDE',
      );
    }

    if (longitude < BELARUS_BOUNDS.LON_MIN || longitude > BELARUS_BOUNDS.LON_MAX) {
      throw new AppError(
        `Longitude must be between ${BELARUS_BOUNDS.LON_MIN} and ${BELARUS_BOUNDS.LON_MAX} (Belarus bounds)`,
        422,
        'INVALID_LONGITUDE',
      );
    }

    // Validate coordinates match the establishment's city
    const cityValidation = validateCityCoordinates(existing.city, latitude, longitude);
    if (!cityValidation.valid) {
      throw new AppError(
        cityValidation.message,
        422,
        'COORDINATES_CITY_MISMATCH',
      );
    }

    const updated = await EstablishmentModel.updateEstablishment(
      establishmentId,
      { latitude, longitude },
    );

    // Audit log (non-blocking)
    AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: 'admin_update_coordinates',
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: {
        latitude: existing.latitude ? parseFloat(existing.latitude) : null,
        longitude: existing.longitude ? parseFloat(existing.longitude) : null,
      },
      new_data: { latitude, longitude },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    logger.info('Admin updated establishment coordinates', {
      establishmentId,
      adminUserId,
      oldCoords: { lat: existing.latitude, lon: existing.longitude },
      newCoords: { lat: latitude, lon: longitude },
    });

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Unexpected error updating coordinates', {
      error: error.message,
      establishmentId,
    });

    throw new AppError(
      'Failed to update establishment coordinates',
      500,
      'COORDINATES_UPDATE_FAILED',
    );
  }
};

/**
 * Search establishments across all statuses
 *
 * @param {Object} params
 * @param {string} params.search - Name search (required)
 * @param {string} params.status - Optional status filter
 * @param {string} params.city - Optional city filter
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @returns {Promise<Object>} { establishments, meta }
 */
export const searchAllEstablishments = async ({ search, status, city, page = 1, perPage = 20 } = {}) => {
  if (!search || !search.trim()) {
    throw new AppError(
      'Search query is required',
      400,
      'SEARCH_REQUIRED',
    );
  }

  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;
    const filters = { status, city, limit: effectivePerPage, offset };

    const [establishments, total] = await Promise.all([
      EstablishmentModel.searchAllEstablishments(search.trim(), filters),
      EstablishmentModel.countSearchResults(search.trim(), { status, city }),
    ]);

    return {
      establishments,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage) || 1,
      },
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Error in searchAllEstablishments service', {
      error: error.message,
      search,
    });

    throw new AppError(
      'Failed to search establishments',
      500,
      'SEARCH_FAILED',
    );
  }
};
