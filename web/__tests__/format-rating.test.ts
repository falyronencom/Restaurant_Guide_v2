/**
 * formatRating wire-type robustness (cabinet dashboard crash hotfix).
 *
 * pg returns NUMERIC columns as STRINGS; the partner listing is a non-projected
 * path, so `average_rating` reaches the web as "0.0" while types.ts claims
 * `number | null`. formatRating must coerce instead of crashing — the bare
 * `.toFixed` on that string took down the whole cabinet dashboard island on its
 * first live render of a real card. The public path never hit this (its
 * projection parseFloats server-side), so the number path must stay identical.
 */
import { formatRating } from '@/lib/establishment-helpers';

describe('formatRating', () => {
  it('formats a number with a Russian decimal comma (unchanged path)', () => {
    expect(formatRating(4.5)).toBe('4,5');
    expect(formatRating(5)).toBe('5,0');
  });

  it('coerces a pg NUMERIC string (the partner-listing wire reality)', () => {
    expect(formatRating('0.0' as unknown as number)).toBe('0,0');
    expect(formatRating('4.5' as unknown as number)).toBe('4,5');
  });

  it('returns the em-dash for null / undefined', () => {
    expect(formatRating(null)).toBe('—');
    expect(formatRating(undefined)).toBe('—');
  });

  it('returns the em-dash for a non-numeric string instead of NaN', () => {
    expect(formatRating('abc' as unknown as number)).toBe('—');
  });
});
