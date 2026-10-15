/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Служебные учётки: одна дверь и полный отзыв — сервер (директива
 * service_accounts 15.10.2026, Б1, Б2, Б4; критик 2Б S1, S2, B2).
 *
 * Ожидания — литералы директивы:
 *   Б1. Учётка панели (admin, viewer) получает сеанс только через вход панели.
 *       Общий вход отвечает ей так же, как на неверный пароль, — при верном и
 *       неверном пароле одинаково, и сеанса не создаёт. Вход через Google/
 *       Яндекс не выдаёт ей сеанс и провайдера к ней не привязывает — для
 *       подтверждённой учётки тоже и для уже привязанной тоже.
 *   Б2. «Забыли пароль» для учёток панели и дома сида (признак 037) ничего не
 *       выдаёт, ответ — как на незнакомый адрес; ссылка, выданная раньше,
 *       пароля не меняет. Дому сида провайдер не привязывается.
 *   Б4. Отказ обновления выключенной учётке гасит предъявленный сеанс: после
 *       включения он не оживает. «Сделать партнёром» из просмотрщика гасит его
 *       сеансы и push. Сброс пароля по ссылке гасит и push.
 *   Ничего не сломано: вход панели и продление сеанса панели работают;
 *   обычный гость получает ссылку сброса; обычный вход через Google работает;
 *   дом сида входит по паролю в общую дверь (кабинет).
 */
import { jest } from '@jest/globals';
import { createHash, randomBytes, randomUUID } from 'crypto';

const mockVerifyIdToken = jest.fn();
const MockOAuth2Client = jest.fn();

jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: MockOAuth2Client,
}));

const request = (await import('supertest')).default;
const app = (await import('../../server.js')).default;
const { clearAllData, query } = await import('../utils/database.js');
const { createTestUser } = await import('../utils/auth.js');
const { createAdminAndGetToken } = await import('../utils/adminTestHelpers.js');
const { invalidateAccountStatus } = await import('../../services/accountStatus.js');
const { oauthProviderResponses } = await import('../fixtures/users.js');

const PASSWORD = 'Panel-Pass-123';
const WRONG = 'Wrong-Pass-456';

beforeEach(async () => {
  await clearAllData();
  MockOAuth2Client.mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken }));
});

afterAll(async () => {
  await clearAllData();
});

const account = async ({ email, role, service = false }) => {
  const user = await createTestUser({ email, password: PASSWORD, name: 'Учётка', role });
  await query('UPDATE users SET email_verified = true, is_service_account = $2 WHERE id = $1', [user.id, service]);
  return user.id;
};

const sharedLogin = (email, password) => request(app).post('/api/v1/auth/login').send({ email, password });
const panelLogin = (email, password = PASSWORD) => request(app).post('/api/v1/admin/auth/login').send({ email, password });
const refresh = (refreshToken) => request(app).post('/api/v1/auth/refresh').send({ refreshToken });

const sessionsOf = async (id) => (await query('SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE user_id = $1', [id])).rows[0].n;

const googleSignIn = (email, sub = 'google-sub-42') => {
  mockVerifyIdToken.mockResolvedValue({
    getPayload: () => ({ ...oauthProviderResponses.google, sub, email, email_verified: true }),
  });
  return request(app).post('/api/v1/auth/oauth').send({ provider: 'google', token: 'oauth-token-1234567890' });
};

describe('Б1: the shared login does not open a session for a panel account', () => {
  test.each(['admin', 'viewer'])('%s: a right password is answered exactly as a wrong one — no session, no last-login write', async (role) => {
    const id = await account({ email: `${role}@example.com`, role });
    const before = (await query('SELECT last_login_at FROM users WHERE id = $1', [id])).rows[0];
    const right = await sharedLogin(`${role}@example.com`, PASSWORD);
    const wrong = await sharedLogin(`${role}@example.com`, WRONG);
    expect(right.status).toBe(401);
    expect(right.body).toEqual(wrong.body);
    expect(right.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await sessionsOf(id)).toBe(0);
    expect((await query('SELECT last_login_at FROM users WHERE id = $1', [id])).rows[0]).toEqual(before);
  });

  test('the panel login and the panel session\'s refresh still work', async () => {
    await account({ email: 'admin@example.com', role: 'admin' });
    const login = await panelLogin('admin@example.com').expect(200);
    const renewed = await refresh(login.body.data.refreshToken).expect(200);
    await request(app)
      .get('/api/v1/admin/audit-log')
      .set('Authorization', `Bearer ${renewed.body.data.accessToken}`)
      .expect(200);
  });

  test('an ordinary user and the seed house still sign in through the shared login', async () => {
    await account({ email: 'guest@example.com', role: 'user' });
    await account({ email: 'house@example.com', role: 'partner', service: true });
    await sharedLogin('guest@example.com', PASSWORD).expect(200);
    await sharedLogin('house@example.com', PASSWORD).expect(200);
  });
});

