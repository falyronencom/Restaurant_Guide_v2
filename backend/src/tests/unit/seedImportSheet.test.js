/**
 * Unit — seed-import CSV parser + sheet normalization + content hash.
 *
 * Locks in the Phase-0 contract-hardening decisions: BOM strip, ';'/',' delimiter
 * autodetect, quoting, decimal-comma coordinate rejection, city-code phones,
 * closed boolean-token whitelist, '|' multi-value separator, strict hours, and a
 * content hash that is stable against cosmetic re-saves but flips on real edits.
 */

import { parseCsv } from '../../../scripts/seed-import/csv.js';
import { normalizeRow, contentHash } from '../../../scripts/seed-import/sheet.js';
import { CITY_BOUNDS as CONTRACT_BOUNDS, BELARUS_BOUNDS as CONTRACT_BELARUS } from '../../../scripts/seed-import/contract.js';
// establishmentService is the canonical source for the geo bounds; contract.js
// duplicates them to avoid loading the DB-pool graph at CLI import time. The pg
// Pool is lazy (constructed, not connected on import), so this comparison needs
// no database. Guards against silent drift between the two copies.
import { CITY_BOUNDS as SERVICE_BOUNDS, BELARUS_BOUNDS as SERVICE_BELARUS } from '../../services/establishmentService.js';

const HOUR_COLS = 'hours_mon,hours_tue,hours_wed,hours_thu,hours_fri,hours_sat,hours_sun';
const OPEN = '10:00-22:00';

/** Build a minimal valid raw row (as parseCsv would produce). */
function validRaw(overrides = {}) {
  return {
    stable_id: 'minsk-001',
    name: 'Кафе Весна',
    city: 'Минск',
    address: 'ул. Немига 5',
    latitude: '53.9012',
    longitude: '27.5590',
    categories: 'Кофейня',
    cuisines: 'Европейская',
    price_range: '$$',
    description: 'A'.repeat(140),
    phone: '+375291234567',
    email: 'x@y.by',
    website: '',
    hours_mon: OPEN, hours_tue: OPEN, hours_wed: OPEN, hours_thu: OPEN,
    hours_fri: OPEN, hours_sat: OPEN, hours_sun: 'выходной',
    attr_wifi: '1', attr_delivery: 'да', attr_parking: '',
    ...overrides,
  };
}

describe('parseCsv', () => {
  test('strips a UTF-8 BOM from the first header', () => {
    const { headers } = parseCsv('﻿stable_id,name\nminsk-001,Кафе');
    expect(headers[0]).toBe('stable_id');
  });

  test('autodetects a semicolon delimiter (ru-Excel)', () => {
    const { headers, rows, delimiter } = parseCsv('stable_id;name;city\nminsk-001;Кафе;Минск');
    expect(delimiter).toBe(';');
    expect(headers).toEqual(['stable_id', 'name', 'city']);
    expect(rows[0]).toEqual({ stable_id: 'minsk-001', name: 'Кафе', city: 'Минск' });
  });

  test('handles quoted fields with embedded delimiter and escaped quotes', () => {
    const { rows } = parseCsv('name,address\n"Bar ""X""","ул. А, 5"');
    expect(rows[0].name).toBe('Bar "X"');
    expect(rows[0].address).toBe('ул. А, 5');
  });

  test('handles CRLF line endings and skips blank trailing lines', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n\r\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ a: '1', b: '2' });
  });

  test('throws on a field-count mismatch (structural error, never silently padded)', () => {
    expect(() => parseCsv('a,b,c\n1,2')).toThrow(/has 2 fields, expected 3/);
  });
});

