/* eslint-env jest */
/**
 * Unit tests for the file-extension allow-list helpers in config/cloudinary.js.
 *
 * These complement the mimetype validators: the mimetype is client-supplied
 * (derived from OS file associations), so a PDF-compatible .ai file can arrive
 * as application/pdf (MARKS, 2026-07-20). The extension is the discriminating
 * signal — content sniffing cannot help, PDF-compatible .ai files share the
 * %PDF- magic bytes.
 */

import {
  fileExtension,
  hasValidImageExtension,
  hasValidPdfExtension,
} from '../../config/cloudinary.js';

describe('fileExtension', () => {
  test('returns "" for the canonical extension-less delivery URL shape', () => {
    expect(
      fileExtension('https://res.cloudinary.com/x/image/upload/c_limit,h_1080,w_1920/f_auto,q_auto/v1/establishments/temp/u1/interior/abc123xyz?_a=BAMAK'),
    ).toBe('');
  });

  test('extracts a lower-cased extension ignoring the query string', () => {
    expect(fileExtension('MENU.PDF?v=2')).toBe('pdf');
  });
});

describe('hasValidImageExtension', () => {
  test.each(['photo.jpg', 'photo.jpeg', 'photo.png', 'photo.webp', 'photo.heic', 'photo.jfif'])(
    'accepts %s',
    (name) => {
      expect(hasValidImageExtension(name)).toBe(true);
    },
  );

  test('is case-insensitive', () => {
    expect(hasValidImageExtension('PHOTO.JPG')).toBe(true);
  });

  test('ignores a query string (URL form)', () => {
    expect(hasValidImageExtension('https://res.cloudinary.com/x/a.jpg?v=2')).toBe(true);
  });

  test.each(['menu.ai', 'menu.pdf', 'notes.txt', 'clip.mp4', 'noextension', ''])(
    'rejects %s',
    (name) => {
      expect(hasValidImageExtension(name)).toBe(false);
    },
  );

  test('rejects non-string input', () => {
    expect(hasValidImageExtension(undefined)).toBe(false);
    expect(hasValidImageExtension(null)).toBe(false);
  });
});

describe('hasValidPdfExtension', () => {
  test('accepts .pdf in any case', () => {
    expect(hasValidPdfExtension('menu.pdf')).toBe(true);
    expect(hasValidPdfExtension('MENU.PDF')).toBe(true);
  });

  test('ignores a query string (URL form)', () => {
    expect(hasValidPdfExtension('https://res.cloudinary.com/x/menu.pdf?v=2')).toBe(true);
  });

  test.each(['menu.ai', 'menu.jpg', 'menu.pdf.ai', 'menu', ''])(
    'rejects %s',
    (name) => {
      expect(hasValidPdfExtension(name)).toBe(false);
    },
  );

  test('rejects non-string input', () => {
    expect(hasValidPdfExtension(undefined)).toBe(false);
  });
});
