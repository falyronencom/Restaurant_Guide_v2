/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отказы партнёру на действиях с бронями — по-русски (решение Координатора
 * 13.10.2026, вариант Б).
 *
 * Самый частый отказ здесь — бронь, чей статус изменился, пока экран партнёра
 * был открыт: истекло время на ответ, гость отменил, со второго телефона того
 * же аккаунта уже ответили. До правки сервер отвечал «Cannot confirm booking
 * with status 'expired'» — английским и с машинным статусом. Приложение
 * начнёт показывать этот текст со следующей сборки (сессия «Брони: партнёр
 * видит, что действие не прошло»).
 *
 * Ожидания — литералы утверждённых формулировок; коды и статусы проверяются
 * тоже — их не меняли. Гостевая отмена своей брони — по слову Координатора,
 * её тексты этот проход не трогает (последний тест держит именно это).
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens, utcTimestamp } from '../utils/auth.js';

const REFRESH = ' Обновите список броней.';

let est;
let otherEst;
let ownerToken;
let strangerToken;
let guestToken;
let guestId;

const phone = () => `+37529${Math.floor(1000000 + Math.random() * 9000000)}`;

const insertBooking = async (status, establishmentId = est.id) => {
  const { rows } = await query(
    `INSERT INTO bookings (establishment_id, user_id, booking_date, booking_time, guest_count,
                           comment, contact_phone, status, expires_at)
     VALUES ($1, $2, CURRENT_DATE + 1, '19:00', 2, NULL, '+375291112233', $3, $4)
     RETURNING id`,
    [establishmentId, guestId, status, utcTimestamp(new Date(Date.now() + 86400000))],
  );
  return rows[0].id;
};

const act = (action, bookingId, { establishmentId = est.id, token = ownerToken, body } = {}) => {
  const req = request(app)
    .put(`/api/v1/partner/bookings/${establishmentId}/${bookingId}/${action}`)
    .set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
};

beforeAll(async () => {
  await clearAllData();
  const owner = await createUserAndGetTokens({
    email: 'booking-texts-owner@test.com', phone: phone(), password: 'Partner123!@#', name: 'Owner', role: 'partner',
  });
  const stranger = await createUserAndGetTokens({
    email: 'booking-texts-stranger@test.com', phone: phone(), password: 'Partner123!@#', name: 'Stranger', role: 'partner',
  });
  const guest = await createUserAndGetTokens({
    email: 'booking-texts-guest@test.com', phone: phone(), password: 'Guest123!@#', name: 'Гость', role: 'user',
  });
  ownerToken = owner.accessToken;
  strangerToken = stranger.accessToken;
  guestToken = guest.accessToken;
  guestId = guest.user.id;
  est = await createTestEstablishment(owner.user.id);
  otherEst = await createTestEstablishment(owner.user.id);
});

afterAll(async () => {
  await clearAllData();
});

describe('Статус брони изменился, пока экран был открыт', () => {
  test('подтвердить бронь, у которой истекло время на ответ', async () => {
    const id = await insertBooking('expired');
    const res = await act('confirm', id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(res.body.message).toBe(`Время на ответ истекло — бронь снята автоматически.${REFRESH}`);
  });

  test('отметить неявку по брони, которую гость отменил', async () => {
    const id = await insertBooking('cancelled');
    const res = await act('no-show', id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(res.body.message).toBe(`Гость отменил эту бронь.${REFRESH}`);
  });

  test('подтвердить уже подтверждённую (второй телефон, двойное нажатие)', async () => {
    const id = await insertBooking('confirmed');
    const res = await act('confirm', id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`Бронь уже подтверждена.${REFRESH}`);
  });

  test('отклонить уже отклонённую', async () => {
    const id = await insertBooking('declined');
    const res = await act('decline', id, { body: { reason: 'Мест нет' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`Бронь уже отклонена.${REFRESH}`);
  });

  test('отметить неявку по ещё не подтверждённой', async () => {
    const id = await insertBooking('pending');
    const res = await act('no-show', id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`Бронь ещё не подтверждена.${REFRESH}`);
  });

  test('завершить бронь, уже отмеченную неявкой', async () => {
    const id = await insertBooking('no_show');
    const res = await act('complete', id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`Бронь уже отмечена: гость не пришёл.${REFRESH}`);
  });

  test('отметить неявку по брони, уже отмеченной как состоявшаяся', async () => {
    const id = await insertBooking('completed');
    const res = await act('no-show', id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`Бронь уже отмечена как состоявшаяся.${REFRESH}`);
  });
});

describe('Бронь или заведение не найдены', () => {
  test('брони нет — 404, «Бронь не найдена…»', async () => {
    const res = await act('confirm', randomUUID());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('Бронь не найдена. Обновите список броней.');
  });

  test('бронь другого заведения того же партнёра — 403, тот же текст', async () => {
    const id = await insertBooking('pending', otherEst.id);
    const res = await act('confirm', id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.message).toBe('Бронь не найдена. Обновите список броней.');
  });

  test('чужое заведение — 403, текст не говорит, есть ли оно', async () => {
    const id = await insertBooking('pending');
    const res = await act('confirm', id, { token: strangerToken });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.message).toBe('Заведение не найдено или принадлежит другому аккаунту. Обновите список заведений.');
  });

  test('список броней чужого заведения — тот же текст', async () => {
    const res = await request(app)
      .get(`/api/v1/partner/bookings/${est.id}`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Заведение не найдено или принадлежит другому аккаунту. Обновите список заведений.');
  });
});

describe('Причина отказа', () => {
  test('отклонить без причины — «Укажите причину отказа.»', async () => {
    const id = await insertBooking('pending');
    const res = await act('decline', id, { body: { reason: '   ' } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('Укажите причину отказа.');
  });
});

describe('Гостевая отмена — вне прохода', () => {
  test('гость отменяет неподтверждённую бронь — текст прежний (ждёт слова Координатора)', async () => {
    const id = await insertBooking('pending');
    const res = await request(app)
      .put(`/api/v1/bookings/${id}/cancel`)
      .set('Authorization', `Bearer ${guestToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(res.body.message).toBe("Cannot cancel booking with status 'pending'");
  });
});
