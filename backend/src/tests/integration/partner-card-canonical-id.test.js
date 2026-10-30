/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration: маршруты карточки партнёра /partner/establishments/:id… —
 * только id так, как его пишет база (Н18 нитки «Остатки „500 вместо
 * отказа“», сессия Д, 20.10.2026).
 *
 * До правки id прописными проходил везде: Postgres читает его как ту же
 * карточку, — а сохранение карточки строит папку файлов из id запроса, и
 * собственные файлы карточки получали 422 MEDIA_URL_NOT_OWNED; пауза,
 * возобновление, удаление, меню и повторное распознавание id не проверяли
 * вовсе (не-UUID доходил до базы и возвращался её английским 400). Медиа
 * карточки и акции так уже не принимают (сессия Г).
 *
 * Теперь неканонический id — отказ того же маршрута, что и чужой или
 * удалённой карточке: тот же статус и код, текст карточки; карточка не
 * тронута. Ожидания — литералы формулировок, не ссылки на модуль текстов.
 */

import request from 'supertest';
import app from '../../server.js';
import redisClient, { connectRedis } from '../../config/redis.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const TEXT = {
  // Утверждены Координатором 15.10.2026 (тексты карточки).
  notOwner: 'Нет доступа к этому заведению — возможно, оно удалено или принадлежит другой учётной записи. Обновите список заведений.',
  notFound: 'Заведение не найдено — возможно, оно удалено. Обновите список заведений.',
};

const NOT_OWNER_403 = { status: 403, code: 'FORBIDDEN', message: TEXT.notOwner };
const NOT_FOUND_404 = { status: 404, code: 'ESTABLISHMENT_NOT_FOUND', message: TEXT.notFound };
const NOT_OWNER_404 = { status: 404, code: 'ESTABLISHMENT_NOT_FOUND', message: TEXT.notOwner };

/**
 * Каждый маршрут /:id… роутера карточки и отказ, которым он отвечает на чужую
 * или удалённую карточку (services/establishmentService.js,
 * services/partnerMenuItemService.js). `status` — состояние карточки, в
 * котором старый код действие выполнил бы.
 */
const ROUTES = [
  { name: 'открытие', method: 'get', path: '', status: 'active', refusal: NOT_FOUND_404 },
  { name: 'сохранение', method: 'put', path: '', body: { description: 'Новое описание карточки' }, status: 'active', refusal: NOT_OWNER_403 },
  { name: 'отправка на модерацию', method: 'post', path: '/submit', status: 'draft', refusal: NOT_OWNER_403 },
  { name: 'пауза', method: 'post', path: '/suspend', status: 'active', refusal: NOT_OWNER_403 },
  { name: 'возобновление', method: 'post', path: '/resume', status: 'suspended', refusal: NOT_OWNER_403 },
  { name: 'удаление', method: 'delete', path: '', status: 'draft', refusal: NOT_OWNER_403 },
  { name: 'меню', method: 'get', path: '/menu-items', status: 'active', refusal: NOT_OWNER_404 },
  { name: 'повторное распознавание', method: 'post', path: '/retry-ocr', status: 'active', refusal: NOT_OWNER_404 },
];

let seq = 0;
const newAccount = async (role) => {
  seq += 1;
  return createUserAndGetTokens({
    email: `${role}-card-id-${Date.now()}-${seq}@test.com`,
    password: 'User123!@#',
    name: 'Card Id',
    role,
  });
};

