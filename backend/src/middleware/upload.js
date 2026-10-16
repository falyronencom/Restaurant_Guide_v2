/**
 * File Upload Middleware
 *
 * Configures multer for avatar uploads and owns the temp directory every multer
 * destination in the backend writes to (TEMP_UPLOAD_DIR = backend/tmp/uploads)
 * before the Cloudinary transfer. backend/uploads/ is only served statically for
 * legacy avatar URLs.
 */

import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { bodyHasNul, bodyNulRefusal, textHasNul } from './requestGuard.js';
import { discardTempUpload } from '../utils/tempUpload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Uploads root directory (backend/uploads/)
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

// Legacy avatars directory — kept for express.static fallback of old relative URLs
const AVATARS_DIR = path.join(UPLOADS_ROOT, 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

// Temp directory for multer uploads (avatars, establishment media, promotions,
// pre-registration temp media) before the Cloudinary transfer.
// Module-relative on purpose: the server runs with cwd = backend/ locally
// (`npm start`) and /app on Railway (Root Directory = backend), so a cwd-relative
// 'backend/tmp/uploads' used to land in backend/backend/tmp/uploads locally and
// /app/backend/tmp/uploads in the container. Every multer destination imports
// this constant; importing the module also guarantees the directory exists
// before the first write.
const TEMP_UPLOAD_DIR = path.join(__dirname, '..', '..', 'tmp', 'uploads');
fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

/**
 * Multipart parsing limits shared by every multer instance in the backend
 * (fileSize stays per route). Until 2026-10 none were set: parsing a request was
 * bounded by nothing but the file size (review 02.10.2026, S1).
 *
 * Every upload form the clients send — the app in every version, the site — is
 * one file plus at most five flat text fields; the promotions controller reads
 * seven. Hence:
 * - fields: 10 — the 11th text field aborts the request (LIMIT_FIELD_COUNT);
 * - parts: 20 — busboy counts every part, including parts without a
 *   Content-Disposition that are neither a field nor a file and slip past the
 *   limit above; the 21st part aborts the request (LIMIT_PART_COUNT — multer
 *   hands busboy parts + 1, so the value is the maximum allowed);
 * - fieldNestingDepth: 0 — no client sends a bracketed name (a[b]), from which
 *   multer would build nested objects (LIMIT_FIELD_NESTING). An array index
 *   needs a bracket too, so fieldArrayIndexLimit adds nothing at depth 0.
 * `files` stays unset: every route takes .single(name), which already refuses a
 * second file (LIMIT_UNEXPECTED_FILE).
 */
export const MULTIPART_LIMITS = Object.freeze({
  fields: 10,
  parts: 20,
  fieldNestingDepth: 0,
});

/**
 * The only way the backend builds multer: the avatar below and the routes
 * (establishment media, promotions, pre-registration temp media) take their
 * storage, fileFilter and limits through here (unit/uploadNulGuard holds it).
 *
 * On top of the route's options it applies the NUL rule of requestGuard to
 * what multer parses inside the route, after that guard, with the same
 * refusal (400 INVALID_FORMAT):
 * - a file name holding U+0000 is refused in the file filter, before anything
 *   is written: every route names its temp file after the client's extension,
 *   and a path holding NUL cannot be written (busboy decodes `%00` in an
 *   RFC 5987 `filename*`). The route's own filter runs after this check,
 *   unchanged;
 * - a text field holding U+0000 is refused once the form is parsed; the file
 *   already written is discarded first (no controller will see it). Before
 *   this, a NUL in a promotion's title reached PostgreSQL (22021 → 500).
 * A field name cannot carry NUL this far — busboy reads no `name*`, and a raw
 * NUL inside a part's header makes it reject the whole form as malformed.
 *
 * @param {Object} options - multer options ({ storage, fileFilter, limits })
 * @returns {{ single: (fieldName: string) => Function }} the routes take .single only
 */
export function createUpload({ fileFilter, ...options }) {
  const upload = multer({
    ...options,
    fileFilter: (req, file, cb) => {
      if (textHasNul(file.originalname)) return cb(bodyNulRefusal());
      if (fileFilter) return fileFilter(req, file, cb);
      return cb(null, true);
    },
  });

  return {
    single(fieldName) {
      const parse = upload.single(fieldName);
      return (req, res, next) => parse(req, res, (err) => {
        if (err) return next(err);
        if (!bodyHasNul(req.body)) return next();
        // discardTempUpload never rejects
        return discardTempUpload(req.file).then(() => next(bodyNulRefusal()));
      });
    },
  };
}

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Storage configuration for avatar uploads.
 * Files saved as: tmp/uploads/{uuid}.{ext} (TEMP_UPLOAD_DIR), then transferred
 * to Cloudinary by authController.uploadAvatar and unlinked.
 */
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${randomUUID()}${ext}`);
  },
});

/**
 * File filter — only allow images
 */
const imageFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('INVALID_FILE_TYPE'), false);
  }
};

/**
 * Avatar upload middleware — single file, max 5MB
 */
export const uploadAvatar = createUpload({
  storage: avatarStorage,
  fileFilter: imageFilter,
  limits: {
    ...MULTIPART_LIMITS,
    fileSize: 5 * 1024 * 1024, // 5MB
  },
}).single('avatar');

export { UPLOADS_ROOT, TEMP_UPLOAD_DIR };
