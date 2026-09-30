/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Время брони считается по часам Минска, а не по часам процесса.
 *
 * Гость бронирует дату и время по-минскому (колонки без пояса). Процесс на
 * проде живёт в UTC, в CI — в Europe/Minsk, и прежний createBooking считал
 * «сегодня», «сколько часов до брони» и срок подтверждения по часам процесса
 * (внешний обзор 23.09.2026, #35):
 *  - шаг 7: в 18:30 по Минску бронь на 17:00, которое уже прошло, сервер в UTC
 *    считал «через 1,5 ч» и принимал;
 *  - шаг 5: сутки начинались в 03:00 по Минску — с 00:00 до 03:00 «сегодня»
 *    было ещё вчерашним днём;
 *  - шаг 9: срок подтверждения писался JS Date в колонку без пояса, то есть
 *    стенкой процесса — под Минском на 3 часа позже.
 *
 * Как тесты видят это, не ожидая нужного часа:
 *  - «сейчас» для HTTP-тестов — живые часы, а время брони считается от
 *    минских часов, взятых через Intl (не тем SQL, который проверяется);
 *  - окно 00:00–03:00 по Минску — через внедрённые часы createBooking
 *    (третий аргумент `{ now }`; через HTTP до него не достать): фейковые
 *    таймеры jest не двигают NOW() в базе.
 * Под каким поясом что краснело на старом коде: шаги 5 и 7 — только под UTC
 * (пояс прода; отдельный шаг CI гоняет эти тесты под TZ=UTC), шаг 9 — только
 * под Europe/Minsk (основной прогон). Часы работы фикстуры — круглые сутки:
 * иначе «минуту назад» утром превращалось бы в TIME_OUTSIDE_HOURS.
 */

import request from 'supertest';
import app from '../../server.js';
import * as BookingService from '../../services/bookingService.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const ALL_DAY = { open: '00:00', close: '23:59' };
const ROUND_THE_CLOCK = {
  monday: ALL_DAY, tuesday: ALL_DAY, wednesday: ALL_DAY, thursday: ALL_DAY,
  friday: ALL_DAY, saturday: ALL_DAY, sunday: ALL_DAY,
};

const SETTINGS = { min_hours_before: 1, max_days_ahead: 7, confirmation_timeout_hours: 4 };

let est;
let guestId;
let guestToken;

const phone = () => `+37529${Math.floor(1000000 + Math.random() * 9000000)}`;

/** Дата и время по минским часам — независимо от пояса процесса и от SQL. */
const minsk = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
};

/** Минская дата через n суток от минского «сегодня» (арифметика календаря в UTC). */
const minskDatePlusDays = (days) => {
  const [y, m, d] = minsk(new Date()).date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const book = (fields) => request(app)
  .post('/api/v1/bookings')
  .set('Authorization', `Bearer ${guestToken}`)
  .send({ establishmentId: est.id, guestCount: 2, contactPhone: '+375291112233', ...fields });

const expiresAtUtc = async (bookingId) => {
  // AT TIME ZONE 'UTC' — timestamptz разбирается node-pg верно в любом поясе;
  // сырая колонка без пояса прочиталась бы по часам процесса.
  const { rows } = await query(
    `SELECT expires_at AT TIME ZONE 'UTC' AS expires_at FROM bookings WHERE id = $1`,
    [bookingId],
  );
  return rows[0].expires_at;
};

beforeAll(async () => {
  const owner = await createUserAndGetTokens({
    email: 'tz-owner@test.com', phone: phone(), password: 'Partner123!@#', name: 'Owner', role: 'partner',
  });
  const guest = await createUserAndGetTokens({
    email: 'tz-guest@test.com', phone: phone(), password: 'Guest123!@#', name: 'Гость', role: 'user',
  });
  guestId = guest.user.id;
  guestToken = guest.accessToken;

  est = await createTestEstablishment(owner.user.id);
  await query('UPDATE establishments SET working_hours = $2, booking_enabled = true WHERE id = $1', [
    est.id, JSON.stringify(ROUND_THE_CLOCK),
  ]);
  await query(
    `INSERT INTO booking_settings (establishment_id, is_enabled, min_hours_before, max_days_ahead, confirmation_timeout_hours)
     VALUES ($1, true, $2, $3, $4)`,
    [est.id, SETTINGS.min_hours_before, SETTINGS.max_days_ahead, SETTINGS.confirmation_timeout_hours],
  );
});

afterEach(async () => {
  // Лимиты гостя (2 активных, 1 на заведение) не должны переходить между тестами.
  await query('DELETE FROM bookings');
});

afterAll(async () => {
  await clearAllData();
});

describe('POST /bookings — по живым часам', () => {
  test('бронь на минуту назад по Минску — отказ TOO_LATE (в UTC старый код считал «через 3 ч»)', async () => {
    const now = new Date();
    const today = minsk(now);
    const minuteAgo = minsk(new Date(now.getTime() - 60 * 1000));
    // Сразу после полуночи «минуту назад» — уже вчера: берём полночь сегодня,
    // она тоже в прошлом, и дата та же.
    const slot = minuteAgo.date === today.date ? minuteAgo : { date: today.date, time: '00:00' };

    const res = await book(slot);

    expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 400, code: 'TOO_LATE' });
  });

  test('вчерашняя по Минску дата — INVALID_DATE', async () => {
    const res = await book({ date: minskDatePlusDays(-1), time: '12:00' });

    expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 400, code: 'INVALID_DATE' });
  });

  test('дальше max_days_ahead — DATE_TOO_FAR', async () => {
    const res = await book({ date: minskDatePlusDays(SETTINGS.max_days_ahead + 1), time: '12:00' });

    expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 400, code: 'DATE_TOO_FAR' });
  });

  test('бронь через 2 часа принята; срок подтверждения — сейчас + 4 ч при любом поясе процесса', async () => {
    const now = new Date();
    const res = await book(minsk(new Date(now.getTime() + 2 * 3600 * 1000)));

    expect(res.status).toBe(201);
    const expected = now.getTime() + SETTINGS.confirmation_timeout_hours * 3600 * 1000;
    const actual = (await expiresAtUtc(res.body.data.id)).getTime();
    // Минута — на время запроса. Ошибка, которую ловит тест, — ровно 3 часа.
    expect(Math.abs(actual - expected)).toBeLessThan(60 * 1000);
  });

  test('время и дата не в формате ЧЧ:ММ / ГГГГ-ММ-ДД — VALIDATION_ERROR, а не 500', async () => {
    for (const slot of [
      { date: minskDatePlusDays(1), time: '9:00' },
      { date: minskDatePlusDays(1), time: '24:00' },
      { date: '2026-02-30', time: '12:00' },
      { date: 'завтра', time: '12:00' },
    ]) {
      const res = await book(slot);
      expect({ slot, status: res.status, code: res.body.error?.code })
        .toEqual({ slot, status: 400, code: 'VALIDATION_ERROR' });
    }
  });
});

