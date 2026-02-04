/**
 * Establishment Service
 * 
 * This service implements all business logic for the establishments management system.
 * It orchestrates database operations through the model layer, enforces business rules,
 * validates ownership, and manages status transitions.
 * 
 * Architecture note: Services contain the "what" and "why" of application behavior.
 * They understand domain concepts and business rules but are independent of HTTP concerns.
 * Controllers call services, services call models.
 */

import * as EstablishmentModel from '../models/establishmentModel.js';
import * as MediaModel from '../models/mediaModel.js';
import * as PartnerDocumentsModel from '../models/partnerDocumentsModel.js';
import * as ReviewModel from '../models/reviewModel.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { upgradeUserToPartner } from './authService.js';

/**
 * Valid city values for Belarus
 */
const VALID_CITIES = ['Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Бобруйск'];

/**
 * Valid category values
 */
const VALID_CATEGORIES = [
  'Ресторан',
  'Кофейня',
  'Фаст-фуд',
  'Бар',
  'Кондитерская',
  'Пиццерия',
  'Пекарня',
  'Паб',
  'Столовая',
  'Кальян',
  'Боулинг',
  'Караоке',
  'Бильярд',
];

/**
 * Valid cuisine types
 */
const VALID_CUISINES = [
  'Народная',
  'Авторская',
  'Азиатская',
  'Американская',
  'Вегетарианская',
  'Японская',
  'Грузинская',
  'Итальянская',
  'Смешанная',
  'Континентальная',
  'Европейская',
];

/**
 * Geographic bounds for Belarus
 */
const BELARUS_BOUNDS = {
  LAT_MIN: 51.0,
  LAT_MAX: 56.0,
  LON_MIN: 23.0,
  LON_MAX: 33.0,
};

/**
 * Geographic bounds for each city (expanded to include suburbs ~15-20km from center)
 * Used to validate that coordinates match the selected city
 * Prevents obvious errors (e.g., Гродно address with Минск coordinates)
 * while allowing suburban areas like Копище, Боровляны, etc.
 */
const CITY_BOUNDS = {
  'Минск': { latMin: 53.75, latMax: 54.10, lonMin: 27.30, lonMax: 27.85 },
  'Гродно': { latMin: 53.55, latMax: 53.78, lonMin: 23.70, lonMax: 24.00 },
  'Брест': { latMin: 51.98, latMax: 52.20, lonMin: 23.55, lonMax: 23.85 },
  'Гомель': { latMin: 52.32, latMax: 52.52, lonMin: 30.85, lonMax: 31.15 },
  'Витебск': { latMin: 55.10, latMax: 55.28, lonMin: 30.05, lonMax: 30.35 },
  'Могилев': { latMin: 53.82, latMax: 54.00, lonMin: 30.20, lonMax: 30.50 },
  'Бобруйск': { latMin: 53.08, latMax: 53.22, lonMin: 29.10, lonMax: 29.40 },
};

/**
 * Validate that coordinates are within the selected city bounds
 * @param {string} city - City name
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {{ valid: boolean, message?: string }}
 */
function validateCityCoordinates(city, latitude, longitude) {
  const bounds = CITY_BOUNDS[city];
  if (!bounds) {
    // City not in bounds list, skip city-specific validation
    return { valid: true };
  }

  const isWithinCity =
    latitude >= bounds.latMin && latitude <= bounds.latMax &&
    longitude >= bounds.lonMin && longitude <= bounds.lonMax;

  if (!isWithinCity) {
    return {
      valid: false,
      message: `Coordinates (${latitude}, ${longitude}) are outside ${city} city bounds. ` +
        `Expected: lat ${bounds.latMin}-${bounds.latMax}, lon ${bounds.lonMin}-${bounds.lonMax}. ` +
        `Please verify the address and coordinates match the selected city.`,
    };
  }

  return { valid: true };
}

