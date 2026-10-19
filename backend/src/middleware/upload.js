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
import { AppError } from './errorHandler.js';
import { bodyHasNul, bodyNulRefusal, textHasNul } from './requestGuard.js';
import { discardTempUpload } from '../utils/tempUpload.js';
import logger from '../utils/logger.js';

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
 * What a person reads when the server cannot read the form they sent (below).
 * The app's next build shows a 400's text as is on the promotion form and the
 * wizard's photo upload (installed builds: the wizard after «Ошибка при
 * загрузке фото:», the promotion form its own text); the site has no text of
 * its own for INVALID_FORMAT and shows its general one. The wording was
 * approved by the Coordinator on 16.10.2026 (PR #52).
 */
export const UNREADABLE_FORM_MESSAGE = 'Не удалось прочитать отправленные данные. Попробуйте ещё раз.';

/**
 * busboy's refusals of a form it cannot read as a whole: the body ends, by
 * its own length, before the closing boundary (a truncated or empty form); a
 * part header that is not `Name: value`; a multipart Content-Type busboy
 * cannot parse (`boundary = x` — type-is, and so multer, lets the spaces
 * through), without a boundary, or of a subtype other than form-data. busboy
 * 1.6 raises them as plain Errors, told apart only by their text
 * (lib/index.js, lib/types/multipart.js); multer hands them on as they are,
 * and errorHandler, finding no status on them, answered 500 with an
 * error-level stack (probe 16.10.2026). Only these become the client's
 * refusal: a failed disk write, the route filter's refusal and anything else
 * go on unchanged. So does multer's «Request aborted» for a connection
 * dropped mid-send: Node's own request timeout ends a request with the same
 * text, and that one is not the client's to answer for.
 * unit/uploadNulGuard sends each form and holds this list against busboy's
 * own source, so a busboy that renames or adds a refusal turns a test red,
 * not a partner's form back into a 500.
 */
export const UNREADABLE_FORM_ERRORS = Object.freeze([
  'Unexpected end of form',
  'Malformed part header',
  'Malformed content type',
  'Multipart: Boundary not found',
]);

/** busboy's refusal of a multipart subtype it does not parse — the header follows the colon. */
export const UNSUPPORTED_TYPE_ERROR_PREFIX = 'Unsupported content type: ';

const isUnreadableForm = ({ message }) => typeof message === 'string'
  && (UNREADABLE_FORM_ERRORS.includes(message) || message.startsWith(UNSUPPORTED_TYPE_ERROR_PREFIX));

/**
 * 400 INVALID_FORMAT with UNREADABLE_FORM_MESSAGE, sent by errorHandler as a
 * client's error; busboy's own text goes to the log here, nowhere else.
 */
function unreadableFormRefusal(req, err) {
  logger.warn('Multipart form not readable', {
    reason: err.message,
    path: req.path,
    method: req.method,
    correlationId: req.correlationId,
  });
  return new AppError(UNREADABLE_FORM_MESSAGE, 400, 'INVALID_FORMAT');
}

/**
 * multer has already tried to remove the files of a request it aborted; what
 * it could not remove it leaves in err.storageErrors and says nothing. Such a
 * file stays in TEMP_UPLOAD_DIR, so it goes to the log, as discardTempUpload
 * logs its own failures. A file already gone (ENOENT) is the end wanted.
 */
function logStorageErrors(req, err) {
  const failures = (Array.isArray(err.storageErrors) ? err.storageErrors : [])
    .filter((failure) => failure?.code !== 'ENOENT');
  if (failures.length === 0) return;
  logger.warn('Failed to remove temp upload of an aborted form', {
    reason: err.code ?? err.message,
    // diskStorage clears file.path before it unlinks; the unlink error keeps it
    failures: failures.map((failure) => ({ path: failure.path ?? failure.file?.path, error: failure.message })),
    path: req.path,
    method: req.method,
    correlationId: req.correlationId,
  });
}

/**
 * The extension a temp file gets, by the file's type as the client declared
 * it — the types the uploaders' filters admit. The client's file name never
 * reaches the disk: until 10.2026 every uploader named its temp file uuid +
 * the extension of the client's name, and a name with a very long extension
 * could not be written — the request ended in a disk-write failure, a 500
 * with an error-level stack (probe 16.10.2026, PR #52). The client's extension
 * is still judged where it was judged: the card's media and the wizard's
 * upload refuse a foreign one (cloudinary.js hasValid*Extension, 422); the
 * avatar and the promotion's picture check the type only, as before. A type
 * outside the list gets no extension.
 */
export const TEMP_FILE_EXTENSIONS = Object.freeze({
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
});

/**
 * A temp file's name: uuid + the extension of its type. Own keys only — a
 * declared type such as `constructor` must not name an inherited member.
 *
 * @param {string} mimetype - The file's type as multer reports it
 * @returns {string}
 */
export const tempUploadName = (mimetype) => {
  const ext = Object.hasOwn(TEMP_FILE_EXTENSIONS, mimetype) ? TEMP_FILE_EXTENSIONS[mimetype] : '';
  return `${randomUUID()}${ext}`;
};

/**
 * The disk storage of every uploader (avatar, establishment media, promotions,
 * pre-registration temp media): TEMP_UPLOAD_DIR, a name from tempUploadName.
 */
export const tempUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, tempUploadName(file.mimetype));
  },
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
 *   is written (busboy decodes `%00` in an RFC 5987 `filename*`). The
 *   uploaders no longer name the temp file after the client's name
 *   (tempUploadStorage), but the rule is the same as for any other text the
 *   client sends. The route's own filter runs after this check, unchanged;
 * - a text field holding U+0000 is refused once the form is parsed; the file
 *   already written is discarded first (no controller will see it). Before
 *   this, a NUL in a promotion's title reached PostgreSQL (22021 → 500).
 * A field name cannot carry NUL this far — busboy reads no `name*`, and a raw
 * NUL inside a part's header makes it reject the whole form as malformed.
 *
 * A form busboy cannot read as a whole is refused here too — 400
 * INVALID_FORMAT with UNREADABLE_FORM_MESSAGE, on every uploader at once;
 * multer has already tried to remove what it wrote, and what it could not
 * remove (err.storageErrors) goes to the log here (logStorageErrors), for
 * every aborted form. The routes' own error handlers (media, temp media,
 * promotions, avatar) pass the refusal on to errorHandler.
 *
 * The route's chain goes on once per request. multer 2.4 can call back a
 * second time: when busboy's constructor refuses the form (a Content-Type it
 * cannot parse), multer calls back at once, but its listeners on the request,
 * set before the constructor, are still there — a connection that then closes
 * before the body ends aborts the request again ('Request closed' / 'Request
 * aborted') and calls back once more. The request has been answered by then;
 * a second next(err) ran the error handlers again, and Express printed the
 * stack of a response sent twice to stderr. The second call is dropped here.
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
      return (req, res, next) => {
        let calledBack = false;
        return parse(req, res, (err) => {
          if (calledBack) {
            logger.debug('Upload parser called back again after its answer', {
              reason: err?.message,
              path: req.path,
              method: req.method,
              correlationId: req.correlationId,
            });
            return undefined;
          }
          calledBack = true;
          if (err) {
            logStorageErrors(req, err);
            return next(isUnreadableForm(err) ? unreadableFormRefusal(req, err) : err);
          }
          if (!bodyHasNul(req.body)) return next();
          // discardTempUpload never rejects
          return discardTempUpload(req.file).then(() => next(bodyNulRefusal()));
        });
      };
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
 * Avatar upload middleware — single file, max 5MB. The file lands in
 * TEMP_UPLOAD_DIR (tempUploadStorage), then authController.uploadAvatar
 * transfers it to Cloudinary and unlinks it.
 */
export const uploadAvatar = createUpload({
  storage: tempUploadStorage,
  fileFilter: imageFilter,
  limits: {
    ...MULTIPART_LIMITS,
    fileSize: 5 * 1024 * 1024, // 5MB
  },
}).single('avatar');

export { UPLOADS_ROOT, TEMP_UPLOAD_DIR };
