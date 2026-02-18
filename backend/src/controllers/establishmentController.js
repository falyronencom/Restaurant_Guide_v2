/**
 * Establishment Controller
 * 
 * This controller handles HTTP requests and responses for the establishments
 * management system. It provides a thin layer between HTTP and business logic,
 * extracting data from requests, calling service methods, and formatting responses.
 * 
 * Architecture note: Controllers should be thin orchestration layers. They parse
 * requests, delegate to services, and format responses. Business logic lives in
 * the service layer, not here.
 */

import * as EstablishmentService from '../services/establishmentService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.js';

/**
 * Create a new establishment
 * 
 * POST /api/v1/partner/establishments
 * 
 * This endpoint allows authenticated partners to create new establishment listings.
 * The partner_id comes from the authenticated context (JWT token), not the request body.
 * This prevents partners from impersonating other partners by specifying different IDs.
 * 
 * Request body requirements are enforced by validation middleware before this
 * controller executes. By the time we reach this code, we know the data is valid.
 * 
 * The service layer handles all business logic including validation, duplicate
 * detection, and geographic bounds checking.
 */
export const createEstablishment = asyncHandler(async (req, res) => {
  // Extract establishment data from request body
  const establishmentData = req.body;

  // Get authenticated partner ID from JWT token (set by authenticate middleware)
  // Never trust partner_id from request body - always use authenticated context
  const partnerId = req.user.userId;
  const originalRole = req.user.role;

  // Call service layer to create establishment with business logic
  const establishment = await EstablishmentService.createEstablishment(
    partnerId,
    establishmentData,
  );

  // Log successful establishment creation for monitoring
  logger.info('Establishment created via API', {
    establishmentId: establishment.id,
    partnerId,
    name: establishment.name,
    city: establishment.city,
    endpoint: 'POST /api/v1/partner/establishments',
  });

  // Build response
  const response = {
    success: true,
    data: {
      establishment,
    },
    message: 'Establishment created successfully in draft status',
  };

  // If user was upgraded from 'user' to 'partner', generate new tokens
  // This allows the client to immediately use partner-only endpoints
  if (originalRole === 'user') {
    const tokenPayload = {
      userId: partnerId,
      email: req.user.email,
      role: 'partner', // New role after upgrade
    };

    response.data.tokens = {
      accessToken: generateAccessToken(tokenPayload),
      refreshToken: generateRefreshToken(tokenPayload),
    };

    logger.info('Generated new tokens for upgraded user', {
      partnerId,
      previousRole: originalRole,
      newRole: 'partner',
    });
  }

  // Return 201 Created with the full establishment object (and new tokens if upgraded)
  res.status(201).json(response);
});

/**
 * Get all establishments for the authenticated partner
 * 
 * GET /api/v1/partner/establishments
 * 
 * Supports pagination and filtering by status for the partner dashboard.
 * Query parameters:
 * - status: Optional filter ('draft', 'pending', 'active', 'suspended')
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 50)
 * 
 * Returns establishments with basic information and primary photo for list view.
 */
export const listPartnerEstablishments = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;

  // Extract query parameters (validated by middleware)
  const filters = {
    status: req.query.status,
    page: parseInt(req.query.page, 10) || 1,
    limit: parseInt(req.query.limit, 10) || 20,
  };

  // Call service layer to fetch establishments
  const result = await EstablishmentService.getPartnerEstablishments(partnerId, filters);

  logger.info('Partner establishments fetched via API', {
    partnerId,
    count: result.establishments.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/partner/establishments',
  });

  // Return establishments with pagination metadata
  res.status(200).json({
    success: true,
    data: {
      establishments: result.establishments,
      pagination: result.meta,
    },
  });
});

/**
 * Get a specific establishment by ID
 * 
 * GET /api/v1/partner/establishments/:id
 * 
 * Returns complete establishment details for the partner's editing interface.
 * The service layer verifies the authenticated partner is the establishment owner
 * before returning data.
 */