/**
 * Create a new establishment
 * 
 * This is the core business operation that implements the complete establishment
 * creation workflow with all necessary validations.
 * 
 * Business rules enforced:
 * - Partner must have 'partner' role (verified by middleware before this)
 * - All required fields must be present and valid
 * - Categories array must have 1-2 items, all valid
 * - Cuisines array must have 1-3 items, all valid
 * - Coordinates must be within Belarus geographic bounds
 * - Establishment name must be unique for this partner
 * - Initial status is 'draft' to allow incremental building
 * 
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {Object} establishmentData - Establishment data from request
 * @returns {Promise<Object>} Created establishment object
 * @throws {AppError} If validation fails or business rules violated
 */
export const createEstablishment = async (partnerId, establishmentData) => {
  const {
    name,
    description,
    city,
    address,
    latitude,
    longitude,
    phone,
    email,
    website,
    categories,
    cuisines,
    price_range,
    working_hours,
    special_hours,
    attributes,
    primary_photo,
    interior_photos,
    menu_photos,
    legal_name,
    unp,
    contact_person,
    contact_email,
  } = establishmentData;

  try {
    // Validate city
    if (!VALID_CITIES.includes(city)) {
      throw new AppError(
        `Invalid city. Must be one of: ${VALID_CITIES.join(', ')}`,
        422,
        'INVALID_CITY',
      );
    }

    // Validate categories array
    if (!Array.isArray(categories) || categories.length < 1 || categories.length > 2) {
      throw new AppError(
        'Categories must be an array with 1-2 items',
        422,
        'INVALID_CATEGORIES_LENGTH',
      );
    }

    const invalidCategories = categories.filter(cat => !VALID_CATEGORIES.includes(cat));
    if (invalidCategories.length > 0) {
      throw new AppError(
        `Invalid categories: ${invalidCategories.join(', ')}. Valid categories: ${VALID_CATEGORIES.join(', ')}`,
        422,
        'INVALID_CATEGORY_VALUE',
      );
    }

    // Validate cuisines array
    if (!Array.isArray(cuisines) || cuisines.length < 1 || cuisines.length > 3) {
      throw new AppError(
        'Cuisines must be an array with 1-3 items',
        422,
        'INVALID_CUISINES_LENGTH',
      );
    }

    const invalidCuisines = cuisines.filter(cuisine => !VALID_CUISINES.includes(cuisine));
    if (invalidCuisines.length > 0) {
      throw new AppError(
        `Invalid cuisines: ${invalidCuisines.join(', ')}. Valid cuisines: ${VALID_CUISINES.join(', ')}`,
        422,
        'INVALID_CUISINE_VALUE',
      );
    }

    // Validate geographic coordinates are within Belarus bounds
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

    // Validate coordinates match the selected city
    const cityValidation = validateCityCoordinates(city, latitude, longitude);
    if (!cityValidation.valid) {
      throw new AppError(
        cityValidation.message,
        422,
        'COORDINATES_CITY_MISMATCH',
      );
    }

    // Check for duplicate name
    const isDuplicate = await EstablishmentModel.checkDuplicateName(partnerId, name);
    if (isDuplicate) {
      throw new AppError(
        'You already have an establishment with this name',
        409,
        'DUPLICATE_ESTABLISHMENT',
      );
    }

    // Create establishment in database
    const establishment = await EstablishmentModel.createEstablishment({
      partner_id: partnerId,
      name,
      description,
      city,
      address,
      latitude,
      longitude,
      phone,
      email,
      website,
      categories,
      cuisines,
      price_range,
      working_hours,
      special_hours,
      attributes,
      primary_image_url: primary_photo,
    });

    // Save photos to establishment_media table
    const allPhotos = [];

    // Add interior photos
    if (Array.isArray(interior_photos) && interior_photos.length > 0) {
      interior_photos.forEach((url, index) => {
        allPhotos.push({
          url,
          type: 'interior',
          position: index,
          is_primary: url === primary_photo,
        });
      });
    }

    // Add menu photos
    if (Array.isArray(menu_photos) && menu_photos.length > 0) {
      menu_photos.forEach((url, index) => {
        allPhotos.push({
          url,
          type: 'menu',
          position: index,
          is_primary: url === primary_photo,
        });
      });
    }

    // Insert all photos into establishment_media
    if (allPhotos.length > 0) {
      const mediaPromises = allPhotos.map(photo =>
        MediaModel.createMedia({
          establishment_id: establishment.id,
          type: photo.type,
          url: photo.url,
          thumbnail_url: photo.url, // Same URL for now, Cloudinary handles resizing via URL params
          preview_url: photo.url,
          position: photo.position,
          is_primary: photo.is_primary,
        })
      );

      await Promise.all(mediaPromises);

      logger.info('Media saved to establishment_media', {
        establishmentId: establishment.id,
        interiorCount: interior_photos?.length || 0,
        menuCount: menu_photos?.length || 0,
      });
    }

    // Save legal fields to partner_documents if provided
    if (legal_name || unp || contact_person || contact_email) {
      try {
        await PartnerDocumentsModel.createPartnerDocument({
          partner_id: partnerId,
          establishment_id: establishment.id,
          company_name: legal_name,
          tax_id: unp,
          contact_person,
          contact_email,
        });

        logger.info('Partner documents saved', {
          establishmentId: establishment.id,
          partnerId,
        });
      } catch (docError) {
        // Log but don't fail establishment creation
        logger.error('Failed to save partner documents', {
          error: docError.message,
          establishmentId: establishment.id,
          partnerId,
        });
      }
    }

    // Auto-upgrade user to partner role if this is their first establishment
    // This enables the partner registration flow where regular users can become partners
    try {
      await upgradeUserToPartner(partnerId);
    } catch (upgradeError) {
      // Log but don't fail the establishment creation
      // User might already be a partner or admin
      logger.warn('Could not upgrade user role', {
        partnerId,
        error: upgradeError.message,
      });
    }

    logger.info('Establishment created successfully', {
      establishmentId: establishment.id,
      partnerId,
      name,
      city,
    });

    return establishment;
  } catch (error) {
    // Re-throw if it's already an AppError
    if (error instanceof AppError) {
      throw error;
    }

    // Handle database-specific errors
    if (error.code === '23505') {
      // Unique constraint violation
      throw new AppError(
        'An establishment with this information already exists',
        409,
        'DUPLICATE_ESTABLISHMENT',
      );
    }

    if (error.code === '23514') {
      // Check constraint violation (enum values, etc.)
      throw new AppError(
        'Establishment data violates database constraints',
        422,
        'CONSTRAINT_VIOLATION',
      );
    }

    // Log unexpected errors
    logger.error('Unexpected error creating establishment', {
      error: error.message,
      stack: error.stack,
      partnerId,
    });

    throw new AppError(
      'Failed to create establishment',
      500,
      'ESTABLISHMENT_CREATE_FAILED',
    );
  }
};

