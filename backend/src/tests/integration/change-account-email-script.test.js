/* eslint-env jest */
/**
 * Смена адреса учётки скриптом оператора (scripts/change-account-email.js,
 * lib/accountEmail.js) — директива 15.10.2026, А2; критик полноты пп. 3–6, 13.
 *
 * Скрипт запускается как есть, на базе теста (процесс наследует DB_*).
 * Ожидания — литералы директивы:
 *   - без --confirm-old — сухой прогон: в базе ничего не меняется;
 *   - --confirm-old, не совпавший с текущим адресом, — отказ, ничего не записано;
 *   - после смены вход панели находит учётку по новому адресу — набранному и
 *     в другом регистре; по прежнему — нет;
 *   - гаснет всё, что давало доступ: сеанс (refresh и access), push, живая
 *     ссылка сброса (её нельзя использовать), коды подтверждения, привязка
 *     Google/Яндекса;
 *   - «Забыли пароль» на прежний адрес ссылки не создаёт;
 *   - журнал: запись change_email; администратор видит адреса, просмотрщик —
 *     нет;
 *   - новый адрес — только наш: чужой домен, метка на чужом ящике, точка в
 *     имени ящика, занятый адрес — отказ;
 *   - дом сида переезжает на месте: id и карточки при нём;
 *   - исправление ошибки — повторный перевод на другой наш адрес;
 *   - значение ящика Координатора в выводе не печатается.
 */

import request from 'supertest';
import { spawnSync } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestUser } from '../utils/auth.js';
import { createViewerAndGetToken } from '../utils/adminTestHelpers.js';
import { invalidateAccountStatus } from '../../services/accountStatus.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(resolve(HERE, '../../../scripts'), 'change-account-email.js');

const MAILBOX = 'owner.box@gmail.com';
const PASSWORD = 'Admin123!@#';

const run = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  env: { ...process.env, SERVICE_ACCOUNT_MAILBOXES: MAILBOX, ...env },
  encoding: 'utf8',
});

const panelLogin = (email, password = PASSWORD) => request(app)
  .post('/api/v1/admin/auth/login')
  .send({ email, password });

/** Учётка панели с сеансом из входа панели, push, живой ссылкой сброса, кодом и привязкой Google. */
const adminWithEverything = async (email) => {
  const user = await createTestUser({ email, password: PASSWORD, name: 'Администратор', role: 'admin' });
  await query("UPDATE users SET email_verified = true, oauth_provider_id = 'google-sub-1', auth_method = 'google' WHERE id = $1", [user.id]);
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
  'SELECT email, auth_method, oauth_provider_id, email_verified, is_active FROM users WHERE id = $1', [id],
)).rows[0];