export const getEstablishmentDetails = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;

  // Call service layer which verifies ownership and fetches data
  const establishment = await EstablishmentService.getEstablishmentById(
    establishmentId,
    partnerId,
  );

  logger.info('Establishment details fetched via API', {
    establishmentId,
    partnerId,
    endpoint: 'GET /api/v1/partner/establishments/:id',
  });

  // Return complete establishment object
  res.status(200).json({
    success: true,
    data: {
      establishment,
    },
  });
});

/**
 * Update an existing establishment
 * 
 * PUT /api/v1/partner/establishments/:id
 * 
 * Allows partners to modify their establishment details. The service layer
 * enforces business rules about which fields can be updated and handles
 * status transitions (e.g., major changes require re-moderation).
 * 
 * Partners cannot update:
 * - status (admin-only, except automatic reset to 'pending' on major changes)
 * - partner_id (immutable)
 * - city, latitude, longitude (requires new submission)
 * - Metric fields (maintained by system)
 * - Subscription fields (handled by subscription system)
 */
export const updateEstablishment = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;
  const updates = req.body;

  // Call service layer which verifies ownership and applies business rules
  const updatedEstablishment = await EstablishmentService.updateEstablishment(
    establishmentId,
    partnerId,
    updates,
  );

  logger.info('Establishment updated via API', {
    establishmentId,
    partnerId,
    updatedFields: Object.keys(updates),
    newStatus: updatedEstablishment.status,
    endpoint: 'PUT /api/v1/partner/establishments/:id',
  });

  // Return updated establishment
  res.status(200).json({
    success: true,
    data: {
      establishment: updatedEstablishment,
    },
    message: 'Establishment updated successfully',
  });
});

/**
 * Submit establishment for moderation
 * 
 * POST /api/v1/partner/establishments/:id/submit
 * 
 * When partner completes their draft establishment, they submit it for admin
 * review. The service layer validates that:
 * - Establishment is in 'draft' status
 * - All required fields are complete
 * - Required media is uploaded (Phase Two requirement)
 * 
 * On success, status changes from 'draft' to 'pending'.
 */
export const submitForModeration = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;

  // Call service layer which validates and submits
  const submittedEstablishment = await EstablishmentService.submitEstablishmentForModeration(
    establishmentId,
    partnerId,
  );

  logger.info('Establishment submitted for moderation via API', {
    establishmentId,
    partnerId,
    endpoint: 'POST /api/v1/partner/establishments/:id/submit',
  });

  // Return success with new status
  res.status(200).json({
    success: true,
    data: {
      establishment: {
        id: submittedEstablishment.id,
        status: submittedEstablishment.status,
        submitted_at: submittedEstablishment.updated_at,
      },
    },
    message: 'Establishment submitted for moderation review',
  });
});

/**
 * Suspend an establishment (partner action)
 * POST /api/v1/partner/establishments/:id/suspend
 */
export const suspendEstablishment = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;

  const result = await EstablishmentService.suspendEstablishment(establishmentId, partnerId);

  logger.info('Establishment suspended via API', { establishmentId, partnerId });

  res.status(200).json({
    success: true,
    data: { establishment: result },
    message: 'Establishment suspended',
  });
});

/**
 * Resume an establishment (partner action, goes to pending for re-moderation)
 * POST /api/v1/partner/establishments/:id/resume
 */
export const resumeEstablishment = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;

  const result = await EstablishmentService.resumeEstablishment(establishmentId, partnerId);

  logger.info('Establishment resume requested via API', { establishmentId, partnerId });

  res.status(200).json({
    success: true,
    data: { establishment: result },
    message: 'Establishment submitted for re-moderation',
  });
});

/**
 * Delete an establishment permanently (partner action)
 * DELETE /api/v1/partner/establishments/:id
 */
export const deleteEstablishment = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;

  const result = await EstablishmentService.deleteEstablishment(establishmentId, partnerId);

  logger.info('Establishment deleted via API', { establishmentId, partnerId, name: result.name });

  res.status(200).json({
    success: true,
    data: { id: result.id, name: result.name },
    message: 'Establishment deleted permanently',
  });
});

