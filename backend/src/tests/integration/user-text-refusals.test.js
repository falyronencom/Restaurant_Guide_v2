/* eslint-env jest */
/**
 * The name rule and the мат refusal on every path that writes them, over HTTP
 * (decisions of the Coordinator 17.10.2026, В4 and В8; tester's walkthrough
 * 17.10, the obscene name and review).
 *
 *   - registration (422, `details.name`, the Russian text also in `message`);
 *   - profile edit — the app's and the site's PUT /auth/profile (400, the
 *     Russian text in `error.message`, as the earlier name refusals);
 *   - Google login: a name off the rule is cleaned or replaced, the login
 *     never fails over it;
 *   - review create and edit, owner's reply (422, `details[].field`).
 *
 * Before this work the profile edit took «Анна, К.» and an obscene name, and a
 * review «х.у.й» was published: each case below was green on the old code's
 * side of the refusal it now asserts.
 */

import { jest } from '@jest/globals';

const mockVerifyIdToken = jest.fn();
const MockOAuth2Client = jest.fn();

jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: MockOAuth2Client,
}));

const request = (await import('supertest')).default;
const app = (await import('../../server.js')).default;
const { clearAllData, query } = await import('../utils/database.js');
const { createUserAndGetTokens, getUserByEmail } = await import('../utils/auth.js');
const { testUsers, oauthProviderResponses } = await import('../fixtures/users.js');
const { NAME_REFUSALS, PROVIDER_NAME_FALLBACK } = await import('../../utils/userName.js');
const { PROFANE_TEXT_MESSAGE } = await import('../../validators/reviewValidation.js');

const DUMMY_TOKEN = 'oauth-token-1234567890';
const CLEAN_REVIEW = 'Отличное место, вкусная кухня и приветливый персонал.';
const CLEAN_REPLY = 'Спасибо за отзыв, будем рады видеть вас снова!';

let userToken;
let partnerToken;
let establishmentId;

beforeAll(async () => {
  await clearAllData();
  userToken = (await createUserAndGetTokens(testUsers.regularUser)).accessToken;
  const partner = await createUserAndGetTokens(testUsers.partner);
  partnerToken = partner.accessToken;
  const created = await query(
    `INSERT INTO establishments (
       id, partner_id, name, slug, description, city, address, latitude, longitude,
       categories, cuisines, status, review_count, working_hours, price_range, created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1, 'Васильки', gen_random_uuid()::text, 'Кафе', 'Минск', 'ул. Ленина, 1',
       53.9, 27.5, ARRAY['Кафе'], ARRAY['Европейская'], 'active', 0, '{}'::jsonb, '$$', NOW(), NOW()
     ) RETURNING id`,
    [partner.user.id],
  );
  establishmentId = created.rows[0].id;
});

beforeEach(async () => {
  await query('TRUNCATE TABLE reviews CASCADE');
  MockOAuth2Client.mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken }));
});

afterAll(async () => {
  await clearAllData();
});

const putName = (name) => request(app)
  .put('/api/v1/auth/profile')
  .set('Authorization', `Bearer ${userToken}`)
  .send({ name });

const register = (name, email) => request(app)
  .post('/api/v1/auth/register')
  .send({ name, email, password: 'Secret123', authMethod: 'email' });

const postReview = (content) => request(app)
  .post('/api/v1/reviews')
  .set('Authorization', `Bearer ${userToken}`)
  .send({ establishmentId, rating: 4, content });

describe('PUT /auth/profile — the name rule', () => {
  test.each([
    ['a comma and a dot', 'Анна, К.', NAME_REFUSALS.NAME_CHARS],
    ['digits', 'Иван2000', NAME_REFUSALS.NAME_CHARS],
    ['a sign at the edge', '-Анна', NAME_REFUSALS.NAME_CHARS],
    ['one letter', 'А', NAME_REFUSALS.NAME_LENGTH],
    ['51 letters', 'А'.repeat(51), NAME_REFUSALS.NAME_LENGTH],
    ['only spaces', '   ', NAME_REFUSALS.NAME_EMPTY],
    ['мат with hyphens', 'Х-у-й', NAME_REFUSALS.NAME_PROFANE],
    ['мат with spaces', 'х у й', NAME_REFUSALS.NAME_PROFANE],
    ['мат in Latin look-alikes', 'Cyka', NAME_REFUSALS.NAME_PROFANE],
  ])('refuses %s with the Russian text, the name unchanged', async (_case, name, text) => {
    const res = await putName(name).expect(400);
    expect(res.body).toEqual({ success: false, error: { code: 'VALIDATION_ERROR', message: text } });
    expect((await getUserByEmail(testUsers.regularUser.email)).name).toBe(testUsers.regularUser.name);
  });

  test.each([
    ['Belarusian letters', 'Алеся Ўладзіслаўна'],
    ['a hyphen and an apostrophe', "Мария-Анна О'Брайен"],
    ['a typographic apostrophe', 'Мар’яна'],
    ['Latin letters', 'Jean-Luc'],
  ])('takes %s', async (_case, name) => {
    const res = await putName(name).expect(200);
    expect(res.body.data.user.name).toBe(name);
  });

  test('stores the name with its spaces collapsed', async () => {
    const res = await putName('  Анна   Мария ').expect(200);
    expect(res.body.data.user.name).toBe('Анна Мария');
  });
});

