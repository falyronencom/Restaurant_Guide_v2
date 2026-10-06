/**
 * Cloudinary Configuration and Utilities
 * 
 * This module configures the Cloudinary SDK and provides helper functions for
 * image upload, URL generation with optimization parameters, and deletion.
 * 
 * Cloudinary serves as the image hosting and optimization platform for all
 * establishment media. It provides automatic format optimization (WebP for
 * modern browsers, JPEG fallback), quality adjustment, and progressive loading.
 * 
 * Architecture note: This module encapsulates all Cloudinary-specific logic,
 * making it easy to swap CDN providers in the future if needed. The media
 * service layer calls these utilities without knowing implementation details.
 * 
 * Critical requirements:
 * - ALL images must include optimization parameters: f_auto, q_auto, fl_progressive
 * - THREE resolutions generated for each upload: original, preview, thumbnail
 * - Proper error handling for upload failures
 * - Clean deletion when media is removed
 */

import { v2 as cloudinary } from 'cloudinary';
import logger from '../utils/logger.js';

/**
 * Configure Cloudinary SDK with credentials from environment variables
 * 
 * Required environment variables:
 * - CLOUDINARY_CLOUD_NAME: Your Cloudinary cloud name
 * - CLOUDINARY_API_KEY: Your Cloudinary API key
 * - CLOUDINARY_API_SECRET: Your Cloudinary API secret
 * 
 * These credentials are configured in the .env file and should never be
 * committed to version control. They provide authenticated access to your
 * Cloudinary account for upload, transformation, and deletion operations.
 */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // Always use HTTPS for security
});

/**
 * Image resolution configurations for the three-tier system
 * 
 * Each uploaded image is available in three resolutions to optimize
 * bandwidth and loading performance:
 * 
 * - Original: Maximum 1920x1080, maintains aspect ratio
 *   Used for: Full-screen image viewing, high-quality displays
 * 
 * - Preview: 800x600, fit within bounds maintaining aspect
 *   Used for: Detail screens, medium-sized image displays
 * 
 * - Thumbnail: 200x150, fill entire bounds with cropping
 *   Used for: List views, gallery thumbnails, fast loading
 */
/**
 * Avatar image configuration
 *
 * Avatars use a single optimized size (256×256) instead of the three-tier
 * system used for establishment media. Mobile picker constrains to 512×512,
 * so server-side 256×256 is always a downscale — never an upscale.
 */
const AVATAR_CONFIG = {
  width: 256,
  height: 256,
  crop: 'fill',
  gravity: 'face', // Cloudinary face detection for better avatar crops
};

/**
 * Delivery-time variants (2026-07-20 uplift for DPR 2–3 screens).
 *
 * No height cap on original/preview: a height cap crushes vertical photos
 * (menu shots are usually vertical — a 3024×4032 phone photo capped at
 * h=1080 keeps only 810×1080 and menu text turns to mush). c_limit bounds
 * the width only, never upscales, and lets the long side of verticals
 * survive. Thumbnail keeps a fill crop — cards need a fixed aspect.
 */
const RESOLUTION_CONFIG = {
  original: {
    width: 1920,
    crop: 'limit', // Cap width only, never upscale
  },
  preview: {
    width: 1200,
    crop: 'limit', // Mid-size for tiles/cards; covers ~600 CSS px at DPR 2
  },
  thumbnail: {
    width: 400,
    height: 300,
    crop: 'fill', // Fixed-aspect crop for card covers
  },
};

/**
 * PDF menu configuration
 *
 * Cloudinary treats PDFs as multi-page images when uploaded with
 * resource_type: 'image'. This enables page-level transformations via
 * pg_N (select page) + f_jpg (convert to JPG) URL parameters, while the
 * original PDF remains fully downloadable via the upload URL.
 *
 * We expose two derived URLs from the first page:
 * - thumbnail: 200x150 fill crop for gallery tiles
 * - preview:   800x600 fit for larger detail display
 *
 * Size limit is 60MB (vs 10MB for images) to accommodate scanned menus.
 */
const PDF_MAX_SIZE = 60 * 1024 * 1024; // 60MB in bytes

const PDF_THUMBNAIL_CONFIG = {
  page: 1,
  width: 400,
  height: 300,
  crop: 'fill',
};

const PDF_PREVIEW_CONFIG = {
  page: 1,
  width: 1200,
  crop: 'limit', // Width cap only — vertical menu pages keep their long side
};