const send = (route, id, token) => {
  const req = request(app)[route.method](`/api/v1/partner/establishments/${id}${route.path}`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return route.body ? req.send(route.body) : req;
};

const refusal = (res) => ({ status: res.status, code: res.body.error?.code, message: res.body.message });

const cardRow = async (id) => {
  const { rows } = await query('SELECT status, description, updated_at FROM establishments WHERE id = $1', [id]);
  return rows[0] ?? null;
};

// Квота повторного распознавания считается в Redis (ocrRestartLimiter);
// без подключения лимитер пропускает всё, и тест порядка ниже был бы пуст.
const sweepRetryQuota = async () => {
  const keys = await redisClient.keys('ratelimit:ocr_restart:*');
  if (keys.length > 0) await redisClient.del(keys);
};

let partner;
let card;

beforeAll(async () => {
  if (!redisClient.isReady && !(await connectRedis())) {
    throw new Error('Redis connection is required for the retry quota test');
  }
  await sweepRetryQuota();
  await clearAllData();
  partner = await newAccount('partner');
});

afterAll(async () => {
  await sweepRetryQuota();
  await clearAllData();
});

beforeEach(async () => {
  card = await createTestEstablishment(partner.user.id);
});

describe.each(ROUTES)('$name ($method /:id$path)', (route) => {
  beforeEach(async () => {
    await query('UPDATE establishments SET status = $1 WHERE id = $2', [route.status, card.id]);
  });

  test.each([
    ['id прописными', () => card.id.toUpperCase()],
    ['UUID в фигурных скобках (база прочла бы его как ту же карточку)', () => `{${card.id}}`],
    ['не UUID', () => 'not-a-card'],
  ])('%s — отказ чужой карточки этого маршрута, карточка не тронута', async (_label, id) => {
    const before = await cardRow(card.id);

    const res = await send(route, id(), partner.accessToken);

    expect(refusal(res)).toEqual(route.refusal);
    expect(await cardRow(card.id)).toEqual(before);
  });

  // Свой id строчными проверку проходит: ответ — не отказ карточки (действие
  // выполнено или отказ самого действия — «нет файлов меню» и т. п.).
  test('свой id в нижнем регистре — не отказ карточки', async () => {
    const res = await send(route, card.id, partner.accessToken);

    expect({ status: res.status, code: res.body.error?.code })
      .not.toEqual({ status: route.refusal.status, code: route.refusal.code });
  });

  test('чужая карточка в нижнем регистре — тот же статус и код', async () => {
    const stranger = await newAccount('partner');

    const res = await send(route, card.id, stranger.accessToken);

    expect({ status: res.status, code: res.body.error?.code })
      .toEqual({ status: route.refusal.status, code: route.refusal.code });
  });
});

describe('порядок проверок и свой id как прежде', () => {
  test('без входа — 401, не партнёр — 403, как прежде: проверка id стоит после них', async () => {
    const regular = await newAccount('user');
    const upper = card.id.toUpperCase();

    const anonymous = await send(ROUTES[3], upper);
    const guest = await send(ROUTES[3], upper, regular.accessToken);

    expect([anonymous.status, guest.status]).toEqual([401, 403]);
    // Отказ роли, не отказ карточки: у него свои подробности.
    expect(guest.body.error?.details?.your_role).toBe('user');
  });

  // Неканонический id не тратит дневную квоту повторного распознавания
  // (5 в сутки, ocrRestartLimiter): проверка стоит до лимитера.
  test('повторное распознавание: шесть отказов по id — квота цела', async () => {
    const fresh = await newAccount('partner');
    const own = await createTestEstablishment(fresh.user.id);
    const retry = ROUTES[7];

    for (let i = 0; i < 6; i += 1) {
      const refused = await send(retry, own.id.toUpperCase(), fresh.accessToken);
      expect(refused.status).toBe(404);
    }
    const res = await send(retry, own.id, fresh.accessToken);

    expect(res.status).not.toBe(429);
    expect(res.body.error?.code).toBe('NO_PDF_MENUS');
  });

  test('id в нижнем регистре: открытие, сохранение и пауза — проходят', async () => {
    const opened = await send(ROUTES[0], card.id, partner.accessToken);
    const saved = await send(ROUTES[1], card.id, partner.accessToken);
    const paused = await send(ROUTES[3], card.id, partner.accessToken);

    expect([opened.status, saved.status, paused.status]).toEqual([200, 200, 200]);
    expect(await cardRow(card.id)).toMatchObject({ status: 'suspended', description: 'Новое описание карточки' });
  });
});
