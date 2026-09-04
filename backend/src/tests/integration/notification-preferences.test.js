/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Notification Preferences Integration Tests (migration 033: menu_push_enabled)
 *
 * Runs against the real test DB — proves the column round-trips through the
 * HTTP contract and into the push gate:
 * - GET returns four booleans, all true, when no row exists
 * - PUT with menu_push_enabled creates the row and stores the value
 * - PUT from a client that does not know the field (pre-033 mobile build)
 *   keeps the stored menu value — backward compatibility
 * - validation: empty body / non-boolean → 400
 * - pushService.isPushEnabledForType reads the stored value for menu_parsed
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import * as NotificationPreferencesModel from '../../models/notificationPreferencesModel.js';
import { isPushEnabledForType } from '../../services/pushService.js';

const PREFS_URL = '/api/v1/notifications/preferences';

let partnerToken;
let partnerId;

beforeAll(async () => {
  const partner = await createUserAndGetTokens(testUsers.partner);
  partnerToken = partner.accessToken;
  partnerId = partner.user.id;
});

beforeEach(async () => {
  await query('TRUNCATE TABLE notification_preferences CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

describe('GET /api/v1/notifications/preferences', () => {
  test('returns four enabled toggles when the user has no row yet', async () => {
    const response = await request(app)
      .get(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        user_id: partnerId,
        booking_push_enabled: true,
        reviews_push_enabled: true,
        promotions_push_enabled: true,
        menu_push_enabled: true,
      })
    );
  });

  test('requires authentication', async () => {
    await request(app).get(PREFS_URL).expect(401);
  });
});

describe('PUT /api/v1/notifications/preferences — menu_push_enabled', () => {
  test('creates the row with menu_push_enabled=false and siblings at default', async () => {
    const response = await request(app)
      .put(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ menu_push_enabled: false })
      .expect(200);

    expect(response.body.data).toEqual(
      expect.objectContaining({
        booking_push_enabled: true,
        reviews_push_enabled: true,
        promotions_push_enabled: true,
        menu_push_enabled: false,
      })
    );

    const stored = await query(
      'SELECT menu_push_enabled FROM notification_preferences WHERE user_id = $1',
      [partnerId]
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].menu_push_enabled).toBe(false);
  });

  test('a client that does not send menu_push_enabled leaves it untouched (pre-033 build)', async () => {
    await request(app)
      .put(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ menu_push_enabled: false })
      .expect(200);

    // Old client payload: only the three original fields.
    const response = await request(app)
      .put(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ booking_push_enabled: false })
      .expect(200);

    expect(response.body.data.booking_push_enabled).toBe(false);
    expect(response.body.data.menu_push_enabled).toBe(false);

    const getResponse = await request(app)
      .get(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
    expect(getResponse.body.data.menu_push_enabled).toBe(false);
    expect(getResponse.body.data.booking_push_enabled).toBe(false);
  });

  test('re-enabling menu push updates the existing row', async () => {
    await request(app)
      .put(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ menu_push_enabled: false })
      .expect(200);

    const response = await request(app)
      .put(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ menu_push_enabled: true })
      .expect(200);

    expect(response.body.data.menu_push_enabled).toBe(true);
    const rows = await query(
      'SELECT COUNT(*)::int AS n FROM notification_preferences WHERE user_id = $1',
      [partnerId]
    );
    expect(rows.rows[0].n).toBe(1);
  });

  test('rejects an empty body', async () => {
    const response = await request(app)
      .put(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({})
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  test('rejects a non-boolean menu_push_enabled', async () => {
    const response = await request(app)
      .put(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ menu_push_enabled: 'off' })
      .expect(400);

    expect(response.body.message).toBe('menu_push_enabled must be a boolean');
  });
});

describe('push gate reads the stored menu preference', () => {
  test('menu_parsed push is enabled by default and disabled after opt-out', async () => {
    const before = await NotificationPreferencesModel.getByUserId(partnerId);
    expect(isPushEnabledForType('menu_parsed', before)).toBe(true);

    await request(app)
      .put(PREFS_URL)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ menu_push_enabled: false })
      .expect(200);

    const after = await NotificationPreferencesModel.getByUserId(partnerId);
    expect(isPushEnabledForType('menu_parsed', after)).toBe(false);
    // Opting out of menu push does not touch the other categories.
    expect(isPushEnabledForType('booking_received', after)).toBe(true);
    expect(isPushEnabledForType('new_review', after)).toBe(true);
  });

  test('menu_item_hidden_by_admin never passes the gate regardless of preferences', async () => {
    const prefs = await NotificationPreferencesModel.getByUserId(partnerId);
    expect(isPushEnabledForType('menu_item_hidden_by_admin', prefs)).toBe(false);
  });
});
