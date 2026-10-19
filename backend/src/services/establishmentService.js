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
import {
  hasModeratorSuspensionMarks,
  isModeratorSuspension,
  parseModerationNotes,
  withoutModeratorSuspension,
} from '../utils/moderationNotes.js';
import { generateUniqueSlug } from '../utils/slugGenerator.js';
import { upgradeUserToPartner } from './authService.js';
import { MAX_PDFS_PER_ESTABLISHMENT, MEDIA_LIMITS } from './mediaService.js';
import { enqueueWithinDailyAllowance } from './ocrAllowance.js';
import { VALID_CATEGORIES, VALID_CUISINES, isCuisineRequired } from '../constants/establishmentVocab.js';
import { ESTABLISHMENT_REFUSALS } from '../constants/establishmentRefusals.js';
import {
  extractPublicIdFromUrl,
  fileExtension,
  generatePdfThumbnailUrl,
  generatePdfPreviewUrl,
  hasPlainTransformations,
  hasValidImageExtension,
  hasValidPdfExtension,
  isOwnedAsset,
  ownCloudPublicId,
  ownedFolders,
} from '../config/cloudinary.js';

/**
 * Whether a link names a PDF's file on our cloud: uploadPdf files every PDF —
 * a card's and a partner's temp upload alike — in a menu_pdf/ folder.
 */
const namesPdfFile = (url) => /\/menu_pdf\/[^/]+$/.test(ownCloudPublicId(url) ?? '');

/**
 * Reject media URLs whose file extension is outside the allow-list, BEFORE any
 * DB write. The upload endpoints gate by extension too, but the create/update
 * payloads carry raw URLs, so this is the authoritative check for what lands in
 * establishment_media. A URL that slips through untyped (e.g. a PDF-compatible
 * .ai reported as application/pdf — MARKS, 2026-07-20) renders as a broken
 * image in every consumer.
 */
function assertValidMediaUrlExtensions(urls, { allowImage = true, allowPdf = false }) {
  for (const url of urls) {
    // Canonical image delivery URLs from generateAllResolutions carry NO
    // extension (cloudinary.url() without `format`) — that shape is
    // system-generated and valid for image buckets. An extension, when
    // present, must be on the allow-list (rejects .ai/.txt — MARKS). PDF
    // URLs (uploadPdf secure_url) always carry .pdf, so the pdf-only bucket
    // keeps requiring it — and so does a link to a PDF's file anywhere: our
    // uploads keep PDFs in menu_pdf/ folders, and such a file named without an
    // extension is delivered as the PDF itself, which as a «photo» would be
    // stored and recognised whole, past the PDF limit and the page limit
    // (review of PR #56 by the lens, finding 2b). One page drawn as a picture
    // (.jpg) stays a photo.
    const extensionless = fileExtension(url) === '' && !namesPdfFile(url);
    const valid = (allowImage && (extensionless || hasValidImageExtension(url)))
      || (allowPdf && hasValidPdfExtension(url));
    if (!valid) {
      throw new AppError(ESTABLISHMENT_REFUSALS.invalidFileType, 422, 'INVALID_FILE_TYPE');
    }
  }
}

/**
 * Why `link` may not be attached by a caller owning `folders`, or null when it
 * may: a delivery URL on our cloud, showing only its own asset (an overlay or a
 * fetched layer would put another picture into a link to the partner's file),
 * and that asset inside the given folders. The checks read the resolved host
 * and path, while the link is stored as sent and the update path builds the
 * PDF previews from its text, so the link must be exactly the address they
 * read: no dot segment the parser resolves (`l_text:…,co_red/../v1/…` keeps in
 * the stored text a layer no check has seen), no fragment (`own.pdf#/../../l_…`
 * is outside every check, and a preview built from that text resolves it into
 * a layer) and no user part. The query stays: our links carry `?_a=`, and
 * nothing reads it.
 */
const mediaLinkRefusal = (link, folders) => {
  const publicId = ownCloudPublicId(link);
  if (publicId === null) return 'not_our_cloud';
  const { origin, pathname, search } = new URL(link);
  if (`${origin}${pathname}${search}` !== link) return 'not_canonical';
  if (!hasPlainTransformations(link)) return 'transformation_not_allowed';
  if (!isOwnedAsset(publicId, folders)) return 'outside_own_folders';
  return null;
};

/**
 * Reject media links that are not the caller's own uploads, BEFORE any DB write
 * (review 02.10.2026, N3, second half). The create/update payloads carry raw
 * URLs, and our upload routes file every asset under its owner's folder (the
 * folder layout is the ownership record — config/cloudinary.js), so a link
 * outside the given folders is someone else's file or another host. Attached to
 * a card it would show in the catalog: an edit of an active card goes live
 * without moderation. The log names the bucket and the reason, never the link —
 * it is client-supplied text. Decision of the Coordinator, 06.10.2026: such a
 * save is refused, not trimmed silently.
 *
 * @param {Object<string, Array>} linksByBucket - Links keyed by the bucket named in the log
 * @param {string[]} folders - The caller's own folders, built with ownedFolders
 * @param {Object} logContext - Server-known ids for the refusal log
 */
function assertOwnMediaUrls(linksByBucket, folders, logContext) {
  for (const [bucket, links] of Object.entries(linksByBucket)) {
    for (const link of links) {
      const reason = mediaLinkRefusal(link, folders);
      if (reason === null) continue;
      logger.warn('Media link refused: not among the partner\'s own uploads', {
        ...logContext,
        bucket,
        reason,
      });
      throw new AppError(ESTABLISHMENT_REFUSALS.mediaNotOwned, 422, 'MEDIA_URL_NOT_OWNED');
    }
  }
}

/** Optional single links (cover, PDF previews): absent when undefined, null or ''. */
const presentLinks = (...links) => links.filter((link) => link !== undefined && link !== null && link !== '');

/** A menu link to a PDF: uploadPdf's secure_url ends in .pdf. */
const isPdfLink = (url) => url.split('?')[0].toLowerCase().endsWith('.pdf');

