/**
 * Client-side media file-name pre-check (menu format hardening, 2026-07-20).
 * The OS-supplied mimetype can misreport a PDF-compatible .ai as
 * application/pdf (the MARKS broken-menu incident), so the wizard rejects by
 * file NAME extension before spending the upload round-trip. The backend
 * re-checks authoritatively — this suite pins the client mirror.
 */
import { validateMediaFileName } from '@/lib/partner/upload';

describe('validateMediaFileName — photo bucket', () => {
  it.each(['a.jpg', 'b.JPEG', 'c.png', 'd.webp', 'e.HEIC', 'f.jfif'])(
    'accepts %s',
    (name) => {
      expect(validateMediaFileName(name, 'photo')).toBeNull();
    },
  );

  it.each(['menu.ai', 'menu.pdf', 'clip.mp4', 'noext'])(
    'rejects %s with a Russian message',
    (name) => {
      const msg = validateMediaFileName(name, 'photo');
      expect(msg).not.toBeNull();
      expect(msg).toContain(name);
    },
  );
});

describe('validateMediaFileName — pdf bucket', () => {
  it('accepts .pdf in any case', () => {
    expect(validateMediaFileName('menu.pdf', 'pdf')).toBeNull();
    expect(validateMediaFileName('MENU.PDF', 'pdf')).toBeNull();
  });

  it.each(['menu.ai', 'menu.jpg', 'menu'])(
    'rejects %s with a Russian message',
    (name) => {
      const msg = validateMediaFileName(name, 'pdf');
      expect(msg).not.toBeNull();
      expect(msg).toContain('PDF');
    },
  );
});
