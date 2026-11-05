/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Вход через Google — с настоящей библиотекой google-auth-library и настоящей
 * проверкой подписи: подделан только источник открытых ключей Google, сеть не
 * нужна, токены подписаны здесь (нитка «Расходы посторонних», п. 1). Библиотека
 * проверяет получателя токена, только когда его ей называют, поэтому без
 * настройки GOOGLE_CLIENT_ID вход принимал токен любого приложения Google.
 */

import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import { OAuth2Client } from 'google-auth-library';
import { verifyGoogleToken } from '../../services/oauthService.js';
import { resolveGoogleClientId } from '../../config/oauth.js';

const OUR_CLIENT = 'our-web-client.apps.googleusercontent.com';
const OTHER_APP = 'somebody-elses-app.apps.googleusercontent.com';
const KEY_ID = 'test-key';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });

const base64url = (value) => Buffer.from(value).toString('base64url');

/** An ID token as Google signs it, issued to `aud`. */
const idToken = (aud, overrides = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' }));
  const body = base64url(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud,
    sub: 'google-sub-1',
    email: 'person@example.com',
    email_verified: true,
    iat: now,
    exp: now + 600,
    ...overrides,
  }));
  const signature = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey, 'base64url');
  return `${head}.${body}.${signature}`;
};

const saved = process.env.GOOGLE_CLIENT_ID;

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = OUR_CLIENT;
  jest.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync')
    .mockResolvedValue({ certs: { [KEY_ID]: PEM }, format: 'PEM' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (saved === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = saved;
});

describe('настройка задана', () => {
  test('токен нашего клиента — вход', async () => {
    await expect(verifyGoogleToken(idToken(OUR_CLIENT))).resolves.toMatchObject({
      providerId: 'google-sub-1',
      email: 'person@example.com',
      provider: 'google',
    });
  });

  test('токен, выданный другому приложению, — отказ', async () => {
    await expect(verifyGoogleToken(idToken(OTHER_APP))).rejects.toThrow('OAUTH_INVALID_TOKEN');
  });

  test('токен с чужой подписью — отказ', async () => {
    const [head, body] = idToken(OUR_CLIENT).split('.');

    await expect(verifyGoogleToken(`${head}.${body}.${base64url('forged')}`)).rejects.toThrow('OAUTH_INVALID_TOKEN');
  });
});

describe('настройка не задана', () => {
  test.each([
    ['нет переменной', undefined],
    ['пустая', ''],
    ['одни пробелы', '   '],
  ])('%s — любой токен получает отказ, ключи Google даже не спрашиваются', async (_label, value) => {
    if (value === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = value;

    await expect(verifyGoogleToken(idToken(OTHER_APP))).rejects.toThrow('OAUTH_INVALID_TOKEN');
    expect(OAuth2Client.prototype.getFederatedSignonCertsAsync).not.toHaveBeenCalled();
  });
});

describe('resolveGoogleClientId', () => {
  test('значение — как есть, без пробелов по краям', () => {
    expect(resolveGoogleClientId({ GOOGLE_CLIENT_ID: ` ${OUR_CLIENT} ` })).toBe(OUR_CLIENT);
  });

  test.each([[{}], [{ GOOGLE_CLIENT_ID: '' }], [{ GOOGLE_CLIENT_ID: '  ' }]])('не задано (%j) — null', (env) => {
    expect(resolveGoogleClientId(env)).toBeNull();
  });
});
