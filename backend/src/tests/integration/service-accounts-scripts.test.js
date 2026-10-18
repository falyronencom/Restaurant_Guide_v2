/* eslint-env jest */
/**
 * Скрипты оператора над служебными учётками (директива service_accounts
 * 15.10.2026, Б3, Б4, Б5). Скрипты запускаются как есть, на базе теста
 * (процесс наследует DB_*). Ожидания — литералы директивы:
 *
 *   Б3. Дом сида узнаётся по признаку (миграция 037), не по адресу: ровно
 *       одна активная служебная учётка партнёра; без неё скрипт сида
 *       останавливается с ошибкой и новую учётку не заводит.
 *       mark-service-account.js ставит признак только партнёру на нашем ящике,
 *       без привязки провайдера и только одному.
 *   Б4. set-user-active.js: выключение гасит сеансы, push и ссылки сброса;
 *       включение прежних сеансов не возвращает — и для учётки, выключенной
 *       раньше без отзыва.
 *   Б5. create-admin.js без адреса не запускается, чужую роль без --promote не
 *       трогает, повышение гасит сеанс другой двери (обновление не делает его
 *       сеансом панели), пишет журнал, пароль не печатает. create-review-user.js
 *       и create-test-partner.js без адреса не запускаются, учётку не удаляют —
 *       правят на месте или отказывают; пароль не печатают. clear-reviews.js
 *       не удаляет учётку с карточкой.
 */
import request from 'supertest';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import app from '../../server.js';
import { getClient } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestUser } from '../utils/auth.js';
import { invalidateAccountStatus } from '../../services/accountStatus.js';
import { blockUser, unblockUser } from '../../services/adminUserService.js';
import { findSeedHouse } from '../../../scripts/lib/seedHouse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '../../../scripts');
const MAILBOX = 'owner.box@gmail.com';
const PASSWORD = 'Script-Pass-123';
const NEW_PASSWORD = 'Script-New-456';

const run = (script, args = [], env = {}) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
  env: { ...process.env, SERVICE_ACCOUNT_MAILBOXES: MAILBOX, ...env },
  encoding: 'utf8',
});

const user = async ({ email, role = 'user', service = false, active = true, provider = null }) => {
  const created = await createTestUser({ email, password: PASSWORD, name: 'Учётка', role });
  await query(
    'UPDATE users SET email_verified = true, is_service_account = $2, is_active = $3, oauth_provider_id = $4 WHERE id = $1',
    [created.id, service, active, provider],
  );
  return created.id;
};

const card = (partnerId) => query(
  `INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude,
                               categories, cuisines, working_hours, status, created_at, updated_at)
   VALUES (gen_random_uuid(), $1, 'Карточка', gen_random_uuid()::text, 'Проверка', 'Минск', 'ул. 1',
           53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '{}'::jsonb, 'active', NOW(), NOW())`,
  [partnerId],
);

const sharedLogin = (email, password = PASSWORD) => request(app).post('/api/v1/auth/login').send({ email, password });
const panelLogin = (email, password) => request(app).post('/api/v1/admin/auth/login').send({ email, password });
const refresh = (refreshToken) => request(app).post('/api/v1/auth/refresh').send({ refreshToken });
const one = async (sql, params) => (await query(sql, params)).rows[0];

beforeEach(async () => {
  await clearAllData();
});

afterAll(async () => {
  await clearAllData();
});