/**
 * The cloud file a menu link names — its public_id on our cloud — or, for a
 * link anywhere else, the link itself. Links that differ only in version,
 * size, format or query name one file, and the first page of a PDF drawn as a
 * picture names the PDF.
 *
 * A card's menu file is recognised once (review of PR #56, finding 1):
 * recognition is paid per call, and a save that named a file of the card in
 * another spelling used to delete its row — with its job and its dishes,
 * cascading — and queue it again; a list naming one file twice queued it
 * twice.
 */
const menuFileKey = (url) => ownCloudPublicId(url) ?? url;

/** The links of a list, each file once: the first link of a file is kept. */
const oneLinkPerFile = (links, keyOf) => {
  const seen = new Set();
  return links.filter((link) => {
    const key = keyOf(link);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Build the establishment_media type/url triplet for a synced menu URL. Menu PDFs
 * (uploaded to menu_pdf/, url ends in .pdf) must carry file_type='pdf' and derived
 * pg_1 JPG preview/thumbnail URLs — Cloudinary blocks RAW .pdf delivery (401), so a
 * .pdf placed in an <img> renders broken. Plain image URLs pass through unchanged
 * (Cloudinary resizes them via URL params). Mirrors the create-path menu_pdfs branch
 * so the two vehicles agree.
 */
function buildMenuMediaFields(url) {
  const isPdf = isPdfLink(url);
  if (!isPdf) {
    return { file_type: 'image', url, thumbnail_url: url, preview_url: url };
  }
  const publicId = extractPublicIdFromUrl(url);
  return {
    file_type: 'pdf',
    url,
    // Fall back to the raw url only if the public_id could not be parsed — the
    // thumbnail would then be broken, but the record is still typed as a pdf.
    thumbnail_url: publicId ? generatePdfThumbnailUrl(publicId) : url,
    preview_url: publicId ? generatePdfPreviewUrl(publicId) : url,
  };
}

/**
 * Statuses in which a partner-driven name change triggers slug regeneration.
 * Post-approve (active, suspended, archived) slug is frozen — display name
 * can change but URL remains stable for SEO and existing links.
 */
const SLUG_MUTABLE_STATUSES = ['draft', 'pending', 'rejected'];

/**
 * Valid city values for Belarus
 */
const VALID_CITIES = ['Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Могилёв', 'Бобруйск'];

// VALID_CATEGORIES (15) / VALID_CUISINES (12) now imported from the shared
// canon (constants/establishmentVocab.js) — see CAT-C-2.9 consolidation.

/**
 * Geographic bounds for Belarus
 */
export const BELARUS_BOUNDS = {
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
export const CITY_BOUNDS = {
  'Минск': { latMin: 53.75, latMax: 54.10, lonMin: 27.30, lonMax: 27.85 },
  'Гродно': { latMin: 53.55, latMax: 53.78, lonMin: 23.70, lonMax: 24.00 },
  'Брест': { latMin: 51.98, latMax: 52.20, lonMin: 23.55, lonMax: 23.85 },
  'Гомель': { latMin: 52.32, latMax: 52.52, lonMin: 30.85, lonMax: 31.15 },
  'Витебск': { latMin: 55.10, latMax: 55.28, lonMin: 30.05, lonMax: 30.35 },
  'Могилев': { latMin: 53.82, latMax: 54.00, lonMin: 30.20, lonMax: 30.50 },
  'Могилёв': { latMin: 53.82, latMax: 54.00, lonMin: 30.20, lonMax: 30.50 },
  'Бобруйск': { latMin: 53.08, latMax: 53.22, lonMin: 29.10, lonMax: 29.40 },
};

/**
 * Validate that coordinates are within the selected city bounds
 *
 * `message` names the box in numbers — it is read by the moderator fixing a
 * point (adminService). A partner is refused with
 * ESTABLISHMENT_REFUSALS.coordinatesOutsideCity instead.
 *
 * @param {string} city - City name
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateCityCoordinates(city, latitude, longitude) {
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
 * The refusal of a point outside the chosen city's box. The partner reads the
 * plain text; the numbers — the point and the box — go to the log, where
 * support finds them when the partner writes in (the text invites that).
 */
function cityMismatchRefusal(cityValidation, logContext) {
  logger.warn('Point outside the city box refused', { ...logContext, detail: cityValidation.message });
  return new AppError(ESTABLISHMENT_REFUSALS.coordinatesOutsideCity, 422, 'COORDINATES_CITY_MISMATCH');
}

/** One city whatever the spelling: the CHECK accepts both Могилев and Могилёв. */
const sameCity = (a, b) => String(a).replace(/ё/g, 'е') === String(b).replace(/ё/g, 'е');

/**
 * Whether an incoming coordinate differs from the stored one. Absent means
 * unchanged. The stored value comes from a numeric column as a string, the
 * incoming one as a number (the app sends back what GET gave it) or a string,
 * so they are compared as numbers. The incoming value is read whole (Number,
 * not parseFloat): "54.2abc" is not the stored 54.2 — anything that is not
 * exactly the stored number counts as a change and meets the checks as before.
 */
const coordinateChanged = (incoming, stored) =>
  incoming !== undefined && Number(incoming) !== parseFloat(stored);

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
 * - Cuisines array must have 1-3 items, all valid (0-3 for a cuisine-optional
 *   category: a bar, a club, a hookah lounge, bowling, karaoke, billiards)
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
    cuisines: cuisinesInput,
    price_range,
    working_hours,
    special_hours,
    attributes,
    primary_photo,
    interior_photos,
    menu_photos,
    menu_pdfs,
    legal_name,
    unp,
    contact_person,
    contact_email,
  } = establishmentData;

  try {
    // Validate city
    if (!VALID_CITIES.includes(city)) {
      throw new AppError(ESTABLISHMENT_REFUSALS.invalidCity, 422, 'INVALID_CITY');
    }

    // Validate categories array
    if (!Array.isArray(categories) || categories.length < 1 || categories.length > 2) {
      throw new AppError(ESTABLISHMENT_REFUSALS.categoriesCount, 422, 'INVALID_CATEGORIES_LENGTH');
    }

    const invalidCategories = categories.filter(cat => !VALID_CATEGORIES.includes(cat));
    if (invalidCategories.length > 0) {
      throw new AppError(ESTABLISHMENT_REFUSALS.unknownCategory, 422, 'INVALID_CATEGORY_VALUE');
    }

    // Validate cuisines array: 1-3, or 0-3 for a cuisine-optional category
    // (decision В5, 17.10.2026; widened 19.10.2026, Ш17 — isCuisineRequired).
    // Such a card that sends no list stores an empty one —
    // the column is NOT NULL.
    const cuisineRequired = isCuisineRequired(categories);
    const cuisines = cuisinesInput === undefined && !cuisineRequired ? [] : cuisinesInput;
    if (!Array.isArray(cuisines) || cuisines.length < (cuisineRequired ? 1 : 0) || cuisines.length > 3) {
      throw new AppError(ESTABLISHMENT_REFUSALS.cuisinesCount, 422, 'INVALID_CUISINES_LENGTH');
    }

    const invalidCuisines = cuisines.filter(cuisine => !VALID_CUISINES.includes(cuisine));
    if (invalidCuisines.length > 0) {
      throw new AppError(ESTABLISHMENT_REFUSALS.unknownCuisine, 422, 'INVALID_CUISINE_VALUE');
    }

    // Validate geographic coordinates are within Belarus bounds
    if (latitude < BELARUS_BOUNDS.LAT_MIN || latitude > BELARUS_BOUNDS.LAT_MAX) {
      throw new AppError(ESTABLISHMENT_REFUSALS.coordinatesOutsideBelarus, 422, 'INVALID_LATITUDE');
    }

    if (longitude < BELARUS_BOUNDS.LON_MIN || longitude > BELARUS_BOUNDS.LON_MAX) {
      throw new AppError(ESTABLISHMENT_REFUSALS.coordinatesOutsideBelarus, 422, 'INVALID_LONGITUDE');
    }

    // Validate coordinates match the selected city
    const cityValidation = validateCityCoordinates(city, latitude, longitude);
    if (!cityValidation.valid) {
      throw cityMismatchRefusal(cityValidation, { partnerId });
    }

    // Enforce photo bucket limits at materialization — the wizard path carries
    // temp-upload URLs in the payload and bypasses the per-upload check in
    // mediaService, so the count must be validated here.
    if (Array.isArray(interior_photos) && interior_photos.length > MEDIA_LIMITS.interior) {
      throw new AppError(
        ESTABLISHMENT_REFUSALS.photoLimit('interior', MEDIA_LIMITS.interior),
        403,
        'MEDIA_LIMIT_EXCEEDED',
      );
    }

    if (Array.isArray(menu_photos) && menu_photos.length > MEDIA_LIMITS.menu) {
      throw new AppError(
        ESTABLISHMENT_REFUSALS.photoLimit('menu', MEDIA_LIMITS.menu),
        403,
        'MEDIA_LIMIT_EXCEEDED',
      );
    }

    // Format gate before the establishment INSERT (no orphan row on failure).
    // Create materializes menu_photos as file_type='image' and menu_pdfs as
    // file_type='pdf' unconditionally, so each bucket accepts only the formats
    // its materialization can render.
    assertValidMediaUrlExtensions(interior_photos || [], {});
    assertValidMediaUrlExtensions(menu_photos || [], {});
    assertValidMediaUrlExtensions(
      (Array.isArray(menu_pdfs) ? menu_pdfs : []).map((pdf) => pdf?.url ?? ''),
      { allowImage: false, allowPdf: true },
    );

    // Ownership gate, before the INSERT too, over every link create stores —
    // primary_photo becomes the catalog thumbnail as is. The card has no folder
    // yet, so each link must be the partner's own temp upload (where the app and
    // the site upload: establishments/temp/{userId}/).
    assertOwnMediaUrls({
      interior: Array.isArray(interior_photos) ? interior_photos : [],
      menu: Array.isArray(menu_photos) ? menu_photos : [],
      menu_pdf: (Array.isArray(menu_pdfs) ? menu_pdfs : [])
        .flatMap((pdf) => [pdf?.url, ...presentLinks(pdf?.thumbnail_url, pdf?.preview_url)]),
      primary: presentLinks(primary_photo),
    }, [ownedFolders.partnerUploads(partnerId)], { partnerId });

    // Each menu file once (menuFileKey): a file named twice — in one list or in
    // both — would be stored and recognised twice. PDFs keep their limit, as
    // before; a menu photo naming a PDF's file is that PDF.
    const menuPdfs = oneLinkPerFile(Array.isArray(menu_pdfs) ? menu_pdfs : [], (pdf) => menuFileKey(pdf.url))
      .slice(0, MAX_PDFS_PER_ESTABLISHMENT);
    const pdfFiles = new Set(menuPdfs.map((pdf) => menuFileKey(pdf.url)));
    const menuPhotos = oneLinkPerFile(Array.isArray(menu_photos) ? menu_photos : [], menuFileKey)
      .filter((url) => !pdfFiles.has(menuFileKey(url)));

    // Check for duplicate name
    const isDuplicate = await EstablishmentModel.checkDuplicateName(partnerId, name);
    if (isDuplicate) {
      throw new AppError(ESTABLISHMENT_REFUSALS.duplicateName, 409, 'DUPLICATE_ESTABLISHMENT');
    }

    // Generate unique slug from name (auto-suffix on collision)
    const slug = await generateUniqueSlug(
      name,
      (candidate) => EstablishmentModel.checkDuplicateSlug(candidate),
    );

    // Create establishment in database
    const establishment = await EstablishmentModel.createEstablishment({
      partner_id: partnerId,
      name,
      slug,
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
    menuPhotos.forEach((url, index) => {
      allPhotos.push({
        url,
        type: 'menu',
        position: index,
        is_primary: url === primary_photo,
      });
    });

    // Insert all photos into establishment_media
    if (allPhotos.length > 0) {
      const mediaPromises = allPhotos.map(photo =>
        MediaModel.createMedia({
          establishment_id: establishment.id,
          type: photo.type,
          file_type: 'image',
          url: photo.url,
          thumbnail_url: photo.url, // Same URL for now, Cloudinary handles resizing via URL params
          preview_url: photo.url,
          position: photo.position,
          is_primary: photo.is_primary,
        }),
      );

      const mediaRecords = await Promise.all(mediaPromises);

      logger.info('Media saved to establishment_media', {
        establishmentId: establishment.id,
        interiorCount: interior_photos?.length || 0,
        menuCount: menuPhotos.length,
      });

      // Menu photos enter the OCR pipeline in parity with PDF menus below
      // (vision_image strategy), within the partner's daily recognition
      // allowance (services/ocrAllowance.js). Fire-and-forget — enqueue
      // failure must not fail registration finalization. allPhotos[i]
      // corresponds to mediaRecords[i] (Promise.all preserves order).
      mediaRecords.forEach((record, index) => {
        if (allPhotos[index].type === 'menu') {
          enqueueWithinDailyAllowance({
            userId: partnerId,
            establishmentId: establishment.id,
            mediaId: record.id,
          }).catch((err) => logger.error('Failed to enqueue OCR job for menu photo on registration finalize', {
            error: err.message,
            mediaId: record.id,
            establishmentId: establishment.id,
          }));
        }
      });
    }

    // Persist PDF menu files separately — they carry thumbnail_url/preview_url
    // generated from Cloudinary pg_1 transformations, not plain duplicates of url.
    if (menuPdfs.length > 0) {
      const pdfPromises = menuPdfs.map((pdf, index) =>
        MediaModel.createMedia({
          establishment_id: establishment.id,
          type: 'menu',
          file_type: 'pdf',
          url: pdf.url,
          thumbnail_url: pdf.thumbnail_url,
          preview_url: pdf.preview_url,
          caption: pdf.file_name || null,
          position: index,
          is_primary: false,
        }),
      );

      const pdfRecords = await Promise.all(pdfPromises);

      logger.info('PDF menus saved to establishment_media', {
        establishmentId: establishment.id,
        pdfCount: menuPdfs.length,
      });

      // Fire-and-forget: enqueue OCR jobs for newly persisted PDF menus, within
      // the partner's daily recognition allowance. Temp uploads do not create
      // establishment_media rows; they are materialised here at registration
      // finalization, so this is the earliest valid enqueue point.
      for (const record of pdfRecords) {
        enqueueWithinDailyAllowance({
          userId: partnerId,
          establishmentId: establishment.id,
          mediaId: record.id,
        }).catch((err) => logger.error('Failed to enqueue OCR job on registration finalize', {
          error: err.message,
          mediaId: record.id,
          establishmentId: establishment.id,
        }));
      }
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

    // Calculate and save completeness score (non-blocking)
    const baseScore = EstablishmentModel.calculateCompletenessScore(establishment);
    if (baseScore > 0) {
      EstablishmentModel.updateBaseScore(establishment.id, baseScore);
      establishment.base_score = baseScore;
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
      // Unique constraint violation — disambiguate by constraint name
      if (error.constraint === 'establishments_slug_unique') {
        throw new AppError(ESTABLISHMENT_REFUSALS.slugCollision, 409, 'SLUG_COLLISION');
      }
      throw new AppError(ESTABLISHMENT_REFUSALS.duplicateName, 409, 'DUPLICATE_ESTABLISHMENT');
    }

    if (error.code === '23514') {
      // Check constraint violation (enum values, etc.)
      throw new AppError(ESTABLISHMENT_REFUSALS.constraintViolation, 422, 'CONSTRAINT_VIOLATION');
    }

    // Log unexpected errors
    logger.error('Unexpected error creating establishment', {
      error: error.message,
      stack: error.stack,
      partnerId,
    });

    throw new AppError(ESTABLISHMENT_REFUSALS.createFailed, 500, 'ESTABLISHMENT_CREATE_FAILED');
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
    const rawEstablishments = await EstablishmentModel.getEstablishmentsByPartner(
      partnerId,
      {
        status,
        limit: effectiveLimit,
        offset,
      },
    );

    // Normalize moderation_notes (TEXT column stores JSON string, parse to
    // object) and coerce pg NUMERIC strings to numbers, mirroring the
    // single-establishment path below — web types.ts declares these as
    // number | null, so the list wire must not ship "4.50" strings.
    const establishments = rawEstablishments.map(est => ({
      ...est,
      latitude: est.latitude ? parseFloat(est.latitude) : est.latitude,
      longitude: est.longitude ? parseFloat(est.longitude) : est.longitude,
      average_rating: est.average_rating ? parseFloat(est.average_rating) : est.average_rating,
      moderation_notes: typeof est.moderation_notes === 'string'
        ? (() => { try { return JSON.parse(est.moderation_notes); } catch { return null; } })()
        : (est.moderation_notes || null),
    }));

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

    throw new AppError(ESTABLISHMENT_REFUSALS.listFailed, 500, 'ESTABLISHMENTS_FETCH_FAILED');
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
      throw new AppError(ESTABLISHMENT_REFUSALS.notFound, 404, 'ESTABLISHMENT_NOT_FOUND');
    }

    // Fetch establishment
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);

    if (!establishment) {
      throw new AppError(ESTABLISHMENT_REFUSALS.notFound, 404, 'ESTABLISHMENT_NOT_FOUND');
    }

    // Fetch media, partner documents, and rating distribution in parallel
    const [media, partnerDoc, ratingDistribution] = await Promise.all([
      MediaModel.getEstablishmentMedia(establishmentId),
      PartnerDocumentsModel.findByEstablishmentId(establishmentId),
      ReviewModel.getRatingDistribution(establishmentId),
    ]);

    // Map media to frontend-expected format
    // Priority: is_primary flag → first interior photo → first any photo
    const primaryMedia = media.find(m => m.is_primary)
      || media.find(m => m.type === 'interior')
      || media[0]
      || null;
    const interiorPhotos = media.filter(m => m.type === 'interior').map(m => m.url);
    const menuPhotos = media.filter(m => m.type === 'menu').map(m => m.url);

    // Normalize moderation_notes: TEXT column stores JSON string, parse to object
    const moderationNotes = typeof establishment.moderation_notes === 'string'
      ? (() => { try { return JSON.parse(establishment.moderation_notes); } catch { return null; } })()
      : (establishment.moderation_notes || null);

    // Convert numeric types from PostgreSQL strings to numbers
    return {
      ...establishment,
      latitude: establishment.latitude ? parseFloat(establishment.latitude) : establishment.latitude,
      longitude: establishment.longitude ? parseFloat(establishment.longitude) : establishment.longitude,
      average_rating: establishment.average_rating ? parseFloat(establishment.average_rating) : establishment.average_rating,
      moderation_notes: moderationNotes,
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

    throw new AppError(ESTABLISHMENT_REFUSALS.fetchFailed, 500, 'ESTABLISHMENT_FETCH_FAILED');
  }
};

/**
 * Update an establishment
 * 
 * Business rules for updates:
 * - Partner must own the establishment
 * - Cannot update if status is 'suspended' (admin-only change)
 * - Edits to an already-approved establishment do NOT require re-moderation
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
      throw new AppError(ESTABLISHMENT_REFUSALS.notOwner, 403, 'FORBIDDEN');
    }

    // Fetch current establishment to check status and for comparison
    const currentEstablishment = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!currentEstablishment) {
      throw new AppError(ESTABLISHMENT_REFUSALS.notFound, 404, 'ESTABLISHMENT_NOT_FOUND');
    }

    // Self-suspended establishments cannot be edited (partner should resume first)
    // Admin-suspended establishments CAN be edited (partner fixes issues, then resubmits)
    if (currentEstablishment.status === 'suspended') {
      const notes = typeof currentEstablishment.moderation_notes === 'string'
        ? (() => { try { return JSON.parse(currentEstablishment.moderation_notes); } catch { return {}; } })()
        : (currentEstablishment.moderation_notes || {});

      if (!notes.suspend_reason) {
        throw new AppError(ESTABLISHMENT_REFUSALS.selfPausedEdit, 403, 'ESTABLISHMENT_SUSPENDED');
      }
      // Admin-suspended with suspend_reason: allow editing (fall through)
    }

    // Validate updates if provided
    if (updates.categories !== undefined) {
      if (!Array.isArray(updates.categories) || updates.categories.length < 1 || updates.categories.length > 2) {
        throw new AppError(ESTABLISHMENT_REFUSALS.categoriesCount, 422, 'INVALID_CATEGORIES_LENGTH');
      }

      const invalidCategories = updates.categories.filter(cat => !VALID_CATEGORIES.includes(cat));
      if (invalidCategories.length > 0) {
        throw new AppError(ESTABLISHMENT_REFUSALS.unknownCategory, 422, 'INVALID_CATEGORY_VALUE');
      }
    }

    if (updates.cuisines !== undefined) {
      if (!Array.isArray(updates.cuisines) || updates.cuisines.length > 3) {
        throw new AppError(ESTABLISHMENT_REFUSALS.cuisinesCount, 422, 'INVALID_CUISINES_LENGTH');
      }

      const invalidCuisines = updates.cuisines.filter(cuisine => !VALID_CUISINES.includes(cuisine));
      if (invalidCuisines.length > 0) {
        throw new AppError(ESTABLISHMENT_REFUSALS.unknownCuisine, 422, 'INVALID_CUISINE_VALUE');
      }
    }

    // A card may be left without a cuisine only while every category is
    // cuisine-optional
    // (decision В5, 17.10.2026). Checked on the card as it will be after this
    // edit: an empty list with stored categories that need a cuisine, or new
    // categories that need one while the stored list is empty. An edit of an
    // approved card goes live without moderation, so the submit check alone
    // would not hold this.
    if (updates.categories !== undefined || updates.cuisines !== undefined) {
      const nextCategories = updates.categories !== undefined
        ? updates.categories
        : currentEstablishment.categories;
      const nextCuisines = updates.cuisines !== undefined
        ? updates.cuisines
        : (currentEstablishment.cuisines || []);
      if (nextCuisines.length === 0 && isCuisineRequired(nextCategories)) {
        throw new AppError(ESTABLISHMENT_REFUSALS.cuisinesCount, 422, 'INVALID_CUISINES_LENGTH');
      }
    }

    // Validate city if being updated
    if (updates.city !== undefined && !VALID_CITIES.includes(updates.city)) {
      throw new AppError(ESTABLISHMENT_REFUSALS.invalidCity, 422, 'INVALID_CITY');
    }

    // Validate the point against Belarus and the city's box only when the
    // city or the point actually changes. The app's edit wizard re-sends the
    // stored city and point with every save (it serializes the whole card), so
    // checking values that did not change refused every edit — a photo, the
    // description — of a card whose point lies outside its city's box, a point
    // accepted earlier (seed import, a moderator's fix). Decision of the
    // Coordinator, 13.10.2026. A changed city is checked against the stored
    // point, and a changed point against the stored city, as before.
    const cityChanged = updates.city !== undefined
      && !sameCity(updates.city, currentEstablishment.city);
    const pointChanged = coordinateChanged(updates.latitude, currentEstablishment.latitude)
      || coordinateChanged(updates.longitude, currentEstablishment.longitude);

    if (cityChanged || pointChanged) {
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
          throw new AppError(ESTABLISHMENT_REFUSALS.coordinatesOutsideBelarus, 422, 'INVALID_LATITUDE');
        }
      }

      if (updates.longitude !== undefined) {
        if (effectiveLon < BELARUS_BOUNDS.LON_MIN || effectiveLon > BELARUS_BOUNDS.LON_MAX) {
          throw new AppError(ESTABLISHMENT_REFUSALS.coordinatesOutsideBelarus, 422, 'INVALID_LONGITUDE');
        }
      }

      // Validate coordinates match city
      const cityValidation = validateCityCoordinates(effectiveCity, effectiveLat, effectiveLon);
      if (!cityValidation.valid) {
        throw cityMismatchRefusal(cityValidation, { partnerId, establishmentId });
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
        throw new AppError(ESTABLISHMENT_REFUSALS.duplicateName, 409, 'DUPLICATE_ESTABLISHMENT');
      }
    }

    // Strip partner-supplied slug — slug is system-controlled.
    // Admin slug correction goes through a separate endpoint.
    if (updates.slug !== undefined) {
      delete updates.slug;
    }

    // The catalog thumbnail is system-controlled too: setPrimaryPhoto writes it
    // from one of the card's media rows, and the media sync below clears it when
    // the last interior photo goes. Taken from the request it would reach the
    // catalog as is — any address, live without moderation (review 02.10.2026,
    // N3). No client sends it.
    if (updates.primary_image_url !== undefined) {
      delete updates.primary_image_url;
      logger.warn('Partner attempted to set primary_image_url directly — ignored', {
        establishmentId,
        partnerId,
      });
    }

    // Slug regeneration gate:
    //   mutable statuses (draft, pending, rejected) → regenerate when name changes
    //   frozen statuses (active, suspended, archived) → slug stays stable
    //   even on rename, so existing URLs do not break.
    if (
      SLUG_MUTABLE_STATUSES.includes(currentEstablishment.status) &&
      updates.name !== undefined &&
      updates.name !== currentEstablishment.name
    ) {
      updates.slug = await generateUniqueSlug(
        updates.name,
        (candidate) => EstablishmentModel.checkDuplicateSlug(candidate, establishmentId),
      );
      logger.info('Slug regenerated due to name change in mutable status', {
        establishmentId,
        oldName: currentEstablishment.name,
        newName: updates.name,
        newSlug: updates.slug,
        status: currentEstablishment.status,
      });
    }

    // Prevent partners from changing status directly
    // Status changes should only come from admin moderation or submission workflow
    if (updates.status !== undefined) {
      const attemptedStatus = updates.status;
      delete updates.status;

      logger.warn('Partner attempted to change status directly', {
        establishmentId,
        partnerId,
        attemptedStatus,
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
      // Enforce photo bucket limits on the sync path — it replaces the bucket
      // state wholesale (final count = incoming array length) and otherwise
      // bypasses the per-upload check in mediaService.
      for (const [field, bucket] of [['interior_photos', 'interior'], ['menu_photos', 'menu']]) {
        const incoming = updates[field];
        if (Array.isArray(incoming) && incoming.length > MEDIA_LIMITS[bucket]) {
          throw new AppError(
            ESTABLISHMENT_REFUSALS.photoLimit(bucket, MEDIA_LIMITS[bucket]),
            403,
            'MEDIA_LIMIT_EXCEEDED',
          );
        }
      }

      const existingMedia = await MediaModel.getEstablishmentMedia(establishmentId);
      const primaryPhotoUrl = updates.primary_photo || null;

      // What the save changes in each bucket, worked out before the first write.
      // A menu link is matched by the cloud file it names (menuFileKey): a file
      // the card already has keeps its row — with its job and its dishes — and a
      // file named twice is added once. Two rows of one file from before (only a
      // forged request or two saves at once made them) stay while the list
      // names the file and go together. Interior photos match by the link as
      // sent: the cover is chosen by its link (setPrimaryPhoto below).
      const plans = [];
      for (const [field, type] of [['interior_photos', 'interior'], ['menu_photos', 'menu']]) {
        if (updates[field] === undefined) continue;
        const keyOf = type === 'menu' ? menuFileKey : (url) => url;
        const newUrls = type === 'menu' ? oneLinkPerFile(updates[field] || [], keyOf) : (updates[field] || []);
        const existingOfType = existingMedia.filter(m => m.type === type);
        const existingKeys = new Set(existingOfType.map(m => keyOf(m.url)));
        const newKeys = new Set(newUrls.map(keyOf));
        plans.push({
          type,
          existingOfType,
          toDelete: existingOfType.filter(m => !newKeys.has(keyOf(m.url))),
          toInsert: newUrls.filter(url => !existingKeys.has(keyOf(url))),
        });
      }

      // Format and ownership gates on newly added URLs only — existing rows stay
      // untouched (legacy-safe: a card transferred from the service account keeps
      // its photos in that account's folder), and both run before the first DB
      // write below (deletes happen inside the sync loop). The menu bucket accepts
      // PDFs on this path: buildMenuMediaFields types them correctly. An added
      // link must be the partner's own temp upload or a file of this very card
      // (a PDF attached through POST /:id/media).
      const ownFolders = [ownedFolders.establishment(establishmentId), ownedFolders.partnerUploads(partnerId)];
      for (const { type, toInsert } of plans) {
        assertValidMediaUrlExtensions(toInsert, { allowPdf: type === 'menu' });
        assertOwnMediaUrls({ [type]: toInsert }, ownFolders, { partnerId, establishmentId });
      }

      // Two menu PDFs per card on this path too, as on the card's own upload
      // (mediaService) — checked before any write. Only a save that adds a PDF is
      // held to it: a card holding more from before is not refused an edit that
      // adds none.
      const menuPlan = plans.find(plan => plan.type === 'menu');
      if (menuPlan) {
        const addedPdfs = menuPlan.toInsert.filter(isPdfLink).length;
        const keptPdfs = menuPlan.existingOfType
          .filter(m => m.file_type === 'pdf' && !menuPlan.toDelete.includes(m))
          .length;
        if (addedPdfs > 0 && keptPdfs + addedPdfs > MAX_PDFS_PER_ESTABLISHMENT) {
          throw new AppError(
            ESTABLISHMENT_REFUSALS.pdfLimit(MAX_PDFS_PER_ESTABLISHMENT),
            403,
            'PDF_LIMIT_EXCEEDED',
          );
        }
      }

      // Sync each media type
      for (const { type, existingOfType, toDelete, toInsert } of plans) {
        // Delete removed media
        for (const media of toDelete) {
          await MediaModel.deleteMedia(media.id);
        }

        // Insert new media. Menu URLs may be PDFs (uploaded to menu_pdf/) — they
        // need file_type='pdf' + pg_1 preview/thumbnail via buildMenuMediaFields,
        // otherwise the raw .pdf lands in an <img> and Cloudinary 401s it.
        for (let i = 0; i < toInsert.length; i++) {
          const url = toInsert[i];
          const mediaFields = type === 'menu'
            ? buildMenuMediaFields(url)
            : { file_type: 'image', url, thumbnail_url: url, preview_url: url };
          const record = await MediaModel.createMedia({
            establishment_id: establishmentId,
            type,
            ...mediaFields,
            position: existingOfType.length + i,
            is_primary: url === primaryPhotoUrl,
          });

          // Cabinet cards add menus through this sync path (two-stage create →
          // autosave PUT), so newly inserted menu media must enter the OCR
          // pipeline here in parity with createEstablishment, within the
          // partner's daily recognition allowance (services/ocrAllowance.js).
          // Fire-and-forget; an active job of the file is returned, not doubled.
          if (type === 'menu') {
            enqueueWithinDailyAllowance({
              userId: partnerId,
              establishmentId,
              mediaId: record.id,
            }).catch((err) => logger.error('Failed to enqueue OCR job for menu media on update sync', {
              error: err.message,
              mediaId: record.id,
              establishmentId,
            }));
          }
        }

        // Update primary flag if needed
        if (primaryPhotoUrl) {
          const keptOfType = existingOfType.filter(m => !toDelete.includes(m));
          for (const media of keptOfType) {
            if ((media.url === primaryPhotoUrl) !== media.is_primary) {
              await MediaModel.updateMedia(media.id, { is_primary: media.url === primaryPhotoUrl });
            }
          }
        }
      }

      // Sync the primary photo THROUGH setPrimaryPhoto — the only writer that also
      // updates establishments.primary_image_url (the catalog thumbnail). The inline
      // is_primary flags set on createMedia/updateMedia above touch ONLY the media
      // row, so calling this unconditionally is what keeps the establishment column
      // from going stale (the empty-catalog-thumbnail bug). Choose the partner's
      // pick, else an existing primary, else the first interior photo.
      const updatedMedia = await MediaModel.getEstablishmentMedia(establishmentId);
      const interiorPhotos = updatedMedia.filter(m => m.type === 'interior');
      if (interiorPhotos.length > 0) {
        const chosen = interiorPhotos.find(m => m.url === primaryPhotoUrl)
          || interiorPhotos.find(m => m.is_primary)
          || interiorPhotos[0];
        await MediaModel.setPrimaryPhoto(establishmentId, chosen.id);
        logger.info('Primary photo synced to establishment column', {
          establishmentId,
          mediaId: chosen.id,
        });
      } else {
        // All interior photos removed — clear the catalog thumbnail (setPrimaryPhoto
        // has no media row to point at; the whitelist handles the NULL write).
        updates.primary_image_url = null;
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

    // Recalculate completeness score (non-blocking)
    const newScore = EstablishmentModel.calculateCompletenessScore(updatedEstablishment);
    if (newScore !== updatedEstablishment.base_score) {
      EstablishmentModel.updateBaseScore(establishmentId, newScore);
      updatedEstablishment.base_score = newScore;
    }

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
    if (error.code === '23505') {
      if (error.constraint === 'establishments_slug_unique') {
        throw new AppError(ESTABLISHMENT_REFUSALS.slugCollision, 409, 'SLUG_COLLISION');
      }
      throw new AppError(ESTABLISHMENT_REFUSALS.duplicateName, 409, 'DUPLICATE_ESTABLISHMENT');
    }

    if (error.code === '23514') {
      throw new AppError(ESTABLISHMENT_REFUSALS.constraintViolation, 422, 'CONSTRAINT_VIOLATION');
    }

    logger.error('Unexpected error updating establishment', {
      error: error.message,
      stack: error.stack,
      establishmentId,
      partnerId,
    });

    throw new AppError(ESTABLISHMENT_REFUSALS.updateFailed, 500, 'ESTABLISHMENT_UPDATE_FAILED');
  }
};

/**
 * Submit establishment for moderation
 *
 * Pre-submission validation ensures establishment is ready for review:
 * - Must be in 'draft', 'rejected', or 'suspended' status
 * - Required content fields complete: name, city, address, coordinates,
 *   categories, cuisines (not for a cuisine-optional category), working_hours
 *
 * Note: media completeness (photo minimums, primary photo) is NOT enforced
 * server-side — it is a procedural gate applied by clients (E1 checklist)
 * and by moderation.
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
      throw new AppError(ESTABLISHMENT_REFUSALS.notOwner, 403, 'FORBIDDEN');
    }

    // Fetch establishment to validate status
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);

    if (!establishment) {
      throw new AppError(ESTABLISHMENT_REFUSALS.notFound, 404, 'ESTABLISHMENT_NOT_FOUND');
    }

    // Must be in 'draft', 'rejected', or 'suspended' (admin-suspended) status to submit
    if (!['draft', 'rejected', 'suspended'].includes(establishment.status)) {
      throw new AppError(ESTABLISHMENT_REFUSALS.alreadySubmitted, 400, 'INVALID_STATUS_FOR_SUBMISSION');
    }

    // Validate all required fields are complete
    const missingFields = [];

    if (!establishment.name) missingFields.push('name');
    if (!establishment.city) missingFields.push('city');
    if (!establishment.address) missingFields.push('address');
    if (!establishment.latitude || !establishment.longitude) missingFields.push('coordinates');
    if (!establishment.categories || establishment.categories.length === 0) missingFields.push('categories');
    // A cuisine-optional card may go to moderation without a cuisine (decision
    // В5, 17.10.2026; widened 19.10.2026, Ш17).
    if ((!establishment.cuisines || establishment.cuisines.length === 0)
      && isCuisineRequired(establishment.categories)) missingFields.push('cuisines');
    if (!establishment.working_hours) missingFields.push('working_hours');

    if (missingFields.length > 0) {
      throw new AppError(ESTABLISHMENT_REFUSALS.incomplete(missingFields), 400, 'INCOMPLETE_ESTABLISHMENT');
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

    throw new AppError(ESTABLISHMENT_REFUSALS.submitFailed, 500, 'ESTABLISHMENT_SUBMIT_FAILED');
  }
};

/**
 * Suspend a partner's establishment (active → suspended) — the partner's own
 * pause, which the partner switches back on (resumeEstablishment).
 *
 * An active card is under no moderator's suspension, so any suspension marks
 * still in its notes are leftovers (until 2026-10-07 lifting a suspension
 * left the reason behind) and are dropped here: otherwise this pause would
 * read as the moderator's — the partner could not resume it, and the panel
 * would show an old reason (utils/moderationNotes.js).
 */
export const suspendEstablishment = async (establishmentId, partnerId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError(ESTABLISHMENT_REFUSALS.notOwner, 403, 'FORBIDDEN');
  }

  const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);
  const notes = parseModerationNotes(establishment?.moderation_notes);

  const result = await EstablishmentModel.changeEstablishmentStatus(establishmentId, {
    fromStatus: 'active',
    toStatus: 'suspended',
    ...(hasModeratorSuspensionMarks(notes) ? { moderationNotes: withoutModeratorSuspension(notes) } : {}),
  });

  if (!result) {
    throw new AppError(ESTABLISHMENT_REFUSALS.pauseNotPublished, 400, 'INVALID_STATUS_TRANSITION');
  }

  logger.info('Establishment suspended by partner', { establishmentId, partnerId });
  return result;
};

/**
 * Resume a partner's self-suspended establishment (suspended → active)
 *
 * Only works for self-suspended establishments (no suspend_reason in moderation_notes):
 * the partner's own pause goes straight back to active, without moderation.
 * A moderator's suspension is not the partner's to lift (403 ADMIN_SUSPENDED):
 * the partner edits the card and resubmits it via submitForModeration, or the
 * moderator lifts it (adminService.unsuspendEstablishment).
 */
export const resumeEstablishment = async (establishmentId, partnerId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError(ESTABLISHMENT_REFUSALS.notOwner, 403, 'FORBIDDEN');
  }

  // Check if suspended by admin (has suspend_reason) — partner cannot self-resume
  const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);
  if (!establishment || establishment.status !== 'suspended') {
    throw new AppError(ESTABLISHMENT_REFUSALS.resumeNotPaused, 400, 'INVALID_STATUS_TRANSITION');
  }

  const notes = typeof establishment.moderation_notes === 'string'
    ? (() => { try { return JSON.parse(establishment.moderation_notes); } catch { return {}; } })()
    : (establishment.moderation_notes || {});

  const adminSuspended = () => new AppError(ESTABLISHMENT_REFUSALS.moderatorSuspended, 403, 'ADMIN_SUSPENDED');

  if (notes.suspend_reason) {
    throw adminSuspended();
  }

  // Self-suspended: restore to active (was approved before self-suspend).
  // The notes the decision was made on guard the write: a moderator may
  // suspend this very card over the partner's pause meanwhile — the status
  // stays 'suspended', only the notes change — and that suspension must win.
  const result = await EstablishmentModel.changeEstablishmentStatus(establishmentId, {
    fromStatus: 'suspended',
    toStatus: 'active',
    expectedModerationNotes: establishment.moderation_notes ?? null,
  });

  if (!result) {
    const now = await EstablishmentModel.findEstablishmentById(establishmentId, true);
    if (now && isModeratorSuspension(now.status, parseModerationNotes(now.moderation_notes))) {
      throw adminSuspended();
    }
    throw new AppError(ESTABLISHMENT_REFUSALS.resumeNotPaused, 400, 'INVALID_STATUS_TRANSITION');
  }

  logger.info('Establishment resumed by partner (self-suspend)', { establishmentId, partnerId });
  return result;
};

/**
 * Delete a partner's establishment permanently — a draft or a rejected card
 * that has never been public only (decision of the Coordinator, 01.10.2026;
 * the refusal text is ESTABLISHMENT_REFUSALS.notDeletable).
 *
 * The rule lives in the DELETE itself (EstablishmentModel.deleteEstablishment);
 * the second read below only picks the answer when nothing was deleted: the
 * card is still there but may not be deleted (403 ESTABLISHMENT_NOT_DELETABLE),
 * or it is gone (404).
 */
export const deleteEstablishment = async (establishmentId, partnerId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError(ESTABLISHMENT_REFUSALS.notOwner, 403, 'FORBIDDEN');
  }

  const result = await EstablishmentModel.deleteEstablishment(establishmentId, partnerId);

  if (!result) {
    const stillThere = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (stillThere) {
      throw new AppError(ESTABLISHMENT_REFUSALS.notDeletable, 403, 'ESTABLISHMENT_NOT_DELETABLE');
    }
    throw new AppError(ESTABLISHMENT_REFUSALS.notFound, 404, 'ESTABLISHMENT_NOT_FOUND');
  }

  logger.info('Establishment deleted by partner', { establishmentId, partnerId, name: result.name });
  return result;
};

