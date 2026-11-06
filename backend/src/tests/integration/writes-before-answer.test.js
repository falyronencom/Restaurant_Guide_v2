/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Запись в базу идёт до ответа сервера, а её сбой ответ не портит
 * (нитка «Хвосты записи», Директива 2; журнал решений CAT-D-3.1).
 *
 * Запись без ожидания переживает свой запрос: при выкатке теряется, в тестах
 * сталкивается со следующим шагом. Здесь на каждое место — проверка на настоящем
 * запросе: нужный оператор висит на промисе, который тест отпускает руками, и
 * ответ за это время не приходит. Чтение после ответа такого не докажет: при
 * холодном пуле оно само ждёт соединение, и хвост успевает (память
 * feedback_fire_and_forget_tail_family). Сбой подменён на уровне пула: писатели
 * счётчиков и оценки глотают ошибку сами, и подмена повыше такой сбой не покажет.
 *
 * Два места загрузки файла (`mediaService`) проверены в media.test.js: там
 * подменено облако.
 */

import { jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { pool } from '../../config/database.js';
import redisClient, { connectRedis, disconnectRedis } from '../../config/redis.js';
import logger from '../../utils/logger.js';
import { clearAllData, clearTableTree, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens, utcTimestamp } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
} from '../utils/adminTestHelpers.js';
import { testEstablishments } from '../fixtures/establishments.js';
import * as NotificationModel from '../../models/notificationModel.js';

/** Сколько ответ обязан молчать, пока запись висит. Хвост уложился бы в миллисекунды. */
const SILENCE_MS = 250;

const realQuery = pool.query.bind(pool);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const notificationInsert = (text) => text.includes('INSERT INTO notifications');
const analyticsInsert = (column) => (text) => text.includes('INSERT INTO establishment_analytics') && text.includes(column);
const ocrInsert = (text) => text.includes('INSERT INTO ocr_jobs');
const scoreWrite = (text) => text.startsWith('UPDATE establishments SET base_score');

/** Пропускает всё, кроме запросов `matches`: с ними поступает `onWrite`. */
const intercept = (matches, onWrite) => jest.spyOn(pool, 'query').mockImplementation((text, ...rest) => (
  typeof text === 'string' && matches(text)
    ? onWrite(() => realQuery(text, ...rest))
    : realQuery(text, ...rest)
));

/**
 * Держит запись `matches`, пока тест её не отпустит, и проверяет, что ответ всё
 * это время не приходит. Возвращает ответ, пришедший после записи.
 */
const answerAfterWrite = async (matches, send) => {
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  let markReached;
  const reached = new Promise((resolve) => { markReached = resolve; });
  intercept(matches, async (write) => {
    markReached();
    await released;
    return write();
  });

  let answered = false;
  const pending = Promise.resolve(send()).then((response) => {
    answered = true;
    return response;
  });

  try {
    // Ответ раньше записи — тоже провал, а не зависание до таймаута теста: запись
    // могла и не начаться (другой запрос, отказ проверки).
    await Promise.race([reached, pending]);
    await sleep(SILENCE_MS);
    expect(answered).toBe(false);
  } finally {
    release();
  }
  return pending;
};

/** Запись `matches` падает. */
const failWrite = (matches) => intercept(matches, async () => {
  throw new Error('write failed');
});

const errorLine = () => jest.spyOn(logger, 'error').mockImplementation(() => logger);

const countRows = async (sql, params) => (await query(sql, params)).rows[0].n;

const notificationsAbout = (establishmentId, type) => countRows(
  'SELECT count(*)::int AS n FROM notifications WHERE establishment_id = $1 AND type = $2',
  [establishmentId, type],
);

const ocrJobsOf = (establishmentId) => countRows(
  'SELECT count(*)::int AS n FROM ocr_jobs WHERE establishment_id = $1',
  [establishmentId],
);

const phone = () => `+37529${Math.floor(1000000 + Math.random() * 9000000)}`;

const person = (role, name) => createUserAndGetTokens({
  email: `writes-${randomUUID()}@test.com`, phone: phone(), password: 'Person123!@#', name, role,
});

const as = (token, method, url) => request(app)[method](`/api/v1${url}`)
  .set('Authorization', `Bearer ${token}`);

let partner;
let guest;
let admin;
let est;

beforeAll(async () => {
  partner = await person('partner', 'Партнёр');
  guest = await person('user', 'Гость');
  admin = await createAdminAndGetToken();
});