/**
 * Upload an image to Cloudinary
 * 
 * This function handles the complete upload workflow:
 * 1. Upload image to Cloudinary with quality optimization
 * 2. Store in folder structure for organization
 * 3. Return public_id and secure URL for database storage
 * 
 * The uploaded image is stored in a folder structure:
 * establishments/{establishmentId}/{filename}
 * 
 * This organization makes it easy to:
 * - Find all images for a specific establishment
 * - Perform bulk operations (backup, migration)
 * - Debug issues with specific establishments
 * 
 * @param {string} filePath - Local file path of the image to upload
 * @param {string} establishmentId - UUID of the establishment (for folder organization)
 * @param {string} mediaType - Type of media ('interior', 'exterior', 'menu', 'dishes')
 * @returns {Promise<Object>} Upload result with public_id and secure_url
 * @throws {Error} If upload fails
 */
export const uploadImage = async (filePath, establishmentId, mediaType) => {
  try {
    // Store the ORIGINAL as-is — no incoming transformation. Resizing at
    // upload permanently destroys the master (a vertical phone photo capped
    // at 1080 loses menu-text legibility forever) and double-compresses
    // (q_auto at upload + q_auto at delivery). All sizing/quality happens at
    // delivery time via generateImageUrl (Cloudinary's recommended model).
    const uploadResult = await cloudinary.uploader.upload(filePath, {
      folder: `establishments/${establishmentId}/${mediaType}`,
      resource_type: 'image',
    });

    logger.info('Image uploaded to Cloudinary', {
      publicId: uploadResult.public_id,
      establishmentId,
      mediaType,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
    });

    return {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
    };
  } catch (error) {
    logger.error('Error uploading image to Cloudinary', {
      error: error.message,
      establishmentId,
      mediaType,
    });
    throw new Error(`Failed to upload image: ${error.message}`);
  }
};

/**
 * Generate optimized URL for an image with specified resolution
 * 
 * This function constructs Cloudinary URLs with transformation parameters
 * for the requested resolution. All URLs include optimization parameters
 * for automatic format and quality selection.
 * 
 * The transformation parameters are applied in the URL structure:
 * https://res.cloudinary.com/{cloud_name}/image/upload/{transformations}/{public_id}.jpg
 * 
 * Example URL:
 * https://res.cloudinary.com/mycloud/image/upload/f_auto,q_auto,fl_progressive,w_800,h_600,c_fit/establishments/abc-123/interior/photo.jpg
 * 
 * @param {string} publicId - Cloudinary public_id from upload
 * @param {string} resolution - Resolution type ('original', 'preview', 'thumbnail')
 * @returns {string} Optimized image URL with transformations
 */
export const generateImageUrl = (publicId, resolution = 'original') => {
  const config = RESOLUTION_CONFIG[resolution];

  if (!config) {
    logger.warn('Invalid resolution requested, using original', { resolution });
    return generateImageUrl(publicId, 'original');
  }

  // Generate URL with transformation parameters. Config is spread so variants
  // without a height cap emit no h_ component at all.
  const url = cloudinary.url(publicId, {
    transformation: [
      { ...config },
      {
        fetch_format: 'auto',
        quality: 'auto',
        flags: 'progressive',
      },
    ],
    secure: true, // Always use HTTPS
  });

  return url;
};

/**
 * Generate all three resolution URLs for an image
 * 
 * This convenience function generates URLs for all three resolutions
 * in a single call. The media model uses this to populate the three
 * URL fields in the database when creating media records.
 * 
 * @param {string} publicId - Cloudinary public_id from upload
 * @returns {Object} Object with url, preview_url, and thumbnail_url properties
 */
export const generateAllResolutions = (publicId) => {
  return {
    url: generateImageUrl(publicId, 'original'),
    preview_url: generateImageUrl(publicId, 'preview'),
    thumbnail_url: generateImageUrl(publicId, 'thumbnail'),
  };
};

