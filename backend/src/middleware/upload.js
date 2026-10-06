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
export const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: imageFilter,
  limits: {
    ...MULTIPART_LIMITS,
    fileSize: 5 * 1024 * 1024, // 5MB
  },
}).single('avatar');

export { UPLOADS_ROOT, TEMP_UPLOAD_DIR };
