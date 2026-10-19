/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сторож контракта провода с мобильным приложением.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ.
 *
 * Приложение на устройстве пользователя между релизами не обновляется: iOS
 * ждёт совместного запуска, Android пересобирается по кабелю. Изменение формы
 * ответа доезжает до уже установленной сборки в тот же день, и разбор там
 * НЕ падает громко — он подставляет умолчание:
 *
 *   - пропал `access_token`  → пустая строка → вход «удался», а следующий
 *                              запрос получает 401 далеко от причины;
 *   - пропал `created_at`    → текущее время → уведомление навсегда
 *                              «Только что»;
 *   - переименован `totalPages` → единица → список замирает на первой
 *                              странице, кнопки «дальше» нет, ошибки нет;
 *   - переименован `establishments` / `reviews` → пустой список при живом
 *                              счётчике → экран говорит «ничего не найдено».
 *
 * Ни одно из этих состояний не отличимо от правды ни для гостя, ни для нас.
 * Жалоб не будет: экран выглядит исправным.
 *
 * Клиентская сторона каждого из этих случаев закреплена в
 * `mobile/test/models/*_contract_test.dart` — но те тесты ФИКСИРУЮТ поведение
 * разбора, а не замечают изменение сервера: переименуй здесь ключ, и они
 * останутся зелёными. Сигнал обязан звучать на той стороне, которая меняется.
 * Это и есть здесь.
 *
 * КАК ЧИТАТЬ ПАДЕНИЕ ЭТОГО ФАЙЛА.
 *
 * Красный тест здесь НЕ означает «сломан бэкенд». Он означает: «форма ответа
 * изменилась, и на устройствах, которые уже у людей, это проявится молча».
 * Дальше нужно решение, а не откат: либо ключ возвращают на место, либо
 * правку сопровождают пересборкой мобильного клиента, либо разбор в
 * приложении заранее учат новой форме. Список полей ниже — не украшение
 * проекции, а несущая конструкция чужого кода.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';

let partnerId;
let partnerToken;
let establishmentId;

const workingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
});

beforeAll(async () => {
  const partner = await createUserAndGetTokens(testUsers.partner);
  partnerId = partner.user.id;
  partnerToken = partner.accessToken;
});

