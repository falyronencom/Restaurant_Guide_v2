/* eslint-env jest */
/**
 * Проверка служебных учёток (scripts/service-accounts-audit.js) — сплошной
 * обход, а не список (директива 15.10.2026, А1; критик полноты п. 16, 18).
 *
 * Что проверяется на базе теста, скриптом как есть (процесс наследует DB_*):
 *   - в перечень попадает КАЖДАЯ учётка с ролью панели или партнёра, каждая
 *     владелица карточки (какой бы ни была её роль) и каждая на домене из
 *     литералов скриптов — и только они; обычные учётки на прочих доменах
 *     только считаются по доменам;
 *   - вердикт «наш / не наш»: наши домены, ящик Координатора и его форма с
 *     меткой (Gmail) — наши; точка в имени ящика — не наш адрес;
 *   - счёт итога: активные не на наших ящиках; выключенные — отдельно;
 *   - непогашенные сеансы, ссылки сброса, коды, push, привязка провайдера —
 *     числами, у каждой учётки;
 *   - ящик Координатора в выводе — меткой, значение не печатается; адрес
 *     партнёра-человека — без имени до «@»;
 *   - первый прогон «красный»: учётки на чужих доменах видны как «не наши».
 *
 * Ожидаемые значения — литералы этого файла, не вывод кода.
 */

import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { clearAllData, query } from '../utils/database.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(resolve(HERE, '../../../scripts'), 'service-accounts-audit.js');

/** Ящик Координатора в тесте — тот же провайдер, что у настоящего (Gmail). */
const MAILBOX = 'owner.box@gmail.com';

const run = (args = ['--json'], env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  env: { ...process.env, SERVICE_ACCOUNT_MAILBOXES: MAILBOX, ...env },
  encoding: 'utf8',
});

const addUser = async ({ email, role = 'user', active = true, password = true, provider = null }) => {
  const id = randomUUID();
  await query(
    `INSERT INTO users (id, email, password_hash, name, role, auth_method, oauth_provider_id,
                        email_verified, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'Проверка', $4, $5, $6, true, $7, NOW(), NOW())`,
    [id, email, password ? '$argon2id$v=19$m=16384,t=3,p=1$c2FsdHNhbHQ$aGFzaGhhc2g' : null,
      role, provider ? 'google' : 'email', provider, active],
  );
  return id;
};

const addCard = (partnerId, status = 'active') => query(
  `INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude,
                               categories, cuisines, working_hours, status, created_at, updated_at)
   VALUES (gen_random_uuid(), $1, 'Карточка', gen_random_uuid()::text, 'Проверка', 'Минск', 'ул. Проверки 1',
           53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '{}'::jsonb, $2, NOW(), NOW())`,
  [partnerId, status],
);

const addRefreshToken = (userId, { used = false } = {}) => query(
  `INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at, used_at)
   VALUES (gen_random_uuid(), $1, $2, NOW() + INTERVAL '30 days', NOW(), ${used ? 'NOW()' : 'NULL'})`,
  [userId, `audit-${randomUUID()}`],
);

