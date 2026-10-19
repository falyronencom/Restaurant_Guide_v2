/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Вход через Google/Яндекс не привязывается к чужой неподтверждённой записи
 * (пакет 1 находок критиков, пункт 1; известно с 02.10.2026 как N2 / F-09;
 * критик Codex — P0).
 *
 * До правки вход через провайдера привязывался к любой записи с тем же
 * e-mail — проверялась только подтверждённость адреса у провайдера, не у
 * записи. Запись с чужим адресом может завести кто угодно (регистрация не
 * требует кода подтверждения для создания записи): её пароль, сессии,
 * партнёрская роль и карточки доставались владельцу адреса вместе с записью —
 * а регистрант сохранял вход по своему паролю в «его» учётку.
 *
 * Правило теперь: если e-mail записи подтверждён — привязка как прежде, ничего
 * не гаснет; если не подтверждён — вход через провайдера есть доказательство
 * владения адресом, и запись переходит к вошедшему: пароль снимается, все
 * выданные refresh-токены сгорают, выданные регистранту access-токены
 * отвергаются со следующего запроса (миграция 035), имя/аватар/телефон регистранта уступают
 * данным провайдера, активные карточки записи приостанавливаются с отметкой
 * модератора и причиной — до решения модератора.
 *
 * Внешняя граница провайдера подменена так же, как в oauth.test.js:
 * google-auth-library через unstable_mockModule, Яндекс — через глобальный
 * fetch. Ожидаемые значения — литералы; текст причины — тот, что читает
 * модератор в панели и новый держатель записи в уведомлении.
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
const { createUserAndGetTokens, createTestEstablishment, getUserByEmail } = await import('../utils/auth.js');
const { oauthProviderResponses } = await import('../fixtures/users.js');

const DUMMY_TOKEN = 'oauth-token-1234567890';
const EMAIL = 'owner-of-address@example.com';
const OLD_PASSWORD = 'Registrant-Pass-123';
const TAKEOVER_REASON =
  'Учётная запись перешла к владельцу адреса e-mail после входа через Google или Яндекс. '
  + 'Карточка приостановлена до решения модератора: кому она принадлежит.';

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

// Провайдер подтверждает адрес EMAIL (Яндекс — всегда; Google — по email_verified).
const signInWith = (provider, { emailVerified = true } = {}) => {
  if (provider === 'yandex') {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...oauthProviderResponses.yandex, default_email: EMAIL }),
    });
  } else {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ ...oauthProviderResponses.google, email: EMAIL, email_verified: emailVerified }),
    });
  }
  return request(app).post('/api/v1/auth/oauth').send({ provider, token: DUMMY_TOKEN });
};

const passwordLogin = () => request(app)
  .post('/api/v1/auth/login')
  .send({ email: EMAIL, password: OLD_PASSWORD });

const refreshWith = (refreshToken) => request(app)
  .post('/api/v1/auth/refresh')
  .send({ refreshToken });

/** Запрос с access-токеном, доступный любой роли. */
const touch = (accessToken) => request(app)
  .get('/api/v1/notifications/unread-count')
  .set('Authorization', `Bearer ${accessToken}`);

/**
 * Запись, заведённая по e-mail без подтверждения (createTestUser пишет
 * email_verified = false), с паролем, телефоном и выданной сессией; партнёр —
 * с активной и с ожидающей карточками.
 */
const registeredWithoutProof = async ({ partner = false, emailVerified = false } = {}) => {
  const { user, accessToken, refreshToken } = await createUserAndGetTokens({
    email: EMAIL,
    phone: '+375291234567',
    password: OLD_PASSWORD,
    name: 'Имя Регистранта',
    role: partner ? 'partner' : 'user',
  });
  if (emailVerified) {
    await query('UPDATE users SET email_verified = true WHERE id = $1', [user.id]);
  }
  let activeCard = null;
  let pendingCard = null;
  if (partner) {
    activeCard = await createTestEstablishment(user.id);
    pendingCard = await createTestEstablishment(user.id);
    await query("UPDATE establishments SET status = 'pending' WHERE id = $1", [pendingCard.id]);
  }
  return { user, accessToken, refreshToken, activeCard, pendingCard };
};

const cardState = async (cardId) => {
  const { rows: [row] } = await query(
    'SELECT status, moderation_notes FROM establishments WHERE id = $1',
    [cardId],
  );
  return { status: row.status, notes: row.moderation_notes ? JSON.parse(row.moderation_notes) : null };
};