beforeEach(async () => {
  await clearTableTree('establishments');
  est = await createTestEstablishment(partner.user.id);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Брони
// ============================================================================

describe('брони', () => {
  /** Минская дата через двое суток: в пределах условий ниже и при любом часе запуска. */
  const bookingDate = () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Minsk', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 2)).toISOString().slice(0, 10);
  };

  const book = () => as(guest.accessToken, 'post', '/bookings').send({
    establishmentId: est.id,
    date: bookingDate(),
    time: '15:00',
    guestCount: 2,
    contactPhone: '+375291112233',
  });

  const bookingOf = async (status) => (await query(
    `INSERT INTO bookings (establishment_id, user_id, booking_date, booking_time, guest_count,
                           contact_phone, status, expires_at)
     VALUES ($1, $2, CURRENT_DATE + 1, '19:00', 2, '+375291112233', $3, $4)
     RETURNING id`,
    [est.id, guest.user.id, status, utcTimestamp(new Date(Date.now() + 86400000))],
  )).rows[0].id;

  const partnerAction = (bookingId, action) => as(
    partner.accessToken,
    'put',
    `/partner/bookings/${est.id}/${bookingId}/${action}`,
  );

  beforeEach(async () => {
    await query('UPDATE establishments SET booking_enabled = true WHERE id = $1', [est.id]);
    await query(
      `INSERT INTO booking_settings (establishment_id, is_enabled, max_guests_per_booking,
         max_days_ahead, min_hours_before, confirmation_timeout_hours)
       VALUES ($1, true, 6, 14, 3, 2)`,
      [est.id],
    );
  });

  test('новая бронь: ответ после счётчика заявок', async () => {
    const response = await answerAfterWrite(analyticsInsert('booking_request_count'), book);
    expect(response.status).toBe(201);
  });

  test('новая бронь: ответ после уведомления партнёру', async () => {
    const response = await answerAfterWrite(notificationInsert, book);
    expect(response.status).toBe(201);
    expect(await notificationsAbout(est.id, 'booking_received')).toBe(1);
  });

  test('подтверждение: ответ после счётчика подтверждений', async () => {
    const id = await bookingOf('pending');
    const response = await answerAfterWrite(
      analyticsInsert('booking_confirmed_count'),
      () => partnerAction(id, 'confirm'),
    );
    expect(response.status).toBe(200);
  });

  test('подтверждение: ответ после уведомления гостю', async () => {
    const id = await bookingOf('pending');
    const response = await answerAfterWrite(notificationInsert, () => partnerAction(id, 'confirm'));
    expect(response.status).toBe(200);
    expect(await notificationsAbout(est.id, 'booking_confirmed')).toBe(1);
  });

  test('отказ: ответ после уведомления гостю', async () => {
    const id = await bookingOf('pending');
    const response = await answerAfterWrite(
      notificationInsert,
      () => partnerAction(id, 'decline').send({ reason: 'Мест нет' }),
    );
    expect(response.status).toBe(200);
    expect(await notificationsAbout(est.id, 'booking_declined')).toBe(1);
  });

  test('отмена гостем: ответ после уведомления партнёру', async () => {
    const id = await bookingOf('confirmed');
    const response = await answerAfterWrite(
      notificationInsert,
      () => as(guest.accessToken, 'put', `/bookings/${id}/cancel`),
    );
    expect(response.status).toBe(200);
    expect(await notificationsAbout(est.id, 'booking_cancelled')).toBe(1);
  });

  test('сбой счётчика и уведомления: гость получает обычный ответ, бронь есть, ошибки в журнале', async () => {
    const line = errorLine();
    failWrite((text) => notificationInsert(text) || analyticsInsert('booking_request_count')(text));

    const response = await book();

    expect(response.status).toBe(201);
    expect(await countRows('SELECT count(*)::int AS n FROM bookings WHERE establishment_id = $1', [est.id])).toBe(1);
    expect(line).toHaveBeenCalledWith(
      'Error tracking booking request in analytics',
      expect.objectContaining({ establishmentId: est.id, error: 'write failed' }),
    );
    expect(line).toHaveBeenCalledWith(
      'Failed to create booking received notification',
      expect.objectContaining({ establishmentId: est.id, error: 'write failed' }),
    );
  });
});

// ============================================================================
// Отзывы
// ============================================================================

describe('отзывы', () => {
  const postReview = () => as(guest.accessToken, 'post', '/reviews').send({
    establishmentId: est.id,
    rating: 5,
    content: 'Очень понравилось: вкусно, быстро и уютно.',
  });

  const setVisible = (reviewId, isVisible) => as(admin.accessToken, 'post', `/admin/reviews/${reviewId}/visibility`)
    .send({ is_visible: isVisible });

  const hideBatch = (reviewIds) => as(admin.accessToken, 'post', '/admin/reviews/hide-batch')
    .send({ review_ids: reviewIds, reason: 'Проверка' });

  test('новый отзыв: ответ после уведомления партнёру', async () => {
    const response = await answerAfterWrite(notificationInsert, postReview);
    expect(response.status).toBe(201);
    expect(await notificationsAbout(est.id, 'new_review')).toBe(1);
  });

  test('ответ партнёра: ответ после уведомления автору', async () => {
    const review = await createTestReview(guest.user.id, est.id);
    const response = await answerAfterWrite(
      notificationInsert,
      () => as(partner.accessToken, 'post', `/reviews/${review.id}/response`)
        .send({ response: 'Спасибо, что зашли к нам!' }),
    );
    expect(response.status).toBe(200);
    expect(await notificationsAbout(est.id, 'partner_response')).toBe(1);
  });

  test('скрытие: ответ после уведомления автору', async () => {
    const review = await createTestReview(guest.user.id, est.id);
    const response = await answerAfterWrite(notificationInsert, () => setVisible(review.id, false));
    expect(response.status).toBe(200);
    expect(await notificationsAbout(est.id, 'review_hidden')).toBe(1);
  });

  test('удаление: ответ после уведомления автору', async () => {
    const review = await createTestReview(guest.user.id, est.id);
    const response = await answerAfterWrite(
      notificationInsert,
      () => as(admin.accessToken, 'post', `/admin/reviews/${review.id}/delete`).send({ reason: 'Проверка' }),
    );
    expect(response.status).toBe(200);
    expect(await notificationsAbout(est.id, 'review_deleted')).toBe(1);
  });

  test('пакет: ответ после уведомлений авторам', async () => {
    const reviews = [await createTestReview(guest.user.id, est.id), await createTestReview(null, est.id)];
    const response = await answerAfterWrite(notificationInsert, () => hideBatch(reviews.map((r) => r.id)));
    expect(response.status).toBe(200);
    expect(await notificationsAbout(est.id, 'review_hidden')).toBe(2);
  });

  test('пакет пишет уведомления одним оператором и после COMMIT: отзывы уже скрыты', async () => {
    const reviews = [
      await createTestReview(guest.user.id, est.id),
      await createTestReview(null, est.id),
      await createTestReview(null, est.id),
    ];
    const seen = [];
    intercept(notificationInsert, async (write) => {
      // Своим соединением: незакоммиченное скрытие такое чтение бы не увидело.
      seen.push((await realQuery(
        'SELECT count(*)::int AS n FROM reviews WHERE establishment_id = $1 AND is_visible = false',
        [est.id],
      )).rows[0].n);
      return write();
    });

    await hideBatch(reviews.map((r) => r.id)).expect(200);

    expect(seen).toEqual([3]);
    expect(await notificationsAbout(est.id, 'review_hidden')).toBe(3);
  });

  test('пакет: лента одного автора листается без повторов и пропусков, хотя время у строк одно', async () => {
    const others = [];
    for (let i = 0; i < 24; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      others.push(await createTestEstablishment(partner.user.id));
    }
    const reviews = [];
    for (const place of [est, ...others]) {
      // eslint-disable-next-line no-await-in-loop
      reviews.push(await createTestReview(guest.user.id, place.id));
    }
    await hideBatch(reviews.map((r) => r.id)).expect(200);

    const page = async (n) => (await as(guest.accessToken, 'get', `/notifications?page=${n}&limit=10&is_read=false`).expect(200))
      .body.data.items.map((item) => item.review_id);
    const seen = [...await page(1), ...await page(2), ...await page(3)];

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  describe('пакет говорит то же, что одиночное скрытие', () => {
    const noticeOf = async (reviewId) => (await query(
      `SELECT user_id, type, title, message, is_read FROM notifications WHERE review_id = $1`,
      [reviewId],
    )).rows;

    test.each([
      ['обычное имя', 'Кафе «Ромашка»', 'Ваш отзыв на «Кафе «Ромашка»» скрыт модератором'],
      ['пустое имя — запасное', '', 'Ваш отзыв на «Заведение» скрыт модератором'],
      ['имя похоже на подстановку', 'Кафе {name}', 'Ваш отзыв на «Кафе {name}» скрыт модератором'],
    ])('%s', async (_, name, expected) => {
      const other = await createTestEstablishment(partner.user.id);
      await query('UPDATE establishments SET name = $1 WHERE id = ANY($2::uuid[])', [name, [est.id, other.id]]);
      const single = await createTestReview(guest.user.id, est.id);
      const inBatch = await createTestReview(guest.user.id, other.id);

      await setVisible(single.id, false).expect(200);
      await hideBatch([inBatch.id]).expect(200);

      const [singleNotice] = await noticeOf(single.id);
      const [batchNotice] = await noticeOf(inBatch.id);
      expect(batchNotice).toEqual(singleNotice);
      expect(batchNotice).toEqual({
        user_id: guest.user.id,
        type: 'review_hidden',
        title: 'Отзыв скрыт модератором',
        message: expected,
        is_read: false,
      });
    });

    test('каждому автору — своё уведомление о своём отзыве, а уже скрытый отзыв молчит', async () => {
      const second = await person('user', 'Другой автор');
      const mine = await createTestReview(guest.user.id, est.id);
      const theirs = await createTestReview(second.user.id, est.id);
      const hiddenBefore = await createTestReview(null, est.id, { is_visible: false });

      await hideBatch([mine.id, theirs.id, hiddenBefore.id]).expect(200);

      expect((await noticeOf(mine.id)).map((n) => n.user_id)).toEqual([guest.user.id]);
      expect((await noticeOf(theirs.id)).map((n) => n.user_id)).toEqual([second.user.id]);
      expect(await noticeOf(hiddenBefore.id)).toEqual([]);
    });
  });

  test('сбой уведомления о новом отзыве: автор получает обычный ответ, отзыв есть, ошибка в журнале', async () => {
    const line = errorLine();
    failWrite(notificationInsert);

    const response = await postReview();

    expect(response.status).toBe(201);
    expect(await countRows('SELECT count(*)::int AS n FROM reviews WHERE establishment_id = $1', [est.id])).toBe(1);
    expect(line).toHaveBeenCalledWith(
      'Failed to create new review notification',
      expect.objectContaining({ establishmentId: est.id, error: 'write failed' }),
    );
  });

  test('сбой уведомлений пакета: скрытие не откатывается, ответ обычный, ошибка в журнале', async () => {
    const review = await createTestReview(guest.user.id, est.id);
    const line = errorLine();
    failWrite(notificationInsert);

    const response = await hideBatch([review.id]);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({ hidden: 1, changed: true }));
    expect((await query('SELECT is_visible FROM reviews WHERE id = $1', [review.id])).rows[0].is_visible).toBe(false);
    expect(line).toHaveBeenCalledWith(
      'Failed to create batch review moderation notifications',
      expect.objectContaining({ count: 1, error: 'write failed' }),
    );
  });
});

// ============================================================================
// Распознавание меню
// ============================================================================

describe('распознавание меню', () => {
  const menuPhoto = (i = 0, owner = partner) => `https://res.cloudinary.com/test/image/upload/c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/temp/${owner.user.id}/menu/p${i}?_a=BAMAMiRg0`;
  const menuPdf = () => `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${partner.user.id}/menu_pdf/a.pdf`;

  const createCard = (extra = {}, owner = partner) => as(owner.accessToken, 'post', '/partner/establishments')
    .send({ ...testEstablishments[0], name: `Карточка ${randomUUID()}`, ...extra });

  const insertMenuPhoto = async (establishmentId) => (await query(
    `INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary)
     VALUES ($1, 'menu', 'image', 'https://res.cloudinary.com/test/image/upload/v1/x.jpg',
             'https://res.cloudinary.com/test/t.jpg', 'https://res.cloudinary.com/test/p.jpg', 0, false)
     RETURNING id`,
    [establishmentId],
  )).rows[0].id;

  const moderate = (establishmentId) => as(admin.accessToken, 'post', `/admin/establishments/${establishmentId}/moderate`)
    .send({ action: 'approve' });

  test('создание карточки, фото меню: ответ после постановки', async () => {
    const response = await answerAfterWrite(ocrInsert, () => createCard({ menu_photos: [menuPhoto()] }));
    expect(response.status).toBe(201);
    expect(await ocrJobsOf(response.body.data.establishment.id)).toBe(1);
  });

  test('создание карточки, PDF меню: ответ после постановки', async () => {
    const response = await answerAfterWrite(ocrInsert, () => createCard({ menu_pdfs: [{ url: menuPdf() }] }));
    expect(response.status).toBe(201);
    expect(await ocrJobsOf(response.body.data.establishment.id)).toBe(1);
  });

  test('правка карточки, новый файл меню: ответ после постановки', async () => {
    const { id } = (await createCard().expect(201)).body.data.establishment;
    const response = await answerAfterWrite(
      ocrInsert,
      () => as(partner.accessToken, 'put', `/partner/establishments/${id}`).send({ menu_photos: [menuPhoto()] }),
    );
    expect(response.status).toBe(200);
    expect(await ocrJobsOf(id)).toBe(1);
  });

  test('одобрение модератором: ответ после постановки', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');
    await insertMenuPhoto(establishment.id);
    const response = await answerAfterWrite(ocrInsert, () => moderate(establishment.id));
    expect(response.status).toBe(200);
    expect(await ocrJobsOf(establishment.id)).toBe(1);
  });

  test.each([
    ['фото меню', () => ({ menu_photos: [menuPhoto()] }), 'Failed to enqueue OCR job for menu photo on registration finalize'],
    ['PDF меню', () => ({ menu_pdfs: [{ url: menuPdf() }] }), 'Failed to enqueue OCR job on registration finalize'],
  ])('сбой постановки при создании, %s: партнёр получает обычный ответ, карточка есть, ошибка в журнале', async (_, files, message) => {
    const line = errorLine();
    failWrite(ocrInsert);

    const response = await createCard(files());

    expect(response.status).toBe(201);
    expect(line).toHaveBeenCalledWith(
      message,
      expect.objectContaining({ establishmentId: response.body.data.establishment.id, error: 'write failed' }),
    );
  });

  test('сбой постановки при правке: партнёр получает обычный ответ, ошибка в журнале', async () => {
    const { id } = (await createCard().expect(201)).body.data.establishment;
    const line = errorLine();
    failWrite(ocrInsert);

    const response = await as(partner.accessToken, 'put', `/partner/establishments/${id}`)
      .send({ menu_photos: [menuPhoto()] });

    expect(response.status).toBe(200);
    expect(line).toHaveBeenCalledWith(
      'Failed to enqueue OCR job for menu media on update sync',
      expect.objectContaining({ establishmentId: id, error: 'write failed' }),
    );
  });

  test('сбой постановки при одобрении: карточка одобрена, ответ обычный, ошибка в журнале', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');
    await insertMenuPhoto(establishment.id);
    const line = errorLine();
    failWrite(ocrInsert);

    const response = await moderate(establishment.id);

    expect(response.status).toBe(200);
    expect((await query('SELECT status FROM establishments WHERE id = $1', [establishment.id])).rows[0].status).toBe('active');
    expect(line).toHaveBeenCalledWith(
      'Failed to backfill OCR jobs on approve',
      expect.objectContaining({ establishmentId: establishment.id, error: 'write failed' }),
    );
  });

  describe('Redis висит (половинное соединение): ответ ждёт в пределах потолка', () => {
    const CEILING_MS = 2000;
    /** Запас на всё, что карточка делает сверх очереди. */
    const LEEWAY_MS = 2000;
    const FILES = 30;

    /** isReady истинно, а ответа нет: каждая операция доходит до срока в 500 мс. */
    const hangRedis = () => jest.spyOn(redisClient, 'multi').mockImplementation(() => {
      const chain = {
        set: () => chain,
        incr: () => chain,
        incrBy: () => chain,
        exec: () => new Promise(() => {}),
      };
      return chain;
    });

    const positionsInQueueOrder = async (establishmentId) => (await query(
      `SELECT m.position
       FROM ocr_jobs j JOIN establishment_media m ON m.id = j.media_id
       WHERE j.establishment_id = $1
       ORDER BY j.created_at`,
      [establishmentId],
    )).rows.map((row) => row.position);

    const everyFile = Array.from({ length: FILES }, (_, i) => i);

    let owner;

    beforeAll(async () => {
      // Без подключения клиент не «готов», и счётчик выходит сразу, мимо зависания.
      expect(await connectRedis()).toBe(true);
    });

    afterAll(async () => {
      await disconnectRedis();
    });

    beforeEach(async () => {
      // Свой партнёр: лимит файлов считается в Redis и переживает повторный прогон.
      // С подтверждённой почтой: у неподтверждённой учётки лимит 10 заданий в сутки.
      owner = await person('partner', 'Партнёр с большим меню');
      await query('UPDATE users SET email_verified = true WHERE id = $1', [owner.user.id]);
    });

    /** Файлы за потолком уже идут в фоне: Redis ожил, и тест дожидается их до конца. */
    const untilQueued = async (establishmentId) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        if (await ocrJobsOf(establishmentId) === FILES) return;
        // eslint-disable-next-line no-await-in-loop
        await sleep(50);
      }
    };

    test('создание: карточка на 30 файлов отвечает в срок, остальные встают в очередь после ответа, по порядку', async () => {
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
      const hung = hangRedis();

      const startedAt = Date.now();
      const response = await createCard({ menu_photos: everyFile.map((i) => menuPhoto(i, owner)) }, owner);
      const elapsed = Date.now() - startedAt;

      expect(response.status).toBe(201);
      const { id } = response.body.data.establishment;
      expect(elapsed).toBeGreaterThanOrEqual(CEILING_MS);
      expect(elapsed).toBeLessThan(CEILING_MS + LEEWAY_MS);

      const atAnswer = await ocrJobsOf(id);
      expect(atAnswer).toBeLessThan(FILES);
      expect(warn).toHaveBeenCalledWith(
        'Menu files go on to the recognition queue in the background',
        expect.objectContaining({ establishmentId: id, total: FILES, waitedMs: CEILING_MS }),
      );

      hung.mockRestore();
      await untilQueued(id);
      expect(await positionsInQueueOrder(id)).toEqual(everyFile);
    }, 30000);

    test('правка: тот же потолок на новые файлы меню', async () => {
      const { id } = (await createCard({}, owner).expect(201)).body.data.establishment;
      const hung = hangRedis();

      const startedAt = Date.now();
      const response = await as(owner.accessToken, 'put', `/partner/establishments/${id}`)
        .send({ menu_photos: everyFile.map((i) => menuPhoto(i, owner)) });
      const elapsed = Date.now() - startedAt;

      expect(response.status).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(CEILING_MS);
      expect(elapsed).toBeLessThan(CEILING_MS + LEEWAY_MS);
      expect(await ocrJobsOf(id)).toBeLessThan(FILES);

      hung.mockRestore();
      await untilQueued(id);
      expect(await positionsInQueueOrder(id)).toEqual(everyFile);
    }, 30000);
  });
});