describe('normalizeRow — happy path', () => {
  test('produces a typed canonical record', () => {
    const { record, errors } = normalizeRow(validRaw(), 2);
    expect(errors).toEqual([]);
    expect(record.categories).toEqual(['Кофейня']);
    expect(record.cuisines).toEqual(['Европейская']);
    expect(record.latitude).toBeCloseTo(53.9012);
    expect(record.working_hours.sunday).toEqual({ is_open: false });
    expect(record.working_hours.monday).toBe(OPEN);
    expect(record.attributes).toEqual({ wifi: true, delivery: true }); // parking '' → absent
  });

  test("splits multi-value cells on '|' only", () => {
    const { record } = normalizeRow(validRaw({ categories: 'Кафе|Бар', cuisines: 'Народная|Азиатская' }), 2);
    expect(record.categories).toEqual(['Кафе', 'Бар']);
    expect(record.cuisines).toEqual(['Народная', 'Азиатская']);
  });

  test('accepts a Belarus city phone (+375 17 …)', () => {
    const { errors } = normalizeRow(validRaw({ phone: '+375172001234' }), 2);
    expect(errors).toEqual([]);
  });
});

describe('normalizeRow — rejections (single-gate fields)', () => {
  const cases = [
    ['decimal-comma latitude', { latitude: '53,9012' }, /coordinates.*decimal-point/],
    ['integer-truncated coord', { latitude: '54', longitude: '27' }, /coordinates.*fractional/],
    ['non-canon category', { categories: 'restaurant' }, /non-canon categories/],
    ['non-canon cuisine', { cuisines: 'european' }, /non-canon cuisines/],
    ['too many categories', { categories: 'Кафе|Бар|Клуб' }, /1-2 values/],
    ['bad phone', { phone: '80291234567' }, /phone.*\+375/],
    ['short description', { description: 'too short' }, /description .* < 120/],
    ['bad price', { price_range: '$$$$' }, /price_range/],
    ['bad hours format', { hours_mon: '9:00-18:00' }, /hours_mon.*HH:MM/],
    ['unrecognised bool token', { attr_wifi: 'maybe' }, /attr_wifi.*not a recognised/],
    ['bad stable_id', { stable_id: 'Minsk 001' }, /stable_id.*invalid/],
    ['non-canon city', { city: 'Пинск' }, /not a canon city/],
  ];
  for (const [label, override, re] of cases) {
    test(`rejects ${label}`, () => {
      const { record, errors } = normalizeRow(validRaw(override), 2);
      expect(record).toBeNull();
      expect(errors.join(' ')).toMatch(re);
    });
  }

  test('rejects an all-closed week', () => {
    const closed = Object.fromEntries(HOUR_COLS.split(',').map((c) => [c, 'выходной']));
    const { errors } = normalizeRow(validRaw(closed), 2);
    expect(errors.join(' ')).toMatch(/all seven days are closed/);
  });

  test('accepts overnight hours (close ≤ open)', () => {
    const { errors } = normalizeRow(validRaw({ hours_fri: '18:00-02:00' }), 2);
    expect(errors).toEqual([]);
  });
});

describe('contract geo bounds parity with establishmentService', () => {
  test('CITY_BOUNDS matches the service (no silent drift)', () => {
    expect(CONTRACT_BOUNDS).toEqual(SERVICE_BOUNDS);
  });
  test('BELARUS_BOUNDS matches the service', () => {
    expect(CONTRACT_BELARUS).toEqual(SERVICE_BELARUS);
  });
});

describe('contentHash', () => {
  test('is stable when only cosmetic (whitespace) differs', () => {
    const a = normalizeRow(validRaw(), 2).record;
    const b = normalizeRow(validRaw({ name: '  Кафе Весна  ', address: 'ул. Немига 5  ' }), 2).record;
    expect(contentHash(a)).toBe(contentHash(b));
  });

  test('is stable regardless of attribute column order', () => {
    const a = normalizeRow(validRaw({ attr_wifi: '1', attr_delivery: '1' }), 2).record;
    const b = normalizeRow(validRaw({ attr_delivery: '1', attr_wifi: '1' }), 2).record;
    expect(contentHash(a)).toBe(contentHash(b));
  });

  test('flips on a real content edit', () => {
    const a = normalizeRow(validRaw(), 2).record;
    const b = normalizeRow(validRaw({ description: 'B'.repeat(150) }), 2).record;
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});
