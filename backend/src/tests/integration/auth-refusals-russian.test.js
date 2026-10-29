/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отказы входа и сеанса — по-русски, коды и статусы прежние (решение
 * Координатора 25.10 и 29.10.2026: английские отказы входа переведены одним
 * проходом вместе с текстами приложения и сайта).
 *
 * Два слоя:
 *  - ответы: каждый случай, до которого запрос доходит без внешних сервисов,
 *    отвечает тем же кодом и статусом, что прежде, и текстом из словаря
 *    constants/authRefusals.js; вход через Google и Яндекс — со своим именем
 *    сервиса в тексте;
 *  - исходник: в authController.js и middleware/auth.js нет ни одного
 *    английского текста для человека — случай, который сюда не попал
 *    запросом (500 authorize без authenticate, гонка первого входа), не
 *    вернёт английский молча.
 *
 * Google — через подменённую библиотеку, Яндекс — через подменённый fetch
 * (как в oauth.test.js): сеть тесту не нужна.
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const mockVerifyIdToken = jest.fn();
const MockOAuth2Client = jest.fn();

jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: MockOAuth2Client,
}));

const request = (await import('supertest')).default;
const jwt = (await import('jsonwebtoken')).default;
const app = (await import('../../server.js')).default;
const { clearAllData } = await import('../utils/database.js');
const { createUserAndGetTokens } = await import('../utils/auth.js');
const { testUsers } = await import('../fixtures/users.js');
const { AUTH_REFUSALS, SUPPORT_EMAIL } = await import('../../constants/authRefusals.js');

const CYRILLIC = /[А-Яа-яЁё]/;
const DUMMY_OAUTH_TOKEN = 'oauth-token-1234567890';

/** Текст отказа: у authController он в `error.message`, у проверки токена — в `message`. */
const refusalText = (body) => body.error?.message ?? body.message;

let savedFetch;

beforeAll(() => {
  savedFetch = global.fetch;
});

beforeEach(async () => {
  await clearAllData();
  MockOAuth2Client.mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken }));
});

afterAll(async () => {
  global.fetch = savedFetch;
  await clearAllData();
});

describe('словарь отказов входа', () => {
  test('каждая фраза — русская, без английских слов', () => {
    const values = Object.values(AUTH_REFUSALS);
    expect(values.length).toBeGreaterThanOrEqual(35);
    for (const text of values) {
      expect(text).toMatch(CYRILLIC);
      // Латиница — только имена сервисов, «email» и адрес поддержки.
      const latin = text
        .replace(SUPPORT_EMAIL, '')
        .match(/[A-Za-z]+/g) ?? [];
      expect(latin.filter((word) => !['email', 'Google'].includes(word))).toEqual([]);
    }
  });

  test('отключённая учётная запись называет адрес поддержки', () => {
    expect(AUTH_REFUSALS.accountDeactivated).toContain(SUPPORT_EMAIL);
    expect(AUTH_REFUSALS.accountInactive).toContain(SUPPORT_EMAIL);
  });
});

describe('проверка токена: код и статус прежние, текст русский', () => {
  const me = () => request(app).get('/api/v1/auth/me');

  test('без токена — 401 MISSING_TOKEN', async () => {
    const res = await me().expect(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.signInRequired);
  });

  test('заголовок не той формы — 401 INVALID_TOKEN_FORMAT', async () => {
    const res = await me().set('Authorization', 'Token abc').expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN_FORMAT');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.sessionInvalid);
  });

  test('не токен — 401 MALFORMED_TOKEN', async () => {
    const res = await me().set('Authorization', 'Bearer not-a-jwt').expect(401);
    expect(res.body.error.code).toBe('MALFORMED_TOKEN');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.sessionInvalid);
  });

  test('истёкший токен — 401 TOKEN_EXPIRED', async () => {
    const expired = jwt.sign(
      { userId: '00000000-0000-0000-0000-000000000000', email: 'x@test.com', role: 'user' },
      process.env.JWT_SECRET,
      {
        expiresIn: -10,
        issuer: 'restaurant-guide-belarus',
        audience: 'restaurant-guide-api',
      },
    );
    const res = await me().set('Authorization', `Bearer ${expired}`).expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.sessionExpired);
  });

  test('обновление неизвестным токеном — 401 INVALID_TOKEN', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'f'.repeat(64) })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.sessionInvalid);
  });
});

describe('вход и регистрация: код и статус прежние, текст русский', () => {
  test('неверный пароль — 401 INVALID_CREDENTIALS', async () => {
    await createUserAndGetTokens(testUsers.regularUser);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUsers.regularUser.email, password: 'Wrong123!@#' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.invalidCredentials);
  });

  test('занятая почта — 409 EMAIL_EXISTS', async () => {
    await createUserAndGetTokens(testUsers.regularUser);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testUsers.regularUser.email,
        password: 'Another123!@#',
        name: 'Пётр Петров',
      })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.emailExists);
  });

  test('код подтверждения не из 6 цифр — 400 INVALID_REQUEST', async () => {
    const { accessToken } = await createUserAndGetTokens(testUsers.regularUser);
    const res = await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '12ab' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.codeFormat);
  });

  test('ссылка сброса пароля неизвестна — 410 INVALID_OR_EXPIRED_TOKEN', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'a'.repeat(64), password: 'NewPass123!@#' })
      .expect(410);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.resetLinkInvalid);
  });

  test('выход — русский ответ', async () => {
    const { accessToken, refreshToken } = await createUserAndGetTokens(testUsers.regularUser);
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(200);
    expect(res.body.data.message).toBe(AUTH_REFUSALS.signedOut);
  });
});

describe('вход через Google и Яндекс: текст называет свой сервис', () => {
  const postOAuth = (provider) =>
    request(app).post('/api/v1/auth/oauth').send({ provider, token: DUMMY_OAUTH_TOKEN });

  test('Google не подтвердил вход — 401 INVALID_TOKEN, «через Google»', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'));
    const res = await postOAuth('google').expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.oauthGoogleFailed);
  });

  test('Яндекс не подтвердил вход — 401 INVALID_TOKEN, «через Яндекс»', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const res = await postOAuth('yandex').expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(refusalText(res.body)).toBe(AUTH_REFUSALS.oauthYandexFailed);
  });
});

describe('исходник: английских текстов для человека не осталось', () => {
  const source = (relative) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

  // Текст для человека — значение `message` в ответе: `message: '…'` или
  // `message = '…'`. Сообщения журнала (logger.*) — не для человека, и в
  // них `message:` не встречается.
  const englishMessages = (text) =>
    [...text.matchAll(/\bmessage\s*[:=]\s*(['`])([^'`]*)\1/g)]
      .map((m) => m[2])
      .filter((value) => /[A-Za-z]/.test(value) && !CYRILLIC.test(value));

  test.each([
    ['controllers/authController.js', '../../controllers/authController.js'],
    ['middleware/auth.js', '../../middleware/auth.js'],
  ])('%s', (_name, path) => {
    const text = source(path);
    // Разбор, который ничего не видит, прошёл бы и на английском.
    expect(text).toMatch(/\bmessage\s*[:=]/);
    expect(englishMessages(text)).toEqual([]);
  });
});