/**
 * Asset ownership: the cloud's folder layout is the ownership record.
 *
 * Every upload path files an asset under its owner's folder:
 * - uploadAvatar → avatars/{userId}/…
 * - uploadImage / uploadPdf → establishments/{establishmentId}/…
 * - the partner temp-upload route → establishments/temp/{userId}/… (uploadImage
 *   with `temp/${userId}`; permanent storage despite the name)
 *
 * A public_id reaching a destroy call is derived from a stored URL, and clients
 * could store any URL — an avatar link via PUT /auth/profile, a card's media URLs
 * via the establishment PUT — so any registered user could get someone else's
 * photo, PDF menu or avatar destroyed (review 02.10.2026, N1). deleteImage
 * therefore destroys only an asset inside a folder the caller names as its own,
 * built with ownedFolders from the authenticated caller and the object it owns —
 * never from the URL itself.
 */
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const OWNED_FOLDER_PATTERN = new RegExp(`^(?:avatars|establishments|establishments/temp)/${UUID_SOURCE}/$`);
// Path segments of letters, digits, '_' and '-' only. Rules out '.' and '..'
// segments, empty segments, encoded or back slashes and spaces: our uploads
// produce none of them, and any of them could make a prefix check say «inside»
// about an id that points elsewhere.
const PLAIN_PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

/**
 * Builders of the folders an owner holds. The result is checked where it is
 * used (deleteImage, isOwnedAsset): a folder whose id is not a UUID names
 * nothing.
 */
export const ownedFolders = {
  avatars: (userId) => `avatars/${userId}/`,
  establishment: (establishmentId) => `establishments/${establishmentId}/`,
  partnerUploads: (userId) => `establishments/temp/${userId}/`,
};

/**
 * Why `publicId` may not be destroyed for a caller owning `folders`, or null
 * when it may. Folder strings outside the layout above are ignored, so an empty
 * or truncated scope never widens to «everything».
 */
const ownershipRefusal = (publicId, folders) => {
  if (typeof publicId !== 'string' || !PLAIN_PUBLIC_ID_PATTERN.test(publicId)) {
    return 'not_a_plain_asset_id';
  }
  const owned = (Array.isArray(folders) ? folders : [])
    .filter((folder) => typeof folder === 'string' && OWNED_FOLDER_PATTERN.test(folder));
  if (owned.length === 0) return 'no_owned_folder_named';
  if (!owned.some((folder) => publicId.startsWith(folder))) return 'outside_owned_folders';
  return null;
};

/**
 * True when the asset lies inside one of the given owned folders.
 *
 * @param {string} publicId - Cloudinary public_id
 * @param {string[]} folders - Folders built with ownedFolders
 * @returns {boolean}
 */
export const isOwnedAsset = (publicId, folders) => ownershipRefusal(publicId, folders) === null;

/**
 * Delete an image from Cloudinary — only an asset inside one of the caller's own
 * folders (see ownedFolders above); anything else is refused, not destroyed.
 * 
 * It should be called when media is deleted from the database to prevent
 * orphaned files that consume storage quota.
 * 
 * The function is idempotent - calling it multiple times with the same
 * public_id will succeed without error (even if the image was already deleted).
 * 
 * @param {string} publicId - Cloudinary public_id to delete
 * @param {string[]} folders - The caller's own folders, built with
 *   ownedFolders from the authenticated caller and the object it owns
 * @returns {Promise<Object>} Deletion result; { result: 'refused' } when the
 *   asset is not inside the given folders
 * @throws {Error} If deletion fails
 */
export const deleteImage = async (publicId, folders) => {
  const refusal = ownershipRefusal(publicId, folders);
  if (refusal) {
    // No ids and no file names: the public_id may come from client-supplied text.
    const topFolder = typeof publicId === 'string' ? publicId.split('/')[0] : '';
    logger.warn('Cloudinary delete refused: the asset is not in the caller\'s folders', {
      reason: refusal,
      topFolder: ['avatars', 'establishments'].includes(topFolder) ? topFolder : 'other',
    });
    return { result: 'refused' };
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId);

    logger.info('Image deleted from Cloudinary', {
      publicId,
      result: result.result, // 'ok' if successful, 'not found' if already deleted
    });

    return result;
  } catch (error) {
    logger.error('Error deleting image from Cloudinary', {
      error: error.message,
      publicId,
    });
    throw new Error(`Failed to delete image: ${error.message}`);
  }
};

/**
 * Extract public_id from Cloudinary URL
 * 
 * When deleting media, we need to extract the public_id from the stored URL
 * to call the deletion API. This function parses various Cloudinary URL formats
 * to extract the public_id.
 * 
 * Example URL formats:
 * - https://res.cloudinary.com/cloud/image/upload/v1234567890/establishments/abc/interior/photo.jpg
 * - https://res.cloudinary.com/cloud/image/upload/transformations/establishments/abc/interior/photo.jpg
 * 
 * Extracted public_id: establishments/abc/interior/photo
 * 
 * @param {string} cloudinaryUrl - Full Cloudinary URL
 * @returns {string|null} Extracted public_id or null if parsing fails
 */