// ============================================================================
// (а) Запись с неподтверждённым e-mail переходит к вошедшему
// ============================================================================

describe('запись с неподтверждённым e-mail переходит к вошедшему через провайдера', () => {
  test.each([['yandex'], ['google']])('%s: старый пароль больше не действует, запись — провайдера', async (provider) => {
    const { user } = await registeredWithoutProof();

    const res = await signInWith(provider).expect(200);

    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.user.authMethod).toBe(provider);

    const login = await passwordLogin();
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');

    const inDb = await getUserByEmail(EMAIL);
    expect(inDb.password_hash).toBeNull();
    expect(inDb.email_verified).toBe(true);
    expect(inDb.auth_method).toBe(provider);
    expect(inDb.oauth_provider_id).toBe(provider === 'yandex' ? '90210' : 'google-sub-42');
  });

  test('старые сессии не действуют: прежний refresh-токен неизвестен серверу, новый — работает', async () => {
    const { refreshToken: oldRefreshToken } = await registeredWithoutProof();

    const res = await signInWith('yandex').expect(200);

    // Прежний токен удалён, а не «сожжён»: сожжённый читался бы как повторное
    // использование и гасил бы все сессии записи — в том числе новую
    // (ревью 08.10.2026). Поэтому сначала предъявляется он — и ничего не гасит.
    const replayOld = await refreshWith(oldRefreshToken);
    expect(replayOld.status).toBe(401);
    expect(replayOld.body.error.code).toBe('INVALID_TOKEN');

    const useNew = await refreshWith(res.body.data.refreshToken);
    expect(useNew.status).toBe(200);
  });

  test('access-токен регистранта отвергается со следующего запроса, токен нового держателя работает', async () => {
    const { accessToken: registrantToken } = await registeredWithoutProof();
    // Тот же процесс, тёплый кэш статуса: до перехода токен проходит.
    await touch(registrantToken).expect(200);

    const res = await signInWith('google').expect(200);

    // До миграции 035 этот токен работал до своего срока — до 4 ч в чужой
    // теперь учётной записи.
    const replayOld = await touch(registrantToken);
    expect(replayOld.status).toBe(401);
    expect(replayOld.body.error.code).toBe('TOKEN_REVOKED');

    await touch(res.body.data.accessToken).expect(200);
  });

  test('телефон регистранта больше не получает уведомления записи', async () => {
    const { user } = await registeredWithoutProof();
    await query(
      `INSERT INTO device_tokens (user_id, fcm_token, platform, device_name)
       VALUES ($1, 'registrant-device-token-0001', 'android', 'Телефон регистранта')`,
      [user.id],
    );

    await signInWith('yandex').expect(200);

    const { rows } = await query(
      'SELECT is_active FROM device_tokens WHERE user_id = $1',
      [user.id],
    );
    expect(rows).toEqual([{ is_active: false }]);
  });

  test('имя, аватар и телефон регистранта уступают данным провайдера', async () => {
    await registeredWithoutProof();

    await signInWith('google').expect(200);

    const inDb = await getUserByEmail(EMAIL);
    expect(inDb.name).toBe('Google Пользователь');
    expect(inDb.avatar_url).toBe('https://lh3.googleusercontent.com/a/pic');
    expect(inDb.phone).toBeNull();
    expect(inDb.phone_verified).toBe(false);
  });

  test('партнёрские карточки не наследуются молча: каждая активная приостановлена с причиной, ожидающая — как была', async () => {
    const { user, activeCard, pendingCard } = await registeredWithoutProof({ partner: true });
    // Вторая активная: приостанавливаются все активные карточки записи, а не
    // первая найденная — с одной карточкой этого не различить.
    const secondActive = await createTestEstablishment(user.id);

    await signInWith('yandex').expect(200);

    for (const card of [activeCard, secondActive]) {
      const active = await cardState(card.id);
      expect(active.status).toBe('suspended');
      expect(active.notes.suspend_reason).toBe(TAKEOVER_REASON);
      expect(active.notes.suspended_from).toBe('active');
      expect(typeof active.notes.suspended_at).toBe('string');
    }

    expect(await cardState(pendingCard.id)).toEqual({ status: 'pending', notes: null });

    // Роль остаётся за записью: карточки видны новому держателю как приостановленные.
    const inDb = await getUserByEmail(EMAIL);
    expect(inDb.role).toBe('partner');
    expect(inDb.id).toBe(user.id);

    // Журнал: приостановка каждой записана как действие без модератора, с причиной.
    for (const card of [activeCard, secondActive]) {
      const { rows: audit } = await query(
        "SELECT user_id, new_data FROM audit_log WHERE entity_id = $1 AND action = 'suspend'",
        [card.id],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].user_id).toBeNull();
      expect(audit[0].new_data.reason).toBe(TAKEOVER_REASON);
      expect(audit[0].new_data.account_takeover).toBe('yandex');
    }

    // Новый держатель записи узнаёт о приостановке каждой — и только о них.
    const { rows: notices } = await query(
      "SELECT establishment_id FROM notifications WHERE user_id = $1 AND type = 'establishment_suspended'",
      [user.id],
    );
    expect(notices.map((row) => row.establishment_id).sort())
      .toEqual([activeCard.id, secondActive.id].sort());
  });

  test('повторный вход после перехода — обычный вход в ту же запись', async () => {
    const { user } = await registeredWithoutProof();
    await signInWith('yandex').expect(200);

    const again = await signInWith('yandex').expect(200);

    expect(again.body.data.user.id).toBe(user.id);
    const { rows } = await query('SELECT count(*)::int AS n FROM users WHERE email = $1', [EMAIL]);
    expect(rows[0].n).toBe(1);
  });
});