// ============================================================================
// Счётчики и оценка заполненности
// ============================================================================

describe('счётчики и оценка', () => {
  const addFavorite = () => as(guest.accessToken, 'post', '/favorites').send({ establishmentId: est.id });
  const removeFavorite = () => as(guest.accessToken, 'delete', `/favorites/${est.id}`);

  /** Правка, после которой оценка заведомо другая: сохранённая обнулена. */
  const saveCardWithStaleScore = async () => {
    await query('UPDATE establishments SET base_score = 0 WHERE id = $1', [est.id]);
    return () => as(partner.accessToken, 'put', `/partner/establishments/${est.id}`)
      .send({ description: 'Новое описание карточки для проверки оценки' });
  };

  const analyticsOf = async (column) => (await query(
    `SELECT ${column} AS value FROM establishment_analytics WHERE establishment_id = $1 AND date = CURRENT_DATE`,
    [est.id],
  )).rows[0]?.value;

  test('в избранное: ответ после счётчика', async () => {
    const response = await answerAfterWrite(analyticsInsert('favorite_count'), addFavorite);
    expect(response.status).toBe(201);
    expect(await analyticsOf('favorite_count')).toBe(1);
  });

  test('из избранного: ответ после счётчика', async () => {
    await addFavorite().expect(201);
    const response = await answerAfterWrite(analyticsInsert('favorite_count'), removeFavorite);
    expect(response.status).toBe(200);
    expect(await analyticsOf('favorite_count')).toBe(0);
  });

  test('правка карточки: ответ после записи оценки', async () => {
    const save = await saveCardWithStaleScore();
    const response = await answerAfterWrite(scoreWrite, save);
    expect(response.status).toBe(200);
    const { rows } = await query('SELECT base_score FROM establishments WHERE id = $1', [est.id]);
    expect(rows[0].base_score).toBe(response.body.data.establishment.base_score);
    expect(rows[0].base_score).toBeGreaterThan(0);
  });

  test('сбой счётчика избранного: гость получает обычный ответ, карточка в избранном, ошибка в журнале', async () => {
    const line = errorLine();
    failWrite(analyticsInsert('favorite_count'));

    const response = await addFavorite();

    expect(response.status).toBe(201);
    expect(await countRows('SELECT count(*)::int AS n FROM favorites WHERE establishment_id = $1', [est.id])).toBe(1);
    expect(line).toHaveBeenCalledWith(
      'Error tracking favorite in analytics',
      expect.objectContaining({ establishmentId: est.id, error: 'write failed' }),
    );
  });

  test('сбой записи оценки при правке: партнёр получает обычный ответ, ошибка в журнале', async () => {
    const save = await saveCardWithStaleScore();
    const line = errorLine();
    failWrite(scoreWrite);

    const response = await save();

    expect(response.status).toBe(200);
    expect(line).toHaveBeenCalledWith(
      'Error updating base score',
      expect.objectContaining({ establishmentId: est.id, error: 'write failed' }),
    );
  });
});

