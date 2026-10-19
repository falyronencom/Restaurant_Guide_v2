/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Public Read-Only API Integration Tests (Brief 1)
 *
 * Validates the public surface under /api/v1/public/*:
 *   - Public access (no auth header → 200)
 *   - Projection (no partner_email/subscription_tier/base_score/etc.)
 *   - URL slug translation (city, category, cuisine slugs → Cyrillic queries)
 *   - Mogilev ё/е edge case (slug 'mogilev' matches both 'Могилев' and 'Могилёв' rows)
 *   - Pagination with totalPages convention
 *   - Strict status='active' filter
 *   - 404 for non-existent / non-active establishments
 *   - 400 for invalid slug parameters
 *   - menu-items respects is_hidden_by_admin=TRUE filter
 *   - reviews respects is_deleted/is_visible filters
 *   - metadata endpoint shape
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';

let partnerId;
let userId;

const defaultWorkingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
  wednesday: { open: '10:00', close: '22:00' },
  thursday: { open: '10:00', close: '22:00' },
  friday: { open: '10:00', close: '23:00' },
  saturday: { open: '11:00', close: '23:00' },
  sunday: { open: '11:00', close: '22:00' }
});

const SENSITIVE_FIELDS = [
  'partner_id',
  'partner_name',
  'partner_email',
  'subscription_tier',
  'subscription_started_at',
  'subscription_expires_at',
  'base_score',
  'boost_score',
  'is_seed',
  'claimed_at',
  'claimed_by',
  'moderation_notes',
  'moderated_by',
  'moderated_at',
];

/**
 * «Non-active» is every status but 'active' — the schema's CHECK
 * (establishments_status_check) lists draft, pending, rejected, suspended and
 * archived next to it. One card of each, at the Minsk point the other
 * fixtures use, so a filter that hid only drafts would show the rest.
 */
