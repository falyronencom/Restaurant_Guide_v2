/* eslint-env jest */
/**
 * Смена адреса учётки скриптом оператора (scripts/change-account-email.js,
 * lib/accountEmail.js) — директива 15.10.2026, А2; критик полноты пп. 3–6, 13;
 * Phase 3.5 (оба ревьюера, 15.10).
 *
 * Скрипт запускается как есть, на базе теста (процесс наследует DB_*).
 * Ожидания — литералы директивы и ревью:
 *   - без --confirm-old — сухой прогон: в базе ничего не меняется (адрес,
 *     сеансы, push, ссылки, коды, привязка, отметка отзыва, журнал);
 *   - --confirm-old, не совпавший с текущим адресом, — отказ, ничего не записано;
 *   - перевод гасит всё, что давало доступ: ПАРОЛЬ и телефон, сеанс (refresh
 *     и access), push, живая ссылка сброса (её нельзя использовать), коды,
 *     привязка Google/Яндекса; прежний пароль с новым адресом не входит;
 *   - после нового пароля от оператора вход панели находит учётку по новому
 *     адресу — набранному и в другом регистре; по прежнему — нет;
 *   - «Забыли пароль» на прежний адрес ссылки не создаёт;
 *   - второй проход через несколько секунд гасит ссылку сброса, записанную
 *     сразу после перевода по прежнему адресу;
 *   - журнал: запись change_email; администратор видит адреса, просмотрщик — нет;
 *   - новый адрес — только наш (внесённый ящик и его Gmail-метка): чужой домен,
 *     метка на чужом ящике, точка в имени ящика, домен проекта без внесения,
 *     занятый адрес (уже в сухом прогоне), тот же адрес — отказ;
 *   - только служебные: учётку человека — лишь с --any-account;
 *   - дом сида переезжает на месте: id и карточки при нём;
 *   - исправление ошибки — повторный перевод на другой наш адрес;
 *   - значение ящика Координатора в выводе не печатается — ни с меткой, ни без.
 */

import request from 'supertest';
import argon2 from 'argon2';
import { spawn, spawnSync } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import app from '../../server.js';
import { getClient } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestUser } from '../utils/auth.js';
import { createViewerAndGetToken } from '../utils/adminTestHelpers.js';
import { invalidateAccountStatus } from '../../services/accountStatus.js';
import { setActiveAccountPassword } from '../../../scripts/lib/operator-password.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(resolve(HERE, '../../../scripts'), 'change-account-email.js');

const MAILBOX = 'owner.box@gmail.com';
const PASSWORD = 'Admin123!@#';
const NEW_PASSWORD = 'Operator9!New';

const scriptEnv = (env) => ({ ...process.env, SERVICE_ACCOUNT_MAILBOXES: MAILBOX, ...env });

const run = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  env: scriptEnv(env),
  encoding: 'utf8',
});

const move = (from, to, extra = []) => run([`--email=${from}`, `--new-email=${to}`, `--confirm-old=${from}`, '--yes', ...extra]);

const panelLogin = (email, password = PASSWORD) => request(app)
  .post('/api/v1/admin/auth/login')
  .send({ email, password });

/** The operator's new password after the move (set-partner-password.js's write). */
const operatorSetsPassword = async (email) => {
  const client = await getClient();
  try {
    return await setActiveAccountPassword(client, email, await argon2.hash(NEW_PASSWORD));
  } finally {
    client.release();
  }
};

/** Учётка панели с сеансом из входа панели, телефоном, push, живой ссылкой сброса, кодом и привязкой Google. */
const adminWithEverything = async (email) => {
  const user = await createTestUser({ email, password: PASSWORD, name: 'Администратор', role: 'admin' });
  await query(
    "UPDATE users SET email_verified = true, oauth_provider_id = 'google-sub-1', auth_method = 'google', phone = '+375291234567', phone_verified = true WHERE id = $1",
    [user.id],
  );
  const login = await panelLogin(email).expect(200);
  await query("INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, $2, 'android')", [user.id, `fcm-${randomUUID()}`]);
  const rawResetToken = randomBytes(32).toString('hex');
  await query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')",
    [user.id, createHash('sha256').update(rawResetToken).digest('hex')],
  );
  await query(
    "INSERT INTO email_verification_codes (user_id, code, expires_at) VALUES ($1, '654321', NOW() + INTERVAL '15 minutes')",
    [user.id],
  );
  return {
    id: user.id,
    accessToken: login.body.data.accessToken,
    refreshToken: login.body.data.refreshToken,
    rawResetToken,
  };
};