export const extractPublicIdFromUrl = (cloudinaryUrl) => {
  try {
    // Query string first (canonical delivery URLs carry ?_a=... analytics).
    const urlParts = String(cloudinaryUrl).split('?')[0].split('/upload/');

    if (urlParts.length < 2) {
      logger.warn('Invalid Cloudinary URL format', { cloudinaryUrl });
      return null;
    }

    // After '/upload/' a URL may chain SEVERAL transformation segments plus a
    // version segment before the public_id:
    //   .../upload/c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/.../abc123xyz
    // Skip ALL leading segments that are transformations (contain ',') or a
    // version marker (strictly v+digits — 'vintage-cafe' must NOT be eaten).
    const pathParts = urlParts[1].split('/');
    let startIndex = 0;
    while (
      startIndex < pathParts.length - 1 &&
      (pathParts[startIndex].includes(',') || /^v\d+$/.test(pathParts[startIndex]))
    ) {
      startIndex += 1;
    }

    // Rejoin the path; strip the extension of the LAST segment only (canonical
    // image URLs are extension-less — folder dots must survive).
    const remaining = pathParts.slice(startIndex);
    const last = remaining[remaining.length - 1].replace(/\.[^.]+$/, '');
    const publicId = [...remaining.slice(0, -1), last].join('/');

    if (!publicId) {
      logger.warn('Empty public_id extracted from URL', { cloudinaryUrl });
      return null;
    }

    logger.debug('Extracted public_id from URL', {
      cloudinaryUrl,
      publicId,
    });

    return publicId;
  } catch (error) {
    logger.error('Error extracting public_id from URL', {
      error: error.message,
      cloudinaryUrl,
    });
    return null;
  }
};

/**
 * public_id of a delivery URL on this project's cloud, or null for any other
 * link — another host, another cloud, another resource type, plain http.
 *
 * The URL is resolved first (dot segments, backslashes, fragment), so the id
 * returned is the asset the link actually points at, not its spelling.
 *
 * @param {string} url - A stored media, avatar or promotion image URL
 * @returns {string|null} The public_id, or null when the link is not ours
 */
export const ownCloudPublicId = (url) => {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.host !== 'res.cloudinary.com'
    || !parsed.pathname.startsWith(`/${cloudinary.config().cloud_name}/image/upload/`)
  ) {
    return null;
  }
  return extractPublicIdFromUrl(`${parsed.origin}${parsed.pathname}`);
};

/**
 * The transformation parameters our URL builders emit (generateAllResolutions,
 * the PDF previews, the old seed builder): crop, width, height, format, quality,
 * the progressive flag and the PDF page. A delivery URL may carry any other
 * parameter, and some of them draw something besides the asset into the picture:
 * a layer of another asset, of a remote file or of text (l_, u_), a default image
 * (d_), a named transformation (t_), an effect (e_).
 */
const PLAIN_TRANSFORMATION_PARAM = /^(?:c|w|h|f|q|fl|pg)_[a-z0-9]+$/;

/**
 * True when every transformation in a delivery URL only resizes, crops or
 * reformats the asset, so the picture shows that asset and nothing else
 * (review 02.10.2026, N3). Looks at the segments extractPublicIdFromUrl skips
 * before the public_id — those with a comma, and version markers. Judge the
 * host and the asset with ownCloudPublicId; false for a link that does not parse.
 *
 * @param {string} url - A delivery URL
 * @returns {boolean}
 */
export const hasPlainTransformations = (url) => {
  let pathname;
  try {
    ({ pathname } = new URL(url));
  } catch {
    return false;
  }
  const marker = '/image/upload/';
  const start = pathname.indexOf(marker);
  if (start === -1) return false;
  for (const segment of pathname.slice(start + marker.length).split('/')) {
    if (/^v\d+$/.test(segment)) continue;
    if (!segment.includes(',')) break;
    if (!segment.split(',').every((param) => PLAIN_TRANSFORMATION_PARAM.test(param))) return false;
  }
  return true;
};