const NON_ACTIVE_STATUSES = ['draft', 'pending', 'rejected', 'suspended', 'archived'];
const insertNonActiveCards = async (prefix) => {
  for (const status of NON_ACTIVE_STATUSES) {
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', $4, $5::jsonb, NOW(), NOW())
    `, [partnerId, `${prefix} ${status}`, `${prefix.toLowerCase().replace(/\s+/g, '-')}-${status}`, status, defaultWorkingHours]);
  }
};

const assertNoSensitiveFields = (obj) => {
  for (const field of SENSITIVE_FIELDS) {
    expect(obj).not.toHaveProperty(field);
  }
};

beforeAll(async () => {
  const partner = await createUserAndGetTokens(testUsers.partner);
  partnerId = partner.user.id;
  const user = await createUserAndGetTokens(testUsers.regularUser);
  userId = user.user.id;
});

beforeEach(async () => {
  await clearAllData();
  await query(
    'INSERT INTO users (id, email, password_hash, name, role, auth_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [partnerId, 'partner@test.com', 'hash', 'Partner', 'partner', 'email']
  );
  await query(
    'INSERT INTO users (id, email, password_hash, name, role, auth_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, 'user@test.com', 'hash', 'Regular User', 'user', 'email']
  );
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// /public/metadata
// ============================================================================

describe('Public API — GET /api/v1/public/metadata', () => {
  test('returns 200 without authentication', async () => {
    const response = await request(app)
      .get('/api/v1/public/metadata')
      .expect(200);
    expect(response.body.success).toBe(true);
  });

  test('returns cities, categories, cuisines arrays with { slug, name }', async () => {
    const response = await request(app)
      .get('/api/v1/public/metadata')
      .expect(200);

    expect(response.body.data).toHaveProperty('cities');
    expect(response.body.data).toHaveProperty('categories');
    expect(response.body.data).toHaveProperty('cuisines');

    expect(Array.isArray(response.body.data.cities)).toBe(true);
    expect(response.body.data.cities.length).toBe(7); // 7 unique cities (Mogilev deduplicated)
    expect(response.body.data.categories.length).toBe(15);
    expect(response.body.data.cuisines.length).toBe(12);

    // { slug, name } in each of the three arrays, and each a non-empty string:
    // a key that is present with null would pass toHaveProperty.
    for (const list of ['cities', 'categories', 'cuisines']) {
      for (const item of response.body.data[list]) {
        expect({ list, slug: typeof item.slug, name: typeof item.name, empty: !item.slug || !item.name })
          .toEqual({ list, slug: 'string', name: 'string', empty: false });
      }
    }
  });

  test('Mogilev exposed once with canonical name without ё', () => {
    return request(app)
      .get('/api/v1/public/metadata')
      .expect(200)
      .then(response => {
        const mogilev = response.body.data.cities.filter(c => c.slug === 'mogilev');
        expect(mogilev).toHaveLength(1);
        expect(mogilev[0].name).toBe('Могилев');
      });
  });
});

// ============================================================================
// /public/establishments — catalog list
// ============================================================================

describe('Public API — GET /api/v1/public/establishments', () => {
  beforeEach(async () => {
    // Seed varied test data. Both Mogilev rows use 'Могилев' (без ё) here;
    // ё-variant resolution covered by urlSlugs.test.js (expandCityForQuery).
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, base_score, boost_score, subscription_tier, created_at, updated_at)
      VALUES
        (gen_random_uuid(), $1, 'Минский Ресторан', 'minsky-restoran', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $2::jsonb, 80, 5, 'premium', NOW(), NOW()),
        (gen_random_uuid(), $1, 'Гродненская Кофейня', 'grodnenskaya-kofeynya', 'Test', 'Гродно', 'Test', 53.68, 23.83, ARRAY['Кофейня'], ARRAY['Европейская'], '$', 'active', $2::jsonb, 70, 0, 'free', NOW(), NOW()),
        (gen_random_uuid(), $1, 'Mogilev One', 'mogilev-one', 'Test', 'Могилев', 'Test', 53.9, 30.33, ARRAY['Ресторан'], ARRAY['Народная'], '$$', 'active', $2::jsonb, 60, 0, 'free', NOW(), NOW()),
        (gen_random_uuid(), $1, 'Mogilev Two', 'mogilev-two', 'Test', 'Могилев', 'Test', 53.91, 30.34, ARRAY['Кафе'], ARRAY['Народная'], '$', 'active', $2::jsonb, 50, 0, 'free', NOW(), NOW()),
        (gen_random_uuid(), $1, 'Inactive Draft', 'inactive-draft', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'draft', $2::jsonb, 0, 0, 'free', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);
  });

  test('returns 200 without authentication', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .expect(200);
    expect(response.body.success).toBe(true);
  });

  test('excludes sensitive fields from every establishment in list', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .expect(200);

    expect(response.body.data.establishments.length).toBeGreaterThan(0);
    for (const est of response.body.data.establishments) {
      assertNoSensitiveFields(est);
    }
  });

  test('does NOT include draft/non-active establishments', async () => {
    await insertNonActiveCards('Catalog Hidden');
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .expect(200);

    const names = response.body.data.establishments.map(e => e.name);
    expect(names).toContain('Минский Ресторан'); // the listing is not empty
    expect(names.filter((name) => name === 'Inactive Draft' || name.startsWith('Catalog Hidden'))).toEqual([]);
  });

  test('city slug "minsk" returns Минск establishments', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ city: 'minsk' })
      .expect(200);

    expect(response.body.data.establishments.length).toBeGreaterThan(0);
    for (const est of response.body.data.establishments) {
      expect(est.city).toBe('Минск');
      expect(est.city_slug).toBe('minsk');
    }
  });

  test('city slug "mogilev" matches Могилев rows (ё-variant covered by unit test)', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ city: 'mogilev' })
      .expect(200);

    // Both rows seeded with 'Могилев' (без ё); ё-variant resolution covered
    // by urlSlugs.test.js (expandCityForQuery returns both spellings).
    expect(response.body.data.establishments.length).toBe(2);
    for (const est of response.body.data.establishments) {
      expect(est.city).toBe('Могилев');
    }
  });

  test('all returned establishments for Mogilev have city_slug=mogilev', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ city: 'mogilev' })
      .expect(200);

    for (const est of response.body.data.establishments) {
      expect(est.city_slug).toBe('mogilev');
    }
  });

  test('category slug "restaurants" returns Ресторан establishments', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ category: 'restaurants' })
      .expect(200);

    expect(response.body.data.establishments.length).toBeGreaterThan(0);
    for (const est of response.body.data.establishments) {
      expect(est.categories).toContain('Ресторан');
    }
  });

  test('cuisines slug "belarusian" returns Народная cuisine establishments', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ cuisines: 'belarusian' })
      .expect(200);

    expect(response.body.data.establishments.length).toBeGreaterThan(0);
    for (const est of response.body.data.establishments) {
      expect(est.cuisines).toContain('Народная');
    }
  });

  test('400 for invalid city slug', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ city: 'moscow' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_SLUG');
  });

  test('400 for invalid category slug', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ category: 'vegan-bar' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_SLUG');
  });

  test('400 for invalid cuisine slug', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ cuisines: 'mexican' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_SLUG');
  });

  test.each([
    ['city', 'constructor'],
    ['category', 'constructor'],
    ['cuisines', '__proto__'],
  ])('400 for %s=%s — a key of the object prototype is not a slug', async (param, value) => {
    // До 13.10.2026 таблица слагов отвечала и за свой прототип: такой город
    // проходил проверку, и каталог отвечал 200 с пустой выдачей.
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ [param]: value })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_SLUG');
  });

  test('pagination uses totalPages convention', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ limit: 2, page: 1 })
      .expect(200);

    expect(response.body.data.pagination).toHaveProperty('totalPages');
    expect(response.body.data.pagination).not.toHaveProperty('pages');
    expect(response.body.data.pagination.page).toBe(1);
    expect(response.body.data.pagination.limit).toBe(2);
  });

  test('returns derived city_slug and category_slug on listings', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .query({ city: 'minsk' })
      .expect(200);

    const est = response.body.data.establishments[0];
    expect(est).toHaveProperty('city_slug');
    expect(est).toHaveProperty('category_slug');
    expect(est.city_slug).toBe('minsk');
  });
});

// ============================================================================
// /public/establishments — hours_filter (Phase A working-hours wire-through)
// ============================================================================

describe('Public API — GET /api/v1/public/establishments?hours_filter', () => {
  // Buckets are absolute/static — derived from stored working_hours, not the
  // current clock. String format ('open-close') mirrors the seed always_open
  // pattern and the engine's CLOSE_TIME_SQL extractor.
  const allDays = (h) =>
    JSON.stringify({
      monday: h, tuesday: h, wednesday: h, thursday: h,
      friday: h, saturday: h, sunday: h,
    });

  beforeEach(async () => {
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
      VALUES
        (gen_random_uuid(), $1, 'Closes By 22', 'closes-by-22', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $2::jsonb, NOW(), NOW()),
        (gen_random_uuid(), $1, 'Open Til Morning', 'open-til-morning', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $3::jsonb, NOW(), NOW()),
        (gen_random_uuid(), $1, 'Round The Clock', 'round-the-clock', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $4::jsonb, NOW(), NOW())
    `, [
      partnerId,
      allDays('10:00-20:00'), // closes by 22:00 every day → until_22
      allDays('18:00-03:00'), // a day closing after midnight → until_morning
      allDays('00:00-23:59'), // round-the-clock → 24_hours
    ]);
  });

  const names = (res) => res.body.data.establishments.map((e) => e.name);

  test('until_22 returns only the early-closing establishment', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ hours_filter: 'until_22' })
      .expect(200);
    const n = names(res);
    expect(n).toContain('Closes By 22');
    expect(n).not.toContain('Open Til Morning');
    expect(n).not.toContain('Round The Clock');
  });

  test('until_morning returns only the late-night establishment', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ hours_filter: 'until_morning' })
      .expect(200);
    const n = names(res);
    expect(n).toContain('Open Til Morning');
    expect(n).not.toContain('Closes By 22');
    expect(n).not.toContain('Round The Clock');
  });

  // Canonical 2-digit '00:00-23:59' (the seed always_open format). Matches after
  // the engine fix that compares the midnight open-hour as IN ('0','00') rather
  // than a single-digit '= 0' — see the separate searchService 24_hours fix.
  test('24_hours returns only the round-the-clock establishment', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ hours_filter: '24_hours' })
      .expect(200);
    const n = names(res);
    expect(n).toContain('Round The Clock');
    expect(n).not.toContain('Closes By 22');
    expect(n).not.toContain('Open Til Morning');
  });

  test('no hours_filter returns all three', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .expect(200);
    const n = names(res);
    expect(n).toContain('Closes By 22');
    expect(n).toContain('Open Til Morning');
    expect(n).toContain('Round The Clock');
  });

  test('unknown hours_filter is soft-ignored — 200, returns all (no 422, unlike /map)', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ hours_filter: 'nonsense' })
      .expect(200);
    const n = names(res);
    expect(n).toContain('Closes By 22');
    expect(n).toContain('Open Til Morning');
    expect(n).toContain('Round The Clock');
  });
});

