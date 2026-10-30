/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration: the sign-in, letter and session paths write no e-mail, no
 * phone and no piece of a refresh token to the log (30.10.2026).
 *
 * Until then every sign-in through Google or Yandex wrote the person's address
 * (oauthService and three authenticateWithOAuth lines), every letter wrote its
 * recipient (emailService), and the refresh-token lines carried the token's
 * first 10 characters. The real routes → services → pg-test chain runs here
 * with only the providers mocked (google-auth-library, the fetch to
 * login.yandex.ru, as in oauth.test.js); Resend is not configured in tests, so
 * every letter ends on its «not configured» line — the one that carried the
 * address too.
 *
 * What the code HANDS the logger is read (spies), not what the logger prints:
 * the logger's own redaction (utils/logger.js, logger.test.js) is a second
 * layer and must not be what keeps these lines clean.
 */
import { jest } from '@jest/globals';

const mockVerifyIdToken = jest.fn();
const MockOAuth2Client = jest.fn();

jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: MockOAuth2Client,
}));

const request = (await import('supertest')).default;
const app = (await import('../../server.js')).default;
const { default: logger } = await import('../../utils/logger.js');
const { resolveYandexClientIds } = await import('../../config/oauth.js');
const { clearAllData, query } = await import('../utils/database.js');
const { createTestUser } = await import('../utils/auth.js');

const DUMMY_TOKEN = 'oauth-token-1234567890'; // satisfies the validator length (10–5000)
const PASSWORD = 'Test123!@#';

const ADDRESSES = {
  yandex: 'yandex-logs@yandex.by',
  google: 'google-logs@gmail.com',
  linked: 'linked-logs@example.by',
  claimed: 'claimed-logs@example.by',
  registered: 'registered-logs@example.by',
};
const PHONE = '+375291112233';

let savedFetch;

beforeAll(() => {
  savedFetch = global.fetch;
});

beforeEach(async () => {
  await clearAllData();
  // resetMocks:true wipes the factory impl each test (feedback_jest_resetmocks).
  MockOAuth2Client.mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken }));
});

afterAll(async () => {
  global.fetch = savedFetch;
  await clearAllData();
});

/**
 * Every log line written while `act` runs: the level, the message, the context.
 * `act` gets the array as it fills, to wait for a line written in the background.
 */
const logWhile = async (act) => {
  const calls = [];
  for (const level of ['error', 'warn', 'info', 'debug']) {
    jest.spyOn(logger, level).mockImplementation((...args) => {
      calls.push({ level, args });
      return logger;
    });
  }
  await act(calls);
  return calls;
};

const messages = (calls) => calls.map(({ args }) => args[0]);

/** No address (nor its mailbox), no phone (with or without its plus) anywhere. */
const expectNoPersonalData = (calls) => {
  const text = JSON.stringify(calls).toLowerCase();
  Object.values(ADDRESSES).forEach((address) => {
    expect(text).not.toContain(address);
    expect(text).not.toContain(address.split('@')[0]);
  });
  expect(text).not.toContain(PHONE);
  expect(text).not.toContain(PHONE.slice(1));
  expect(text).not.toContain(PHONE.slice(4)); // without the country code
};

/** A background step (a letter after the answer) has written its line. */
const untilLogged = async (calls, message) => {
  for (let i = 0; i < 100 && !messages(calls).includes(message); i += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
};

const yandexSignIn = (id, email) => {
  const [acceptedApp] = resolveYandexClientIds(process.env);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id, client_id: acceptedApp, default_email: email, display_name: 'Яндекс Пользователь' }),
  });
  return request(app).post('/api/v1/auth/oauth').send({ provider: 'yandex', token: DUMMY_TOKEN });
};

const googleSignIn = (sub, email, emailVerified = true) => {
  mockVerifyIdToken.mockResolvedValue({
    getPayload: () => ({ sub, email, name: 'Google Пользователь', email_verified: emailVerified }),
  });
  return request(app).post('/api/v1/auth/oauth').send({ provider: 'google', token: DUMMY_TOKEN });
};