const counts = async (id) => (await query(
  `SELECT
     (SELECT COUNT(*)::int FROM refresh_tokens WHERE user_id = $1 AND used_at IS NULL) AS refresh,
     (SELECT COUNT(*)::int FROM device_tokens WHERE user_id = $1 AND is_active = TRUE) AS devices,
     (SELECT COUNT(*)::int FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL) AS reset_links,
     (SELECT COUNT(*)::int FROM email_verification_codes WHERE user_id = $1 AND used_at IS NULL) AS codes`,
  [id],
)).rows[0];

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
      const result = run(['--email=admin@test.com', '--new-email=owner.box+admin@gmail.com']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('dry run');
      expect((await row(admin.id)).email).toBe('admin@test.com');
      expect(await counts(admin.id)).toEqual({ refresh: 1, devices: 1, reset_links: 1, codes: 1 });
    });

    test('a --confirm-old that is not the current address is refused; nothing changes', async () => {
      const result = run(['--email=admin@test.com', '--new-email=owner.box+admin@gmail.com', '--confirm-old=admin@tset.com', '--yes']);
      expect(result.status).toBe(1);
      expect((await row(admin.id)).email).toBe('admin@test.com');
      expect(await counts(admin.id)).toEqual({ refresh: 1, devices: 1, reset_links: 1, codes: 1 });
    });

    test('the move writes the address in the login\'s form and ends everything that gave access', async () => {
      const result = run(['--email=admin@test.com', '--new-email=Owner.Box+Admin@Gmail.com', '--confirm-old=admin@test.com', '--yes']);
      moveOutput = result.stdout + result.stderr;
      expect(result.status).toBe(0);
      expect(await row(admin.id)).toEqual({
        email: 'owner.box+admin@gmail.com',
        auth_method: 'email',
        oauth_provider_id: null,
        email_verified: true,
        is_active: true,
      });
      expect(await counts(admin.id)).toEqual({ refresh: 0, devices: 0, reset_links: 0, codes: 0 });
    });

    test('the panel login finds the account by the new address, as typed and in another case; not by the old one', async () => {
      await panelLogin('owner.box+admin@gmail.com').expect(200);
      await panelLogin('OWNER.BOX+ADMIN@GMAIL.COM').expect(200);
      const old = await panelLogin('admin@test.com');
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
      await panelLogin('owner.box+admin@gmail.com').expect(200);
    });

    test('«forgot password» on the old address issues nothing', async () => {
      await request(app).post('/api/v1/auth/forgot-password').send({ email: 'admin@test.com' }).expect(200);
      expect((await counts(admin.id)).reset_links).toBe(0);
    });

    test('the journal keeps the move; the admin sees the addresses, the viewer does not', async () => {
      const fresh = await panelLogin('owner.box+admin@gmail.com').expect(200);
      const asAdmin = await request(app)
        .get('/api/v1/admin/audit-log?action=change_email')
        .set('Authorization', `Bearer ${fresh.body.data.accessToken}`)
        .expect(200);
      const entry = asAdmin.body.data.find((e) => e.entity_id === admin.id);
      expect(entry.summary).toBe('Адрес e-mail учётки изменён');
      expect(entry.old_data.user_email).toBe('admin@test.com');
      expect(entry.new_data.user_email).toBe('owner.box+admin@gmail.com');

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
    });

    test('a mistake is corrected by moving again to another address of ours', async () => {
      const result = run(['--email=owner.box+admin@gmail.com', '--new-email=owner.box+panel@gmail.com',
        '--confirm-old=owner.box+admin@gmail.com', '--yes']);
      expect(result.status).toBe(0);
      expect((await row(admin.id)).email).toBe('owner.box+panel@gmail.com');
      await panelLogin('owner.box+panel@gmail.com').expect(200);
    });
  });

  describe('refusals: the new address must be ours and free', () => {
    let id;

    beforeAll(async () => {
      await clearAllData();
      id = (await createTestUser({ email: 'admin2@test.com', password: PASSWORD, name: 'Админ', role: 'admin' })).id;
      await createTestUser({ email: 'owner.box+taken@gmail.com', password: PASSWORD, name: 'Занят', role: 'user' });
    });

    test.each([
      ['a stranger\'s domain', 'admin@restaurantguide.by'],
      ['a tag on someone else\'s Gmail', 'stranger+admin@gmail.com'],
      ['the mailbox with a dot moved — Gmail delivers, but it is not the form we hold', 'owner.b.ox+admin@gmail.com'],
      ['an address another account stands on', 'owner.box+taken@gmail.com'],
      ['the address it already stands on', 'admin2@test.com'],
      ['not an address at all', 'owner.box+admin'],
    ])('%s', async (_, newEmail) => {
      const result = run(['--email=admin2@test.com', `--new-email=${newEmail}`, '--confirm-old=admin2@test.com', '--yes']);
      expect(result.status).toBe(1);
      expect((await row(id)).email).toBe('admin2@test.com');
    });

    test('a taken address is refused already in the dry run', async () => {
      const result = run(['--email=admin2@test.com', '--new-email=owner.box+taken@gmail.com']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Another account');
    });

    test('an address at a domain the project owns is accepted; the move confirms it', async () => {
      expect((await query('SELECT email_verified FROM users WHERE id = $1', [id])).rows[0].email_verified).toBe(false);
      const result = run(['--email=admin2@test.com', '--new-email=panel@nirivio.by', '--confirm-old=admin2@test.com', '--yes']);
      expect(result.status).toBe(0);
      expect(await row(id)).toMatchObject({ email: 'panel@nirivio.by', email_verified: true });
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
      const result = run(['--email=seed.data.generator@restaurantguide.by', '--new-email=owner.box+seed@gmail.com',
        '--confirm-old=seed.data.generator@restaurantguide.by', '--yes']);
      expect(result.status).toBe(0);
      const house = (await query('SELECT id, email, role, oauth_provider_id, auth_method FROM users WHERE id = $1', [houseId])).rows[0];
      expect(house).toEqual({ id: houseId, email: 'owner.box+seed@gmail.com', role: 'partner', oauth_provider_id: null, auth_method: 'email' });
      const cards = (await query('SELECT COUNT(*)::int AS n FROM establishments WHERE partner_id = $1', [houseId])).rows[0].n;
      expect(cards).toBe(3);
    });
  });
});