// ============================================================================
// /public/establishments — features (attribute wire-through, Segment D)
// ============================================================================

describe('Public API — GET /api/v1/public/establishments?features', () => {
  // Attribute filtering reuses searchWithoutLocation's existing WHERE branch
  // (addFeatureConditions: the key's value is JSON true), now forwarded through the public
  // catalog path (publicController → publicService → searchWithoutLocation).
  // Multiple keys are AND-ed (each adds its own condition). The valid keys are
  // the REAL data canon (9 reader/writer keys), NOT the geo-search validator —
  // 'smoking'/'pets_allowed'/'live_music' are real data keys the geo path's
  // 'smoking_area'/'pet_friendly' 8-key list would miss. Unknown keys are
  // soft-ignored like hours_filter.
  beforeEach(async () => {
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, attributes, created_at, updated_at)
      VALUES
        (gen_random_uuid(), $1, 'Wifi And Parking', 'wifi-and-parking', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $2::jsonb, '{"wifi": true, "parking": true}'::jsonb, NOW(), NOW()),
        (gen_random_uuid(), $1, 'Wifi Only', 'wifi-only', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $2::jsonb, '{"wifi": true}'::jsonb, NOW(), NOW()),
        (gen_random_uuid(), $1, 'Smoking Live', 'smoking-live', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $2::jsonb, '{"smoking": true, "live_music": true}'::jsonb, NOW(), NOW()),
        (gen_random_uuid(), $1, 'No Attributes', 'no-attributes', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $2::jsonb, '{}'::jsonb, NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);
  });

  const names = (res) => res.body.data.establishments.map((e) => e.name);

  test('features=wifi returns both wifi establishments, excludes the others', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ features: 'wifi' })
      .expect(200);
    const n = names(res);
    expect(n).toContain('Wifi And Parking');
    expect(n).toContain('Wifi Only');
    expect(n).not.toContain('Smoking Live');
    expect(n).not.toContain('No Attributes');
  });

  test('features=wifi,parking is AND — only the establishment with BOTH', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ features: 'wifi,parking' })
      .expect(200);
    const n = names(res);
    expect(n).toContain('Wifi And Parking');
    expect(n).not.toContain('Wifi Only');
    expect(n).not.toContain('No Attributes');
  });

  test('features=smoking (a data-canon key the geo validator lacks) filters correctly', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ features: 'smoking' })
      .expect(200);
    const n = names(res);
    expect(n).toContain('Smoking Live');
    expect(n).not.toContain('Wifi And Parking');
    expect(n).not.toContain('No Attributes');
  });

  test('no features param returns all seeded establishments', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .expect(200);
    const n = names(res);
    expect(n).toContain('Wifi And Parking');
    expect(n).toContain('Wifi Only');
    expect(n).toContain('Smoking Live');
    expect(n).toContain('No Attributes');
  });

  test('unknown feature key is soft-ignored — 200, returns all (mirrors hours_filter)', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ features: 'nonsense' })
      .expect(200);
    const n = names(res);
    expect(n).toContain('Wifi And Parking');
    expect(n).toContain('Smoking Live');
    expect(n).toContain('No Attributes');
  });

  test('mixed known+unknown applies only the valid key (wifi), drops nonsense', async () => {
    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ features: 'wifi,nonsense' })
      .expect(200);
    const n = names(res);
    expect(n).toContain('Wifi And Parking');
    expect(n).toContain('Wifi Only');
    expect(n).not.toContain('No Attributes');
  });

  test('a non-true value («да») does not break the catalog — 200, that card is simply not marked', async () => {
    // The filter used to cast the value to boolean, so ONE card storing «да»
    // instead of true turned every catalog request with this facet into an
    // error (the client got 400 INVALID_FORMAT — Postgres 22P02).
    // Marked = JSON true, exactly what the detail page renders (=== true).
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, attributes, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Wifi Da', 'wifi-da', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $2::jsonb, '{"wifi": "да"}'::jsonb, NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    const res = await request(app)
      .get('/api/v1/public/establishments')
      .query({ features: 'wifi' })
      .expect(200);
    expect(names(res).sort()).toEqual(['Wifi And Parking', 'Wifi Only']);
  });
});