const addResetLink = (userId) => query(
  `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
   VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
  [userId, randomUUID().replace(/-/g, '')],
);

const addEmailCode = (userId) => query(
  `INSERT INTO email_verification_codes (user_id, code, expires_at)
   VALUES ($1, '123456', NOW() + INTERVAL '15 minutes')`,
  [userId],
);

const addDevice = (userId) => query(
  `INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, $2, 'android')`,
  [userId, `fcm-${randomUUID()}`],
);

describe('scripts/service-accounts-audit.js', () => {
  let ids;

  beforeAll(async () => {
    await clearAllData();
    ids = {
      // Панель на чужом домене, с живым сеансом, ссылкой сброса и push
      adminForeign: await addUser({ email: 'admin@test.com', role: 'admin' }),
      // Панель на ящике Координатора с меткой — наш адрес
      adminOurs: await addUser({ email: 'owner.box+admin@gmail.com', role: 'admin' }),
      // Выключенный просмотрщик на чужом домене — в счёт не входит
      viewerOff: await addUser({ email: 'viewer@restaurantguide.by', role: 'viewer', active: false }),
      // Дом сида: партнёр на чужом домене, без пароля, с привязкой провайдера, с карточками
      seedHouse: await addUser({ email: 'seed.data.generator@restaurantguide.by', role: 'partner', password: false, provider: 'g-123' }),
      // Партнёр-человек на почтовом сервисе — в перечне, имя замаскировано
      partnerPerson: await addUser({ email: 'ivan.petrov@mail.ru', role: 'partner' }),
      // Владелица карточки с ролью user (передача карточки не повышает всех) — в перечне
      cardOwnerUser: await addUser({ email: 'owner-user@tut.by' }),
      // Посевной автор отзывов: user на домене из литералов скриптов — в перечне
      seedReviewer: await addUser({ email: 'seed.user.1@restaurantguide.by' }),
      // Наш домен проекта — наш
      viewerOurDomain: await addUser({ email: 'viewer@nirivio.by', role: 'viewer' }),
      // Ящик Координатора с точкой в имени — Gmail доставит, но это не та форма: не наш
      adminDotted: await addUser({ email: 'owner.b.ox+x@gmail.com', role: 'admin' }),
      // Обычные люди — только счёт
      person1: await addUser({ email: 'person1@gmail.com' }),
      person2: await addUser({ email: 'person2@gmail.com' }),
      person3: await addUser({ email: 'person3@yandex.ru' }),
    };
    await addRefreshToken(ids.adminForeign);
    await addRefreshToken(ids.adminForeign);
    await addRefreshToken(ids.adminForeign, { used: true });
    await addResetLink(ids.adminForeign);
    await addDevice(ids.adminForeign);
    await addEmailCode(ids.seedReviewer);
    await addCard(ids.seedHouse);
    await addCard(ids.seedHouse);
    await addCard(ids.seedHouse, 'draft');
    await addCard(ids.cardOwnerUser);
    await addCard(ids.partnerPerson, 'pending');
    await addRefreshToken(ids.adminOurs);
  });

  afterAll(async () => {
    await clearAllData();
  });

  const report = () => {
    const result = run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return { parsed: JSON.parse(result.stdout), stdout: result.stdout };
  };

  const byId = (parsed) => Object.fromEntries(parsed.accounts.map((a) => [a.id, a]));

  test('lists panel, partner, card-owner and script-domain accounts — and only them', () => {
    const { parsed } = report();
    const listed = parsed.accounts.map((a) => a.id).sort();
    const expected = [
      ids.adminForeign, ids.adminOurs, ids.viewerOff, ids.seedHouse, ids.partnerPerson,
      ids.cardOwnerUser, ids.seedReviewer, ids.viewerOurDomain, ids.adminDotted,
    ].sort();
    expect(listed).toEqual(expected);
    expect(parsed.otherUsersByDomain).toEqual([
      { domain: 'gmail.com', accounts: 2 },
      { domain: 'yandex.ru', accounts: 1 },
    ]);
  });

  test('says which addresses are ours: our domains and the mailbox with a tag; a dotted variant is not', () => {
    const accounts = byId(report().parsed);
    expect(accounts[ids.adminOurs].ours).toBe(true);
    expect(accounts[ids.viewerOurDomain].ours).toBe(true);
    expect(accounts[ids.adminForeign].ours).toBe(false);
    expect(accounts[ids.seedHouse].ours).toBe(false);
    expect(accounts[ids.adminDotted].ours).toBe(false);
  });

  test('counts active accounts not on our mailboxes; switched-off ones apart', () => {
    const { summary } = report().parsed;
    // adminForeign, seedHouse, partnerPerson, cardOwnerUser, seedReviewer, adminDotted
    expect(summary.activeNotOurs).toBe(6);
    // viewerOff
    expect(summary.inactiveNotOurs).toBe(1);
    expect(summary.listed).toBe(9);
  });

  test('reports sessions, reset links, codes, push, provider links and cards per account', () => {
    const { parsed } = report();
    const accounts = byId(parsed);
    expect(accounts[ids.adminForeign]).toMatchObject({
      unspentRefreshTokens: 2, liveRefreshTokens: 2, unspentResetLinks: 1, activeDevices: 1, hasPassword: true,
    });
    expect(accounts[ids.seedHouse]).toMatchObject({
      cards: 3, activeCards: 2, hasPassword: false, providerLinked: true, authMethod: 'google',
    });
    expect(accounts[ids.seedReviewer].unspentEmailCodes).toBe(1);
    expect(parsed.summary.oursUnspentRefreshTokens).toBe(1);
    expect(parsed.migration035).toBe(true);
  });

  test('never prints the mailbox itself; masks a person-partner; shows foreign service addresses as they are', () => {
    const { parsed, stdout } = report();
    const text = run([]).stdout + stdout;
    expect(text).not.toContain('owner.box@');
    expect(text).not.toContain('owner.box+');
    const accounts = byId(parsed);
    expect(accounts[ids.adminOurs].address).toBe('[ящик Координатора]+admin');
    expect(accounts[ids.partnerPerson].address).toBe('i***@mail.ru');
    expect(accounts[ids.adminForeign].address).toBe('admin@test.com');
    expect(accounts[ids.seedHouse].address).toBe('seed.data.generator@restaurantguide.by');
  });

  test('the human-readable run names the foreign accounts «НЕ наш ящик» and the total', () => {
    const result = run([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('admin@test.com  — НЕ наш ящик');
    expect(result.stdout).toContain('Активных НЕ на наших ящиках: 6');
  });

  test('refuses a mailbox value the login would not accept', () => {
    const result = run(['--json'], { SERVICE_ACCOUNT_MAILBOXES: 'not-an-address' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SERVICE_ACCOUNT_MAILBOXES');
    expect(result.stdout).toBe('');
  });
});
