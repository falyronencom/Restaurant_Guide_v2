/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Брони заведения видит и меняет только его партнёр.
 *
 * Маршруты /partner/bookings/* проверяют только роль. Пять функций
 * bookingService получали partnerId и не использовали его: любой партнёр —
 * а партнёром становится любой, кто создал черновик, — читал брони чужого
 * заведения вместе с телефоном и комментарием гостя, подтверждал и отклонял
 * их, и гостю уходило уведомление (внешний обзор 23.09.2026, #1; основа —
 * воспроизведение из итога обзора).
 *
 * Проверка владения обязана идти ПЕРВОЙ, до поиска брони и проверки её
 * статуса: иначе разные коды и тексты ошибок сказали бы чужому, существует ли
 * бронь и в каком она статусе. Сторож по всем партнёрским маршрутам —
 * partner-ownership-guard.test.js; здесь — брони подробно и путь владельца.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens, utcTimestamp } from '../utils/auth.js';

const GUEST_PHONE = '+375291112233';

let est;
let ownerToken;
let attackerToken;
let guestId;

const phone = () => `+37529${Math.floor(1000000 + Math.random() * 9000000)}`;

const insertBooking = async (status, { expiresAt = new Date(Date.now() + 86400000) } = {}) => {
  const { rows } = await query(
    `INSERT INTO bookings (establishment_id, user_id, booking_date, booking_time, guest_count,
                           comment, contact_phone, status, expires_at)
     VALUES ($1, $2, CURRENT_DATE + 1, '19:00', 2, 'Годовщина, столик у окна', $3, $4, $5)
     RETURNING id`,
    [est.id, guestId, GUEST_PHONE, status, utcTimestamp(expiresAt)],
  );
  return rows[0].id;
};

const bookingRow = async (id) => {
  const { rows } = await query('SELECT status, decline_reason FROM bookings WHERE id = $1', [id]);
  return rows[0];
};

const guestNotifications = async () => {
  const { rows } = await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1', [guestId]);
  return rows[0].n;
};

/** Уведомление гостю уходит после ответа («огнём и забыл») — дать хвосту лечь. */
const settleTails = () => new Promise((resolve) => setTimeout(resolve, 500));

beforeAll(async () => {
  const owner = await createUserAndGetTokens({
    email: 'idor-victim-partner@test.com', phone: phone(), password: 'Partner123!@#', name: 'Victim Partner', role: 'partner',
  });
  const guest = await createUserAndGetTokens({
    email: 'idor-guest@test.com', phone: phone(), password: 'Guest123!@#', name: 'Гость Иванов', role: 'user',
  });
  const attacker = await createUserAndGetTokens({
    email: 'idor-attacker-partner@test.com', phone: phone(), password: 'Attack123!@#', name: 'Attacker', role: 'partner',
  });
  ownerToken = owner.accessToken;
  attackerToken = attacker.accessToken;
  guestId = guest.user.id;

  est = await createTestEstablishment(owner.user.id);
  await createTestEstablishment(attacker.user.id);
});

afterAll(async () => {
  await clearAllData();
});

