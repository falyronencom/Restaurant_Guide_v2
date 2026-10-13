/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Форма брони гостя: откуда она берёт условия и какое время сервер примет.
 *
 * Найдено 09.10.2026 на копии сервера из снимка прода (брони на проде
 * выключены у всех карточек, поэтому никто не видел):
 *  1. Форма грузила условия с партнёрского адреса
 *     GET /api/v1/partner/booking-settings/:id — он отвечает 403 всем, кроме
 *     владельца. Гость не получал ни условий, ни времени и видел «Заведение не
 *     работает в этот день» на любую дату. Теперь у формы свой публичный адрес
 *     GET /api/v1/establishments/:id/booking-settings — только четыре условия и
 *     только пока бронь вообще возможна.
 *  2. Закрытие в полночь и после неё: сервер сравнивал время строками
 *     (`'23:00' <= '00:00'` — ложь), и бронь на вечер пятницы у бара,
 *     работающего до 00:00 или до 02:00, получала TIME_OUTSIDE_HOURS.
 *
 * Партнёрские маршруты не ослаблены: чужой партнёр по-прежнему получает 403
 * (сторож — partner-ownership-guard.test.js), здесь — то же для гостя.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const everyDay = (hours) => Object.fromEntries(DAYS.map((day) => [day, hours]));

/** Ровно то, что нужно форме, — и ничего сверх. */
const TERMS = {
  is_enabled: true,
  max_guests_per_booking: 6,
  max_days_ahead: 14,
  min_hours_before: 3,
  confirmation_timeout_hours: 2,
};

let owner;
let guest;
let est; // активная, бронь включена

const phone = () => `+37529${Math.floor(1000000 + Math.random() * 9000000)}`;

const termsUrl = (id) => `/api/v1/establishments/${id}/booking-settings`;

const enableBooking = async (establishmentId, { enabled = true } = {}) => {
  await query('UPDATE establishments SET booking_enabled = $2 WHERE id = $1', [establishmentId, enabled]);
  await query(
    `INSERT INTO booking_settings (establishment_id, is_enabled, max_guests_per_booking,
       max_days_ahead, min_hours_before, confirmation_timeout_hours)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [establishmentId, enabled, TERMS.max_guests_per_booking, TERMS.max_days_ahead,
      TERMS.min_hours_before, TERMS.confirmation_timeout_hours],
  );
};

const settingsRow = async (establishmentId) => {
  const { rows } = await query(
    `SELECT is_enabled, max_guests_per_booking, max_days_ahead, min_hours_before,
            confirmation_timeout_hours
       FROM booking_settings WHERE establishment_id = $1`,
    [establishmentId],
  );
  return rows[0];
};

/** Минская дата через n суток от минского «сегодня». */
const minskDatePlusDays = (days) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

beforeAll(async () => {
  owner = await createUserAndGetTokens({
    email: 'form-owner@test.com', phone: phone(), password: 'Partner123!@#', name: 'Владелец', role: 'partner',
  });
  guest = await createUserAndGetTokens({
    email: 'form-guest@test.com', phone: phone(), password: 'Guest123!@#', name: 'Гость', role: 'user',
  });
  est = await createTestEstablishment(owner.user.id);
  await enableBooking(est.id);
});

afterAll(async () => {
  await clearAllData();
});

describe('GET /api/v1/establishments/:id/booking-settings — условия для формы гостя', () => {
  test('гость получает условия: ровно пять полей, без id, дат и прочих колонок', async () => {
    const res = await request(app)
      .get(termsUrl(est.id))
      .set('Authorization', `Bearer ${guest.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: TERMS });
  });

  test('без входа — те же условия (форму открывают и до входа)', async () => {
    const res = await request(app).get(termsUrl(est.id));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(TERMS);
  });

  test('бронь выключена — 404, условия не отдаются', async () => {
    const off = await createTestEstablishment(owner.user.id);
    await enableBooking(off.id, { enabled: false });

    const res = await request(app).get(termsUrl(off.id));

    expect({ status: res.status, code: res.body.error?.code, data: res.body.data })
      .toEqual({ status: 404, code: 'BOOKING_NOT_ENABLED', data: undefined });
  });

  test('бронь ни разу не включалась (строки настроек нет) — 404', async () => {
    const never = await createTestEstablishment(owner.user.id);

    const res = await request(app).get(termsUrl(never.id));

    expect({ status: res.status, code: res.body.error?.code })
      .toEqual({ status: 404, code: 'BOOKING_NOT_ENABLED' });
  });

  test.each(['draft', 'pending', 'suspended'])(
    'карточка в статусе %s при включённой брони — 404 (сервер такую бронь и не примет)',
    async (status) => {
      const hidden = await createTestEstablishment(owner.user.id);
      await enableBooking(hidden.id);
      await query('UPDATE establishments SET status = $2 WHERE id = $1', [hidden.id, status]);

      const res = await request(app).get(termsUrl(hidden.id));

      expect({ status: res.status, code: res.body.error?.code })
        .toEqual({ status: 404, code: 'BOOKING_NOT_ENABLED' });
    },
  );

  test('несуществующий и кривой id — 404, не 500', async () => {
    const missing = await request(app).get(termsUrl('00000000-0000-4000-8000-000000000000'));
    const malformed = await request(app).get(termsUrl('not-a-uuid'));

    expect([missing.status, malformed.status]).toEqual([404, 404]);
  });
});

