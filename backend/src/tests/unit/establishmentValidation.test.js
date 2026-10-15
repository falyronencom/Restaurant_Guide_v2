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

  // Restaurants commonly publish a city landline, and it is what guests call
  // (decision of the Coordinator, 13.10.2026). Until then only 25/29/33/44
  // passed: the partner was refused at the last wizard step, with a format
  // hint their number already matched.
  test.each([
    ['Минск', '+375171234567'],
    ['Минская область (Борисов)', '+375177123456'],
    ['Гродно', '+375152123456'],
    ['Брест', '+375162123456'],
    ['Витебск', '+375212123456'],
    ['Могилёв', '+375222123456'],
    ['Бобруйск', '+375225123456'],
    ['Гомель', '+375232123456'],
  ])('city landline is accepted: %s %s', async (_city, phone) => {
    const req = { params: params(), body: { phone } };
    expect(await fieldErrors(chains, req)).not.toContain('phone');
  });

  test.each(['+375251234567', '+375291234567', '+375331234567', '+375441234567'])(
    'mobile number is still accepted: %s',
    async (phone) => {
      const req = { params: params(), body: { phone } };
      expect(await fieldErrors(chains, req)).not.toContain('phone');
    },
  );

  // The mobile wizard prepends 375 to input that does not start with 3, so a
  // number typed the domestic way arrives as +375 80… — a number that does not
  // exist. «+375 and any 9 digits» would let it onto the card.
  test.each([
    ['«8 029 123 45 67» through the app formatter', '+375802912345'],
    ['«8 017 123 45 67» through the app formatter', '+375801712345'],
    ['one digit short', '+37517123456'],
    ['one digit too many', '+3751712345678'],
  ])('number that cannot be dialled is refused: %s', async (_label, phone) => {
    const req = { params: params(), body: { phone } };
    expect(await fieldErrors(chains, req)).toContain('phone');
  });

  // The app shows this refusal through a table keyed by the exact English text
  // (mobile/lib/services/api_client.dart _validationMessages); installed builds
  // cannot follow a change, so the text stays as it is.
  test('phone refusal keeps the text the app translates', async () => {
    const req = { params: params(), body: { phone: '+375802912345' } };
    for (const chain of chains) {
      await chain.run(req);
    }
    const phoneError = validationResult(req).array().find((e) => e.path === 'phone');
    expect(phoneError?.msg).toBe('Phone must be in format +375XXXXXXXXX (Belarus number)');
  });
});
