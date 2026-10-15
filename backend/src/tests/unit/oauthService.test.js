/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: oauthService.js
 *
 * Pins the provider verification contracts the web Yandex flow + mobile both
 * depend on. Google is JWT-based (google-auth-library mocked); Yandex is an
 * opaque-token API call (global.fetch swapped, per llmStructurer.test.js:13-55).
 * Zero network. Production code unchanged — additive coverage of a path that
 * previously had none (Discovery Q8).
 */
import { jest } from '@jest/globals';

const mockVerifyIdToken = jest.fn();
const MockOAuth2Client = jest.fn();

jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: MockOAuth2Client,
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { verifyGoogleToken, verifyYandexToken } = await import(
  '../../services/oauthService.js'
);
const { DEFAULT_YANDEX_CLIENT_IDS } = await import('../../config/oauth.js');
const logger = (await import('../../utils/logger.js')).default;

/** The application our mobile app and website sign in through. */
const OUR_YANDEX_APP = DEFAULT_YANDEX_CLIENT_IDS[0];

describe('oauthService', () => {
  let originalFetch;

  beforeEach(() => {
    // jest.config has resetMocks:true, which wipes factory implementations
    // before every test — re-arm the OAuth2Client constructor so `new
    // OAuth2Client()` yields our stubbed verifyIdToken (feedback_jest_resetmocks).
    MockOAuth2Client.mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken }));
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('verifyGoogleToken', () => {
    const makeTicket = (payload) => ({ getPayload: () => payload });

    test('returns normalized user data for a valid id_token', async () => {
      mockVerifyIdToken.mockResolvedValue(
        makeTicket({
          sub: 'google-sub-1',
          email: 'User@Example.com',
          name: 'Иван',
          picture: 'https://pic',
          email_verified: true,
        })
      );

      const result = await verifyGoogleToken('id-token');

      expect(result).toEqual({
        providerId: 'google-sub-1',
        email: 'user@example.com', // lowercased + trimmed
        name: 'Иван',
        avatarUrl: 'https://pic',
        emailVerified: true,
        provider: 'google',
      });
    });

    test('throws OAUTH_NO_EMAIL when the payload carries no email', async () => {
      mockVerifyIdToken.mockResolvedValue(makeTicket({ sub: 's', email: undefined }));
      await expect(verifyGoogleToken('id-token')).rejects.toThrow('OAUTH_NO_EMAIL');
    });

    test('maps any verification failure to OAUTH_INVALID_TOKEN', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('bad signature'));
      await expect(verifyGoogleToken('id-token')).rejects.toThrow('OAUTH_INVALID_TOKEN');
    });

    test('derives name from the email local-part and nulls a missing avatar', async () => {
      mockVerifyIdToken.mockResolvedValue(
        makeTicket({ sub: 's', email: 'alice@example.com', email_verified: false })
      );
      const result = await verifyGoogleToken('id-token');
      expect(result.name).toBe('alice');
      expect(result.emailVerified).toBe(false);
      expect(result.avatarUrl).toBeNull();
    });
  });

  describe('verifyYandexToken', () => {
    // Every answer names the application the token was issued to; ours unless
    // a test says otherwise. A body passed with client_id: undefined has none.
    const yandexResponse = (body, ok = true, status = 200) => ({
      ok,
      status,
      json: async () => ({ client_id: OUR_YANDEX_APP, ...body }),
    });

    const savedClientIds = process.env.YANDEX_CLIENT_ID;

    beforeEach(() => {
      // .env can leak into a local run; each test starts from the default.
      delete process.env.YANDEX_CLIENT_ID;
    });

    afterAll(() => {
      if (savedClientIds === undefined) delete process.env.YANDEX_CLIENT_ID;
      else process.env.YANDEX_CLIENT_ID = savedClientIds;
    });

    test('calls the Yandex login API with the OAuth header and normalizes the response', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        yandexResponse({
          id: 123456,
          default_email: 'User@Yandex.ru',
          display_name: 'Аня',
          default_avatar_id: 'avatar-xyz',
        })
      );
      global.fetch = fetchMock;

      const result = await verifyYandexToken('ya-oauth-token');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://login.yandex.ru/info?format=json',
        expect.objectContaining({
          headers: { Authorization: 'OAuth ya-oauth-token' },
        })
      );
      expect(result).toEqual({
        providerId: '123456', // String(id)
        email: 'user@yandex.ru',
        name: 'Аня',
        avatarUrl: 'https://avatars.yandex.net/get-yapic/avatar-xyz/islands-200',
        emailVerified: true, // Yandex treats default_email as verified
        provider: 'yandex',
      });
    });

    test('returns null avatar when default_avatar_id is absent', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(yandexResponse({ id: 1, default_email: 'a@b.ru', display_name: 'X' }));
      expect((await verifyYandexToken('t')).avatarUrl).toBeNull();
    });

    test('name falls back real_name → email local-part', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(yandexResponse({ id: 1, default_email: 'bob@b.ru', real_name: 'Bob Real' }));
      expect((await verifyYandexToken('t')).name).toBe('Bob Real');

      global.fetch = jest
        .fn()
        .mockResolvedValue(yandexResponse({ id: 1, default_email: 'carol@b.ru' }));
      expect((await verifyYandexToken('t')).name).toBe('carol');
    });

    test('throws OAUTH_NO_EMAIL when default_email is missing', async () => {
      global.fetch = jest.fn().mockResolvedValue(yandexResponse({ id: 1 }));
      await expect(verifyYandexToken('t')).rejects.toThrow('OAUTH_NO_EMAIL');
    });

    test('throws OAUTH_INVALID_TOKEN on a non-ok Yandex response', async () => {
      global.fetch = jest.fn().mockResolvedValue(yandexResponse({}, false, 401));
      await expect(verifyYandexToken('t')).rejects.toThrow('OAUTH_INVALID_TOKEN');
    });

    test('throws OAUTH_INVALID_TOKEN on a transport failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
      await expect(verifyYandexToken('t')).rejects.toThrow('OAUTH_INVALID_TOKEN');
    });

    describe('only tokens issued to our application', () => {
      test('a token issued to another Yandex application is refused', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          yandexResponse({ client_id: 'another-yandex-app', id: 1, default_email: 'victim@yandex.ru' })
        );

        await expect(verifyYandexToken('t')).rejects.toThrow('OAUTH_INVALID_TOKEN');
        // The other application's ID reaches the log: it is what tells a
        // client of ours missing from YANDEX_CLIENT_ID apart from a stray token.
        expect(logger.warn).toHaveBeenCalledWith(
          'Yandex token issued to another application',
          { clientId: 'another-yandex-app' }
        );
      });

      test('an answer that names no application is refused, not waved through', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          yandexResponse({ client_id: undefined, id: 1, default_email: 'a@yandex.ru' })
        );

        await expect(verifyYandexToken('t')).rejects.toThrow('OAUTH_INVALID_TOKEN');
        expect(logger.warn).toHaveBeenCalledWith(
          'Yandex token issued to another application',
          { clientId: null }
        );
      });

      test('the check comes before the e-mail: a foreign token without e-mail is still OAUTH_INVALID_TOKEN', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          yandexResponse({ client_id: 'another-yandex-app', id: 1 })
        );

        await expect(verifyYandexToken('t')).rejects.toThrow('OAUTH_INVALID_TOKEN');
      });

      test('YANDEX_CLIENT_ID lists the accepted applications and replaces the default', async () => {
        process.env.YANDEX_CLIENT_ID = 'first-app, second-app';

        global.fetch = jest.fn().mockResolvedValue(
          yandexResponse({ client_id: 'second-app', id: 1, default_email: 'a@yandex.ru' })
        );
        await expect(verifyYandexToken('t')).resolves.toMatchObject({ email: 'a@yandex.ru' });

        global.fetch = jest.fn().mockResolvedValue(
          yandexResponse({ client_id: OUR_YANDEX_APP, id: 1, default_email: 'a@yandex.ru' })
        );
        await expect(verifyYandexToken('t')).rejects.toThrow('OAUTH_INVALID_TOKEN');
      });

      test('an empty YANDEX_CLIENT_ID keeps the default — it does not open the door to every application', async () => {
        process.env.YANDEX_CLIENT_ID = ' , ';

        global.fetch = jest.fn().mockResolvedValue(
          yandexResponse({ client_id: 'another-yandex-app', id: 1, default_email: 'a@yandex.ru' })
        );
        await expect(verifyYandexToken('t')).rejects.toThrow('OAUTH_INVALID_TOKEN');

        global.fetch = jest.fn().mockResolvedValue(
          yandexResponse({ id: 1, default_email: 'a@yandex.ru' })
        );
        await expect(verifyYandexToken('t')).resolves.toMatchObject({ email: 'a@yandex.ru' });
      });
    });
  });
});