// ============================================================================
// /public/establishments/map
// ============================================================================

describe('Public API — GET /api/v1/public/establishments/map', () => {
  beforeEach(async () => {
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
      VALUES
        (gen_random_uuid(), $1, 'Map Pin Minsk', 'map-pin-minsk', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $2::jsonb, NOW(), NOW()),
        (gen_random_uuid(), $1, 'Map Draft', 'map-draft', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'draft', $2::jsonb, NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);
  });

  test('returns 200 without authentication', async () => {
    await request(app)
      .get('/api/v1/public/establishments/map')
      .expect(200);
  });

  test('returns minimum map marker projection (no description, no phone, no working_hours)', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments/map')
      .expect(200);

    expect(response.body.data.establishments.length).toBeGreaterThan(0);
    for (const marker of response.body.data.establishments) {
      // Minimum marker fields present
      expect(marker).toHaveProperty('id');
      expect(marker).toHaveProperty('slug');
      expect(marker).toHaveProperty('name');
      expect(marker).toHaveProperty('latitude');
      expect(marker).toHaveProperty('longitude');
      expect(marker).toHaveProperty('primary_image_url');
      expect(marker).toHaveProperty('average_rating');
      expect(marker).toHaveProperty('has_promotion');
      // Fields excluded from minimum marker
      expect(marker).not.toHaveProperty('description');
      expect(marker).not.toHaveProperty('phone');
      expect(marker).not.toHaveProperty('working_hours');
      expect(marker).not.toHaveProperty('attributes');
      // Sensitive fields excluded
      assertNoSensitiveFields(marker);
    }
  });

  test('excludes non-active establishments', async () => {
    await insertNonActiveCards('Map Hidden');
    const response = await request(app)
      .get('/api/v1/public/establishments/map')
      .expect(200);

    const names = response.body.data.establishments.map(e => e.name);
    expect(names).toContain('Map Pin Minsk');
    expect(names.filter((name) => name === 'Map Draft' || name.startsWith('Map Hidden'))).toEqual([]);
  });

  test('400 for invalid city slug on map', async () => {
    await request(app)
      .get('/api/v1/public/establishments/map')
      .query({ city: 'moscow' })
      .expect(400);
  });

  test('400 for city=__proto__ on map — a key of the object prototype is not a slug', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments/map')
      .query({ city: '__proto__' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_SLUG');
  });

  test('bounds enclosing the pin returns it', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments/map')
      .query({ swLat: 53, neLat: 54, swLon: 27, neLon: 28 })
      .expect(200);

    const names = response.body.data.establishments.map((e) => e.name);
    expect(names).toContain('Map Pin Minsk');
  });

  test('bounds excluding the pin omits it', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments/map')
      .query({ swLat: 50, neLat: 51, swLon: 27, neLon: 28 })
      .expect(200);

    const names = response.body.data.establishments.map((e) => e.name);
    expect(names).not.toContain('Map Pin Minsk');
  });

  test('partial bounds (missing corners) → 422', async () => {
    await request(app)
      .get('/api/v1/public/establishments/map')
      .query({ neLat: 54 })
      .expect(422);
  });

  test('bounds search still excludes non-active establishments', async () => {
    await insertNonActiveCards('Bounds Hidden');
    const response = await request(app)
      .get('/api/v1/public/establishments/map')
      .query({ swLat: 53, neLat: 54, swLon: 27, neLon: 28 })
      .expect(200);

    const names = response.body.data.establishments.map((e) => e.name);
    expect(names).toContain('Map Pin Minsk');
    expect(names.filter((name) => name === 'Map Draft' || name.startsWith('Bounds Hidden'))).toEqual([]);
  });

  test('bounds marker carries preview-card fields', async () => {
    const response = await request(app)
      .get('/api/v1/public/establishments/map')
      .query({ swLat: 53, neLat: 54, swLon: 27, neLon: 28 })
      .expect(200);

    const pin = response.body.data.establishments.find(
      (e) => e.name === 'Map Pin Minsk',
    );
    expect(pin).toBeDefined();
    expect(pin).toHaveProperty('address');
    expect(pin).toHaveProperty('category_slug');
    expect(pin).toHaveProperty('price_range');
    expect(pin).toHaveProperty('review_count');
  });
});

// ============================================================================
// /public/establishments/by-slug/:slug
// ============================================================================

describe('Public API — GET /api/v1/public/establishments/by-slug/:slug', () => {
  let activeSlug;
  let draftSlug;

  beforeEach(async () => {
    activeSlug = 'active-establishment';
    draftSlug = 'draft-establishment';

    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, base_score, boost_score, subscription_tier, created_at, updated_at)
      VALUES
        (gen_random_uuid(), $1, 'Active Est', $2, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $3::jsonb, 75, 10, 'premium', NOW(), NOW()),
        (gen_random_uuid(), $1, 'Draft Est', $4, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'draft', $3::jsonb, 0, 0, 'free', NOW(), NOW())
    `, [partnerId, activeSlug, defaultWorkingHours, draftSlug]);
  });

  test('returns active establishment by slug, 200, no auth', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}`)
      .expect(200);

    expect(response.body.data.establishment.slug).toBe(activeSlug);
    expect(response.body.data.establishment.name).toBe('Active Est');
  });

  test('detail response excludes all sensitive fields', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}`)
      .expect(200);

    assertNoSensitiveFields(response.body.data.establishment);
  });

  test('detail includes media and promotions arrays', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}`)
      .expect(200);

    expect(response.body.data.establishment).toHaveProperty('media');
    expect(response.body.data.establishment).toHaveProperty('promotions');
    expect(Array.isArray(response.body.data.establishment.media)).toBe(true);
    expect(Array.isArray(response.body.data.establishment.promotions)).toBe(true);
  });

  test('404 for non-existent slug', async () => {
    await request(app)
      .get('/api/v1/public/establishments/by-slug/does-not-exist')
      .expect(404);
  });

  test('404 for non-active establishment slug', async () => {
    await request(app)
      .get(`/api/v1/public/establishments/by-slug/${draftSlug}`)
      .expect(404);
  });

  test.each(NON_ACTIVE_STATUSES)('404 for non-active establishment slug: %s', async (status) => {
    await insertNonActiveCards('Slug Hidden');
    // The card is there under this slug — a 404 for a slug never written proves nothing.
    const { rows } = await query('SELECT status FROM establishments WHERE slug = $1', [`slug-hidden-${status}`]);
    expect(rows).toEqual([{ status }]);
    await request(app)
      .get(`/api/v1/public/establishments/by-slug/slug-hidden-${status}`)
      .expect(404);
  });
});