beforeEach(async () => {
  await clearAllData();
  await query(
    'INSERT INTO users (id, email, password_hash, name, role, auth_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [partnerId, 'partner@test.com', 'hash', 'Partner', 'partner', 'email']
  );

  const inserted = await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Васильки', gen_random_uuid()::text, 'Описание', 'Минск', 'пр. Независимости, 43', 53.9023, 27.5619, ARRAY['Ресторан'], ARRAY['Народная'], 'active', $2::jsonb, '$$', NOW(), NOW())
    RETURNING id
  `, [partnerId, workingHours]);
  establishmentId = inserted.rows[0].id;
});

afterAll(async () => {
  await clearAllData();
});

/**
 * Поля, без которых `Establishment.fromJson` в приложении не собирает
 * карточку. Не «желательные» — несущие: их пропажа даёт исключение при
 * разборе и пустой экран, а не деградировавшую карточку.
 * Источник: `mobile/lib/models/establishment.dart`.
 */
const LOAD_BEARING_ESTABLISHMENT_FIELDS = [
  'id',
  'name',
  'address',
  'city',
  'status',
  'created_at',
  'updated_at',
];

describe('Контракт провода с mobile — список заведений', () => {
  test('конверт несёт establishments и pagination под своими именами', async () => {
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    // Приложение читает ровно эти два ключа. Переименование любого даёт
    // пустой список при живом счётчике — «ничего не найдено» на экране.
    expect(Array.isArray(res.body.data.establishments)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  test('блок pagination несёт page, limit, total, totalPages', async () => {
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    const p = res.body.data.pagination;

    // `establishments_service.dart` перекладывает limit → per_page и
    // totalPages → total_pages, а отсутствующее подставляет умолчанием.
    // Переименование `totalPages` схлопывает выдачу в одну страницу молча.
    expect(Object.keys(p).sort()).toEqual(
      expect.arrayContaining(['limit', 'page', 'total', 'totalPages'])
    );
    expect(typeof p.page).toBe('number');
    expect(typeof p.limit).toBe('number');
    expect(typeof p.total).toBe('number');
    expect(typeof p.totalPages).toBe('number');
  });

  test('каждое заведение несёт все несущие поля непустыми', async () => {
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    const row = res.body.data.establishments[0];
    expect(row).toBeDefined();

    const missing = LOAD_BEARING_ESTABLISHMENT_FIELDS
      .filter((f) => row[f] === undefined || row[f] === null);

    expect(missing).toEqual([]);
  });

  test('координаты приходят числами, а не строками NUMERIC', async () => {
    // Приложение кастует их как `as num`. Строка (что node-pg отдаёт для
    // NUMERIC без явного каста) уронит разбор — на этот раз громко, но на
    // устройстве, которое не пересоберут.
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    const row = res.body.data.establishments[0];
    expect(typeof row.latitude).toBe('number');
    expect(typeof row.longitude).toBe('number');
  });

  test('картинка карточки приходит как primary_image_url', async () => {
    // В списке нет `thumbnail_url`; приложение падает на `primary_image_url`
    // запасным вариантом. Ключ обязан присутствовать — пусть и со значением
    // null у карточки без фотографий.
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    expect(res.body.data.establishments[0]).toHaveProperty('primary_image_url');
  });

  test('категории и кухни приходят массивами, а не строкой', async () => {
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    const row = res.body.data.establishments[0];
    expect(Array.isArray(row.categories)).toBe(true);
    expect(Array.isArray(row.cuisines)).toBe(true);
  });
});

describe('Контракт провода с mobile — карточка заведения', () => {
  test('деталь несёт все несущие поля непустыми', async () => {
    const res = await request(app)
      .get(`/api/v1/search/establishments/${establishmentId}`)
      .expect(200);

    const row = res.body.data;
    const missing = LOAD_BEARING_ESTABLISHMENT_FIELDS
      .filter((f) => row[f] === undefined || row[f] === null);

    expect(missing).toEqual([]);
  });

  // Строка медиа детали: EstablishmentMedia.fromJson (mobile/lib/models/
  // establishment.dart) приводит type, position и created_at без запасного
  // значения — пропажа любого роняет разбор всей карточки; id и
  // establishment_id превращаются в строку «null». У карточки фикстуры медиа
  // нет, и тест выше их не видит: здесь одна строка медиа.
  test('строка медиа детали несёт поля, которые приложение разбирает без запаса', async () => {
    const image = 'https://res.cloudinary.com/test/image/upload/v1/establishments/wire/x.jpg';
    await query(
      `INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary)
       VALUES ($1, 'interior', 'image', $2, $2, $2, 0, true)`,
      [establishmentId, image],
    );
    const res = await request(app)
      .get(`/api/v1/search/establishments/${establishmentId}`)
      .expect(200);

    const [media] = res.body.data.media;
    expect(media).toBeDefined();
    expect({
      id: typeof media.id,
      establishment_id: typeof media.establishment_id,
      type: typeof media.type,
      position: Number.isInteger(media.position),
      created_at: typeof media.created_at === 'string' && !Number.isNaN(Date.parse(media.created_at)),
    }).toEqual({ id: 'string', establishment_id: 'string', type: 'string', position: true, created_at: true });
  });

  test('деталь несёт working_hours — иначе подпись «Открыто» врёт', async () => {
    // При отсутствии часов приложение падает на `status == "active"` и
    // рисует «Открыто» круглые сутки. Это молчаливая неправда, а не пробел.
    const res = await request(app)
      .get(`/api/v1/search/establishments/${establishmentId}`)
      .expect(200);

    expect(res.body.data).toHaveProperty('working_hours');
  });
});

describe('Контракт провода с mobile — список отзывов', () => {
  test('блок pagination отзывов несёт pages, а НЕ totalPages', async () => {
    // Асимметрия намеренная и закреплена с обеих сторон: поиск шлёт
    // `totalPages`, отзывы — `pages`. Приложение читает у каждого
    // эндпоинта своё имя. Приведение их «к единому виду» без правки
    // клиента остановит пролистывание отзывов молча.
    const res = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews`)
      .expect(200);

    const p = res.body.data.pagination;
    expect(p).toBeDefined();
    expect(Object.keys(p)).toEqual(
      expect.arrayContaining(['page', 'limit', 'total', 'pages'])
    );
    expect(Object.keys(p)).not.toContain('totalPages');
  });

  test('конверт отзывов несёт массив под ключом reviews', async () => {
    const res = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews`)
      .expect(200);

    expect(Array.isArray(res.body.data.reviews)).toBe(true);
  });
});

describe('Контракт провода с mobile — лента уведомлений', () => {
  test('блок pagination несёт число страниц под обоими именами: pages и totalPages', async () => {
    // Ровно случай из шапки файла — и он здесь не гипотеза. С марта 2026
    // приложение считает, есть ли ещё страницы ленты, по `totalPages`
    // (`notification_provider.dart`), а сервер называл это число только
    // `pages`: ключа нет → единица → лента любой сборки кончалась на первых
    // 20 уведомлениях, без ошибки. С 16.10.2026 сервер шлёт оба имени с одним
    // числом. `totalPages` не убирать, пока живы сборки, которые его читают;
    // `pages` — родное имя этого ответа, его не убирать тоже.
    //
    // 25 уведомлений при странице 20 — две страницы; запрос — ровно тот, что
    // шлёт приложение (`page`, `limit=20`).
    await query(`
      INSERT INTO notifications (user_id, type, title, message, created_at)
      SELECT $1, 'booking_received', 'Новая бронь', 'Новая бронь на «Васильки»',
             NOW() - make_interval(mins => g)
      FROM generate_series(1, 25) AS g
    `, [partnerId]);

    const feedPage = (page) => request(app)
      .get('/api/v1/notifications')
      .query({ page, limit: 20 })
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    const first = await feedPage(1);
    expect(first.body.data.items).toHaveLength(20);
    expect(first.body.data.pagination).toEqual({
      page: 1, limit: 20, total: 25, pages: 2, totalPages: 2,
    });

    const second = await feedPage(2);
    expect(second.body.data.items).toHaveLength(5);
    expect(second.body.data.pagination).toEqual({
      page: 2, limit: 20, total: 25, pages: 2, totalPages: 2,
    });
  });

  test('строка ленты несёт id, type, title, is_read, created_at — под своими именами и своих типов', async () => {
    // `NotificationModel.fromJson` подставляет умолчание за каждый пропавший
    // ключ: без `created_at` — текущее время (уведомление навсегда «Только
    // что»), без `is_read` — «прочитано» (точка «новое» гаснет), без `type` —
    // «Новый отзыв» (не тот значок и не тот переход по нажатию), без `id` —
    // пустая строка (отметка «прочитано» уходит в никуда, повторы на стыке
    // страниц не отсекаются). Клиентский тест
    // (`mobile/test/models/notification_contract_test.dart`) правку выборки
    // `notificationModel.getByUserId` не заметит — заметит этот.
    //
    // Время вставлено на три дня назад и сверяется с тем, что вернула база
    // через тот же драйвер: `created_at` — TIMESTAMP без пояса, и литерал с
    // `Z` на входе дал бы сдвиг на пояс процесса — сравнение мерило бы ось
    // времени, а не контракт.
    const inserted = await query(`
      INSERT INTO notifications (user_id, type, title, message, is_read, created_at)
      VALUES ($1, 'booking_received', 'Новая бронь', 'Новая бронь на «Васильки»', false,
              NOW() - INTERVAL '3 days')
      RETURNING id, created_at
    `, [partnerId]);
    const createdAt = inserted.rows[0].created_at.toISOString();

    const res = await request(app)
      .get('/api/v1/notifications')
      .query({ page: 1, limit: 20 })
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    const row = res.body.data.items[0];
    expect(row).toEqual(expect.objectContaining({
      id: inserted.rows[0].id,
      type: 'booking_received',
      title: 'Новая бронь',
      is_read: false,
    }));
    // Время — строкой ISO, и это время из базы, а не момент ответа.
    expect(typeof row.created_at).toBe('string');
    expect(new Date(row.created_at).toISOString()).toBe(createdAt);
    expect(Date.now() - Date.parse(row.created_at))
      .toBeGreaterThan(2 * 24 * 60 * 60 * 1000);
  });
});

describe('Контракт провода с mobile — что под чипами ленты', () => {
  // Приложение шлёт `category=establishments` под чипом «Мои заведения» и
  // `category=reviews` под «Мои отзывы». Состав — решение Координатора
  // 17.10.2026 (вариант «А-узкий»): в «Мои заведения» — всё о своих местах,
  // включая новый отзыв о месте и партнёрские брони; в «Мои отзывы» — только
  // то, что случилось с отзывами, написанными самим пользователем. Брони
  // гостя, «бронь истекла» (один тип и гостю, и партнёру) и акции — только
  // во «Все». Список ниже — состав чипа целиком: лишний тип под чипом —
  // такой же сбой, как пропавший.
  const ALL_TYPES = [
    'establishment_approved', 'establishment_rejected', 'establishment_suspended',
    'establishment_unsuspended', 'establishment_claimed', 'menu_parsed',
    'menu_item_hidden_by_admin', 'new_review', 'partner_response', 'review_hidden',
    'review_deleted', 'booking_received', 'booking_confirmed', 'booking_declined',
    'booking_expired', 'booking_cancelled', 'promotion_new',
  ];

  const typesUnder = async (category) => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .query({ page: 1, limit: 50, ...(category ? { category } : {}) })
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
    return res.body.data.items.map((n) => n.type).sort();
  };

  beforeEach(async () => {
    await query(`
      INSERT INTO notifications (user_id, type, title)
      SELECT $1, t, 'Уведомление' FROM unnest($2::text[]) AS t
    `, [partnerId, ALL_TYPES]);
  });

  test('«Мои заведения» — места партнёра, новый отзыв о месте, партнёрские брони', async () => {
    expect(await typesUnder('establishments')).toEqual([
      'booking_cancelled',
      'booking_received',
      'establishment_approved',
      'establishment_claimed',
      'establishment_rejected',
      'establishment_suspended',
      'establishment_unsuspended',
      'menu_item_hidden_by_admin',
      'menu_parsed',
      'new_review',
    ]);
  });

  test('«Мои отзывы» — только то, что случилось с отзывами самого пользователя', async () => {
    expect(await typesUnder('reviews')).toEqual([
      'partner_response',
      'review_deleted',
      'review_hidden',
    ]);
  });

  test('«Все» — все типы, включая оставшиеся вне чипов', async () => {
    expect(await typesUnder(null)).toEqual([...ALL_TYPES].sort());
  });
});

describe('Лента и отметки уведомлений — только свои', () => {
  // Владельца держит условие WHERE модели (notificationModel.js); её юнит-тест
  // видит подстроки SQL на подменённом пуле. Здесь — живая база и два
  // аккаунта: что видит и что меняет один, другого не касается.
  test('лента, счётчик, отметка одного и «прочитать все» трогают только уведомления своего аккаунта', async () => {
    const other = await createUserAndGetTokens({
      email: `notif-other-${Date.now()}@test.com`, password: 'Other123!@#', name: 'Другой', role: 'user',
    });
    const insert = async (userId, title) => (await query(
      `INSERT INTO notifications (user_id, type, title, message)
       VALUES ($1, 'booking_received', $2, 'текст') RETURNING id`,
      [userId, title],
    )).rows[0].id;
    const mine = await insert(partnerId, 'Моё');
    await insert(partnerId, 'Моё второе');
    const theirs = await insert(other.user.id, 'Чужое');
    await insert(other.user.id, 'Чужое второе');
    const asPartner = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${partnerToken}`);

    const feed = await asPartner('get', '/api/v1/notifications').expect(200);
    expect(feed.body.data.items.map((n) => n.title).sort()).toEqual(['Моё', 'Моё второе']);
    const count = await asPartner('get', '/api/v1/notifications/unread-count').expect(200);
    expect(count.body.data.count).toBe(2);

    await asPartner('put', `/api/v1/notifications/${theirs}/read`).expect(404);
    await asPartner('put', `/api/v1/notifications/${mine}/read`).expect(200);
    await asPartner('put', '/api/v1/notifications/read-all').expect(200);

    const { rows } = await query('SELECT title, is_read FROM notifications ORDER BY title');
    expect(rows).toEqual([
      { title: 'Моё', is_read: true },
      { title: 'Моё второе', is_read: true },
      { title: 'Чужое', is_read: false },
      { title: 'Чужое второе', is_read: false },
    ]);
  });
});