const row = async (id) => (await query(
  `SELECT email, auth_method, oauth_provider_id, email_verified, is_active,
          (password_hash IS NOT NULL) AS has_password, phone, phone_verified
   FROM users WHERE id = $1`, [id],
)).rows[0];

const counts = async (id) => (await query(
  `SELECT
     (SELECT COUNT(*)::int FROM refresh_tokens WHERE user_id = $1 AND used_at IS NULL) AS refresh,
     (SELECT COUNT(*)::int FROM device_tokens WHERE user_id = $1 AND is_active = TRUE) AS devices,
     (SELECT COUNT(*)::int FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL) AS reset_links,
     (SELECT COUNT(*)::int FROM email_verification_codes WHERE user_id = $1 AND used_at IS NULL) AS codes`,
  [id],
)).rows[0];

const journalEntries = async (id) => (await query(
  "SELECT COUNT(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'change_email'", [id],
)).rows[0].n;

describe('scripts/change-account-email.js', () => {
  afterAll(async () => {
    await clearAllData();
  });

  describe('a panel account moved to the operator\'s mailbox', () => {
    let admin;
    let viewerToken;
    let moveOutput;

    beforeAll(async () => {
      await clearAllData();
      admin = await adminWithEverything('admin@test.com');
      viewerToken = (await createViewerAndGetToken()).accessToken;
    });

    test('without --confirm-old it is a dry run: nothing changes', async () => {
      const stampBefore = (await query('SELECT sessions_revoked_at FROM users WHERE id = $1', [admin.id])).rows[0];
      const result = run(['--email=admin@test.com', '--new-email=owner.box+admin@gmail.com']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('dry run');
      expect(await row(admin.id)).toMatchObject({ email: 'admin@test.com', oauth_provider_id: 'google-sub-1', has_password: true });
      expect(await counts(admin.id)).toEqual({ refresh: 1, devices: 1, reset_links: 1, codes: 1 });
      expect(await journalEntries(admin.id)).toBe(0);
      expect((await query('SELECT sessions_revoked_at FROM users WHERE id = $1', [admin.id])).rows[0]).toEqual(stampBefore);
    });

    test('a --confirm-old that is not the current address is refused; nothing changes', async () => {
      const result = run(['--email=admin@test.com', '--new-email=owner.box+admin@gmail.com', '--confirm-old=admin@tset.com', '--yes']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('--confirm-old does not match');
      expect((await row(admin.id)).email).toBe('admin@test.com');
      expect(await counts(admin.id)).toEqual({ refresh: 1, devices: 1, reset_links: 1, codes: 1 });
    });

    test('the move writes the address in the login\'s form and ends everything that gave access — the password and phone too', async () => {
      const result = move('admin@test.com', 'Owner.Box+Admin@Gmail.com');
      moveOutput = result.stdout + result.stderr;
      expect(result.status).toBe(0);
      expect(await row(admin.id)).toEqual({
        email: 'owner.box+admin@gmail.com',
        auth_method: 'email',
        oauth_provider_id: null,
        email_verified: true,
        is_active: true,
        has_password: false,
        phone: null,
        phone_verified: false,
      });
      expect(await counts(admin.id)).toEqual({ refresh: 0, devices: 0, reset_links: 0, codes: 0 });
      expect(await journalEntries(admin.id)).toBe(1);
    });

    test('the old password does not open the account at its new address', async () => {
      const res = await panelLogin('owner.box+admin@gmail.com', PASSWORD);
      expect(res.status).toBe(401);
    });

    test('after the operator\'s new password the panel login finds the account by the new address, as typed and in another case; not by the old one', async () => {
      const { account } = await operatorSetsPassword('owner.box+admin@gmail.com');
      expect(account.id).toBe(admin.id);
      await panelLogin('owner.box+admin@gmail.com', NEW_PASSWORD).expect(200);
      await panelLogin('OWNER.BOX+ADMIN@GMAIL.COM', NEW_PASSWORD).expect(200);
      const old = await panelLogin('admin@test.com', NEW_PASSWORD);
      expect(old.status).toBe(401);
    });

    test('the session opened before the move is dead: refresh and access', async () => {
      // The script cannot clear the server's cached status (10 s); the test does.
      invalidateAccountStatus(admin.id);
      const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: admin.refreshToken });
      expect(refresh.status).toBe(401);
      const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${admin.accessToken}`);
      expect(me.status).toBe(401);
      expect(me.body.error.code).toBe('TOKEN_REVOKED');
    });

    test('the reset link mailed to the old address no longer sets a password', async () => {
      const reset = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: admin.rawResetToken, password: 'Brand9New!pass' });
      expect(reset.status).toBe(410);
      expect(reset.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
      await panelLogin('owner.box+admin@gmail.com', NEW_PASSWORD).expect(200);
    });

    test('«forgot password» on the old address issues nothing', async () => {
      await request(app).post('/api/v1/auth/forgot-password').send({ email: 'admin@test.com' }).expect(200);
      expect((await counts(admin.id)).reset_links).toBe(0);
    });

    test('the journal keeps the move; the admin sees the addresses, the viewer does not', async () => {
      const fresh = await panelLogin('owner.box+admin@gmail.com', NEW_PASSWORD).expect(200);
      const asAdmin = await request(app)
        .get('/api/v1/admin/audit-log?action=change_email')
        .set('Authorization', `Bearer ${fresh.body.data.accessToken}`)
        .expect(200);
      const entry = asAdmin.body.data.find((e) => e.entity_id === admin.id);
      expect(entry.summary).toBe('Адрес e-mail учётки изменён');
      expect(entry.old_data.user_email).toBe('admin@test.com');
      expect(entry.new_data.user_email).toBe('owner.box+admin@gmail.com');
      expect(entry.new_data.password_cleared).toBe(true);
      // What the move itself ended, before the second pass (which would mask a
      // first pass that left the code alive for its few seconds).
      expect(entry.new_data).toMatchObject({
        sessions_ended: 1, devices_switched_off: 1, reset_links_spent: 1, email_codes_spent: 1,
      });

      const asViewer = await request(app)
        .get('/api/v1/admin/audit-log?action=change_email')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      const seen = asViewer.body.data.find((e) => e.entity_id === admin.id);
      expect(seen.old_data.user_email).toBeNull();
      expect(seen.new_data.user_email).toBeNull();
      expect(JSON.stringify(asViewer.body)).not.toContain('owner.box');
    });

    test('the output never prints the operator\'s mailbox', () => {
      expect(moveOutput).not.toContain('owner.box');
      expect(moveOutput).toContain('[ящик Координатора]+admin');
      expect(moveOutput).toContain('Second pass');
    });

    test('a mistake is corrected by moving again to another address of ours — the bare mailbox too, printed as a label', async () => {
      const result = move('owner.box+admin@gmail.com', 'owner.box@gmail.com');
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('owner.box');
      expect(result.stdout).toContain('[ящик Координатора]');
      expect((await row(admin.id)).email).toBe('owner.box@gmail.com');
    });
  });

  describe('the second pass ends what a request by the old address wrote just after the move', () => {
    test('a reset link written right after the commit is spent a few seconds later', async () => {
      await clearAllData();
      const id = (await createTestUser({ email: 'admin3@test.com', password: PASSWORD, name: 'Админ', role: 'admin' })).id;
      const child = spawn(process.execPath, [SCRIPT, '--email=admin3@test.com', '--new-email=owner.box+late@gmail.com',
        '--confirm-old=admin3@test.com', '--yes'], { env: scriptEnv({}) });
      const exited = new Promise((resolveExit) => { child.on('exit', resolveExit); });

      // Wait for the commit, then write what a «forgot password» that read the
      // old address before it would write after it.
      const deadline = Date.now() + 10000;
      while ((await row(id)).email !== 'owner.box+late@gmail.com') {
        if (Date.now() > deadline) throw new Error('the move did not commit in time');
        await new Promise((r) => { setTimeout(r, 50); });
      }
      await query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')",
        [id, createHash('sha256').update(randomBytes(32).toString('hex')).digest('hex')],
      );
      expect((await counts(id)).reset_links).toBe(1);

      expect(await exited).toBe(0);
      expect((await counts(id)).reset_links).toBe(0);
    }, 20000);
  });

  describe('refusals: the new address must be ours and free; the account must be a service account', () => {
    let id;

    beforeAll(async () => {
      await clearAllData();
      id = (await createTestUser({ email: 'admin2@test.com', password: PASSWORD, name: 'Админ', role: 'admin' })).id;
      await createTestUser({ email: 'owner.box+taken@gmail.com', password: PASSWORD, name: 'Занят', role: 'user' });
      await createTestUser({ email: 'owner.box+same@gmail.com', password: PASSWORD, name: 'Тот же', role: 'admin' });
      await createTestUser({ email: 'ivan.petrov@mail.ru', password: PASSWORD, name: 'Иван', role: 'partner' });
    });

    test.each([
      ['a stranger\'s domain', 'admin2@test.com', 'admin@restaurantguide.by', 'not ours'],
      ['a tag on someone else\'s Gmail', 'admin2@test.com', 'stranger+admin@gmail.com', 'not ours'],
      ['the mailbox with a dot moved — Gmail delivers, but it is not the form we hold', 'admin2@test.com', 'owner.b.ox+admin@gmail.com', 'not ours'],
      ['a project-domain address not listed as a mailbox', 'admin2@test.com', 'panel@nirivio.by', 'not ours'],
      ['an address another account stands on', 'admin2@test.com', 'owner.box+taken@gmail.com', 'Another account'],
      ['the address it already stands on', 'owner.box+same@gmail.com', 'owner.box+same@gmail.com', 'already stands on this address'],
      ['not an address at all', 'admin2@test.com', 'owner.box+admin', 'not one the login accepts'],
      ['a person\'s account without --any-account', 'ivan.petrov@mail.ru', 'owner.box+ivan@gmail.com', 'not a service account'],
    ])('%s', async (_, from, to, message) => {
      const before = (await query('SELECT email FROM users WHERE lower(email) = $1', [from])).rows[0];
      const result = move(from, to);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect((await query('SELECT email FROM users WHERE lower(email) = $1', [from])).rows[0]).toEqual(before);
    });

    test('a taken address is refused already in the dry run', async () => {
      const result = run(['--email=admin2@test.com', '--new-email=owner.box+taken@gmail.com']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Another account');
    });

    test('a project-domain address listed as a mailbox is ours; the move confirms it', async () => {
      await query('UPDATE users SET email_verified = false WHERE id = $1', [id]);
      const result = move('admin2@test.com', 'panel@nirivio.by', []);
      expect(result.status).toBe(1);
      const listed = spawnSync(process.execPath, [SCRIPT, '--email=admin2@test.com', '--new-email=panel@nirivio.by',
        '--confirm-old=admin2@test.com', '--yes'], { env: scriptEnv({ SERVICE_ACCOUNT_MAILBOXES: `${MAILBOX},panel@nirivio.by` }), encoding: 'utf8' });
      expect(listed.status).toBe(0);
      expect(await row(id)).toMatchObject({ email: 'panel@nirivio.by', email_verified: true });
    });

    test('a person\'s account moves only with --any-account', async () => {
      const result = move('ivan.petrov@mail.ru', 'owner.box+ivan@gmail.com', ['--any-account']);
      expect(result.status).toBe(0);
      expect((await query("SELECT COUNT(*)::int AS n FROM users WHERE email = 'owner.box+ivan@gmail.com'")).rows[0].n).toBe(1);
    });
  });

  describe('the seed house moves in place', () => {
    test('same id, cards still its own, provider link gone', async () => {
      await clearAllData();
      const houseId = randomUUID();
      await query(
        `INSERT INTO users (id, email, password_hash, name, role, auth_method, oauth_provider_id, email_verified, is_active)
         VALUES ($1, 'seed.data.generator@restaurantguide.by', NULL, 'Дом сида', 'partner', 'yandex', 'ya-77', true, true)`,
        [houseId],
      );
      for (let i = 0; i < 3; i += 1) {
        await query(
          `INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude,
                                       categories, cuisines, working_hours, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, 'Карточка', gen_random_uuid()::text, 'Проверка', 'Минск', 'ул. 1',
                   53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '{}'::jsonb, 'active', NOW(), NOW())`,
          [houseId],
        );
      }
      const dry = run(['--email=seed.data.generator@restaurantguide.by', '--new-email=owner.box+seed@gmail.com']);
      expect(dry.stdout).toContain('owns 3 card(s)');
      const result = move('seed.data.generator@restaurantguide.by', 'owner.box+seed@gmail.com');
      expect(result.status).toBe(0);
      const house = (await query('SELECT id, email, role, oauth_provider_id, auth_method FROM users WHERE id = $1', [houseId])).rows[0];
      expect(house).toEqual({ id: houseId, email: 'owner.box+seed@gmail.com', role: 'partner', oauth_provider_id: null, auth_method: 'email' });
      const cards = (await query('SELECT COUNT(*)::int AS n FROM establishments WHERE partner_id = $1', [houseId])).rows[0].n;
      expect(cards).toBe(3);
    });
  });
});