// ============================================================================
// Акция
// ============================================================================

describe('акция', () => {
  const createPromotion = (title = 'Скидка 20%') => as(partner.accessToken, 'post', '/partner/promotions')
    .field('establishment_id', est.id)
    .field('title', title)
    .field('description', 'Описание акции');

  const subscribe = (token) => as(token, 'post', '/favorites').send({ establishmentId: est.id }).expect(201);

  test('ответ после записи в ленту подписчиков', async () => {
    await subscribe(guest.accessToken);
    const response = await answerAfterWrite(notificationInsert, () => createPromotion());
    expect(response.status).toBe(201);
    expect(await notificationsAbout(est.id, 'promotion_new')).toBe(1);
  });

  test('лента пишется одним оператором на всех подписчиков', async () => {
    const others = [await person('user', 'Подписчик 1'), await person('user', 'Подписчик 2')];
    await subscribe(guest.accessToken);
    await Promise.all(others.map((other) => subscribe(other.accessToken)));
    const writes = [];
    intercept(notificationInsert, (write) => {
      writes.push(1);
      return write();
    });

    await createPromotion().expect(201);

    expect(writes).toHaveLength(1);
    expect(await notificationsAbout(est.id, 'promotion_new')).toBe(3);
  });

  test('строка в ленте та же, что пишет одиночная запись', async () => {
    await subscribe(guest.accessToken);
    await createPromotion('Скидка 20%').expect(201);
    const written = (await query(
      `SELECT * FROM notifications WHERE establishment_id = $1 AND type = 'promotion_new'`,
      [est.id],
    )).rows[0];

    const single = await NotificationModel.create({
      userId: guest.user.id,
      type: 'promotion_new',
      title: 'Новая акция',
      message: 'Новая акция в «Test Restaurant»: Скидка 20%',
      establishmentId: est.id,
    });
    const reference = (await query('SELECT * FROM notifications WHERE id = $1', [single.id])).rows[0];

    const shape = ({ id, created_at: createdAt, updated_at: updatedAt, ...rest }) => rest;
    expect(shape(written)).toEqual(shape(reference));
  });

  test('подписчик, выключивший уведомления, запись в ленте всё равно получает', async () => {
    await subscribe(guest.accessToken);
    await query(
      `INSERT INTO notification_preferences (user_id, reviews_push_enabled, promotions_push_enabled)
       VALUES ($1, false, false)
       ON CONFLICT (user_id) DO UPDATE SET promotions_push_enabled = false`,
      [guest.user.id],
    );

    await createPromotion().expect(201);

    expect(await notificationsAbout(est.id, 'promotion_new')).toBe(1);
  });

  test('сбой записи в ленту: партнёр получает обычный ответ, акция есть, ошибка в журнале', async () => {
    await subscribe(guest.accessToken);
    const line = errorLine();
    failWrite(notificationInsert);

    const response = await createPromotion();

    expect(response.status).toBe(201);
    expect(await countRows('SELECT count(*)::int AS n FROM promotions WHERE establishment_id = $1', [est.id])).toBe(1);
    expect(line).toHaveBeenCalledWith(
      'Failed to create promotion notifications',
      expect.objectContaining({ establishmentId: est.id, error: 'write failed' }),
    );
  });
});