describe('Б3: the seed house is found by its flag', () => {
  const find = async () => {
    const client = await getClient();
    try {
      return await findSeedHouse(client);
    } finally {
      client.release();
    }
  };

  test('exactly one active flagged partner is the house; none, two or a switched-off one stop the script', async () => {
    await user({ email: 'partner@example.com', role: 'partner' });
    await expect(find()).rejects.toMatchObject({ code: 'SEED_HOUSE_NOT_FOUND' });

    const off = await user({ email: 'off@example.com', role: 'partner', service: true, active: false });
    await expect(find()).rejects.toMatchObject({ code: 'SEED_HOUSE_NOT_FOUND' });
    await query('UPDATE users SET is_active = true WHERE id = $1', [off]);
    expect((await find()).id).toBe(off);

    await user({ email: 'second@example.com', role: 'partner', service: true });
    await expect(find()).rejects.toMatchObject({ code: 'SEED_HOUSE_AMBIGUOUS' });
  });

  test('the import refuses --house-email instead of ignoring it', () => {
    const result = run('seed-import/index.js', ['--house-email=someone@example.com', '--target=dryrun']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--house-email больше не поддерживается');
  });

  test('a seed script without the house stops and creates no account', async () => {
    const result = run('seed-establishments-placeholder.js');
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Дом сида не найден');
    expect((await one('SELECT COUNT(*)::int AS n FROM users')).n).toBe(0);
    expect((await one('SELECT COUNT(*)::int AS n FROM establishments')).n).toBe(0);
  });
});

describe('Б3: mark-service-account.js', () => {
  const mark = (email, extra = []) => run('mark-service-account.js', [`--email=${email}`, `--confirm-old=${email}`, '--yes', ...extra]);
  const flag = async (id) => (await one('SELECT is_service_account FROM users WHERE id = $1', [id])).is_service_account;

  test('dry run writes nothing; the write sets the flag and journals it', async () => {
    const id = await user({ email: 'owner.box+seed@gmail.com', role: 'partner' });
    const dry = run('mark-service-account.js', ['--email=owner.box+seed@gmail.com']);
    expect(dry.status).toBe(0);
    expect(await flag(id)).toBe(false);
    expect(dry.stdout).not.toContain('owner.box');

    const result = mark('owner.box+seed@gmail.com');
    expect(result.status).toBe(0);
    expect(await flag(id)).toBe(true);
    expect((await one("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'mark_service_account' AND entity_id = $1", [id])).n).toBe(1);
  });

  test.each([
    ['not a partner', { email: 'owner.box+admin@gmail.com', role: 'admin' }, 'the flag is for the seed house'],
    ['not on our mailbox', { email: 'seed.data.generator@restaurantguide.by', role: 'partner' }, 'not on an address of ours'],
    ['a provider link', { email: 'owner.box+seed@gmail.com', role: 'partner', provider: 'g-1' }, 'Google/Yandex link'],
  ])('refuses %s', async (_, account, message) => {
    const id = await user(account);
    const result = mark(account.email);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(await flag(id)).toBe(false);
  });

  test('refuses a second service partner', async () => {
    await user({ email: 'owner.box+seed@gmail.com', role: 'partner', service: true });
    const id = await user({ email: 'owner.box+seed2@gmail.com', role: 'partner' });
    const result = mark('owner.box+seed2@gmail.com');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already a service partner');
    expect(await flag(id)).toBe(false);
  });
});

describe('Б4: set-user-active.js ends everything, and switching on revives nothing', () => {
  const extras = async (id) => {
    await query("INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, $2, 'android')", [id, `fcm-${randomUUID()}`]);
    await query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')",
      [id, randomUUID().replace(/-/g, '').padEnd(64, '0')],
    );
  };
  const left = (id) => one(
    `SELECT (SELECT COUNT(*)::int FROM refresh_tokens WHERE user_id = $1 AND used_at IS NULL) AS refresh,
            (SELECT COUNT(*)::int FROM device_tokens WHERE user_id = $1 AND is_active = TRUE) AS devices,
            (SELECT COUNT(*)::int FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL) AS reset_links`,
    [id],
  );

  test('switched off: sessions, push and reset links end; switched on: the old session stays dead', async () => {
    const id = await user({ email: 'guest@example.com' });
    const login = await sharedLogin('guest@example.com').expect(200);
    await extras(id);

    expect(run('set-user-active.js', ['--email=guest@example.com', '--active=false', '--yes']).status).toBe(0);
    expect(await left(id)).toEqual({ refresh: 0, devices: 0, reset_links: 0 });

    expect(run('set-user-active.js', ['--email=guest@example.com', '--active=true', '--yes']).status).toBe(0);
    invalidateAccountStatus(id);
    expect((await refresh(login.body.data.refreshToken)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.data.accessToken}`)).status).toBe(401);
    await sharedLogin('guest@example.com').expect(200);
  });

  test('an account switched off earlier without revocation: switching it on does not revive its session', async () => {
    const id = await user({ email: 'guest@example.com' });
    const login = await sharedLogin('guest@example.com').expect(200);
    await query('UPDATE users SET is_active = false WHERE id = $1', [id]);

    expect(run('set-user-active.js', ['--email=guest@example.com', '--active=true', '--yes']).status).toBe(0);
    invalidateAccountStatus(id);
    expect((await refresh(login.body.data.refreshToken)).status).toBe(401);
  });
});

describe('set-user-active.js writes the journal as the panel does (проход тестировщика 17.10, П8, находка 3)', () => {
  const entries = (id) => query(
    `SELECT action, user_id, old_data, new_data, user_agent FROM audit_log
     WHERE entity_type = 'user' AND entity_id = $1 ORDER BY created_at, id`,
    [id],
  ).then((result) => result.rows);
  const reviewOf = async (authorId) => {
    const partnerId = await user({ email: 'partner@example.com', role: 'partner' });
    await card(partnerId);
    const place = await one('SELECT id FROM establishments WHERE partner_id = $1', [partnerId]);
    return (await one(
      `INSERT INTO reviews (id, user_id, establishment_id, rating, content, text, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 2, 'Отзыв, который скроет блокировка.', 'Отзыв, который скроет блокировка.', NOW(), NOW())
       RETURNING id`,
      [authorId, place.id],
    )).id;
  };
  const visible = async (reviewId) => (await one('SELECT is_visible FROM reviews WHERE id = $1', [reviewId])).is_visible;
  const active = async (id) => (await one('SELECT is_active FROM users WHERE id = $1', [id])).is_active;

  test('off, then on: user_block, then user_unblock — the operator script as the actor, empty review lists', async () => {
    const id = await user({ email: 'guest@example.com' });
    expect(run('set-user-active.js', ['--email=guest@example.com', '--active=false', '--yes']).status).toBe(0);
    expect(run('set-user-active.js', ['--email=guest@example.com', '--active=true', '--yes']).status).toBe(0);

    const actor = 'operator_script:set-user-active';
    expect(await entries(id)).toEqual([
      {
        action: 'user_block',
        user_id: null,
        old_data: { is_active: true },
        new_data: { is_active: false, reason: 'Учётку выключил оператор скриптом', hidden_review_ids: [], actor },
        user_agent: actor,
      },
      {
        action: 'user_unblock',
        user_id: null,
        old_data: { is_active: false },
        new_data: {
          is_active: true,
          reason: 'Учётку включил оператор скриптом',
          restore_reviews: false,
          restored_review_ids: [],
          actor,
        },
        user_agent: actor,
      },
    ]);
  });

  test('nothing to do writes nothing', async () => {
    const id = await user({ email: 'guest@example.com' });
    expect(run('set-user-active.js', ['--email=guest@example.com', '--active=true', '--yes']).status).toBe(0);
    expect(await entries(id)).toEqual([]);
  });

  test('blocked from the panel, reviews still hidden: the script refuses; --keep-reviews-hidden switches on and leaves them hidden', async () => {
    const admin = await user({ email: 'admin@example.com', role: 'admin' });
    const id = await user({ email: 'guest@example.com' });
    const reviewId = await reviewOf(id);
    await blockUser(id, 'Оскорбления в отзыве', admin);
    expect(await visible(reviewId)).toBe(false);

    const refused = run('set-user-active.js', ['--email=guest@example.com', '--active=true', '--yes']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('blocked from the panel');
    expect(await active(id)).toBe(false);
    expect((await entries(id)).map((entry) => entry.action)).toEqual(['user_block']);

    const kept = run('set-user-active.js', ['--email=guest@example.com', '--active=true', '--keep-reviews-hidden', '--yes']);
    expect(kept.status).toBe(0);
    expect(await active(id)).toBe(true);
    expect(await visible(reviewId)).toBe(false);
    expect((await entries(id)).map((entry) => entry.action)).toEqual(['user_block', 'user_unblock']);
  });

  test('switched off by the script, unblocked from the panel: the unblock reads the script entry and shows no review it did not hide', async () => {
    const admin = await user({ email: 'admin@example.com', role: 'admin' });
    const id = await user({ email: 'guest@example.com' });
    const reviewId = await reviewOf(id);
    await blockUser(id, 'Оскорбления в отзыве', admin);
    await query('UPDATE users SET is_active = TRUE WHERE id = $1', [id]); // switched on some other way, before this rule
    expect(run('set-user-active.js', ['--email=guest@example.com', '--active=false', '--yes']).status).toBe(0);

    const result = await unblockUser(id, 'Ошибка', admin);
    expect(result).toMatchObject({ changed: true, restored_reviews: 0 });
    expect(await visible(reviewId)).toBe(false);
  });
});

describe('Б5: create-admin.js', () => {
  test('without --email it does not run and creates nothing', async () => {
    const result = run('create-admin.js', ['--yes'], { ADMIN_PASSWORD: NEW_PASSWORD });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--email');
    expect((await one('SELECT COUNT(*)::int AS n FROM users')).n).toBe(0);
  });

  test('creates the admin on the given address, journals it, never prints the password', async () => {
    const result = run('create-admin.js', ['--email=Owner.Box+Admin@Gmail.com', '--yes'], { ADMIN_PASSWORD: NEW_PASSWORD });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(NEW_PASSWORD);
    expect(result.stdout).not.toContain('owner.box');
    const admin = await one("SELECT id, role FROM users WHERE email = 'owner.box+admin@gmail.com'");
    expect(admin.role).toBe('admin');
    expect((await one("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'operator_create_admin' AND entity_id = $1", [admin.id])).n).toBe(1);
    await panelLogin('owner.box+admin@gmail.com', NEW_PASSWORD).expect(200);
  });

  test('an account of another role is not touched without --promote', async () => {
    const id = await user({ email: 'guest@example.com' });
    const result = run('create-admin.js', ['--email=guest@example.com', '--yes'], { ADMIN_PASSWORD: NEW_PASSWORD });
    expect(result.status).toBe(1);
    expect((await one('SELECT role FROM users WHERE id = $1', [id])).role).toBe('user');
  });

  test('--promote: the session opened through the shared door does not become a panel session; the provider link goes', async () => {
    const id = await user({ email: 'guest@example.com', provider: 'g-guest' });
    const login = await sharedLogin('guest@example.com').expect(200);
    const result = run('create-admin.js', ['--email=guest@example.com', '--promote', '--yes'], { ADMIN_PASSWORD: NEW_PASSWORD });
    expect(result.status).toBe(0);
    expect(await one('SELECT role, oauth_provider_id FROM users WHERE id = $1', [id]))
      .toEqual({ role: 'admin', oauth_provider_id: null });
    invalidateAccountStatus(id);
    expect((await refresh(login.body.data.refreshToken)).status).toBe(401);
    expect((await one("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'operator_promote_admin' AND entity_id = $1", [id])).n).toBe(1);
  });
});

describe('Б5: create-review-user.js and create-test-partner.js do not delete', () => {
  test('without an address neither runs', async () => {
    expect(run('create-review-user.js', [], { REVIEW_PASSWORD: NEW_PASSWORD }).status).toBe(1);
    expect(run('create-test-partner.js', [], { PARTNER_PASSWORD: NEW_PASSWORD }).status).toBe(1);
    expect((await one('SELECT COUNT(*)::int AS n FROM users')).n).toBe(0);
  });

  test('create-review-user.js refuses an account with cards and leaves it and its cards in place', async () => {
    const id = await user({ email: 'review@example.com', role: 'partner' });
    await card(id);
    const result = run('create-review-user.js', [], { REVIEW_EMAIL: 'review@example.com', REVIEW_PASSWORD: NEW_PASSWORD });
    expect(result.status).toBe(1);
    expect(await one('SELECT id, role FROM users WHERE id = $1', [id])).toEqual({ id, role: 'partner' });
    expect((await one('SELECT COUNT(*)::int AS n FROM establishments WHERE partner_id = $1', [id])).n).toBe(1);
  });

  test('create-review-user.js updates an ordinary user in place — same id — and does not print the password', async () => {
    const id = await user({ email: 'review@example.com' });
    const result = run('create-review-user.js', [], { REVIEW_EMAIL: 'review@example.com', REVIEW_PASSWORD: NEW_PASSWORD });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(NEW_PASSWORD);
    expect((await one("SELECT id FROM users WHERE email = 'review@example.com'")).id).toBe(id);
    await sharedLogin('review@example.com', NEW_PASSWORD).expect(200);
  });

  test('create-test-partner.js updates a partner in place and refuses the seed house', async () => {
    const id = await user({ email: 'partner@example.com', role: 'partner' });
    const result = run('create-test-partner.js', [], { PARTNER_EMAIL: 'partner@example.com', PARTNER_PASSWORD: NEW_PASSWORD });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(NEW_PASSWORD);
    expect((await one("SELECT id FROM users WHERE email = 'partner@example.com'")).id).toBe(id);

    const house = await user({ email: 'house@example.com', role: 'partner', service: true });
    const refused = run('create-test-partner.js', [], { PARTNER_EMAIL: 'house@example.com', PARTNER_PASSWORD: NEW_PASSWORD });
    expect(refused.status).toBe(1);
    expect((await one('SELECT id FROM users WHERE id = $1', [house])).id).toBe(house);
  });
});

describe('Б5: clear-reviews.js never deletes an account that owns a card', () => {
  test('a seed-pattern account with a card stays; one without is deleted', async () => {
    const owner = await user({ email: 'seed.user.1@seed-reviews.invalid' });
    await card(owner);
    const plain = await user({ email: 'seed.user.2@seed-reviews.invalid' });
    const result = run('clear-reviews.js', ['--force']);
    expect(result.status).toBe(0);
    expect((await one('SELECT COUNT(*)::int AS n FROM users WHERE id = $1', [owner])).n).toBe(1);
    expect((await one('SELECT COUNT(*)::int AS n FROM users WHERE id = $1', [plain])).n).toBe(0);
  });
});
