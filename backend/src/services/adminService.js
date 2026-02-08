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
      moderation_notes: establishment.moderation_notes,
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