/**
 * Get all establishments for a partner
 * 
 * Supports pagination and filtering by status for the partner dashboard.
 * 
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {Object} filters - Filter options
 * @param {string} filters.status - Optional status filter
 * @param {number} filters.page - Page number (default: 1)
 * @param {number} filters.limit - Items per page (default: 20, max: 50)
 * @returns {Promise<Object>} Object with establishments array and pagination metadata
 */
export const getPartnerEstablishments = async (partnerId, filters = {}) => {
  try {
    const {
      status,
      page = 1,
      limit = 20,
    } = filters;

    // Enforce maximum limit
    const effectiveLimit = Math.min(limit, 50);

    // Calculate offset for pagination
    const offset = (page - 1) * effectiveLimit;

    // Fetch establishments
    const establishments = await EstablishmentModel.getEstablishmentsByPartner(
      partnerId,
      {
        status,
        limit: effectiveLimit,
        offset,
      },
    );

    // Get total count for pagination metadata
    const total = await EstablishmentModel.countPartnerEstablishments(partnerId, status);

    // Calculate total pages
    const totalPages = Math.ceil(total / effectiveLimit);

    logger.debug('Fetched partner establishments', {
      partnerId,
      count: establishments.length,
      total,
      page,
      totalPages,
    });

    return {
      establishments,
      meta: {
        total,
        page,
        limit: effectiveLimit,
        pages: totalPages,
      },
    };
  } catch (error) {
    logger.error('Error fetching partner establishments', {
      error: error.message,
      partnerId,
    });

    throw new AppError(
      'Failed to fetch establishments',
      500,
      'ESTABLISHMENTS_FETCH_FAILED',
    );
  }
};

