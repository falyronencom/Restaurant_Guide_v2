/**
 * File Upload Middleware
 *
 * Configures multer for handling file uploads (avatars, images).
 * Files are stored in backend/uploads/ with unique filenames.
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

// Ensure upload directories exist
const AVATARS_DIR = path.join(UPLOADS_ROOT, 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Storage configuration for avatar uploads.
 * Files saved as: uploads/avatars/{uuid}.{ext}
 */
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AVATARS_DIR);
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
    fileSize: 5 * 1024 * 1024, // 5MB
  },
}).single('avatar');

export { UPLOADS_ROOT };