describe('POST /auth/register — the same rule', () => {
  test('refuses an obscene name: 422, the field, the text also as the summary', async () => {
    const res = await register('Х у й', 'obscene-name@test.com').expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.name).toEqual([NAME_REFUSALS.NAME_PROFANE]);
    expect(res.body.error.message).toBe(NAME_REFUSALS.NAME_PROFANE);
    expect(await getUserByEmail('obscene-name@test.com')).toBeFalsy();
  });

  test('refuses a sign outside the rule', async () => {
    const res = await register('Анна, К.', 'comma-name@test.com').expect(422);
    expect(res.body.error.details.name).toEqual([NAME_REFUSALS.NAME_CHARS]);
  });

  test('takes a Belarusian name it refused before (і, ў)', async () => {
    const res = await register('Алеся Ўладзіслаўна', 'belarusian-name@test.com').expect(201);
    expect(res.body.data.user.name).toBe('Алеся Ўладзіслаўна');
  });

  test('a refusal of another field keeps the English summary', async () => {
    const res = await register('Анна', 'not-an-email').expect(422);
    expect(res.body.error.message).toBe('Invalid input data');
  });
});

describe('POST /auth/oauth — the provider name never fails the login', () => {
  const googleLogin = (payload) => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ ...oauthProviderResponses.google, ...payload }) });
    return request(app).post('/api/v1/auth/oauth').send({ provider: 'google', token: DUMMY_TOKEN });
  };

  test('an obscene provider name becomes the neutral one', async () => {
    const res = await googleLogin({ sub: 'g-obscene', email: 'g-obscene@gmail.com', name: 'Хуйло Петров' })
      .expect(200);
    expect(res.body.data.user.name).toBe(PROVIDER_NAME_FALLBACK);
  });

  test('a provider name with signs is cleaned', async () => {
    const res = await googleLogin({ sub: 'g-signs', email: 'g-signs@gmail.com', name: 'Анна, К. (работа)' })
      .expect(200);
    expect(res.body.data.user.name).toBe('Анна К работа');
  });

  test('no provider name: the e-mail part is cleaned', async () => {
    const res = await googleLogin({ sub: 'g-noname', email: 'ivan.petrov93@gmail.com', name: undefined })
      .expect(200);
    expect(res.body.data.user.name).toBe('ivan petrov');
  });
});

describe('Reviews and owner replies — мат refused, the text not saved', () => {
  const expectRefused = (res, field) => {
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field, message: PROFANE_TEXT_MESSAGE }),
    ]);
  };

  test.each([
    ['dots between the letters', 'Еда норм, но персонал х.у.й знает что'],
    ['stretched letters', 'Официант хууууй забил на нас'],
    ['Latin look-alikes', 'Бармен xyй пойми какой'],
  ])('create: refuses %s', async (_case, content) => {
    expectRefused(await postReview(content), 'content');
    const { rows } = await query('SELECT count(*)::int AS n FROM reviews');
    expect(rows[0].n).toBe(0);
  });

  test('create: a clean review is published', async () => {
    await postReview(CLEAN_REVIEW).expect(201);
  });

  test('edit: refuses мат, the old text stays', async () => {
    const created = await postReview(CLEAN_REVIEW).expect(201);
    const id = created.body.data.review.id;
    const res = await request(app)
      .put(`/api/v1/reviews/${id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ content: 'Передумал: п и з д е ц, а не кухня' });
    expectRefused(res, 'content');
    const { rows } = await query('SELECT content FROM reviews WHERE id = $1', [id]);
    expect(rows[0].content).toBe(CLEAN_REVIEW);
  });

  test('owner reply: refuses мат, takes a clean one', async () => {
    const created = await postReview(CLEAN_REVIEW).expect(201);
    const id = created.body.data.review.id;
    const reply = (response) => request(app)
      .post(`/api/v1/reviews/${id}/response`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ response });

    expectRefused(await reply('Сам ты мудак, приходи ещё'), 'response');
    const { rows } = await query('SELECT partner_response FROM reviews WHERE id = $1', [id]);
    expect(rows[0].partner_response).toBeNull();

    await reply(CLEAN_REPLY).expect(200);
  });
});