const passwordAccount = async (email, { emailVerified }) => {
  const user = await createTestUser({ email, password: PASSWORD, name: 'Анна' });
  if (emailVerified) {
    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [user.id]);
  }
  return user;
};

describe('Google and Yandex sign-in: the account and the provider in the log, never the address', () => {
  test('a new account, a second sign-in, a link onto a password account', async () => {
    await passwordAccount(ADDRESSES.linked, { emailVerified: true });

    const calls = await logWhile(async () => {
      await yandexSignIn(1001, ADDRESSES.yandex).expect(200);
      await yandexSignIn(1001, ADDRESSES.yandex).expect(200);
      await googleSignIn('google-sub-logs', ADDRESSES.google).expect(200);
      await yandexSignIn(1002, ADDRESSES.linked).expect(200);
    });

    expectNoPersonalData(calls);
    expect(messages(calls)).toEqual(expect.arrayContaining([
      'Yandex token verified',
      'Google token verified',
      'OAuth login: new user created',
      'OAuth login: existing user',
      'OAuth login: linked existing account',
    ]));
  });

  test('an unconfirmed provider address claiming an existing account: refused, the account by its id', async () => {
    const claimed = await passwordAccount(ADDRESSES.claimed, { emailVerified: true });

    const calls = await logWhile(async () => {
      await googleSignIn('google-sub-claim', ADDRESSES.claimed, false).expect(403);
    });

    expectNoPersonalData(calls);
    const refusal = calls.find(({ args }) => args[0] === 'OAuth login: unverified email tried to claim existing account');
    expect(refusal.args[1]).toEqual({ userId: claimed.id, provider: 'google' });
  });
});

describe('letters: the account in the log, never the recipient', () => {
  test('the code after registration, a code asked again, a password-reset link', async () => {
    const calls = await logWhile(async (seen) => {
      const registered = await request(app).post('/api/v1/auth/register').send({
        email: ADDRESSES.registered, phone: PHONE, password: PASSWORD, name: 'Анна', authMethod: 'email',
      }).expect(201);
      await untilLogged(seen, 'Resend not configured — email verification code not sent');

      await request(app)
        .post('/api/v1/auth/send-verification-code')
        .set('Authorization', `Bearer ${registered.body.data.accessToken}`)
        .expect(200);
      await request(app).post('/api/v1/auth/forgot-password').send({ email: ADDRESSES.registered }).expect(200);
      // The reset letter goes out after the answer, too (timing defence).
      await untilLogged(seen, 'Resend not configured — password reset email not sent');
    });

    expectNoPersonalData(calls);
    const notSent = calls.filter(({ args }) => /^Resend not configured/.test(args[0]));
    expect(notSent.map(({ args }) => args[0])).toEqual(expect.arrayContaining([
      'Resend not configured — email verification code not sent',
      'Resend not configured — password reset email not sent',
    ]));
    notSent.forEach(({ args }) => expect(args[1].userId).toEqual(expect.any(String)));
  });
});

describe('refresh tokens: not one character of the token in the log', () => {
  test('an unknown token presented, a logout', async () => {
    const unknown = 'f3a9c2e17b4d58a6'.repeat(4); // the 64-hex shape of a real one
    let issued;

    const calls = await logWhile(async (seen) => {
      const registered = await request(app).post('/api/v1/auth/register').send({
        email: ADDRESSES.registered, password: PASSWORD, name: 'Анна', authMethod: 'email',
      }).expect(201);
      issued = registered.body.data.refreshToken;

      await request(app).post('/api/v1/auth/refresh').send({ refreshToken: unknown }).expect(401);
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${registered.body.data.accessToken}`)
        .send({ refreshToken: issued })
        .expect(200);
      await untilLogged(seen, 'Resend not configured — email verification code not sent');
    });

    const text = JSON.stringify(calls);
    expect(text).not.toContain(unknown.slice(0, 6));
    expect(text).not.toContain(issued.slice(0, 6));
    expect(messages(calls)).toEqual(expect.arrayContaining(['Refresh token not found', 'Refresh token invalidated']));
    expectNoPersonalData(calls);
  });
});