// ============================================================================
// (б) Запись с подтверждённым e-mail — привязка как прежде
// ============================================================================

describe('запись с подтверждённым e-mail: привязка как прежде, ничего не гаснет', () => {
  test('пароль, сессия, имя и карточки остаются', async () => {
    const { user, refreshToken, activeCard } = await registeredWithoutProof({ partner: true, emailVerified: true });

    const res = await signInWith('yandex').expect(200);
    expect(res.body.data.user.id).toBe(user.id);

    expect((await passwordLogin()).status).toBe(200);
    expect((await refreshWith(refreshToken)).status).toBe(200);

    const inDb = await getUserByEmail(EMAIL);
    expect(inDb.auth_method).toBe('yandex');
    expect(inDb.password_hash).not.toBeNull();
    expect(inDb.name).toBe('Имя Регистранта');
    expect(inDb.phone).toBe('+375291234567');

    expect(await cardState(activeCard.id)).toEqual({ status: 'active', notes: null });
  });

  test('устройство владельца подтверждённой записи остаётся подписанным', async () => {
    const { user } = await registeredWithoutProof({ emailVerified: true });
    await query(
      `INSERT INTO device_tokens (user_id, fcm_token, platform)
       VALUES ($1, 'owner-device-token-0001', 'ios')`,
      [user.id],
    );

    await signInWith('yandex').expect(200);

    const { rows } = await query('SELECT is_active FROM device_tokens WHERE user_id = $1', [user.id]);
    expect(rows).toEqual([{ is_active: true }]);
  });
});

// ============================================================================
// Учётные записи панели не переходят
// ============================================================================

describe('учётная запись панели с неподтверждённым e-mail не переходит', () => {
  test.each([['admin'], ['viewer']])('%s: отказ 403, пароль и способ входа прежние', async (role) => {
    const { user } = await createUserAndGetTokens({
      email: EMAIL,
      password: OLD_PASSWORD,
      name: 'Сотрудник Панели',
      role,
    });

    const res = await signInWith('yandex').expect(403);
    expect(res.body.error.code).toBe('OAUTH_EMAIL_NOT_VERIFIED');

    const inDb = await getUserByEmail(EMAIL);
    expect(inDb.id).toBe(user.id);
    expect(inDb.password_hash).not.toBeNull();
    expect(inDb.auth_method).toBe('email');
    expect(inDb.email_verified).toBe(false);
  });
});

// ============================================================================
// Провайдер не подтвердил адрес — доказательства нет ни у кого
// ============================================================================

describe('провайдер не подтвердил e-mail: отказ, запись не тронута', () => {
  test('Google без email_verified → 403, пароль и сессия регистранта живы', async () => {
    const { refreshToken } = await registeredWithoutProof();

    const res = await signInWith('google', { emailVerified: false }).expect(403);
    expect(res.body.error.code).toBe('OAUTH_EMAIL_NOT_VERIFIED');

    expect((await passwordLogin()).status).toBe(200);
    expect((await refreshWith(refreshToken)).status).toBe(200);
    const inDb = await getUserByEmail(EMAIL);
    expect(inDb.email_verified).toBe(false);
    expect(inDb.auth_method).toBe('email');
  });
});