/**
 * Validate image file type
 * 
 * This function checks if the uploaded file is a valid image type.
 * We accept common web image formats that Cloudinary can optimize.
 * 
 * Accepted formats:
 * - JPEG/JPG: Most common, good compression
 * - PNG: Lossless, supports transparency
 * - WebP: Modern format, excellent compression
 * - HEIC: iOS native format (Cloudinary converts to web formats)
 * 
 * Not accepted:
 * - GIF: Use video for animations
 * - BMP: Uncompressed, too large
 * - TIFF: Professional format, not web-optimized
 * 
 * @param {string} mimetype - MIME type from uploaded file
 * @returns {boolean} True if valid image type
 */
export const isValidImageType = (mimetype) => {
  const validTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
  ];

  return validTypes.includes(mimetype);
};

/**
 * Extension allow-lists, complementing the mimetype checks above.
 *
 * The mimetype is client-supplied and derived from OS file associations, so it
 * cannot be trusted alone: a PDF-compatible `.ai` (Adobe Illustrator) file is
 * reported as application/pdf on machines where Acrobat owns the extension,
 * passes isValidPdfType, and lands in the menu bucket as an asset browsers
 * cannot render (MARKS, 2026-07-20). Content sniffing cannot catch this either
 * — PDF-compatible .ai files start with the same %PDF- magic bytes — so the
 * file name extension is the discriminating signal.
 */
const IMAGE_FILE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'jfif'];

/**
 * Lower-cased extension of a file name or URL ('' when there is none).
 * Exported for the URL-level media gate: canonical Cloudinary delivery URLs
 * built by generateAllResolutions carry NO extension (cloudinary.url() without
 * `format`), so '' is a shape the gate must treat as system-generated.
 */
