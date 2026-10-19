/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Device tokens — one device, one active account.
 *
 * An FCM token belongs to an app install, not to a person. When someone signs
 * out and another account signs in on the same phone, the app registers the
 * same token for the new account. Until 2026-10-07 the previous account kept
 * its row active (uniqueness is per (user_id, fcm_token)), so its pushes —
 * booking details included — kept arriving on a phone it had left.
 *
 * Registration now releases the token from every other account in the same
 * statement as the upsert. Requests are sent exactly as the app sends them
 * (mobile push_notification_service.dart: PUT { fcm_token, platform } on
 * every start; DELETE { fcm_token } on sign-out). The check reads the same
 * query the push sender uses (DeviceTokenModel.findByUserId — active only).
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import * as DeviceTokenModel from '../../models/deviceTokenModel.js';

const DEVICE = 'fcm-token-shared-phone-0001';
const OTHER_DEVICE = 'fcm-token-tablet-0002';

let first;
let second;

const registerAs = (account, fcmToken) => request(app)
  .put('/api/v1/notifications/device-token')
  .set('Authorization', `Bearer ${account.accessToken}`)
  .send({ fcm_token: fcmToken, platform: 'android' })
  .expect(200);

const activeTokensOf = async (account) => (await DeviceTokenModel.findByUserId(account.user.id))
  .map((row) => row.fcm_token)
  .sort();

beforeAll(async () => {
  first = await createUserAndGetTokens({
    email: 'first-owner@test.com',
    phone: null,
    password: 'User123!@#',
    name: 'Первый владелец',
    role: 'user',
    authMethod: 'email',
  });
  second = await createUserAndGetTokens({
    email: 'second-owner@test.com',
    phone: null,
    password: 'User123!@#',
    name: 'Второй владелец',
    role: 'partner',
    authMethod: 'email',
  });
});

beforeEach(async () => {
  await query('TRUNCATE TABLE device_tokens');
});

afterAll(async () => {
  await clearAllData();
});

describe('PUT /api/v1/notifications/device-token — one active account per device', () => {
  test('another account registering the same device takes it over: the previous one stops getting pushes', async () => {
    await registerAs(first, DEVICE);
    expect(await activeTokensOf(first)).toEqual([DEVICE]);

    await registerAs(second, DEVICE);

    expect(await activeTokensOf(second)).toEqual([DEVICE]);
    expect(await activeTokensOf(first)).toEqual([]);

    // The row of the previous owner is kept, switched off — not deleted.
    const rows = await query(
      'SELECT user_id, is_active FROM device_tokens WHERE fcm_token = $1 ORDER BY created_at',
      [DEVICE]
    );
    expect(rows.rows).toEqual([
      { user_id: first.user.id, is_active: false },
      { user_id: second.user.id, is_active: true },
    ]);
  });

  test('switching back reactivates the first account and releases the second', async () => {
    await registerAs(first, DEVICE);
    await registerAs(second, DEVICE);

    await registerAs(first, DEVICE);

    expect(await activeTokensOf(first)).toEqual([DEVICE]);
    expect(await activeTokensOf(second)).toEqual([]);
  });

  test('the same account re-registering on every app start keeps its device active', async () => {
    await registerAs(first, DEVICE);
    await registerAs(first, DEVICE);

    expect(await activeTokensOf(first)).toEqual([DEVICE]);
    const rows = await query('SELECT COUNT(*)::int AS n FROM device_tokens WHERE fcm_token = $1', [DEVICE]);
    expect(rows.rows[0].n).toBe(1);
  });

  test("taking over one device leaves the previous account's other devices alone", async () => {
    await registerAs(first, DEVICE);
    await registerAs(first, OTHER_DEVICE);

    await registerAs(second, DEVICE);

    expect(await activeTokensOf(first)).toEqual([OTHER_DEVICE]);
    expect(await activeTokensOf(second)).toEqual([DEVICE]);
  });

  test('a switched-off account gets no pushes on its devices; switched back on, it does again', async () => {
    await registerAs(first, DEVICE);
    await query('UPDATE users SET is_active = false WHERE id = $1', [first.user.id]);

    expect(await activeTokensOf(first)).toEqual([]);

    await query('UPDATE users SET is_active = true WHERE id = $1', [first.user.id]);
    expect(await activeTokensOf(first)).toEqual([DEVICE]);
  });

  test('sign-out on the device still switches off only the account that signs out', async () => {
    await registerAs(first, DEVICE);
    await registerAs(second, DEVICE);

    await request(app)
      .delete('/api/v1/notifications/device-token')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .send({ fcm_token: DEVICE })
      .expect(200);

    expect(await activeTokensOf(second)).toEqual([]);
    expect(await activeTokensOf(first)).toEqual([]);
  });

  // Above, the first account was already released by the takeover before the
  // sign-out, so a sign-out that switched off every holder would look the
  // same. Here the one signing out is NOT the current holder: the previous
  // holder's late sign-out, then an account that never had the token — the
  // current holder keeps its push.
  test('a sign-out by an account that does not hold the token leaves the current holder on', async () => {
    await registerAs(first, DEVICE);
    await registerAs(second, DEVICE);
    const stranger = await createUserAndGetTokens({
      email: `device-stranger-${Date.now()}@test.com`, password: 'Stranger123!@#', name: 'Чужой', role: 'user',
    });

    for (const account of [first, stranger]) {
      await request(app)
        .delete('/api/v1/notifications/device-token')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ fcm_token: DEVICE })
        .expect(200);
      expect(await activeTokensOf(second)).toEqual([DEVICE]);
    }
  });
});

// A malformed request is the client's mistake, and the answer says so: 400
// with a code of its own. Until 2026-10-19 the service set `error.status`,
// which the error handler does not read (it reads `statusCode`), so each of
// these went out as 500 INTERNAL_ERROR — a false server failure in the log.
// The app sends valid values; these guard any other client.
describe('/api/v1/notifications/device-token — malformed requests are refused as 400', () => {
  const put = (body) => request(app)
    .put('/api/v1/notifications/device-token')
    .set('Authorization', `Bearer ${first.accessToken}`)
    .send(body);

  test.each([
    ['no token at all', { platform: 'android' }],
    ['an empty token', { fcm_token: '', platform: 'android' }],
    ['a token of spaces', { fcm_token: '   ', platform: 'ios' }],
    ['a token that is not a string', { fcm_token: 12345, platform: 'android' }],
  ])('registration with %s: 400 FCM_TOKEN_REQUIRED, nothing stored', async (_label, body) => {
    const res = await put(body).expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FCM_TOKEN_REQUIRED');
    expect((await query('SELECT COUNT(*)::int AS n FROM device_tokens')).rows[0].n).toBe(0);
  });

  test.each([
    ['a platform the app does not have', 'web'],
    ['no platform', undefined],
  ])('registration with %s: 400 INVALID_PLATFORM, nothing stored', async (_label, platform) => {
    const res = await put({ fcm_token: DEVICE, platform }).expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_PLATFORM');
    expect((await query('SELECT COUNT(*)::int AS n FROM device_tokens')).rows[0].n).toBe(0);
  });

  test('sign-out without a token: 400 FCM_TOKEN_REQUIRED, the device stays on', async () => {
    await registerAs(first, DEVICE);

    const res = await request(app)
      .delete('/api/v1/notifications/device-token')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FCM_TOKEN_REQUIRED');
    expect(await activeTokensOf(first)).toEqual([DEVICE]);
  });
});
