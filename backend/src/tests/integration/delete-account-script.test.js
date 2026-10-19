/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Удаление учётки оператором по заявке в поддержку — scripts/delete-account.js
 * (бриф В1, 18.10.2026). Страница «Как удалить учётку» обещает удаление и
 * человеку без приложения; телефонную учётку на сайте не удалить — вход там
 * только по почте; отключённую учётку приложение не удаляет («напишите в
 * поддержку»).
 *
 * Скрипт запускается как есть, отдельным процессом на базе теста: процесс
 * наследует DB_*, флага --production здесь нет и быть не должно. Само
 * удаление — то же, что из приложения (anonymiseAccount; что уходит и что
 * остаётся, проверяет delete-own-account.test.js). Здесь — чем путь оператора
 * отличается: запись журнала без автора, с именем скрипта; отключённая учётка
 * удаляется; заведению — уведомление тем же текстом, без пуша; фото —
 * подсказкой оператору, облако скрипт не зовёт; вывод — без почты и имени. И
 * отказы: владелец карточек, учётки панели и служебные, нет такой учётки; то
 * же, если это случилось, пока скрипт ждал блокировку строки.
 *
 * Ожидаемые тексты — литералами: оператор читает вывод, заведение —
 * уведомление.
 *
 * На старом коде (до В1) каждый тест здесь красный: скрипта не было.
 */

import { spawn, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import app from '../../server.js';
import { invalidateAccountStatus } from '../../services/accountStatus.js';
import { clearAllData, getClient, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createPartnerWithEstablishment,
  createTestReview,
  createViewerAndGetToken,
} from '../utils/adminTestHelpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '../../../scripts/delete-account.js');
const AUTH = '/api/v1/auth';
const ACTOR = 'operator_script:delete-account';

/** Скрипт до конца, с ответом на вопрос «yes» в input, если он задан. */
const run = (args, { input } = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  env: { ...process.env },
  encoding: 'utf8',
  input,
});

/** Скрипт в фоне — для гонки: тест держит строку учётки, пока скрипт ждёт. */
const start = (args) => new Promise((resolveExit) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolveExit({ status, stdout, stderr }));
});

/** Человек с почтой и паролем, с живым сеансом. */
const person = async ({ name = 'Анна Заявкина', phone = null } = {}) => {
  const email = `request-${randomUUID()}@test.com`;
  const created = await createUserAndGetTokens({
    email, phone, password: 'Person123!@#', name, role: 'user', authMethod: 'email',
  });
  return { ...created, email, id: created.user.id };
};

const userRow = async (id) => (await query(
  `SELECT email, phone, password_hash, name, avatar_url, is_active
   FROM users WHERE id = $1`,
  [id],
)).rows[0];

const deletionEntries = async (userId) => (await query(
  `SELECT user_id, old_data, new_data FROM audit_log
   WHERE entity_type = 'user' AND entity_id = $1 AND action = 'user_delete_account'`,
  [userId],
)).rows;

/**
 * Бронь на день и время литералами — фиксированные строки теста, не ввод:
 * день в уведомлении сверяется буквально.
 */
const addBookingAt = async (establishmentId, userId, status, dateSql, timeSql) => {
  const { rows } = await query(
    `INSERT INTO bookings (
       establishment_id, user_id, booking_date, booking_time, guest_count,
       comment, contact_phone, status, expires_at
     )
     VALUES ($1, $2, ${dateSql}, ${timeSql}, 2, 'Окно', '+375291112233', $3,
             (NOW() AT TIME ZONE 'UTC') + interval '2 hours')
     RETURNING id`,
    [establishmentId, userId, status],
  );
  return rows[0].id;
};

/** Ждать, пока скрипт встанет в очередь за блокировкой строки учётки. */
const waitForLockWaiters = async (expected) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0].n >= expected) return;
    await new Promise((resolveWait) => { setTimeout(resolveWait, 20); });
  }
  throw new Error(`в очереди за блокировкой нет ${expected} запросов`);
};

/**
 * Держать строку учётки, пока скрипт не встанет за ней; тогда сделать change
 * в той же транзакции и отпустить. Возвращает итог скрипта.
 */