export const fileExtension = (filename) => {
  if (typeof filename !== 'string') return '';
  const base = filename.split('?')[0];
  // Look only at the last path segment — for URLs the host dots
  // (res.cloudinary.com) must not read as an extension.
  const lastSegment = base.slice(base.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  return dot === -1 ? '' : lastSegment.slice(dot + 1).toLowerCase();
};

/**
 * Validate image file extension (jpg/jpeg/png/webp/heic)
 *
 * @param {string} filename - Original file name (or URL) of the upload
 * @returns {boolean} True if the extension is an accepted image format
 */
export const hasValidImageExtension = (filename) => {
  return IMAGE_FILE_EXTENSIONS.includes(fileExtension(filename));
};

/**
 * Validate PDF file extension
 *
 * @param {string} filename - Original file name (or URL) of the upload
 * @returns {boolean} True if the extension is .pdf
 */
export const hasValidPdfExtension = (filename) => {
  return fileExtension(filename) === 'pdf';
};

/**
 * Validate image file size
 * 
 * We enforce a maximum file size to prevent abuse and ensure reasonable
 * upload times. The 10MB limit is generous for high-quality photos while
 * preventing extremely large files.
 * 
 * For context:
 * - Modern smartphone photo: 2-5MB
 * - Professional DSLR photo: 5-15MB (acceptable)
 * - Unnecessarily large file: >20MB (rejected)
 * 
 * @param {number} sizeInBytes - File size in bytes
 * @returns {boolean} True if size is acceptable
 */
export const isValidImageSize = (sizeInBytes) => {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB in bytes
  return sizeInBytes <= MAX_SIZE;
};

/**
 * Upload an avatar image to Cloudinary
 *
 * Stores avatars in a dedicated folder structure: avatars/{userId}/{filename}
 * Applies a single 256×256 fill crop with face detection for optimal results.
 *
 * @param {string} filePath - Local file path of the image to upload
 * @param {string} userId - UUID of the user (for folder organization)
 * @returns {Promise<Object>} Upload result with public_id and secure_url
 * @throws {Error} If upload fails
 */
/**
 * Validate PDF file type
 *
 * @param {string} mimetype - MIME type from uploaded file
 * @returns {boolean} True if valid PDF type
 */
export const isValidPdfType = (mimetype) => {
  return mimetype === 'application/pdf';
};

/**
 * Validate PDF file size (60MB limit for scanned menus)
 *
 * @param {number} sizeInBytes - File size in bytes
 * @returns {boolean} True if size is acceptable
 */
export const isValidPdfSize = (sizeInBytes) => {
  return sizeInBytes <= PDF_MAX_SIZE;
};

/**
 * Upload a PDF menu to Cloudinary
 *
 * Stored under resource_type: 'image' — Cloudinary accepts PDF files in the
 * image pipeline and enables page-level transformations (pg_N, f_jpg) while
 * preserving the full PDF for download/viewing. folder structure matches
 * establishment media convention: establishments/{id}/menu_pdf/{filename}
 *
 * @param {string} filePath - Local file path of the PDF to upload
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<Object>} Upload result with public_id, secure_url, bytes, pages
 * @throws {Error} If upload fails
 */
export const uploadPdf = async (filePath, establishmentId) => {
  try {
    const uploadResult = await cloudinary.uploader.upload(filePath, {
      folder: `establishments/${establishmentId}/menu_pdf`,
      resource_type: 'image', // required for PDF page transformations
    });

    logger.info('PDF uploaded to Cloudinary', {
      publicId: uploadResult.public_id,
      establishmentId,
      bytes: uploadResult.bytes,
      pages: uploadResult.pages,
    });

    return {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url,
      bytes: uploadResult.bytes,
      pages: uploadResult.pages,
    };
  } catch (error) {
    logger.error('Error uploading PDF to Cloudinary', {
      error: error.message,
      establishmentId,
    });
    throw new Error(`Failed to upload PDF: ${error.message}`);
  }
};

/**
 * Generate thumbnail URL for PDF first page (200x150 fill crop)
 *
 * Uses pg_1 (first page) + f_jpg (convert to JPG) transformations.
 * Result is a static JPG image URL suitable for gallery tiles.
 *
 * @param {string} publicId - Cloudinary public_id from PDF upload
 * @returns {string} Thumbnail URL
 */
export const generatePdfThumbnailUrl = (publicId) => {
  return cloudinary.url(publicId, {
    resource_type: 'image',
    transformation: [
      {
        page: PDF_THUMBNAIL_CONFIG.page,
        width: PDF_THUMBNAIL_CONFIG.width,
        height: PDF_THUMBNAIL_CONFIG.height,
        crop: PDF_THUMBNAIL_CONFIG.crop,
      },
      {
        fetch_format: 'jpg',
        quality: 'auto',
      },
    ],
    secure: true,
    format: 'jpg',
  });
};

/**
 * Generate preview URL for PDF first page (800x600 fit)
 *
 * Used for larger preview in detail card before user opens full viewer.
 *
 * @param {string} publicId - Cloudinary public_id from PDF upload
 * @returns {string} Preview URL
 */
export const generatePdfPreviewUrl = (publicId) => {
  return cloudinary.url(publicId, {
    resource_type: 'image',
    transformation: [
      // Spread: the preview config carries no height cap (vertical menu pages).
      { ...PDF_PREVIEW_CONFIG },
      {
        fetch_format: 'jpg',
        quality: 'auto',
      },
    ],
    secure: true,
    format: 'jpg',
  });
};

/**
 * Generate full-resolution image URL for a specific PDF page.
 *
 * Used by the OCR pipeline, which reads every PDF menu as page images
 * (ocrService.extractPageTexts): each page is fetched as an image via pg_N
 * transformation, one vision call per page.
 *
 * Unlike thumbnail/preview helpers, this produces the page at its native
 * resolution (no width/height crop) — Vision models need readable text.
 *
 * @param {string} pdfUrl - Original PDF secure_url from establishment_media
 * @param {number} pageNum - 1-based page number
 * @returns {string} Cloudinary URL rendering the given page as JPG
 */
export const generatePdfPageImageUrl = (pdfUrl, pageNum) => {
  return pdfUrl
    .replace('/upload/', `/upload/pg_${pageNum}/`)
    .replace(/\.pdf$/i, '.jpg');
};

export const uploadAvatar = async (filePath, userId) => {
  try {
    const uploadResult = await cloudinary.uploader.upload(filePath, {
      folder: `avatars/${userId}`,
      resource_type: 'image',
      transformation: [
        {
          width: AVATAR_CONFIG.width,
          height: AVATAR_CONFIG.height,
          crop: AVATAR_CONFIG.crop,
          gravity: AVATAR_CONFIG.gravity,
          quality: 'auto',
          fetch_format: 'auto',
        },
      ],
    });

    logger.info('Avatar uploaded to Cloudinary', {
      publicId: uploadResult.public_id,
      userId,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
    });

    return {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url,
    };
  } catch (error) {
    logger.error('Error uploading avatar to Cloudinary', {
      error: error.message,
      userId,
    });
    throw new Error(`Failed to upload avatar: ${error.message}`);
  }
};

export default cloudinary;

