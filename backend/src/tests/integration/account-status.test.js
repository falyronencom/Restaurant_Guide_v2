/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * An account switched off or given another role is treated as such from the
 * next request — not when its access token expires (JWT_ACCESS_EXPIRY = 4h).
 *
 * authenticate verifies the token, then asks services/accountStatus.js: the
 * database decides whether the account may act and with which role. The
 * answer is cached briefly per account; where the code itself changes a role
 * (upgrade to partner, claim) the cache is dropped at once — those cases are
 * tested with a warm cache. A change made in the database by hand applies
 * within the cache bound — those cases are tested from a cold cache (the
 * account has not been seen since its token was issued, the usual situation
 * for a token picked up hours later).
 *
 * The token is always the one issued before the change, presented exactly as
 * clients do (Authorization: Bearer). What the clients do with the 401
 * ACCOUNT_INACTIVE: refresh once — and the refresh endpoint answers the same
 * code, so mobile, the site and the panel sign the account out.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { createPartnerWithEstablishment } from '../utils/adminTestHelpers.js';
import { upgradeUserToPartner } from '../../services/authService.js';

const newAccount = (role) => createUserAndGetTokens({
  email: `account-${randomUUID()}@test.com`,
  phone: null,
  password: 'User123!@#',
  name: 'Проверка аккаунта',
  role,
  authMethod: 'email',
});

const bearer = (account) => `Bearer ${account.accessToken}`;

/** An authenticated read any role may make — warms the cache for the account. */
const touch = (account) => request(app)
  .get('/api/v1/notifications/unread-count')
  .set('Authorization', bearer(account));

afterAll(async () => {
  await clearAllData();
});

describe('switched off in the database — the token issued before stops working', () => {
  test('a switched-off account gets 401 ACCOUNT_INACTIVE on its next request; refresh answers the same', async () => {
    const account = await newAccount('user');
    await query('UPDATE users SET is_active = false WHERE id = $1', [account.user.id]);

    const response = await touch(account).expect(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');

    // The client's next step: one refresh — refused with the same code.
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken })
      .expect(401);
    expect(refresh.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  test('an account that no longer exists gets 401 ACCOUNT_INACTIVE', async () => {
    const account = await newAccount('user');
    await query('DELETE FROM users WHERE id = $1', [account.user.id]);

    const response = await touch(account).expect(401);
    expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  test('an active account is let through, as before', async () => {
    const account = await newAccount('user');

    const response = await touch(account).expect(200);
    expect(response.body.success).toBe(true);
  });
});

describe('role changed — the role in the database wins over the role in the token', () => {
  test('an admin demoted in the database loses the panel on the next request', async () => {
    const admin = await newAccount('admin');
    await query("UPDATE users SET role = 'user' WHERE id = $1", [admin.user.id]);

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', bearer(admin))
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.details.your_role).toBe('user');
  });

  test('upgrade to partner applies from the next request, even with a warm cache and the old token', async () => {
    const account = await newAccount('user');
    await touch(account).expect(200);
    await request(app)
      .get('/api/v1/partner/establishments')
      .set('Authorization', bearer(account))
      .expect(403);

    await upgradeUserToPartner(account.user.id);

    await request(app)
      .get('/api/v1/partner/establishments')
      .set('Authorization', bearer(account))
      .expect(200);
  });

  test('a claim by the moderator makes the account a partner from its next request (warm cache, old token)', async () => {
    const admin = await newAccount('admin');
    const account = await newAccount('user');
    const { establishment } = await createPartnerWithEstablishment('active');
    await touch(account).expect(200);

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', bearer(admin))
      .send({ user_id: account.user.id })
      .expect(200);

    await request(app)
      .get('/api/v1/partner/establishments')
      .set('Authorization', bearer(account))
      .expect(200);
  });
});