const raceWith = async (userId, args, change) => {
  const holder = await getClient();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const script = start(args);
    try {
      await waitForLockWaiters(1);
      await change(holder);
      await holder.query('COMMIT');
    } catch (error) {
      await holder.query('ROLLBACK');
      throw error;
    }
    return await script;
  } finally {
    holder.release();
  }
};

beforeEach(async () => {
  await clearAllData();
});

afterAll(async () => {
  await clearAllData();
});

describe('scripts/delete-account.js — удаление по заявке', () => {
  test('по почте: учётка обезличена, отзыв остался, запись журнала без автора — с именем скрипта', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    await createTestReview(p.id, establishment.id, { rating: 4, content: 'Хорошо посидели' });

    // Почта — в другом регистре: оператор пишет её, как прочёл в письме.
    const result = run([`--email=${p.email.toUpperCase()}`, '--yes']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Account ${p.id}: role user, sign-in email, active, registered `);
    expect(result.stdout).toContain(
      `✅ Account ${p.id} deleted: 1 review(s) kept under «Гость», `
      + '0 booking(s) ahead cancelled (0 establishment notice(s), no push), '
      + '0 favourite(s) removed, 0 unfinished card(s) deleted; every session ended.',
    );
    expect(result.stdout).toContain('A server process may let an old access token through for up to 10 seconds.');
    expect(await userRow(p.id)).toEqual({
      email: null, phone: null, password_hash: null, name: 'Гость', avatar_url: null, is_active: false,
    });
    expect(await deletionEntries(p.id)).toEqual([{
      user_id: null,
      old_data: { role: 'user', auth_method: 'email' },
      new_data: {
        reviews_kept: 1,
        bookings_cancelled: 0,
        favorites_removed: 0,
        drafts_deleted: 0,
        access_tokens_revoked: true,
        actor: ACTOR,
      },
    }]);
    const review = await query('SELECT rating, content FROM reviews WHERE user_id = $1', [p.id]);
    expect(review.rows).toEqual([{ rating: 4, content: 'Хорошо посидели' }]);
  });

  test('вывод не называет человека: ни почты, ни имени, ни телефона', async () => {
    const p = await person({ name: 'Анна Заявкина', phone: '+375297654321' });

    const result = run([`--email=${p.email}`, '--yes']);

    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain(p.email);
    expect(output).not.toContain('Анна');
    expect(output).not.toContain('7654321');
  });

  test('прежний сеанс закрыт: refresh-токен — 401, access-токен — 401, когда сервер перечитал учётку', async () => {
    const p = await person();

    expect(run([`--email=${p.email}`, '--yes']).status).toBe(0);

    await request(app).post(`${AUTH}/refresh`).send({ refreshToken: p.refreshToken }).expect(401);
    // Кэш статуса сервера скрипт сбросить не может (он другой процесс и
    // говорит это); тест сбрасывает его сам — стоит за эти 10 с.
    invalidateAccountStatus(p.id);
    await request(app).get(`${AUTH}/me`).set('Authorization', `Bearer ${p.accessToken}`).expect(401);
  });

  test('по телефону, записанному как его пишут люди', async () => {
    const p = await person({ phone: '+375291234567' });

    const result = run(['--phone=+375 (29) 123-45-67', '--yes']);

    expect(result.status).toBe(0);
    expect(await userRow(p.id)).toMatchObject({ email: null, phone: null, name: 'Гость', is_active: false });
  });

  test('отключённую учётку тоже удаляет; отзыв, скрытый блоком, остаётся скрытым', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    const review = await createTestReview(p.id, establishment.id, { content: 'Скрыт блоком', is_visible: false });
    await query('UPDATE users SET is_active = FALSE WHERE id = $1', [p.id]);

    const result = run([`--email=${p.email}`, '--yes']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Account ${p.id}: role user, sign-in email, switched off, registered `);
    expect(await userRow(p.id)).toMatchObject({ email: null, name: 'Гость', is_active: false });
    expect(await deletionEntries(p.id)).toHaveLength(1);
    const kept = await query('SELECT is_visible, is_deleted FROM reviews WHERE id = $1', [review.id]);
    expect(kept.rows).toEqual([{ is_visible: false, is_deleted: false }]);
  });

  test('бронь впереди отменена; заведению — уведомление тем же текстом, что при отмене гостем', async () => {
    const p = await person();
    const { partner, establishment } = await createPartnerWithEstablishment('active');
    const ahead = await addBookingAt(establishment.id, p.id, 'confirmed', "'2030-03-15'::date", "'19:00'::time");
    const past = await addBookingAt(establishment.id, p.id, 'completed', "'2020-03-15'::date", "'19:00'::time");

    const result = run([`--email=${p.email}`, '--yes']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 booking(s) ahead cancelled (1 establishment notice(s), no push)');
    const bookings = await query(
      'SELECT id, status, contact_phone, comment, guest_count FROM bookings WHERE id = ANY($1::uuid[]) ORDER BY booking_date',
      [[ahead, past]],
    );
    expect(bookings.rows).toEqual([
      { id: past, status: 'completed', contact_phone: '', comment: null, guest_count: 2 },
      { id: ahead, status: 'cancelled', contact_phone: '', comment: null, guest_count: 2 },
    ]);
    const notices = await query(
      'SELECT type, title, message, establishment_id FROM notifications WHERE user_id = $1',
      [partner.user.id],
    );
    expect(notices.rows).toEqual([{
      type: 'booking_cancelled',
      title: 'Бронь отменена',
      message: 'Бронь на «Test Establishment» (15 марта 19:00) отменена гостем',
      establishment_id: establishment.id,
    }]);
  });

  test('черновик уходит вместе с учёткой; запись журнала карточки — тоже без автора', async () => {
    const { partner, establishment: draft } = await createPartnerWithEstablishment('draft');

    const result = run([`--email=${partner.user.email}`, '--yes']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`✅ Account ${partner.user.id} deleted: `);
    expect(result.stdout).toContain('1 unfinished card(s) deleted');
    const journal = await query(
      `SELECT entity_id, user_id, old_data FROM audit_log WHERE action = 'partner_delete_establishment'`,
    );
    expect(journal.rows).toEqual([{
      entity_id: draft.id, user_id: null, old_data: { name: 'Test Establishment', city: 'Минск', status: 'draft' },
    }]);
  });

  test('фото на нашем облаке: скрипт его не трогает и говорит оператору, что удалить', async () => {
    const p = await person();
    await query('UPDATE users SET avatar_url = $2 WHERE id = $1', [
      p.id, `https://res.cloudinary.com/test/image/upload/v1/avatars/${p.id}/face.jpg`,
    ]);

    const result = run([`--email=${p.email}`, '--yes']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `   The picture is left on the cloud: delete avatars/${p.id}/face in the Cloudinary console (Media Library).`,
    );
    expect((await userRow(p.id)).avatar_url).toBeNull();
  });

  test('фото не с нашего облака (Google) — подсказка смотреть папку аватара', async () => {
    const p = await person();
    await query(`UPDATE users SET avatar_url = 'https://lh3.googleusercontent.com/a/face' WHERE id = $1`, [p.id]);

    const result = run([`--email=${p.email}`, '--yes']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      '   The picture is not on the cloud this machine is set up for (a Google or Yandex picture — or CLOUDINARY_* '
      + `not set here): look into avatars/${p.id}/ in the Cloudinary console.`,
    );
  });

  test('без --yes: «no» — ничего не записано; «yes» — удалена', async () => {
    const p = await person();

    const declined = run([`--email=${p.email}`], { input: 'no\n' });
    expect(declined.status).toBe(1);
    expect(declined.stdout).toContain('Aborted — nothing was written.');
    expect((await userRow(p.id)).email).toBe(p.email);
    expect(await deletionEntries(p.id)).toHaveLength(0);

    const accepted = run([`--email=${p.email}`], { input: 'yes\n' });
    expect(accepted.status).toBe(0);
    expect((await userRow(p.id)).email).toBeNull();
  });
});