describe('createBooking — внедрённые часы: окно 00:00–03:00 по Минску', () => {
  // 23.09.2026 21:30 UTC = 24.09.2026 00:30 по Минску: UTC ещё во вчерашнем дне.
  const NOW = new Date('2026-09-23T21:30:00Z');
  const create = (date, time) => BookingService.createBooking(
    guestId,
    { establishmentId: est.id, date, time, guestCount: 2, contactPhone: '+375291112233' },
    { now: NOW },
  );
  const codeOf = (promise) => promise.then(() => 'CREATED', (error) => error.code);

  test('вчерашняя по Минску дата (сегодняшняя по UTC) — INVALID_DATE', async () => {
    expect(await codeOf(create('2026-09-23', '23:00'))).toBe('INVALID_DATE');
  });

  test('20 минут назад по Минску — TOO_LATE', async () => {
    expect(await codeOf(create('2026-09-24', '00:10'))).toBe('TOO_LATE');
  });

  test('граница min_hours_before: за 59 минут — TOO_LATE, ровно за час — принята', async () => {
    expect(await codeOf(create('2026-09-24', '01:29'))).toBe('TOO_LATE');
    expect(await codeOf(create('2026-09-24', '01:30'))).toBe('CREATED');
  });

  test('граница max_days_ahead считается от минского «сегодня»: +7 принята, +8 — DATE_TOO_FAR', async () => {
    expect(await codeOf(create('2026-10-01', '12:00'))).toBe('CREATED');
    await query('DELETE FROM bookings');
    expect(await codeOf(create('2026-10-02', '12:00'))).toBe('DATE_TOO_FAR');
  });

  test('срок подтверждения — внедрённое «сейчас» + 4 ч, до секунды', async () => {
    const booking = await create('2026-09-24', '12:00');

    expect((await expiresAtUtc(booking.id)).toISOString()).toBe('2026-09-24T01:30:00.000Z');
  });

  test('день недели — по минской дате: воскресенье 27.09 закрыто — CLOSED_DAY', async () => {
    await query('UPDATE establishments SET working_hours = $2 WHERE id = $1', [
      est.id, JSON.stringify({ ...ROUND_THE_CLOCK, sunday: { is_open: false } }),
    ]);
    try {
      expect(await codeOf(create('2026-09-27', '12:00'))).toBe('CLOSED_DAY');
      expect(await codeOf(create('2026-09-26', '12:00'))).toBe('CREATED');
    } finally {
      await query('UPDATE establishments SET working_hours = $2 WHERE id = $1', [
        est.id, JSON.stringify(ROUND_THE_CLOCK),
      ]);
    }
  });
});
