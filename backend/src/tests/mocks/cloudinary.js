/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Cloudinary Mock for Unit and Integration Tests
 *
 * Provides mocked Cloudinary operations for testing media upload,
 * URL generation, and deletion without hitting the real Cloudinary API.
 *
 * Follows the same pattern as redis.js mock:
 * - Named exports matching config/cloudinary.js
 * - All functions as jest.fn() with sensible defaults
 * - resetCloudinaryMocks() helper for beforeEach cleanup
 */

import { jest } from '@jest/globals';

/**
 * Mock: Upload image to Cloudinary
 * Returns a realistic upload result object
 */
export const uploadImage = jest.fn(async () => ({
  public_id: 'test-public-id',
  secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/interior/test.jpg',
  width: 800,
  height: 600,
  format: 'jpg',
}));

/**
 * Mock: Generate all three resolution URLs (original, preview, thumbnail)
 * Must match the real function name: generateAllResolutions (NOT generateMediaUrls)
 */
export const generateAllResolutions = jest.fn((publicId) => ({
  url: `https://res.cloudinary.com/test/image/upload/w_1920,h_1080,c_limit/f_auto,q_auto,fl_progressive/${publicId || 'test-public-id'}.jpg`,
  preview_url: `https://res.cloudinary.com/test/image/upload/w_800,h_600,c_fit/f_auto,q_auto,fl_progressive/${publicId || 'test-public-id'}.jpg`,
  thumbnail_url: `https://res.cloudinary.com/test/image/upload/w_200,h_150,c_fill/f_auto,q_auto,fl_progressive/${publicId || 'test-public-id'}.jpg`,
}));

/**
 * Mock: Generate URL for a single resolution
 */
export const generateImageUrl = jest.fn((publicId, resolution = 'original') => {
  const sizes = {
    original: 'w_1920,h_1080,c_limit',
    preview: 'w_800,h_600,c_fit',
    thumbnail: 'w_200,h_150,c_fill',
  };
  const size = sizes[resolution] || sizes.original;
  return `https://res.cloudinary.com/test/image/upload/${size}/f_auto,q_auto,fl_progressive/${publicId || 'test-public-id'}.jpg`;
});

/**
 * Mock: Upload avatar to Cloudinary
 * Returns a realistic upload result for user avatars
 */
export const uploadAvatar = jest.fn(async () => ({
  public_id: 'avatars/test-user-id/test-avatar',
  secure_url: 'https://res.cloudinary.com/test/image/upload/w_256,h_256,c_fill/avatars/test-user-id/test-avatar.jpg',
}));

/**
 * Mock: Delete image from Cloudinary
 */
export const deleteImage = jest.fn(async () => ({
  result: 'ok',
}));

/**
 * Mock: Extract public_id from Cloudinary URL
 */
export const extractPublicIdFromUrl = jest.fn((url) => {
  if (!url) return null;
  // Simple extraction: take path after /upload/, skip version, remove extension
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
  return match ? match[1] : 'test-public-id';
});

/**
 * Mock: Validate image MIME type
 */
export const isValidImageType = jest.fn(() => true);

/**
 * Mock: Validate image file size
 */
export const isValidImageSize = jest.fn(() => true);

/**
 * Mock: Extension gates — mirror the real allow-list logic so format-rejection
 * paths behave realistically by default
 */
export const hasValidImageExtension = jest.fn(
  (name) => /\.(jpe?g|png|webp|heic|jfif)$/i.test(String(name || '').split('?')[0]),
);
export const hasValidPdfExtension = jest.fn(
  (name) => /\.pdf$/i.test(String(name || '').split('?')[0]),
);
export const fileExtension = jest.fn((name) => {
  const base = String(name || '').split('?')[0];
  const seg = base.slice(base.lastIndexOf('/') + 1);
  const dot = seg.lastIndexOf('.');
  return dot === -1 ? '' : seg.slice(dot + 1).toLowerCase();
});

/**
 * Mock: Raw cloudinary instance (default export)
 */
const cloudinaryInstance = {};
export default cloudinaryInstance;

/**
 * Reset all Cloudinary mocks to default state
 * Call in beforeEach to ensure clean state between tests
 */
export function resetCloudinaryMocks() {
  uploadImage.mockReset().mockResolvedValue({
    public_id: 'test-public-id',
    secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/interior/test.jpg',
    width: 800,
    height: 600,
    format: 'jpg',
  });

  generateAllResolutions.mockReset().mockImplementation((publicId) => ({
    url: `https://res.cloudinary.com/test/image/upload/w_1920,h_1080,c_limit/f_auto,q_auto,fl_progressive/${publicId || 'test-public-id'}.jpg`,
    preview_url: `https://res.cloudinary.com/test/image/upload/w_800,h_600,c_fit/f_auto,q_auto,fl_progressive/${publicId || 'test-public-id'}.jpg`,
    thumbnail_url: `https://res.cloudinary.com/test/image/upload/w_200,h_150,c_fill/f_auto,q_auto,fl_progressive/${publicId || 'test-public-id'}.jpg`,
  }));

  generateImageUrl.mockReset().mockImplementation((publicId, resolution = 'original') => {
    const sizes = {
      original: 'w_1920,h_1080,c_limit',
      preview: 'w_800,h_600,c_fit',
      thumbnail: 'w_200,h_150,c_fill',
    };
    const size = sizes[resolution] || sizes.original;
    return `https://res.cloudinary.com/test/image/upload/${size}/f_auto,q_auto,fl_progressive/${publicId || 'test-public-id'}.jpg`;
  });

  uploadAvatar.mockReset().mockResolvedValue({
    public_id: 'avatars/test-user-id/test-avatar',
    secure_url: 'https://res.cloudinary.com/test/image/upload/w_256,h_256,c_fill/avatars/test-user-id/test-avatar.jpg',
  });

  deleteImage.mockReset().mockResolvedValue({ result: 'ok' });

  extractPublicIdFromUrl.mockReset().mockImplementation((url) => {
    if (!url) return null;
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
    return match ? match[1] : 'test-public-id';
  });

  isValidImageType.mockReset().mockReturnValue(true);
  isValidImageSize.mockReset().mockReturnValue(true);
  hasValidImageExtension.mockReset().mockImplementation(
    (name) => /\.(jpe?g|png|webp|heic|jfif)$/i.test(String(name || '').split('?')[0]),
  );
  hasValidPdfExtension.mockReset().mockImplementation(
    (name) => /\.pdf$/i.test(String(name || '').split('?')[0]),
  );
  fileExtension.mockReset().mockImplementation((name) => {
    const base = String(name || '').split('?')[0];
    const seg = base.slice(base.lastIndexOf('/') + 1);
    const dot = seg.lastIndexOf('.');
    return dot === -1 ? '' : seg.slice(dot + 1).toLowerCase();
  });
}