describe('scripts/delete-account.js — отказы', () => {
  test.each(['active', 'pending', 'suspended'])(
    'владелец карточки в статусе %s — отказ, ничего не записано',
    async (status) => {
      const { partner, establishment } = await createPartnerWithEstablishment(status);

      const result = run([`--email=${partner.user.email}`, '--yes']);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        '❌ Refusing: the account holds establishment cards. Pass them to another holder first, then run the script again.',
      );
      expect(await userRow(partner.user.id)).toMatchObject({ email: partner.user.email, is_active: true });
      expect((await query('SELECT id FROM establishments WHERE id = $1', [establishment.id])).rows).toHaveLength(1);
      expect(await deletionEntries(partner.user.id)).toHaveLength(0);
    },
  );

  test('учётка панели — отказ', async () => {
    const viewer = await createViewerAndGetToken();

    const result = run([`--email=${viewer.user.email}`, '--yes']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '❌ Refusing: a panel or service account — its access is the operator\'s. Switch it off with set-user-active.js.',
    );
    expect((await userRow(viewer.user.id)).is_active).toBe(true);
  });

  test('служебная учётка — отказ', async () => {
    const p = await person();
    await query('UPDATE users SET is_service_account = TRUE WHERE id = $1', [p.id]);

    const result = run([`--email=${p.email}`, '--yes']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('❌ Refusing: a panel or service account');
    expect((await userRow(p.id)).email).toBe(p.email);
  });

  test('нет такой учётки; удалённую второй раз не найти — ничего не записано', async () => {
    const p = await person();
    expect(run([`--email=${p.email}`, '--yes']).status).toBe(0);

    const again = run([`--email=${p.email}`, '--yes']);

    expect(again.status).toBe(1);
    expect(again.stderr).toContain(
      '❌ No account with this e-mail. A deleted account keeps neither: if its holder deleted it, there is nothing to do.',
    );
    expect(await deletionEntries(p.id)).toHaveLength(1);
  });

  test.each([
    ['ни почты, ни телефона', ['--yes'], 'exactly one of --email=<email> or --phone=<phone> is required'],
    ['и почта, и телефон', ['--email=a@test.com', '--phone=+375291234567', '--yes'],
      'exactly one of --email=<email> or --phone=<phone> is required'],
    ['почта без @', ['--email=nobody', '--yes'], '--email=<email> is not an e-mail address'],
    ['телефон не номер', ['--phone=375-29', '--yes'], '--phone=<phone> is not a phone number: +375XXXXXXXXX'],
  ])('%s — подсказка, база не тронута', async (_case, args, problem) => {
    const result = run(args);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`❌ ${problem}`);
  });
});

