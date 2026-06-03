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
    for (const c of response.body.data.cities) {
      expect(c).toHaveProperty('slug');
      expect(c).toHaveProperty('name');
    }

    expect(response.body.data.categories.length).toBe(15);
    expect(response.body.data.cuisines.length).toBe(12);
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
    const response = await request(app)
      .get('/api/v1/public/establishments')
      .expect(200);

    const names = response.body.data.establishments.map(e => e.name);
    expect(names).not.toContain('Inactive Draft');
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
    const response = await request(app)
      .get('/api/v1/public/establishments/map')
      .expect(200);

    const names = response.body.data.establishments.map(e => e.name);
    expect(names).not.toContain('Map Draft');
  });

  test('400 for invalid city slug on map', async () => {
    await request(app)
      .get('/api/v1/public/establishments/map')
      .query({ city: 'moscow' })
      .expect(400);
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
