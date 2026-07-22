/* eslint-env jest */
/**
 * Delivery-variant URL generation (2026-07-20 uplift for DPR 2–3 screens).
 *
 * Pins the transformation components of the three image variants and the PDF
 * preview/thumbnail: original/preview carry a WIDTH cap only (a height cap
 * crushes vertical menu photos), thumbnail keeps a fixed-aspect fill crop.
 * Masters are stored untransformed (upload-time resizing is destructive and
 * double-compresses) — that path is upload-mocked in integration suites, so
 * only the pure URL builders are pinned here.
 */

let cloudinary;

beforeAll(async () => {
  // cloudinary.config() runs at module import and needs a cloud name to build
  // URLs; .env.test carries no CLOUDINARY_* (uploads are mocked elsewhere).
  process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'testcloud';
  cloudinary = await import('../../config/cloudinary.js');
});

const PID = 'establishments/e1/interior/abc123';

describe('generateImageUrl variants', () => {
  test('original: width-capped at 1920, no height component', () => {
    const url = cloudinary.generateImageUrl(PID, 'original');
    expect(url).toMatch(/w_1920/);
    expect(url).toMatch(/c_limit/);
    expect(url).not.toMatch(/h_\d/);
  });

  test('preview: width-capped at 1200, no height component', () => {
    const url = cloudinary.generateImageUrl(PID, 'preview');
    expect(url).toMatch(/w_1200/);
    expect(url).toMatch(/c_limit/);
    expect(url).not.toMatch(/h_\d/);
  });

  test('thumbnail: 400×300 fill crop', () => {
    const url = cloudinary.generateImageUrl(PID, 'thumbnail');
    expect(url).toMatch(/w_400/);
    expect(url).toMatch(/h_300/);
    expect(url).toMatch(/c_fill/);
  });

  test('all variants keep delivery-time optimization (f_auto, q_auto)', () => {
    for (const variant of ['original', 'preview', 'thumbnail']) {
      const url = cloudinary.generateImageUrl(PID, variant);
      expect(url).toMatch(/f_auto/);
      expect(url).toMatch(/q_auto/);
    }
  });

  test('generateAllResolutions returns the three variant fields', () => {
    const urls = cloudinary.generateAllResolutions(PID);
    expect(urls.url).toMatch(/w_1920/);
    expect(urls.preview_url).toMatch(/w_1200/);
    expect(urls.thumbnail_url).toMatch(/w_400/);
  });
});

describe('extractPublicIdFromUrl — real URL shapes', () => {
  // The parser feeds deleteImage AND the recalc script: a wrong (non-null)
  // extraction silently orphans Cloudinary assets and, in the script, bakes
  // 404 variant URLs. Round-trip against the LIVE builders pins the canonical
  // multi-segment, extension-less, query-carrying shape.
  test('round-trips the canonical delivery URL for every variant', () => {
    for (const variant of ['original', 'preview', 'thumbnail']) {
      const url = cloudinary.generateImageUrl(PID, variant);
      expect(cloudinary.extractPublicIdFromUrl(url)).toBe(PID);
    }
  });

  test('round-trips a canonical URL with an analytics query string', () => {
    const url = `${cloudinary.generateImageUrl(PID, 'original')}?_a=BAMAK`;
    expect(cloudinary.extractPublicIdFromUrl(url)).toBe(PID);
  });

  test('parses an upload secure_url (version + extension)', () => {
    expect(
      cloudinary.extractPublicIdFromUrl(
        'https://res.cloudinary.com/test/image/upload/v1784541426/establishments/x/menu_pdf/abc.pdf',
      ),
    ).toBe('establishments/x/menu_pdf/abc');
  });

  test('does not eat a public_id folder that merely starts with v', () => {
    expect(
      cloudinary.extractPublicIdFromUrl(
        'https://res.cloudinary.com/test/image/upload/v123/vintage-cafe/photo.jpg',
      ),
    ).toBe('vintage-cafe/photo');
  });

  test('returns null for a non-Cloudinary URL', () => {
    expect(cloudinary.extractPublicIdFromUrl('https://example.com/photo.jpg')).toBeNull();
  });
});

describe('PDF preview/thumbnail variants', () => {
  test('preview: page 1, width-capped at 1200, no height, jpg', () => {
    const url = cloudinary.generatePdfPreviewUrl(PID);
    expect(url).toMatch(/pg_1/);
    expect(url).toMatch(/w_1200/);
    expect(url).not.toMatch(/h_\d/);
    expect(url).toMatch(/f_jpg|\.jpg/);
  });

  test('thumbnail: page 1, 400×300 fill, jpg', () => {
    const url = cloudinary.generatePdfThumbnailUrl(PID);
    expect(url).toMatch(/pg_1/);
    expect(url).toMatch(/w_400/);
    expect(url).toMatch(/h_300/);
    expect(url).toMatch(/c_fill/);
  });
});