/**
 * Get a single establishment by ID
 * 
 * Verifies ownership before returning data. This ensures partners can only
 * view detailed information about their own establishments.
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} partnerId - UUID of the authenticated partner
 * @returns {Promise<Object>} Complete establishment object
 * @throws {AppError} If establishment not found or doesn't belong to partner
 */
export const getEstablishmentById = async (establishmentId, partnerId) => {
  try {
    // Check ownership first
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Establishment not found or access denied',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    // Fetch establishment
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);

    if (!establishment) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    // Fetch media, partner documents, and rating distribution in parallel
    const [media, partnerDoc, ratingDistribution] = await Promise.all([
      MediaModel.getEstablishmentMedia(establishmentId),
      PartnerDocumentsModel.findByEstablishmentId(establishmentId),
      ReviewModel.getRatingDistribution(establishmentId),
    ]);

    // Map media to frontend-expected format
    const primaryMedia = media.find(m => m.is_primary);
    const interiorPhotos = media.filter(m => m.type === 'interior').map(m => m.url);
    const menuPhotos = media.filter(m => m.type === 'menu').map(m => m.url);

    // Convert numeric types from PostgreSQL strings to numbers
    return {
      ...establishment,
      latitude: establishment.latitude ? parseFloat(establishment.latitude) : establishment.latitude,
      longitude: establishment.longitude ? parseFloat(establishment.longitude) : establishment.longitude,
      average_rating: establishment.average_rating ? parseFloat(establishment.average_rating) : establishment.average_rating,
      primary_photo: primaryMedia ? { url: primaryMedia.url, thumbnail_url: primaryMedia.thumbnail_url } : null,
      interior_photos: interiorPhotos,
      menu_photos: menuPhotos,
      // Rating distribution for statistics screen
      rating_distribution: ratingDistribution,
      // Legal fields mapped back to frontend naming
      legal_name: partnerDoc?.company_name || null,
      unp: partnerDoc?.tax_id || null,
      contact_person: partnerDoc?.contact_person || null,
      contact_email: partnerDoc?.contact_email || null,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error('Error fetching establishment by ID', {
      error: error.message,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to fetch establishment',
      500,
      'ESTABLISHMENT_FETCH_FAILED',
    );
  }
};

/**
 * Update an establishment
 * 
 * Business rules for updates:
 * - Partner must own the establishment
 * - Cannot update if status is 'suspended' (admin-only change)
 * - Major changes (name, categories, cuisines) require status reset to 'pending' if currently 'active'
 * - Minor changes (hours, description, contact) don't require re-moderation
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated establishment object
 * @throws {AppError} If validation fails or unauthorized
 */
export const updateEstablishment = async (establishmentId, partnerId, updates) => {
  try {
    // Check ownership
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Access denied. You can only update your own establishments.',
        403,
        'FORBIDDEN',
      );
    }

    // Fetch current establishment to check status and for comparison
    const currentEstablishment = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!currentEstablishment) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    // Cannot update suspended establishments (admin-only)
    if (currentEstablishment.status === 'suspended') {
      throw new AppError(
        'Cannot update suspended establishment. Contact support.',
        403,
        'ESTABLISHMENT_SUSPENDED',
      );
    }

    // Validate updates if provided
    if (updates.categories !== undefined) {
      if (!Array.isArray(updates.categories) || updates.categories.length < 1 || updates.categories.length > 2) {
        throw new AppError(
          'Categories must be an array with 1-2 items',
          422,
          'INVALID_CATEGORIES_LENGTH',
        );
      }

      const invalidCategories = updates.categories.filter(cat => !VALID_CATEGORIES.includes(cat));
      if (invalidCategories.length > 0) {
        throw new AppError(
          `Invalid categories: ${invalidCategories.join(', ')}`,
          422,
          'INVALID_CATEGORY_VALUE',
        );
      }
    }

    if (updates.cuisines !== undefined) {
      if (!Array.isArray(updates.cuisines) || updates.cuisines.length < 1 || updates.cuisines.length > 3) {
        throw new AppError(
          'Cuisines must be an array with 1-3 items',
          422,
          'INVALID_CUISINES_LENGTH',
        );
      }

      const invalidCuisines = updates.cuisines.filter(cuisine => !VALID_CUISINES.includes(cuisine));
      if (invalidCuisines.length > 0) {
        throw new AppError(
          `Invalid cuisines: ${invalidCuisines.join(', ')}`,
          422,
          'INVALID_CUISINE_VALUE',
        );
      }
    }

    // Validate city if being updated
    if (updates.city !== undefined && !VALID_CITIES.includes(updates.city)) {
      throw new AppError(
        `Invalid city. Must be one of: ${VALID_CITIES.join(', ')}`,
        422,
        'INVALID_CITY',
      );
    }

    // Validate coordinates match city when either coordinates or city are updated
    const hasCoordinateUpdate = updates.latitude !== undefined || updates.longitude !== undefined;
    const hasCityUpdate = updates.city !== undefined;

    if (hasCoordinateUpdate || hasCityUpdate) {
      // Use updated values or fall back to current values
      const effectiveCity = updates.city ?? currentEstablishment.city;
      const effectiveLat = updates.latitude !== undefined
        ? parseFloat(updates.latitude)
        : parseFloat(currentEstablishment.latitude);
      const effectiveLon = updates.longitude !== undefined
        ? parseFloat(updates.longitude)
        : parseFloat(currentEstablishment.longitude);

      // Validate Belarus bounds for coordinates
      if (updates.latitude !== undefined) {
        if (effectiveLat < BELARUS_BOUNDS.LAT_MIN || effectiveLat > BELARUS_BOUNDS.LAT_MAX) {
          throw new AppError(
            `Latitude must be between ${BELARUS_BOUNDS.LAT_MIN} and ${BELARUS_BOUNDS.LAT_MAX} (Belarus bounds)`,
            422,
            'INVALID_LATITUDE',
          );
        }
      }

      if (updates.longitude !== undefined) {
        if (effectiveLon < BELARUS_BOUNDS.LON_MIN || effectiveLon > BELARUS_BOUNDS.LON_MAX) {
          throw new AppError(
            `Longitude must be between ${BELARUS_BOUNDS.LON_MIN} and ${BELARUS_BOUNDS.LON_MAX} (Belarus bounds)`,
            422,
            'INVALID_LONGITUDE',
          );
        }
      }

      // Validate coordinates match city
      const cityValidation = validateCityCoordinates(effectiveCity, effectiveLat, effectiveLon);
      if (!cityValidation.valid) {
        throw new AppError(
          cityValidation.message,
          422,
          'COORDINATES_CITY_MISMATCH',
        );
      }
    }

    // Check if name is being changed and if it's a duplicate
    if (updates.name !== undefined && updates.name !== currentEstablishment.name) {
      const isDuplicate = await EstablishmentModel.checkDuplicateName(
        partnerId,
        updates.name,
        establishmentId,
      );
      if (isDuplicate) {
        throw new AppError(
          'You already have an establishment with this name',
          409,
          'DUPLICATE_ESTABLISHMENT',
        );
      }
    }

    // Determine if major fields are being changed
    const majorFieldsChanged =
      (updates.name !== undefined && updates.name !== currentEstablishment.name) ||
      (updates.categories !== undefined) ||
      (updates.cuisines !== undefined);

    // If currently 'active' and major fields changed, reset to 'pending'
    if (currentEstablishment.status === 'active' && majorFieldsChanged) {
      updates.status = 'pending';
      
      logger.info('Major fields updated, status reset to pending', {
        establishmentId,
        partnerId,
        changedFields: Object.keys(updates),
      });
    }

    // Prevent partners from changing status directly (except through major field changes above)
    // Status changes should only come from admin moderation or submission workflow
    if (updates.status !== undefined && updates.status !== 'pending' && !majorFieldsChanged) {
      delete updates.status;
      
      logger.warn('Partner attempted to change status directly', {
        establishmentId,
        partnerId,
        attemptedStatus: updates.status,
      });
    }

    // Handle features and capacity - store in attributes JSONB field for compatibility
    if (updates.features !== undefined || updates.capacity !== undefined) {
      if (!updates.attributes) {
        updates.attributes = {};
      }
      if (updates.features !== undefined) {
        updates.attributes.features = updates.features;
        delete updates.features;
      }
      if (updates.capacity !== undefined) {
        updates.attributes.capacity = updates.capacity;
        delete updates.capacity;
      }
    }

    // Sync media if interior_photos or menu_photos are provided
    const hasMediaUpdates = updates.interior_photos !== undefined || updates.menu_photos !== undefined;
    if (hasMediaUpdates) {
      const existingMedia = await MediaModel.getEstablishmentMedia(establishmentId);
      const primaryPhotoUrl = updates.primary_photo || null;

      // Sync each media type
      for (const [field, type] of [['interior_photos', 'interior'], ['menu_photos', 'menu']]) {
        if (updates[field] === undefined) continue;

        const newUrls = updates[field] || [];
        const existingOfType = existingMedia.filter(m => m.type === type);
        const existingUrls = existingOfType.map(m => m.url);

        // Delete removed media
        const toDelete = existingOfType.filter(m => !newUrls.includes(m.url));
        for (const media of toDelete) {
          await MediaModel.deleteMedia(media.id);
        }

        // Insert new media
        const toInsert = newUrls.filter(url => !existingUrls.includes(url));
        for (let i = 0; i < toInsert.length; i++) {
          await MediaModel.createMedia({
            establishment_id: establishmentId,
            type,
            url: toInsert[i],
            thumbnail_url: toInsert[i],
            preview_url: toInsert[i],
            position: existingOfType.length + i,
            is_primary: toInsert[i] === primaryPhotoUrl,
          });
        }

        // Update primary flag if needed
        if (primaryPhotoUrl) {
          const keptOfType = existingOfType.filter(m => newUrls.includes(m.url));
          for (const media of keptOfType) {
            if ((media.url === primaryPhotoUrl) !== media.is_primary) {
              await MediaModel.updateMedia(media.id, { is_primary: media.url === primaryPhotoUrl });
            }
          }
        }
      }

      // Clean media fields from updates before sending to model (not DB columns)
      delete updates.interior_photos;
      delete updates.menu_photos;
      delete updates.primary_photo;

      logger.info('Media synced for establishment', {
        establishmentId,
      });
    }

    // Sync legal fields to partner_documents
    const hasLegalUpdates = updates.legal_name !== undefined || updates.unp !== undefined ||
      updates.contact_person !== undefined || updates.contact_email !== undefined;

    if (hasLegalUpdates) {
      const legalData = {
        company_name: updates.legal_name,
        tax_id: updates.unp,
        contact_person: updates.contact_person,
        contact_email: updates.contact_email,
      };

      // Try update first, create if no record exists
      const existing = await PartnerDocumentsModel.findByEstablishmentId(establishmentId);
      if (existing) {
        await PartnerDocumentsModel.updateByEstablishmentId(establishmentId, legalData);
      } else {
        await PartnerDocumentsModel.createPartnerDocument({
          partner_id: partnerId,
          establishment_id: establishmentId,
          ...legalData,
        });
      }

      logger.info('Partner documents synced on update', {
        establishmentId,
        partnerId,
      });
    }

    // Clean legal fields before sending to establishment model (not DB columns on establishments table)
    delete updates.legal_name;
    delete updates.unp;
    delete updates.contact_person;
    delete updates.contact_email;

    // Update establishment
    const updatedEstablishment = await EstablishmentModel.updateEstablishment(
      establishmentId,
      updates,
    );

    // Extract features and capacity from attributes for response compatibility
    if (updatedEstablishment.attributes) {
      if (updatedEstablishment.attributes.features) {
        updatedEstablishment.features = updatedEstablishment.attributes.features;
      }
      if (updatedEstablishment.attributes.capacity) {
        updatedEstablishment.capacity = updatedEstablishment.attributes.capacity;
      }
    }

    logger.info('Establishment updated successfully', {
      establishmentId,
      partnerId,
      updatedFields: Object.keys(updates),
      newStatus: updatedEstablishment.status,
    });

    return updatedEstablishment;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    // Handle database-specific errors
    if (error.code === '23514') {
      throw new AppError(
        'Establishment data violates database constraints',
        422,
        'CONSTRAINT_VIOLATION',
      );
    }

    logger.error('Unexpected error updating establishment', {
      error: error.message,
      stack: error.stack,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to update establishment',
      500,
      'ESTABLISHMENT_UPDATE_FAILED',
    );
  }
};