describe('чужой партнёр', () => {
  test('не читает брони заведения', async () => {
    await insertBooking('pending');

    const res = await request(app)
      .get(`/api/v1/partner/bookings/${est.id}`)
      .set('Authorization', `Bearer ${attackerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(JSON.stringify(res.body)).not.toContain('375291112233');
    expect(JSON.stringify(res.body)).not.toContain('Годовщина');
  });

  test('не отклоняет бронь заведения: строка в БД не меняется, гостю ничего не уходит', async () => {
    const bookingId = await insertBooking('pending');

    const res = await request(app)
      .put(`/api/v1/partner/bookings/${est.id}/${bookingId}/decline`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ reason: 'мест нет' });
    await settleTails();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await bookingRow(bookingId)).toEqual({ status: 'pending', decline_reason: null });
    expect(await guestNotifications()).toBe(0);
  });

  test('не подтверждает бронь заведения', async () => {
    const bookingId = await insertBooking('pending');

    const res = await request(app)
      .put(`/api/v1/partner/bookings/${est.id}/${bookingId}/confirm`)
      .set('Authorization', `Bearer ${attackerToken}`);
    await settleTails();

    expect(res.status).toBe(403);
    expect((await bookingRow(bookingId)).status).toBe('pending');
    expect(await guestNotifications()).toBe(0);
  });

  test.each([
    ['no-show', 'confirmed'],
    ['complete', 'confirmed'],
  ])('не отмечает %s у брони заведения', async (action, status) => {
    const bookingId = await insertBooking(status);

    const res = await request(app)
      .put(`/api/v1/partner/bookings/${est.id}/${bookingId}/${action}`)
      .set('Authorization', `Bearer ${attackerToken}`);

    expect(res.status).toBe(403);
    expect((await bookingRow(bookingId)).status).toBe(status);
  });

  test('чтением не запускает «ленивое» истечение чужих броней', async () => {
    const expired = await insertBooking('pending', { expiresAt: new Date(Date.now() - 3600000) });

    await request(app)
      .get(`/api/v1/partner/bookings/${est.id}`)
      .set('Authorization', `Bearer ${attackerToken}`);

    expect((await bookingRow(expired)).status).toBe('pending');
  });
});

describe('владение проверяется первым: чужому не видно, есть ли бронь и в каком она статусе', () => {
  test.each(['confirm', 'decline', 'no-show', 'complete'])('%s: несуществующая бронь — тот же 403', async (action) => {
    const res = await request(app)
      .put(`/api/v1/partner/bookings/${est.id}/${randomUUID()}/${action}`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ reason: 'мест нет' });

    expect({ status: res.status, code: res.body.error.code }).toEqual({ status: 403, code: 'FORBIDDEN' });
  });

  test.each([
    ['confirm', 'declined'],
    ['decline', 'expired'],
    ['no-show', 'pending'],
    ['complete', 'cancelled'],
  ])('%s: бронь в неподходящем статусе (%s) — тот же 403, а не 400', async (action, status) => {
    const bookingId = await insertBooking(status);

    const res = await request(app)
      .put(`/api/v1/partner/bookings/${est.id}/${bookingId}/${action}`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ reason: 'мест нет' });

    expect({ status: res.status, code: res.body.error.code }).toEqual({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('владелец', () => {
  test('видит брони своего заведения вместе с контактами гостя', async () => {
    const bookingId = await insertBooking('pending');

    const res = await request(app)
      .get(`/api/v1/partner/bookings/${est.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const mine = res.body.data.items.find((item) => item.id === bookingId);
    expect(mine).toEqual(expect.objectContaining({ contact_phone: GUEST_PHONE, status: 'pending' }));
  });

  test('подтверждает, отклоняет, отмечает неявку и завершение', async () => {
    const toConfirm = await insertBooking('pending');
    const toDecline = await insertBooking('pending');
    const toNoShow = await insertBooking('confirmed');
    const toComplete = await insertBooking('confirmed');
    const put = (id, action, body) => request(app)
      .put(`/api/v1/partner/bookings/${est.id}/${id}/${action}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body);

    expect((await put(toConfirm, 'confirm')).status).toBe(200);
    expect((await put(toDecline, 'decline', { reason: 'Мест нет' })).status).toBe(200);
    expect((await put(toNoShow, 'no-show')).status).toBe(200);
    expect((await put(toComplete, 'complete')).status).toBe(200);
    await settleTails();

    expect((await bookingRow(toConfirm)).status).toBe('confirmed');
    expect(await bookingRow(toDecline)).toEqual({ status: 'declined', decline_reason: 'Мест нет' });
    expect((await bookingRow(toNoShow)).status).toBe('no_show');
    expect((await bookingRow(toComplete)).status).toBe('completed');
  });
});
