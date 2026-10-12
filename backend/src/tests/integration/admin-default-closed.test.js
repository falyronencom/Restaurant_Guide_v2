/* eslint-env jest */
/**
 * The admin panel is closed by default on the server (pack 2, point 5;
 * cloud critic 2A, B-4 — «closedness held by a test, not by the server»).
 *
 * Every route of adminRoutes.js names its access tier by hand, and the
 * static guard tests/unit/adminRoutesAccessTiers.test.js fails the gate when
 * one does not. But the guard is a test: a route registered without a tier
 * and shipped past it would have been open — to anyone without
 * `authenticate`, to any signed-in role (a regular user, a partner) with it.
 *
 * This file registers probe routes WITHOUT any tier or authenticate on the
 * live router, after the module has loaded — exactly the shape of the
 * mistake — and requires the server itself to close them:
 *   - anonymous → 401; a user or a partner → 403;
 *   - a read (GET) is open to the panel roles, and a viewer's answer passes
 *     the viewer projection;
 *   - any other method is admin-only.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import adminRoutes from '../../routes/v1/adminRoutes.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';

const PROBE = '/__probe-untiered';
const URL = `/api/v1/admin${PROBE}`;

// The mistake itself: no authenticate, no tier.
adminRoutes.get(PROBE, (req, res) => res.json({
  success: true,
  data: { reached: true, admin_email: 'leak@team.by' },
}));
adminRoutes.post(PROBE, (req, res) => res.json({ success: true, data: { acted: true } }));

const tokens = {};

beforeAll(async () => {
  for (const role of ['user', 'partner', 'viewer', 'admin']) {
    tokens[role] = (await createUserAndGetTokens({
      email: `closed-${role}-${randomUUID().slice(0, 8)}@test.com`,
      phone: null,
      password: 'Closed123!@#',
      name: `Closed ${role}`,
      role,
      authMethod: 'email',
    })).accessToken;
  }
});

afterAll(async () => {
  await clearAllData();
});

describe('a panel route registered without a tier is closed by the server', () => {
  test('anonymous: 401 on read and on action', async () => {
    await request(app).get(URL).expect(401);
    await request(app).post(URL).send({}).expect(401);
  });

  test.each(['user', 'partner'])('%s: 403 on read and on action', async (role) => {
    await request(app).get(URL).set('Authorization', `Bearer ${tokens[role]}`).expect(403);
    await request(app).post(URL).set('Authorization', `Bearer ${tokens[role]}`).send({}).expect(403);
  });

  test('viewer: reads, through the viewer projection; may not act', async () => {
    const read = await request(app).get(URL)
      .set('Authorization', `Bearer ${tokens.viewer}`)
      .expect(200);
    expect(read.body.data).toEqual({ reached: true, admin_email: null });

    await request(app).post(URL)
      .set('Authorization', `Bearer ${tokens.viewer}`)
      .send({})
      .expect(403);
  });

  test('admin: reads and acts', async () => {
    const read = await request(app).get(URL)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    expect(read.body.data.admin_email).toBe('leak@team.by');

    await request(app).post(URL)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
  });

  test('the login stays public — the gate sits after it', async () => {
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'nobody@test.com', password: 'Wrong123!@#' });
    expect(response.status).not.toBe(403);
    expect(response.body?.error?.code).not.toBe('MISSING_TOKEN');
  });
});