// ============================================================================
// /public/establishments/by-id/:id
// ============================================================================

describe('Public API — GET /api/v1/public/establishments/by-id/:id (deprecated)', () => {
  let activeId;

  beforeEach(async () => {
    const result = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'By ID test', 'by-id-test', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $2::jsonb, NOW(), NOW())
      RETURNING id
    `, [partnerId, defaultWorkingHours]);
    activeId = result.rows[0].id;
  });

  test('returns active establishment by id', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-id/${activeId}`)
      .expect(200);
    expect(response.body.data.establishment.id).toBe(activeId);
  });

  test('detail by-id excludes sensitive fields', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-id/${activeId}`)
      .expect(200);
    assertNoSensitiveFields(response.body.data.establishment);
  });

  test('404 for non-existent id', async () => {
    await request(app)
      .get('/api/v1/public/establishments/by-id/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });
});

// ============================================================================
// /public/establishments/by-slug/:slug/menu-items
// ============================================================================

describe('Public API — GET /api/v1/public/establishments/by-slug/:slug/menu-items', () => {
  let activeSlug;
  let activeEstId;
  let mediaId;

  beforeEach(async () => {
    activeSlug = 'menu-test-slug';

    const estResult = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Menu Test', $2, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $3::jsonb, NOW(), NOW())
      RETURNING id
    `, [partnerId, activeSlug, defaultWorkingHours]);
    activeEstId = estResult.rows[0].id;

    const mediaResult = await query(`
      INSERT INTO establishment_media (id, establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary)
      VALUES (gen_random_uuid(), $1, 'menu', 'pdf', 'https://cdn.test/menu.pdf', 'https://cdn.test/thumb.jpg', 'https://cdn.test/preview.jpg', 0, false)
      RETURNING id
    `, [activeEstId]);
    mediaId = mediaResult.rows[0].id;

    // Insert menu items: 2 visible, 1 admin-hidden, with sanity_flag on one
    await query(`
      INSERT INTO menu_items (id, establishment_id, media_id, item_name, price_byn, category_raw, confidence, sanity_flag, is_hidden_by_admin, hidden_reason, position)
      VALUES
        (gen_random_uuid(), $1, $2, 'Драники', 12.50, 'Основные', 0.95, NULL, false, NULL, 0),
        (gen_random_uuid(), $1, $2, 'Борщ', 8.00, 'Супы', 0.85, '{"reason":"low_confidence"}', false, NULL, 1),
        (gen_random_uuid(), $1, $2, 'Hidden Item', 999.99, 'Suspicious', 0.20, '{"reason":"price_outlier"}', true, 'Suspicious entry by admin', 2)
    `, [activeEstId, mediaId]);
  });

  test('returns menu items for active establishment by slug', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/menu-items`)
      .expect(200);

    expect(Array.isArray(response.body.data.menu_items)).toBe(true);
    expect(response.body.data.menu_items.length).toBe(2); // hidden item excluded
  });

  test('admin-hidden items excluded', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/menu-items`)
      .expect(200);

    const names = response.body.data.menu_items.map(i => i.item_name);
    expect(names).not.toContain('Hidden Item');
  });

  test('menu item projection excludes sensitive metadata', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/menu-items`)
      .expect(200);

    for (const item of response.body.data.menu_items) {
      expect(item).not.toHaveProperty('media_id');
      expect(item).not.toHaveProperty('sanity_flag');
      expect(item).not.toHaveProperty('hidden_reason');
      expect(item).not.toHaveProperty('confidence');
      expect(item).not.toHaveProperty('is_hidden_by_admin');
    }
  });

  // -- quality_tier derivation (CAT-C-2.7 augmentation, Brief 4) ----------
  // Verifies positive-direction consumer contract: every public item carries
  // a quality_tier signal, correctly derived from sanity_flag presence at the
  // service→projection boundary. The exclusion test above is the guard that
  // sanity_flag itself never leaks; these tests ensure the derived signal IS
  // emitted (CAT-D-1.10 pattern — verify what consumer needs, not only what
  // it must not see).

  test('every public menu item carries a quality_tier field', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/menu-items`)
      .expect(200);

    for (const item of response.body.data.menu_items) {
      expect(item).toHaveProperty('quality_tier');
      expect(['clean', 'needs_caution']).toContain(item.quality_tier);
    }
  });

  test('items with sanity_flag NULL get quality_tier=clean', async () => {
    // Fixture seeds 'Драники' with sanity_flag NULL.
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/menu-items`)
      .expect(200);

    const drainiki = response.body.data.menu_items.find(i => i.item_name === 'Драники');
    expect(drainiki).toBeDefined();
    expect(drainiki.quality_tier).toBe('clean');
  });

  test('items with sanity_flag populated get quality_tier=needs_caution', async () => {
    // Fixture seeds 'Борщ' with sanity_flag = {"reason":"low_confidence"}.
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/menu-items`)
      .expect(200);

    const borshch = response.body.data.menu_items.find(i => i.item_name === 'Борщ');
    expect(borshch).toBeDefined();
    expect(borshch.quality_tier).toBe('needs_caution');
  });

  test('404 for non-existent establishment slug on menu-items', async () => {
    await request(app)
      .get('/api/v1/public/establishments/by-slug/does-not-exist/menu-items')
      .expect(404);
  });

  test('returns empty array when establishment has no menu items', async () => {
    const emptySlug = 'no-menu-slug';
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'No Menu', $2, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $3::jsonb, NOW(), NOW())
    `, [partnerId, emptySlug, defaultWorkingHours]);

    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${emptySlug}/menu-items`)
      .expect(200);

    expect(response.body.data.menu_items).toEqual([]);
  });
});

