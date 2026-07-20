/**
 * Partner error-code russification guard (CAT-C-3.x — cabinet create-flow
 * hardening, B1). errors.ts maps backend AppError codes → Russian; a code the
 * backend actually throws but errors.ts omits degrades SILENTLY to the neutral
 * fallback, so the partner flies blind. That is exactly the
 * COORDINATES_CITY_MISMATCH / DUPLICATE_ESTABLISHMENT drift that masked the
 * cabinet create-flow failures. This pins the codes the cabinet surfaces so a
 * future backend addition can't regress unnoticed.
 *
 * Source of truth: backend/src/services/establishmentService.js AppError codes on
 * the create / update / submit paths (manual cross-target sync — no shared
 * package, per constants.ts).
 */
import { messageForEstablishmentError } from '@/lib/partner/errors';

// Codes establishmentService throws on create/update/submit that reach the
// cabinet UI — each MUST map to a specific message (not the neutral fallback).
const CABINET_CODES = [
  'INVALID_CITY',
  'INVALID_CATEGORIES_LENGTH',
  'INVALID_CATEGORY_VALUE',
  'INVALID_CUISINES_LENGTH',
  'INVALID_CUISINE_VALUE',
  'INVALID_LATITUDE',
  'INVALID_LONGITUDE',
  'COORDINATES_CITY_MISMATCH',
  'MEDIA_LIMIT_EXCEEDED',
  'INVALID_FILE_TYPE',
  'DUPLICATE_ESTABLISHMENT',
  'CONSTRAINT_VIOLATION',
  'FORBIDDEN',
  'ESTABLISHMENT_SUSPENDED',
  'ESTABLISHMENT_NOT_FOUND',
  'INVALID_STATUS_FOR_SUBMISSION',
  'INCOMPLETE_ESTABLISHMENT',
  'NO_SESSION',
];

const FALLBACK = 'Не удалось выполнить запрос. Попробуйте позже.';

describe('messageForEstablishmentError — cabinet code coverage (B1 anti-drift)', () => {
  it.each(CABINET_CODES)('maps %s to a specific message', (code) => {
    const msg = messageForEstablishmentError(code);
    expect(msg).not.toBe(FALLBACK);
    expect(msg.length).toBeGreaterThan(0);
  });

  it('falls back to the neutral message for an unknown / missing code', () => {
    expect(messageForEstablishmentError('SOME_FUTURE_CODE')).toBe(FALLBACK);
    expect(messageForEstablishmentError(undefined)).toBe(FALLBACK);
  });
});