/**
 * Submit establishment for moderation
 * 
 * Pre-submission validation ensures establishment is ready for review:
 * - Must be in 'draft' status
 * - All required fields complete
 * - At least 1 interior photo uploaded (checked by service)
 * - At least 1 menu photo uploaded (checked by service)
 * - Primary photo is set (checked by service)
 * 
 * Note: Media validation will be implemented in Phase Two when media service exists
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} partnerId - UUID of the authenticated partner
 * @returns {Promise<Object>} Updated establishment with 'pending' status
 * @throws {AppError} If validation fails or unauthorized
 */
export const submitEstablishmentForModeration = async (establishmentId, partnerId) => {
  try {
    // Check ownership
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Access denied. You can only update your own establishments.',
        403,
        'FORBIDDEN',
      );
    }

    // Fetch establishment to validate status
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);

    if (!establishment) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    // Must be in 'draft' status to submit
    if (establishment.status !== 'draft') {
      throw new AppError(
        `Cannot submit establishment with status '${establishment.status}'. Only draft establishments can be submitted.`,
        400,
        'INVALID_STATUS_FOR_SUBMISSION',
      );
    }

    // Validate all required fields are complete
    const missingFields = [];

    if (!establishment.name) missingFields.push('name');
    if (!establishment.city) missingFields.push('city');
    if (!establishment.address) missingFields.push('address');
    if (!establishment.latitude || !establishment.longitude) missingFields.push('coordinates');
    if (!establishment.categories || establishment.categories.length === 0) missingFields.push('categories');
    if (!establishment.cuisines || establishment.cuisines.length === 0) missingFields.push('cuisines');
    if (!establishment.working_hours) missingFields.push('working_hours');

    if (missingFields.length > 0) {
      throw new AppError(
        `Missing required fields: ${missingFields.join(', ')}`,
        400,
        'INCOMPLETE_ESTABLISHMENT',
      );
    }

    // TODO: Validate media requirements (Phase Two)
    // - At least 1 interior photo
    // - At least 1 menu photo
    // - Primary photo is set
    // This will be added when media service is implemented

    // Submit for moderation (change status to 'pending')
    const submittedEstablishment = await EstablishmentModel.submitForModeration(establishmentId);

    logger.info('Establishment submitted for moderation', {
      establishmentId,
      partnerId,
      name: establishment.name,
    });

    return submittedEstablishment;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error('Unexpected error submitting establishment for moderation', {
      error: error.message,
      stack: error.stack,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to submit establishment for moderation',
      500,
      'ESTABLISHMENT_SUBMIT_FAILED',
    );
  }
};

