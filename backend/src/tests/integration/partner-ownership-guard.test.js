/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сторож владения: чужой партнёр на партнёрском маршруте, который принимает id
 * заведения (или id его дочернего объекта — акции, позиции меню, отзыва),
 * получает отказ, и в базе ничего не меняется.
 *
 * Почему сторож, а не тест на каждый маршрут отдельно. Маршруты проверяют
 * только роль (`authorize(['partner'])`), владение каждый сервис проверяет сам.
 * Так пять функций броней и чтение акций остались без проверки (внешний обзор
 * 23.09.2026, #1): партнёром становится любой, кто создал черновик, id
 * заведений публичны — чужие брони читались вместе с телефонами гостей и
 * отклонялись с уведомлением гостю, а тестов на эти маршруты не было ни одного.
 *
 * Три части.
 *  1. Полнота. Все маршруты пространства /api/v1/partner/ перечисляются из
 *     живого приложения, и каждый обязан стоять либо в таблице ROUTES, либо в
 *     EXCLUDED с причиной. Партнёрские маршруты вне этого пространства
 *     (ответы на отзывы) сверяются по исходникам: сколько раз роль partner
 *     названа в authorize([...]) каждого файла. Новый маршрут без
 *     классификации роняет тест — забыть его здесь молча нельзя.
 *  2. Отказ. На каждый маршрут таблицы уходит корректный запрос токеном чужого
 *     партнёра, и код ответа закреплён по маршруту. Запрос проходит валидацию:
 *     отказать обязана именно проверка владения, а не проверка формы.
 *  3. Ничего не изменилось. Отпечаток всех таблиц состояния (TEST_STATE_TABLES)
 *     до и после каждого запроса — и ещё раз в конце, после паузы: уведомления
 *     и аналитика пишутся после ответа («огнём и забыл»), и без ожидания
 *     утверждение «ничего не изменилось» проходило бы и на старом коде.
 *     У заведения-жертвы лежат просроченная бронь и истёкшая акция: чтение
 *     «лениво» переводит их в expired, и старый код делал это ещё до проверки
 *     владения, то есть по запросу чужого партнёра.
 *
 * Коды отказа в проекте не едины: 403 «нет доступа» и 404 «не найдено или нет
 * доступа». Данные не утекают ни при одном из них, и сторож закрепляет код
 * каждого маршрута как есть: 403 у шести маршрутов, исправленных 30.09.2026
 * (брони и чтение акций), как уже отвечают bookingService и мутации заведения.
 * Выравнивание остальных — отдельное решение (матрица прав, #44 обзора).
 *
 * Как выключить сторож, не изменив вывода прогона? Только вписав маршрут в
 * EXCLUDED — и тогда причина стоит рядом с правилом.
 */

import { readFileSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens, utcTimestamp } from '../utils/auth.js';
import { TEST_STATE_TABLES } from '../testTables.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = resolve(__dirname, '../../routes/v1');
const NAMESPACE = '/api/v1/partner/';

// ============================================================================
// Перечень маршрутов живого приложения (Express 4)
// ============================================================================

/**
 * Путь монтирования слоя `router.use(path, router)` — Express 4 хранит его
 * только регулярным выражением: '^\/a(?:\/([^/]+?))\/b\/?(?=\/|$)' с ключами
 * параметров (слэш перед параметром — внутри его группы, в классе символов —
 * без обратной косой). Параметры возвращаются как ':имя', остальное — как было.
 */
const mountPathOf = (layer) => {
  if (layer.regexp.fast_slash) return '';
  let keyIndex = 0;
  return layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?:(\\\/)?\(\[\^\\?\/\]\+\?\)\)/g, (_group, slash) => `${slash ? '/' : ''}:${layer.keys[keyIndex++].name}`)
    .replace(/\\\//g, '/');
};

/** «МЕТОД /полный/путь» всех маршрутов стека, вложенные роутеры — рекурсивно. */
const listRoutes = (stack, prefix = '') => stack.flatMap((layer) => {
  if (layer.route) {
    return Object.keys(layer.route.methods)
      .filter((method) => method !== '_all')
      .map((method) => `${method.toUpperCase()} ${prefix}${layer.route.path}`);
  }
  if (layer.name === 'router' && layer.handle && layer.handle.stack) {
    return listRoutes(layer.handle.stack, prefix + mountPathOf(layer));
  }
  return [];
});

// ============================================================================
// Классификация
// ============================================================================

/** Маршруты пространства /partner/ без чужого объекта в запросе — с причиной. */
const EXCLUDED = new Map([
  ['GET /api/v1/partner/establishments', 'список своих заведений — id не принимает'],
  ['POST /api/v1/partner/establishments', 'создание черновика — заведения ещё нет'],
  ['POST /api/v1/partner/media/upload', 'временная загрузка в папку самого пользователя, заведения нет'],
  ['GET /api/v1/partner/analytics/overview', 'сводка по своим заведениям — id не принимает'],
]);

/**
 * Файлы маршрутов, смонтированные в пространстве /partner/: их маршруты видит
 * перечень живого приложения. Во всех остальных файлах роль partner в
 * authorize([...]) встречается ровно столько раз, сколько указано здесь, и
 * каждый такой маршрут стоит в таблице.
 */
const NAMESPACE_FILES = new Set([
  'establishmentRoutes.js',
  'mediaRoutes.js',
  'tempMediaRoutes.js',
  'bookingSettingsRoutes.js',
  'bookingRoutes.js',
  'promotionRoutes.js',
  'partnerAnalyticsRoutes.js',
  'partnerMenuItemRoutes.js',
]);
const PARTNER_ROUTES_OUTSIDE_NAMESPACE = {
  'reviewRoutes.js': ['POST /api/v1/reviews/:id/response', 'DELETE /api/v1/reviews/:id/response'],
};

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Фикстуры жертвы: заполняются в beforeAll. */
const f = {};

/**
 * Каждый маршрут с чужим объектом: как сделать корректный запрос и чем обязан
 * ответить чужому партнёру. `code` — поле error.code ответа.
 */
const ROUTES = [
  // Карточка заведения
  { route: 'GET /api/v1/partner/establishments/:id', url: () => `/api/v1/partner/establishments/${f.est}`, status: 404, code: 'ESTABLISHMENT_NOT_FOUND' },
  { route: 'PUT /api/v1/partner/establishments/:id', url: () => `/api/v1/partner/establishments/${f.est}`, body: { description: 'Правка чужим партнёром' }, status: 403, code: 'FORBIDDEN' },
  { route: 'POST /api/v1/partner/establishments/:id/submit', url: () => `/api/v1/partner/establishments/${f.est}/submit`, status: 403, code: 'FORBIDDEN' },
  { route: 'POST /api/v1/partner/establishments/:id/suspend', url: () => `/api/v1/partner/establishments/${f.est}/suspend`, status: 403, code: 'FORBIDDEN' },
  { route: 'POST /api/v1/partner/establishments/:id/resume', url: () => `/api/v1/partner/establishments/${f.est}/resume`, status: 403, code: 'FORBIDDEN' },
  { route: 'DELETE /api/v1/partner/establishments/:id', url: () => `/api/v1/partner/establishments/${f.est}`, status: 403, code: 'FORBIDDEN' },
  { route: 'GET /api/v1/partner/establishments/:id/menu-items', url: () => `/api/v1/partner/establishments/${f.est}/menu-items`, status: 404, code: 'ESTABLISHMENT_NOT_FOUND' },
  { route: 'POST /api/v1/partner/establishments/:id/retry-ocr', url: () => `/api/v1/partner/establishments/${f.est}/retry-ocr`, status: 404, code: 'ESTABLISHMENT_NOT_FOUND' },
  // Фото и меню-файлы
  { route: 'POST /api/v1/partner/establishments/:id/media', url: () => `/api/v1/partner/establishments/${f.est}/media`, upload: { field: 'file', type: 'interior' }, status: 404, code: 'ESTABLISHMENT_NOT_FOUND' },
  { route: 'GET /api/v1/partner/establishments/:id/media', url: () => `/api/v1/partner/establishments/${f.est}/media`, status: 404, code: 'ESTABLISHMENT_NOT_FOUND' },
  { route: 'PUT /api/v1/partner/establishments/:id/media/:mediaId', url: () => `/api/v1/partner/establishments/${f.est}/media/${f.media}`, body: { caption: 'Подпись чужим партнёром' }, status: 404, code: 'ESTABLISHMENT_NOT_FOUND' },
  { route: 'DELETE /api/v1/partner/establishments/:id/media/:mediaId', url: () => `/api/v1/partner/establishments/${f.est}/media/${f.media}`, status: 404, code: 'ESTABLISHMENT_NOT_FOUND' },
  // Настройки броней
  { route: 'GET /api/v1/partner/booking-settings/:establishmentId', url: () => `/api/v1/partner/booking-settings/${f.est}`, status: 403, code: 'FORBIDDEN' },
  { route: 'POST /api/v1/partner/booking-settings/:establishmentId/activate', url: () => `/api/v1/partner/booking-settings/${f.est}/activate`, body: {}, status: 403, code: 'FORBIDDEN' },
  { route: 'PUT /api/v1/partner/booking-settings/:establishmentId', url: () => `/api/v1/partner/booking-settings/${f.est}`, body: { max_guests_per_booking: 8 }, status: 403, code: 'FORBIDDEN' },
  { route: 'POST /api/v1/partner/booking-settings/:establishmentId/deactivate', url: () => `/api/v1/partner/booking-settings/${f.est}/deactivate`, status: 403, code: 'FORBIDDEN' },
  // Брони — исправлено 30.09.2026
  { route: 'GET /api/v1/partner/bookings/:establishmentId', url: () => `/api/v1/partner/bookings/${f.est}`, status: 403, code: 'FORBIDDEN' },
  { route: 'PUT /api/v1/partner/bookings/:establishmentId/:bookingId/confirm', url: () => `/api/v1/partner/bookings/${f.est}/${f.pendingBooking}/confirm`, status: 403, code: 'FORBIDDEN' },
  { route: 'PUT /api/v1/partner/bookings/:establishmentId/:bookingId/decline', url: () => `/api/v1/partner/bookings/${f.est}/${f.pendingBooking}/decline`, body: { reason: 'Мест нет' }, status: 403, code: 'FORBIDDEN' },
  { route: 'PUT /api/v1/partner/bookings/:establishmentId/:bookingId/no-show', url: () => `/api/v1/partner/bookings/${f.est}/${f.confirmedBooking}/no-show`, status: 403, code: 'FORBIDDEN' },
  { route: 'PUT /api/v1/partner/bookings/:establishmentId/:bookingId/complete', url: () => `/api/v1/partner/bookings/${f.est}/${f.confirmedBooking}/complete`, status: 403, code: 'FORBIDDEN' },
  // Акции
  { route: 'POST /api/v1/partner/promotions', url: () => '/api/v1/partner/promotions', body: () => ({ establishment_id: f.est, title: 'Акция чужого партнёра' }), status: 404, code: 'ESTABLISHMENT_NOT_FOUND' },
  { route: 'GET /api/v1/partner/promotions/establishment/:establishmentId', url: () => `/api/v1/partner/promotions/establishment/${f.est}`, status: 403, code: 'FORBIDDEN' },
  { route: 'PATCH /api/v1/partner/promotions/:id', url: () => `/api/v1/partner/promotions/${f.promotion}`, body: { title: 'Правка чужим партнёром' }, status: 404, code: 'PROMOTION_NOT_FOUND' },
  { route: 'DELETE /api/v1/partner/promotions/:id', url: () => `/api/v1/partner/promotions/${f.promotion}`, status: 404, code: 'PROMOTION_NOT_FOUND' },
  // Аналитика — id заведения в строке запроса
  { route: 'GET /api/v1/partner/analytics/trends', url: () => `/api/v1/partner/analytics/trends?establishment_id=${f.est}`, status: 404, code: 'NOT_FOUND' },
  { route: 'GET /api/v1/partner/analytics/ratings', url: () => `/api/v1/partner/analytics/ratings?establishment_id=${f.est}`, status: 404, code: 'NOT_FOUND' },
  // Позиция меню
  { route: 'PATCH /api/v1/partner/menu-items/:id', url: () => `/api/v1/partner/menu-items/${f.menuItem}`, body: { item_name: 'Блюдо чужого партнёра' }, status: 404, code: 'MENU_ITEM_NOT_FOUND' },
  // Ответ заведения на отзыв — вне пространства /partner/
  { route: 'POST /api/v1/reviews/:id/response', url: () => `/api/v1/reviews/${f.review}/response`, body: { response: 'Ответ от имени чужого заведения' }, status: 403, code: 'UNAUTHORIZED_PARTNER_RESPONSE' },
  { route: 'DELETE /api/v1/reviews/:id/response', url: () => `/api/v1/reviews/${f.reviewWithResponse}/response`, status: 403, code: 'UNAUTHORIZED_PARTNER_RESPONSE' },
];

// ============================================================================
// Отпечаток базы
// ============================================================================

/** Число строк и хеш содержимого каждой таблицы состояния. */
const fingerprint = async () => {
  const entries = [];
  for (const table of TEST_STATE_TABLES) {
    const { rows } = await query(
      `SELECT count(*)::int AS n,
              md5(COALESCE(string_agg(t::text, '|' ORDER BY t::text), '')) AS h
         FROM ${table} t`,
    );
    entries.push([table, `${rows[0].n}:${rows[0].h}`]);
  }
  return Object.fromEntries(entries);
};

let attackerToken;
let baseline;

const phone = () => `+37529${Math.floor(1000000 + Math.random() * 9000000)}`;

beforeAll(async () => {
  const victim = await createUserAndGetTokens({
    email: 'guard-victim-partner@test.com', phone: phone(), password: 'Partner123!@#', name: 'Victim Partner', role: 'partner',
  });
  const attacker = await createUserAndGetTokens({
    email: 'guard-attacker-partner@test.com', phone: phone(), password: 'Attack123!@#', name: 'Attacker', role: 'partner',
  });
  const guest = await createUserAndGetTokens({
    email: 'guard-guest@test.com', phone: phone(), password: 'Guest123!@#', name: 'Гость Первый', role: 'user',
  });
  const guest2 = await createUserAndGetTokens({
    email: 'guard-guest2@test.com', phone: phone(), password: 'Guest123!@#', name: 'Гость Второй', role: 'user',
  });
  attackerToken = attacker.accessToken;

  // У нападающего своё заведение: он настоящий партнёр, а не пользователь с ролью.
  await createTestEstablishment(attacker.user.id);

  const est = await createTestEstablishment(victim.user.id);
  f.est = est.id;

  await query(
    `INSERT INTO booking_settings (establishment_id, is_enabled) VALUES ($1, true)`,
    [f.est],
  );
  await query('UPDATE establishments SET booking_enabled = true WHERE id = $1', [f.est]);

  const tomorrow = utcTimestamp(new Date(Date.now() + 24 * 3600 * 1000));
  const booking = async (status, expiresAt) => {
    const { rows } = await query(
      `INSERT INTO bookings (establishment_id, user_id, booking_date, booking_time, guest_count,
                             comment, contact_phone, status, expires_at)
       VALUES ($1, $2, CURRENT_DATE + 2, '19:00', 2, 'Годовщина, столик у окна', '+375291112233', $3, $4)
       RETURNING id`,
      [f.est, guest.user.id, status, expiresAt],
    );
    return rows[0].id;
  };
  f.pendingBooking = await booking('pending', tomorrow);
  f.confirmedBooking = await booking('confirmed', tomorrow);
  // Срок подтверждения прошёл: чтение броней заведения «лениво» переведёт её в
  // expired. Должно — только по запросу владельца.
  await booking('pending', utcTimestamp(new Date(Date.now() - 3600 * 1000)));

  const promo = await query(
    `INSERT INTO promotions (establishment_id, title, status, valid_until)
     VALUES ($1, 'Скидка 10%', 'active', CURRENT_DATE + 7) RETURNING id`,
    [f.est],
  );
  f.promotion = promo.rows[0].id;
  // Истекла вчера, но ещё active: чтение акций заведения переведёт её в expired.
  await query(
    `INSERT INTO promotions (establishment_id, title, status, valid_from, valid_until)
     VALUES ($1, 'Истёкшая акция', 'active', CURRENT_DATE - 10, CURRENT_DATE - 1)`,
    [f.est],
  );

  const media = await query(
    `INSERT INTO establishment_media (establishment_id, type, url, file_type)
     VALUES ($1, 'menu', 'https://res.cloudinary.com/test/image/upload/guard-menu', 'image') RETURNING id`,
    [f.est],
  );
  f.media = media.rows[0].id;
  const item = await query(
    `INSERT INTO menu_items (establishment_id, media_id, item_name) VALUES ($1, $2, 'Драники') RETURNING id`,
    [f.est, f.media],
  );
  f.menuItem = item.rows[0].id;

  const review = await query(
    `INSERT INTO reviews (user_id, establishment_id, rating, content, text)
     VALUES ($1, $2, 4, 'Хорошее место', 'Хорошее место') RETURNING id`,
    [guest.user.id, f.est],
  );
  f.review = review.rows[0].id;
  const answered = await query(
    `INSERT INTO reviews (user_id, establishment_id, rating, content, text,
                          partner_response, partner_response_at, partner_responder_id)
     VALUES ($1, $2, 5, 'Отлично', 'Отлично', 'Спасибо!', NOW(), $3) RETURNING id`,
    [guest2.user.id, f.est, victim.user.id],
  );
  f.reviewWithResponse = answered.rows[0].id;

  baseline = await fingerprint();
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// 1. Полнота
// ============================================================================

describe('полнота: каждый партнёрский маршрут классифицирован', () => {
  test('перечень маршрутов видит вложенные роутеры и параметры монтирования (якорь на своём приложении)', () => {
    // Якорь не зависит от проверяемого приложения: если разбор путей
    // монтирования сломается, этот тест покраснеет, а не перечень ниже
    // молча опустеет.
    const inner = express.Router({ mergeParams: true });
    inner.get('/', () => {});
    inner.delete('/:mediaId', () => {});
    const outer = express.Router();
    outer.put('/:id', () => {});
    outer.use('/:id/media', inner);
    const probe = express();
    probe.use('/api/v1/partner/things', outer);

    expect(listRoutes(probe._router.stack).sort()).toEqual([
      'DELETE /api/v1/partner/things/:id/media/:mediaId',
      'GET /api/v1/partner/things/:id/media/',
      'PUT /api/v1/partner/things/:id',
    ]);
  });

  test('маршруты пространства /partner/ — ровно таблица плюс исключения', () => {
    const live = listRoutes(app._router.stack)
      .map((route) => route.replace(/(\S)\/$/, '$1'))
      .filter((route) => route.split(' ')[1].startsWith(NAMESPACE));
    const classified = [
      ...ROUTES.map((r) => r.route).filter((route) => route.split(' ')[1].startsWith(NAMESPACE)),
      ...EXCLUDED.keys(),
    ];

    expect([...new Set(live)].sort()).toEqual([...new Set(classified)].sort());
  });

  test('вне пространства /partner/ роль partner названа только у маршрутов из таблицы', () => {
    const counted = {};
    for (const file of readdirSync(ROUTES_DIR).filter((name) => name.endsWith('.js'))) {
      if (NAMESPACE_FILES.has(file)) continue;
      const source = readFileSync(resolve(ROUTES_DIR, file), 'utf8');
      const hits = (source.match(/authorize\(\s*\[[^\]]*['"]partner['"][^\]]*\]\s*\)/g) || []).length;
      if (hits > 0) counted[file] = hits;
    }
    const expected = Object.fromEntries(
      Object.entries(PARTNER_ROUTES_OUTSIDE_NAMESPACE).map(([file, routes]) => [file, routes.length]),
    );

    expect(counted).toEqual(expected);
    for (const route of Object.values(PARTNER_ROUTES_OUTSIDE_NAMESPACE).flat()) {
      expect(ROUTES.map((r) => r.route)).toContain(route);
    }
  });

  test('исключения и таблица называют только существующие маршруты', () => {
    const live = new Set(listRoutes(app._router.stack).map((route) => route.replace(/(\S)\/$/, '$1')));
    for (const route of [...ROUTES.map((r) => r.route), ...EXCLUDED.keys()]) {
      expect(live.has(route) ? route : `нет маршрута: ${route}`).toBe(route);
    }
  });
});

// ============================================================================
// 2–3. Отказ, и ничего не изменилось
// ============================================================================

const send = (row) => {
  const method = row.route.split(' ')[0].toLowerCase();
  let req = request(app)[method](row.url()).set('Authorization', `Bearer ${attackerToken}`);
  if (row.upload) {
    req = req.field('type', row.upload.type)
      .attach(row.upload.field, PNG_1X1, { filename: 'guard.png', contentType: 'image/png' });
  } else if (row.body !== undefined) {
    req = req.send(typeof row.body === 'function' ? row.body() : row.body);
  }
  return req;
};

describe('чужой партнёр получает отказ, и база не меняется', () => {
  test.each(ROUTES.map((row) => [row.route, row]))('%s', async (_label, row) => {
    const before = await fingerprint();
    const res = await send(row);
    const after = await fingerprint();

    expect({ status: res.status, code: res.body?.error?.code })
      .toEqual({ status: row.status, code: row.code });
    // Отказ сервиса, а не «маршрут не найден»: у обоих бывает код NOT_FOUND.
    expect(String(res.body?.message)).not.toMatch(/^Route /);
    // В ответе нет данных жертвы (телефон гостя из брони, текст акции).
    expect(JSON.stringify(res.body)).not.toMatch(/375291112233|Скидка 10%|Годовщина/);
    expect(after).toEqual(before);
  });

  test('после паузы на хвосты «огнём и забыл» база совпадает с исходной', async () => {
    // Уведомления и счётчики аналитики пишутся уже после ответа. Пауза с
    // запасом: на старом коде хвост ложится за миллисекунды.
    await new Promise((resolveWait) => setTimeout(resolveWait, 750));

    expect(await fingerprint()).toEqual(baseline);
  });
});