describe('scripts/delete-account.js — пока скрипт ждал строку учётки', () => {
  test('человек удалил учётку сам — скрипт ничего не пишет', async () => {
    const p = await person();

    const result = await raceWith(p.id, [`--email=${p.email}`, '--yes'], async (holder) => {
      await holder.query(
        `UPDATE users SET email = NULL, name = 'Гость', is_active = FALSE WHERE id = $1`,
        [p.id],
      );
      await holder.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data)
         VALUES ($1, 'user_delete_account', 'user', $1, '{}'::jsonb)`,
        [p.id],
      );
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Nothing written: the account was deleted meanwhile.');
    expect(await deletionEntries(p.id)).toEqual([{ user_id: p.id, old_data: null, new_data: {} }]);
  });

  test('учётку отметили служебной — отказ, ничего не записано', async () => {
    const p = await person();

    const result = await raceWith(p.id, [`--email=${p.email}`, '--yes'], async (holder) => {
      await holder.query('UPDATE users SET is_service_account = TRUE WHERE id = $1', [p.id]);
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '❌ A panel or service account: its access is the operator\'s — switch it off with set-user-active.js.',
    );
    expect(await userRow(p.id)).toMatchObject({ email: p.email, is_active: true });
    expect(await deletionEntries(p.id)).toHaveLength(0);
  });

  test('у человека появилась карточка в каталоге — отказ, ничего не записано, черновик цел', async () => {
    const { partner, establishment: draft } = await createPartnerWithEstablishment('draft');

    const result = await raceWith(partner.user.id, [`--email=${partner.user.email}`, '--yes'], async (holder) => {
      await holder.query(`UPDATE establishments SET status = 'pending' WHERE id = $1`, [draft.id]);
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '❌ The account holds establishment cards: pass them to another holder first — nothing written.',
    );
    expect(await userRow(partner.user.id)).toMatchObject({ email: partner.user.email, is_active: true });
    expect((await query('SELECT status FROM establishments WHERE id = $1', [draft.id])).rows)
      .toEqual([{ status: 'pending' }]);
    expect(await deletionEntries(partner.user.id)).toHaveLength(0);
  });
});