describe('партнёрские маршруты настроек не ослаблены', () => {
  test('гость на партнёрском чтении — 403, как и раньше', async () => {
    const res = await request(app)
      .get(`/api/v1/partner/booking-settings/${est.id}`)
      .set('Authorization', `Bearer ${guest.accessToken}`);

    expect(res.status).toBe(403);
  });

  test('гость не меняет и не выключает чужую бронь — 403, строка настроек та же', async () => {
    const before = await settingsRow(est.id);

    const put = await request(app)
      .put(`/api/v1/partner/booking-settings/${est.id}`)
      .set('Authorization', `Bearer ${guest.accessToken}`)
      .send({ max_guests_per_booking: 1 });
    const off = await request(app)
      .post(`/api/v1/partner/booking-settings/${est.id}/deactivate`)
      .set('Authorization', `Bearer ${guest.accessToken}`);

    expect([put.status, off.status]).toEqual([403, 403]);
    expect(await settingsRow(est.id)).toEqual(before);
  });

  test('без входа партнёрское чтение закрыто — 401', async () => {
    const res = await request(app).get(`/api/v1/partner/booking-settings/${est.id}`);

    expect(res.status).toBe(401);
  });
});

describe('POST /bookings — закрытие в полночь и после полуночи', () => {
  // Дата через двое суток: дальше min_hours_before и ближе max_days_ahead
  // при любом часе запуска. Часы одинаковы на всю неделю — день недели неважен.
  const date = minskDatePlusDays(2);
  let guestNo = 0;

  /** Свежий гость на каждую бронь: лимиты гостя (2 активных) не копятся. */
  const bookAs = async (establishmentId, time) => {
    guestNo += 1;
    const booker = await createUserAndGetTokens({
      email: `night-${guestNo}@test.com`, phone: phone(), password: 'Guest123!@#', name: 'Гость', role: 'user',
    });
    return request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${booker.accessToken}`)
      .send({ establishmentId, date, time, guestCount: 2, contactPhone: '+375291112233' });
  };

  const barWith = async (hours) => {
    const bar = await createTestEstablishment(owner.user.id);
    await query('UPDATE establishments SET working_hours = $2 WHERE id = $1', [
      bar.id, JSON.stringify(everyDay(hours)),
    ]);
    await enableBooking(bar.id);
    return bar;
  };

  test.each([
    ['12:00–00:00 (строкой)', '23:00', '12:00-00:00'],
    ['12:00–00:00 (строкой)', '23:30', '12:00-00:00'],
    ['18:00–02:00 (объектом)', '23:00', { is_open: true, open: '18:00', close: '02:00' }],
    ['18:00–02:00 (объектом)', '23:30', { is_open: true, open: '18:00', close: '02:00' }],
    ['12:00–01:00', '23:00', '12:00-01:00'],
    ['12:00–12:00 (сутки с открытия)', '23:30', '12:00-12:00'],
  ])('часы %s — бронь на %s принята', async (_label, time, hours) => {
    const bar = await barWith(hours);

    const res = await bookAs(bar.id, time);

    expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 201, code: undefined });
  });

  test.each([
    ['18:00–02:00', '01:00', 'ночной хвост — сессия вчерашнего дня', '18:00-02:00'],
    ['18:00–02:00', '17:30', 'до открытия', '18:00-02:00'],
    ['12:00–12:00', '11:30', 'до открытия', '12:00-12:00'],
    ['10:00–22:00', '22:00', 'минута закрытия', '10:00-22:00'],
  ])('часы %s — бронь на %s отклонена (%s)', async (_label, time, _why, hours) => {
    const bar = await barWith(hours);

    const res = await bookAs(bar.id, time);

    expect({ status: res.status, code: res.body.error?.code })
      .toEqual({ status: 400, code: 'TIME_OUTSIDE_HOURS' });
  });
});
