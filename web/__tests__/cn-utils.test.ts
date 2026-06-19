/**
 * cn() — the tailwind-merge wrapper (src/lib/utils.ts).
 *
 * Guards the systemic fix for the design system's custom font-size tokens.
 * Stock tailwind-merge has no knowledge of `text-body-m`, `text-headline-l`,
 * etc., so it falls them into its `text-color` group's catch-all. A size token
 * + a color token (e.g. text-foreground) in one cn() call then both resolve to
 * `text-color` and the *size* token is silently dropped — text collapses to the
 * default size, visible only in computed fontSize, never in source. The
 * extendTailwindMerge config moves these tokens into the `font-size` group.
 *
 * This test locks the behavior so the invisible regression can't return, and
 * cross-checks the impl's token list against the @theme source of truth.
 *
 * See memory: feedback_tailwind_merge_text_token.
 */
import { cn } from '@/lib/utils';

// Independent mirror of the `--text-*` scale in src/app/globals.css @theme.
// Listed here (NOT imported from utils.ts) on purpose: if the cn() extend list
// drifts from the @theme source of truth, that drift fails this test instead of
// passing silently. Update both together if the typography scale changes.
const SIZE_TOKENS = [
  'display-l', 'display-m', 'display-s',
  'headline-l', 'headline-m', 'headline-s',
  'body-l', 'body-m', 'body-s',
  'label-l', 'label-m', 'label-s',
  'caption-l', 'caption-m', 'caption-s',
];

describe('cn — font-size token preservation', () => {
  it('keeps the known regression case: text-body-m survives next to text-foreground', () => {
    const out = cn('text-body-m', 'text-foreground').split(' ');
    expect(out).toContain('text-body-m');
    expect(out).toContain('text-foreground');
  });

  it.each(SIZE_TOKENS)(
    'keeps text-%s when a color token shares the same cn() call',
    (token) => {
      const out = cn(`text-${token}`, 'text-foreground').split(' ');
      expect(out).toContain(`text-${token}`);
      expect(out).toContain('text-foreground');
    },
  );
});

describe('cn — conflicts still resolve correctly', () => {
  it('two font-size tokens still override (last wins)', () => {
    // Both are now in the `font-size` group, so they genuinely conflict.
    expect(cn('text-body-m', 'text-headline-l')).toBe('text-headline-l');
  });

  it('two text colors still dedupe (last wins)', () => {
    expect(cn('text-foreground', 'text-brand')).toBe('text-brand');
  });

  it('a size token and a color token coexist regardless of order', () => {
    expect(cn('text-foreground', 'text-body-m').split(' ').sort()).toEqual(
      ['text-body-m', 'text-foreground'],
    );
  });

  it('non-text groups remain unaffected (padding still merges)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