// -- One menu uploaded as several files (photo of the board + PDF) -----------
// The guest sees every dish once (brief LEAF_BRIEF_MENU_DUPLICATES, 2026-10-19:
// VARKA (Новая Боровая) showed 127 items, 56 of them repeats — «эспрессо S»
// twice, «какао S» twice). Same name and same price from different files is one
// line; a different price is not a repeat. The partner's cabinet keeps the rows
// file by file — they are edited per file.

describe('Public API — menu-items: one menu uploaded as several files', () => {
  const slug = 'two-files-slug';
  let estId;
  let photoId;
  let pdfId;

  const insertItems = async (mediaId, rows) => {
    for (const [name, price, category, position, flags = {}] of rows) {
      await query(`
        INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, category_raw, confidence, sanity_flag, is_hidden_by_admin, position)
        VALUES ($1, $2, $3, $4, $5, 0.9, $6::jsonb, $7, $8)
      `, [
        estId, mediaId, name, price, category,
        flags.caution ? '{"reason":"low_confidence"}' : null,
        flags.hidden === true,
        position,
      ]);
    }
  };

  const fetchMenu = async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${slug}/menu-items`)
      .expect(200);
    return response.body.data.menu_items;
  };

  const lines = (items) => items.map(i => `${i.item_name} — ${i.price_byn}`);

  beforeEach(async () => {
    const estResult = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Two Files', $2, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Кофейня'], ARRAY['Европейская'], '$$', 'active', $3::jsonb, NOW(), NOW())
      RETURNING id
    `, [partnerId, slug, defaultWorkingHours]);
    estId = estResult.rows[0].id;

    const insertMedia = async (fileType, position) => {
      const r = await query(`
        INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary)
        VALUES ($1, 'menu', $2, 'https://cdn.test/m', 'https://cdn.test/t', 'https://cdn.test/p', $3, false)
        RETURNING id
      `, [estId, fileType, position]);
      return r.rows[0].id;
    };
    photoId = await insertMedia('image', 0);
    pdfId = await insertMedia('pdf', 1);
  });

  test('the same dishes read from two files are shown once, in menu order', async () => {
    const menu = [
      ['эспрессо S', 3.5, 'КОФЕ', 0],
      ['американо S', 4, 'КОФЕ', 1],
      ['какао S', 5, 'НЕ КОФЕ', 2],
    ];
    await insertItems(photoId, menu);
    await insertItems(pdfId, menu);

    const items = await fetchMenu();

    expect(lines(items)).toEqual(['эспрессо S — 3.5', 'американо S — 4', 'какао S — 5']);
  });

  test('a different price under the same name is not a repeat — both are shown', async () => {
    await insertItems(photoId, [['Капучино', 6, 'КОФЕ', 0]]);
    await insertItems(pdfId, [['Капучино', 7.5, 'КОФЕ', 0]]);

    const items = await fetchMenu();

    expect(lines(items).sort()).toEqual(['Капучино — 6', 'Капучино — 7.5']);
  });

  test('case, spaces and ё/е left by recognition do not make a second dish', async () => {
    await insertItems(photoId, [
      ['Сырники со смётаной', 9, 'Завтраки', 0],
      ['Чай  чёрный', null, 'Чай', 1],
    ]);
    await insertItems(pdfId, [
      [' СЫРНИКИ СО СМЕТАНОЙ ', 9.00, 'ЗАВТРАКИ', 2],
      ['чай черный', null, 'ЧАЙ', 3],
    ]);

    const items = await fetchMenu();

    // Both files hold two lines, so which spelling is shown is the tie between
    // files (their ids) — the count and the prices are what the guest checks.
    expect(items.map(i => i.price_byn)).toEqual([9, null]);
  });

  test('a section the two reads spell differently stays one section', async () => {
    // The PDF read one dish more, so the whole menu is shown from the PDF: the
    // site groups by the section name as read, and mixing «КОФЕ» from the photo
    // with «Кофе» from the PDF would show two half-sections.
    await insertItems(photoId, [
      ['Эспрессо', 3.5, 'КОФЕ', 0],
      ['Американо', 4, 'КОФЕ', 1],
    ]);
    await insertItems(pdfId, [
      ['Эспрессо', 3.5, 'Кофе', 0],
      ['Американо', 4, 'Кофе', 1],
      ['Флэт уайт', 6.5, 'Кофе', 2],
    ]);

    const items = await fetchMenu();

    expect(items.map(i => `${i.item_name} / ${i.category_raw}`)).toEqual([
      'Эспрессо / Кофе',
      'Американо / Кофе',
      'Флэт уайт / Кофе',
    ]);
  });

  test('if one copy is clean and the other is in question, the guest sees it as clean', async () => {
    // The photo's copy comes first (lower position) and is the one in question.
    await insertItems(photoId, [['Латте', 7, 'КОФЕ', 0, { caution: true }]]);
    await insertItems(pdfId, [['Латте', 7, 'КОФЕ', 1]]);

    const items = await fetchMenu();

    expect(items).toHaveLength(1);
    expect(items[0].item_name).toBe('Латте');
    expect(items[0].quality_tier).toBe('clean');
  });

  test('both copies in question — one line, still marked in question', async () => {
    await insertItems(photoId, [['Раф', 8, 'КОФЕ', 0, { caution: true }]]);
    await insertItems(pdfId, [['Раф', 8, 'КОФЕ', 0, { caution: true }]]);

    const items = await fetchMenu();

    expect(items).toHaveLength(1);
    expect(items[0].quality_tier).toBe('needs_caution');
  });

  test('a dish the menu itself lists twice in one file stays twice', async () => {
    // One file: the syrup is sold with coffee and with tea. Read from two files,
    // it is still two lines — not four, not one.
    const menu = [
      ['Сироп', 1.5, 'КОФЕ', 0],
      ['Сироп', 1.5, 'ЧАЙ', 1],
    ];
    await insertItems(photoId, menu);
    await insertItems(pdfId, menu);

    const items = await fetchMenu();

    expect(items.map(i => `${i.item_name} / ${i.category_raw}`)).toEqual([
      'Сироп / КОФЕ',
      'Сироп / ЧАЙ',
    ]);
  });

  test('a copy hidden by the moderator stays hidden; the dish is shown once', async () => {
    await insertItems(photoId, [['Мохито', 12, 'Коктейли', 0, { hidden: true }]]);
    await insertItems(pdfId, [['Мохито', 12, 'Коктейли', 0]]);
    await insertItems(pdfId, [['Подозрительное', 999, 'Коктейли', 1, { hidden: true }]]);

    const items = await fetchMenu();

    expect(lines(items)).toEqual(['Мохито — 12']);
  });

  test('two different menus (breakfast and lunch) that share a dish keep it in both sections', async () => {
    // The files share one line of four — they are two menus, not two copies of one.
    await insertItems(photoId, [
      ['Каша овсяная', 5, 'ЗАВТРАК', 0],
      ['Омлет', 7, 'ЗАВТРАК', 1],
      ['Сырники', 8, 'ЗАВТРАК', 2],
      ['Дополнительное блюдо', 3, 'ЗАВТРАК', 3],
    ]);
    await insertItems(pdfId, [
      ['Борщ', 9, 'ОБЕД', 0],
      ['Котлета', 12, 'ОБЕД', 1],
      ['Салат', 6, 'ОБЕД', 2],
      ['Дополнительное блюдо', 3, 'ОБЕД', 3],
    ]);

    const items = await fetchMenu();

    expect(items).toHaveLength(8);
    expect(items.filter(i => i.item_name === 'Дополнительное блюдо').map(i => i.category_raw).sort())
      .toEqual(['ЗАВТРАК', 'ОБЕД']);
  });

  test('a line read twice in one file, in the same section, is shown once', async () => {
    await insertItems(pdfId, [
      ['Фин де Бретань №3', 4, 'УСТРИЧНЫЙ БАР', 0],
      ['Мидии', 10, 'УСТРИЧНЫЙ БАР', 1],
      ['Фин де Бретань №3', 4, 'Устричный бар', 2],
    ]);

    const items = await fetchMenu();

    expect(lines(items)).toEqual(['Фин де Бретань №3 — 4', 'Мидии — 10']);
  });

  test('the same line in the same section of two different menus is one line (SFB oysters)', async () => {
    // The oyster card shares three lines of eight with the main menu — not a
    // copy of it — but the oysters stand under «УСТРИЧНЫЙ БАР» in both.
    const oysters = [
      ['Фин де Бретань №3', 12, 'УСТРИЧНЫЙ БАР'],
      ['Спесиаль Лима №3', 14, 'УСТРИЧНЫЙ БАР'],
      ['Плато устриц', 196, 'УСТРИЧНЫЙ БАР'],
    ];
    await insertItems(pdfId, [
      ...oysters,
      ['Тартар', 25, 'ЗАКУСКИ'], ['Сибас', 38, 'ГОРЯЧЕЕ'], ['Паста', 22, 'ГОРЯЧЕЕ'],
      ['Тирамису', 14, 'ДЕСЕРТЫ'], ['Чизкейк', 13, 'ДЕСЕРТЫ'], ['Лимонад', 8, 'НАПИТКИ'], ['Морс', 6, 'НАПИТКИ'],
    ].map(([name, price, section], i) => [name, price, section, i]));
    await insertItems(photoId, [
      ...oysters,
      ['Устрицы Жиллардо №3', 27, 'УСТРИЧНЫЙ БАР'], ['Сет устриц', 174, 'УСТРИЧНЫЙ БАР'],
      ['Шабли', 30, 'ВИНО'], ['Мюскаде', 26, 'ВИНО'], ['Шампанское', 45, 'ВИНО'],
    ].map(([name, price, section], i) => [name, price, section, i]));

    const items = await fetchMenu();

    expect(items).toHaveLength(15);
    expect(items.filter(i => i.item_name === 'Плато устриц')).toHaveLength(1);
  });

  test('a section spelled with dots and dashes is the same section (Shelbi «Дополнительно»)', async () => {
    const extras = [['МОЛОКО', 0.6], ['СЛИВКИ', 1.3], ['ЛИМОН', 0.5]];
    await insertItems(photoId, [
      ...extras.map(([name, price]) => [name, price, '—Д•О•П•О•Л•Н•И•Т•Е•Л•Ь•Н•О—']),
      ['Эспрессо', 4, 'КОФЕ'], ['Капучино', 6, 'КОФЕ'], ['Латте', 7, 'КОФЕ'], ['Раф', 8, 'КОФЕ'], ['Какао', 6, 'КОФЕ'],
    ].map(([name, price, section], i) => [name, price, section, i]));
    await insertItems(pdfId, [
      ...extras.map(([name, price]) => [name, price, '-ДОПОЛНИТЕЛЬНО-']),
      ['Чай чёрный', 4, 'ЧАЙ'], ['Чай зелёный', 4, 'ЧАЙ'], ['Матча', 9, 'ЧАЙ'], ['Сок', 5, 'НАПИТКИ'], ['Вода', 3, 'НАПИТКИ'],
    ].map(([name, price, section], i) => [name, price, section, i]));

    const items = await fetchMenu();

    expect(items).toHaveLength(13);
    expect(items.filter(i => i.item_name === 'МОЛОКО')).toHaveLength(1);
  });

  test('a line without a section is the same line in any section (a board without headings)', async () => {
    await insertItems(photoId, [
      ['БИФ', null, null, 0], ['ЧИЗ', 12, null, 1], ['ДАБЛ', 15, null, 2], ['ЧИКЕН', 11, null, 3],
    ]);
    await insertItems(pdfId, [
      ['ДОГ', 8, 'ХОТ-ДОГИ', 0], ['БИФ', null, 'ХОТ-ДОГИ', 1], ['ЧИЛИ', 9, 'ХОТ-ДОГИ', 2], ['КОЛА', 4, 'НАПИТКИ', 3],
    ]);

    const items = await fetchMenu();

    expect(items).toHaveLength(7);
    expect(items.filter(i => i.item_name === 'БИФ')).toHaveLength(1);
  });

  test('the partner cabinet still lists every row of both files', async () => {
    const menu = [['эспрессо S', 3.5, 'КОФЕ', 0], ['американо S', 4, 'КОФЕ', 1]];
    await insertItems(photoId, menu);
    await insertItems(pdfId, menu);
    const partner = await createUserAndGetTokens({
      email: 'two-files-partner@test.com',
      phone: null,
      password: 'Partner123!@#',
      name: 'Two Files Partner',
      role: 'partner',
      authMethod: 'email',
    });
    await query('UPDATE establishments SET partner_id = $1 WHERE id = $2', [partner.user.id, estId]);

    const response = await request(app)
      .get(`/api/v1/partner/establishments/${estId}/menu-items`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(4);
    expect(new Set(response.body.data.map(i => i.media_id))).toEqual(new Set([photoId, pdfId]));
  });
});