describe('Б1/Б2: Google/Yandex neither opens a session for nor links an operator-managed account', () => {
  test.each([
    ['admin', 'admin', false],
    ['viewer', 'viewer', false],
    ['the seed house', 'partner', true],
  ])('%s, confirmed: refused, not linked, no session', async (_, role, service) => {
    const id = await account({ email: 'held@example.com', role, service });
    const res = await googleSignIn('held@example.com');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OAUTH_EMAIL_NOT_VERIFIED');
    const { rows: [row] } = await query('SELECT oauth_provider_id, auth_method FROM users WHERE id = $1', [id]);
    expect(row).toEqual({ oauth_provider_id: null, auth_method: 'email' });
    expect(await sessionsOf(id)).toBe(0);
  });

  test.each([
    ['a panel account', 'admin', false],
    ['the seed house', 'partner', true],
  ])('%s already linked (before the rule, or by hand) gets no session from the provider', async (_, role, service) => {
    const id = await account({ email: 'linked@example.com', role, service });
    await query("UPDATE users SET auth_method = 'google', oauth_provider_id = 'google-sub-linked' WHERE id = $1", [id]);
    const res = await googleSignIn('somewhere-else@example.com', 'google-sub-linked');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OAUTH_EMAIL_NOT_VERIFIED');
    expect(await sessionsOf(id)).toBe(0);
  });

  test('a switched-off operator-managed account gets the same answer as a switched-on one', async () => {
    const id = await account({ email: 'linked@example.com', role: 'admin' });
    await query("UPDATE users SET auth_method = 'google', oauth_provider_id = 'google-sub-linked', is_active = false WHERE id = $1", [id]);
    const linked = await googleSignIn('somewhere-else@example.com', 'google-sub-linked');
    expect(linked.body.error.code).toBe('OAUTH_EMAIL_NOT_VERIFIED');
    const byEmail = await googleSignIn('linked@example.com', 'google-sub-other');
    expect(byEmail.body.error.code).toBe('OAUTH_EMAIL_NOT_VERIFIED');
  });

  test('an ordinary confirmed user is still linked and signed in', async () => {
    const id = await account({ email: 'guest@example.com', role: 'user' });
    const res = await googleSignIn('guest@example.com');
    expect(res.status).toBe(200);
    const { rows: [row] } = await query('SELECT oauth_provider_id FROM users WHERE id = $1', [id]);
    expect(row.oauth_provider_id).toBe('google-sub-42');
  });
});

describe('Б2: «forgot password» issues nothing for an operator-managed account', () => {
  const forgot = (email) => request(app).post('/api/v1/auth/forgot-password').send({ email });
  const links = async (id) => (await query('SELECT COUNT(*)::int AS n FROM password_reset_tokens WHERE user_id = $1', [id])).rows[0].n;

  test.each([
    ['admin', 'admin', false],
    ['viewer', 'viewer', false],
    ['the seed house', 'partner', true],
  ])('%s: no link, and the answer is the one an unknown address gets', async (_, role, service) => {
    const id = await account({ email: 'held@example.com', role, service });
    const held = await forgot('held@example.com');
    const unknown = await forgot('nobody-here@example.com');
    expect(held.status).toBe(unknown.status);
    expect(held.body).toEqual(unknown.body);
    expect(await links(id)).toBe(0);
  });

  test('an ordinary guest still gets a reset link', async () => {
    const id = await account({ email: 'guest@example.com', role: 'user' });
    await forgot('guest@example.com').expect(200);
    expect(await links(id)).toBe(1);
  });

  test('a link issued earlier does not set a panel account\'s password', async () => {
    const id = await account({ email: 'admin@example.com', role: 'admin' });
    const raw = randomBytes(32).toString('hex');
    await query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')",
      [id, createHash('sha256').update(raw).digest('hex')],
    );
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token: raw, password: 'Taken9Over!pass' });
    expect(res.status).toBe(410);
    await panelLogin('admin@example.com', PASSWORD).expect(200);
    const { rows: [link] } = await query('SELECT used_at FROM password_reset_tokens WHERE user_id = $1', [id]);
    expect(link.used_at).not.toBeNull();
  });
});

describe('Б4: whatever takes access away takes all of it', () => {
  const device = async (id) => {
    await query("INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, $2, 'android')", [id, `fcm-${randomUUID()}`]);
  };
  const activeDevices = async (id) => (await query(
    'SELECT COUNT(*)::int AS n FROM device_tokens WHERE user_id = $1 AND is_active = TRUE', [id],
  )).rows[0].n;

  test('a refresh refused to a switched-off account burns the token: switched on again, it does not come back', async () => {
    const id = await account({ email: 'guest@example.com', role: 'user' });
    const login = await sharedLogin('guest@example.com', PASSWORD).expect(200);
    await query('UPDATE users SET is_active = false WHERE id = $1', [id]);
    invalidateAccountStatus(id);
    const refused = await refresh(login.body.data.refreshToken);
    expect(refused.status).not.toBe(200);
    const { rows: [burned] } = await query(
      'SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND used_at IS NULL', [id],
    );
    expect(burned.n).toBe(0);

    await query('UPDATE users SET is_active = true WHERE id = $1', [id]);
    invalidateAccountStatus(id);
    const again = await refresh(login.body.data.refreshToken);
    expect(again.status).not.toBe(200);
  });

  test('«make partner» on a viewer ends its sessions, push devices and reset links', async () => {
    const { accessToken: adminToken } = await createAdminAndGetToken();
    const id = await account({ email: 'viewer@example.com', role: 'viewer' });
    const login = await panelLogin('viewer@example.com').expect(200);
    await device(id);
    await query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')",
      [id, randomUUID().replace(/-/g, '').padEnd(64, '0')],
    );

    await request(app)
      .post(`/api/v1/admin/users/${id}/upgrade-to-partner`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const renewed = await refresh(login.body.data.refreshToken);
    expect(renewed.status).toBe(401);
    expect(await activeDevices(id)).toBe(0);
    const { rows: [links] } = await query(
      'SELECT COUNT(*)::int AS n FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL', [id],
    );
    expect(links.n).toBe(0);
  });

  test('a password reset by link switches off the push devices too', async () => {
    const id = await account({ email: 'guest@example.com', role: 'user' });
    await device(id);
    const raw = randomBytes(32).toString('hex');
    await query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')",
      [id, createHash('sha256').update(raw).digest('hex')],
    );
    await request(app).post('/api/v1/auth/reset-password').send({ token: raw, password: 'Fresh9New!pass' }).expect(200);
    expect(await activeDevices(id)).toBe(0);
  });
});
