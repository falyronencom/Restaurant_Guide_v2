/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: establishmentValidation.js — the partner-input rules that moved
 * with the validator library (express-validator 7.3.2 → validator 13.15.x).
 *
 * Both chains a partner hits are checked: create (POST /partner/establishments)
 * and update (PUT /partner/establishments/:id). Each case looks only at the
 * error for its own field, so the rest of the body need not be valid.
 */

import { validationResult } from 'express-validator';
import {
  validateCreate,
  validateUpdate,
} from '../../validators/establishmentValidation.js';

async function fieldErrors(chains, req) {
  for (const chain of chains) {
    await chain.run(req);
  }
  return validationResult(req).array().map((e) => e.path);
}

const ID = '550e8400-e29b-41d4-a716-446655440000';

describe.each([
  ['create', validateCreate, () => ({})],
  ['update', validateUpdate, () => ({ id: ID })],
])('establishment %s', (_name, chains, params) => {
  // validator < 13.15.20 split the scheme on '://' while browsers split on ':'
  // (CVE-2025-56200): with the script in the userinfo part the string passed
  // isURL() and was stored as the card's website.
  test('website with a javascript: scheme hidden before @host is rejected', async () => {
    const req = { params: params(), body: { website: "javascript:alert(1)+'@example.com/'" } };
    expect(await fieldErrors(chains, req)).toContain('website');
  });

  test.each([
    'https://example.by',
    'example.by',
    'www.example.by/menu',
    'instagram.com/place.minsk',
    'https://t.me/place_minsk',
  ])('website typed the way partners type it is accepted: %s', async (website) => {
    const req = { params: params(), body: { website } };
    expect(await fieldErrors(chains, req)).not.toContain('website');
  });

  // validator < 13.15.22 did not count U+FE0F / U+FE0E (GHSA-vghf-hv5q-vc2g).
  // description is TEXT: the padding was stored and served on the card page.
  test('description padded with invisible selectors past 2000 is rejected', async () => {
    const req = { params: params(), body: { description: `Уютное кафе${'\uFE0F'.repeat(2000)}` } };
    expect(await fieldErrors(chains, req)).toContain('description');
  });

  // name is varchar(255): the padding used to pass here and fail in the
  // database with «value too long» instead of a clear validation message.
  test('name padded with invisible selectors past 255 is rejected', async () => {
    const req = { params: params(), body: { name: `Кафе${'\uFE0E'.repeat(255)}` } };
    expect(await fieldErrors(chains, req)).toContain('name');
  });
});