// ============================================================================
// /public/establishments/by-slug/:slug/reviews
// ============================================================================

describe('Public API — GET /api/v1/public/establishments/by-slug/:slug/reviews', () => {
  let activeSlug;
  let activeEstId;

  beforeEach(async () => {
    activeSlug = 'reviews-test-slug';

    const estResult = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Reviews Test', $2, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $3::jsonb, NOW(), NOW())
      RETURNING id
    `, [partnerId, activeSlug, defaultWorkingHours]);
    activeEstId = estResult.rows[0].id;

    // Partial unique index on reviews (user_id, establishment_id) WHERE is_deleted=FALSE.
    // Need separate users for each non-deleted review for the same establishment.
    const hiddenReviewerResult = await query(
      `INSERT INTO users (id, email, password_hash, name, role, auth_method)
       VALUES (gen_random_uuid(), 'hidden@test.com', 'hash', 'Hidden Reviewer', 'user', 'email')
       RETURNING id`
    );
    const hiddenReviewerId = hiddenReviewerResult.rows[0].id;

    const deletedReviewerResult = await query(
      `INSERT INTO users (id, email, password_hash, name, role, auth_method)
       VALUES (gen_random_uuid(), 'deleted@test.com', 'hash', 'Deleted Reviewer', 'user', 'email')
       RETURNING id`
    );
    const deletedReviewerId = deletedReviewerResult.rows[0].id;

    // 1 visible (main user), 1 admin-hidden (different user), 1 soft-deleted (third user)
    await query(`
      INSERT INTO reviews (id, user_id, establishment_id, rating, content, is_visible, is_deleted, created_at, updated_at)
      VALUES
        (gen_random_uuid(), $1, $4, 5, 'Visible review', true, false, NOW(), NOW()),
        (gen_random_uuid(), $2, $4, 1, 'Hidden by admin', false, false, NOW(), NOW()),
        (gen_random_uuid(), $3, $4, 4, 'Deleted review', true, true, NOW(), NOW())
    `, [userId, hiddenReviewerId, deletedReviewerId, activeEstId]);
  });

  test('returns 200 and visible non-deleted reviews', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/reviews`)
      .expect(200);

    const contents = response.body.data.reviews.map(r => r.content);
    expect(contents).toContain('Visible review');
    expect(contents).not.toContain('Hidden by admin');
    expect(contents).not.toContain('Deleted review');
  });

  test('review projection excludes partner_responder_id', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/reviews`)
      .expect(200);

    for (const r of response.body.data.reviews) {
      expect(r).not.toHaveProperty('partner_responder_id');
      expect(r).not.toHaveProperty('is_visible');
      expect(r).not.toHaveProperty('is_deleted');
    }
  });

  test('reviews pagination uses totalPages convention', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/reviews`)
      .expect(200);

    expect(response.body.data.pagination).toHaveProperty('totalPages');
    expect(response.body.data.pagination).not.toHaveProperty('pages');
  });

  test('404 for non-existent establishment slug on reviews', async () => {
    await request(app)
      .get('/api/v1/public/establishments/by-slug/does-not-exist/reviews')
      .expect(404);
  });

  test('includes author wrapper', async () => {
    const response = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${activeSlug}/reviews`)
      .expect(200);

    expect(response.body.data.reviews.length).toBeGreaterThan(0);
    const r = response.body.data.reviews[0];
    expect(r).toHaveProperty('author');
    expect(r.author).toHaveProperty('id');
    expect(r.author).toHaveProperty('name');
  });
});
