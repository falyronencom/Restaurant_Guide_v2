/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отзыв и его вклад в рейтинг записываются вместе; квота отзывов держится
 * при параллельных запросах (пакет 1 находок критиков, пункт 5 — Codex B6 + B7).
 *
 * До правки создание отзыва, пересчёт рейтинга заведения и счётчик квоты были
 * тремя отдельными шагами без общей транзакции: отказ пересчёта оставлял отзыв
 * записанным (комментарий кода обещал транзакцию — ложно), а квота читалась
 * до записи и увеличивалась после — одновременные запросы все видели «9» и
 * все проходили.
 *
 * Правило теперь: слот квоты резервируется атомарным приращением ДО записи и
 * возвращается, если отзыва не вышло; вставка отзыва и пересчёт — одна
 * транзакция.
 *
 * Гонка проверяется прямым вызовом сервиса, не по HTTP: два supertest-запроса
 * сериализуются и гонки не дают (feedback_supertest_does_not_reproduce_db_race).
 * Отказ пересчёта вызывается триггером, созданным только в этом тесте: он
 * роняет UPDATE establishments, который делает сам сервис (глубина триггера 1),
 * и пропускает UPDATE триггера схемы на INSERT отзыва (глубина 2).
 * Известное решение 23.09 #22 («без Redis — пропускать») не меняется.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query, countRecords } from '../utils/database.js';
import { createUserAndGetTokens, createTestEstablishment } from '../utils/auth.js';
import redisClient, { connectRedis, deleteKey, getCounter, getTTL, setWithExpiry } from '../../config/redis.js';
import { createReview } from '../../services/reviewService.js';
import { secondsUntilMinskMidnight } from '../../utils/minskDay.js';

const CONTENT = 'Достаточно длинный и содержательный отзыв длиной более двадцати символов.';
const quotaKey = (userId) => `reviews:ratelimit:${userId}`;

let user;
let userToken;
let partnerId;

beforeAll(async () => {
  if (!redisClient.isReady) {
    const ready = await connectRedis();
    if (!ready) throw new Error('Redis connection is required for the quota tests');
  }
});

beforeEach(async () => {
  await clearAllData();
  const author = await createUserAndGetTokens({
    email: `quota-${Date.now()}@test.com`,
    password: 'User123!@#',
    name: 'Автор Отзывов',
    role: 'user',
  });
  user = author.user;
  userToken = author.accessToken;
  const partner = await createUserAndGetTokens({
    email: `quota-partner-${Date.now()}@test.com`,
    password: 'Partner123!@#',
    name: 'Партнёр',
    role: 'partner',
  });
  partnerId = partner.user.id;
  await deleteKey(quotaKey(user.id));
});

afterAll(async () => {
  await clearAllData();
});

afterEach(async () => {
  if (user) await deleteKey(quotaKey(user.id));
  await query('DROP TRIGGER IF EXISTS test_fail_service_recalc ON establishments');
  await query('DROP FUNCTION IF EXISTS test_fail_service_recalc()');
});

const newEstablishment = async () => (await createTestEstablishment(partnerId)).id;

const reviewsOfUser = () => countRecords('reviews', 'WHERE user_id = $1', [user.id]);

// ============================================================================
// B7 — квота при одновременных запросах
// ============================================================================

describe('квота отзывов держится при параллельных запросах', () => {
  test('один свободный слот, три одновременных отзыва: создаётся ровно один', async () => {
    // 9 из 10 уже использованы.
    await setWithExpiry(quotaKey(user.id), '9', 3600);
    const establishments = await Promise.all([newEstablishment(), newEstablishment(), newEstablishment()]);

    const outcomes = await Promise.allSettled(establishments.map((establishmentId) => createReview({
      user_id: user.id,
      establishment_id: establishmentId,
      rating: 5,
      content: CONTENT,
    })));

    const created = outcomes.filter((o) => o.status === 'fulfilled');
    const refused = outcomes.filter((o) => o.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(2);
    for (const { reason } of refused) {
      expect(reason.statusCode).toBe(429);
      expect(reason.code).toBe('RATE_LIMIT_EXCEEDED');
    }
    expect(await reviewsOfUser()).toBe(1);
    // Отказанные попытки слот не съели: счётчик ровно 10.
    expect(await getCounter(quotaKey(user.id))).toBe(10);
  });

  test('неудачная попытка не съедает слот: повторный отзыв на то же заведение', async () => {
    const establishmentId = await newEstablishment();
    await createReview({ user_id: user.id, establishment_id: establishmentId, rating: 4, content: CONTENT });
    expect(await getCounter(quotaKey(user.id))).toBe(1);

    await expect(createReview({ user_id: user.id, establishment_id: establishmentId, rating: 2, content: CONTENT }))
      .rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_REVIEW' });

    expect(await getCounter(quotaKey(user.id))).toBe(1);
  });

  test('окно квоты кончается в полночь Минска, а не через 24 часа', async () => {
    // Решение Координатора 11.10.2026 (закрывает 23.09 #26): квота — 10 отзывов
    // в календарные сутки по Минску. Срок ключа после первого отзыва дня —
    // секунды до минской полуночи, считанные по именованному поясу.
    const establishmentId = await newEstablishment();
    const before = secondsUntilMinskMidnight();

    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 5, content: CONTENT })
      .expect(201);

    const ttl = await getTTL(quotaKey(user.id));
    const after = secondsUntilMinskMidnight();
    // Между «до» и «после» прошло не больше нескольких секунд; на границе
    // полуночи «после» может оказаться 86400 — тогда и ttl около него.
    expect(ttl).toBeGreaterThanOrEqual(Math.min(before, after) - 5);
    expect(ttl).toBeLessThanOrEqual(Math.max(before, after));
    // Ответ о квоте называет тот же срок.
    const quota = await request(app)
      .get('/api/v1/reviews/quota')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(quota.body.data.quota.resetIn).toBeGreaterThanOrEqual(ttl - 5);
    expect(quota.body.data.quota.resetIn).toBeLessThanOrEqual(Math.max(before, after));
  });

  test('отказанная попытка не продлевает окно квоты', async () => {
    // Окно отсчитывается от первого отзыва дня: у ключа осталось 100 секунд,
    // и одиннадцатая попытка не должна вернуть ему сутки (ревью 09.10.2026).
    await setWithExpiry(quotaKey(user.id), '10', 100);

    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: await newEstablishment(), rating: 5, content: CONTENT })
      .expect(429);

    const ttl = await getTTL(quotaKey(user.id));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(100);
    expect(await getCounter(quotaKey(user.id))).toBe(10);
  });

  test('одиннадцатый отзыв отвергается, счётчик не растёт выше десяти', async () => {
    await setWithExpiry(quotaKey(user.id), '10', 3600);

    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: await newEstablishment(), rating: 5, content: CONTENT })
      .expect(429);

    expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(await getCounter(quotaKey(user.id))).toBe(10);
    expect(await reviewsOfUser()).toBe(0);
  });
});

// ============================================================================
// B6 — отзыв и пересчёт рейтинга в одной транзакции
// ============================================================================

describe('отзыв и пересчёт рейтинга записываются вместе', () => {
  const failServiceRecalc = async () => {
    await query(`
      CREATE OR REPLACE FUNCTION test_fail_service_recalc() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        -- Глубина 1 — UPDATE, который делает сам сервис; глубина 2 — UPDATE
        -- триггера схемы, вызванный вставкой отзыва. (updated_at различием не
        -- служит: внутри одной транзакции оба UPDATE ставят одно и то же
        -- CURRENT_TIMESTAMP через update_establishments_updated_at.)
        IF pg_trigger_depth() = 1 THEN
          RAISE EXCEPTION 'test: service recalculation failed';
        END IF;
        RETURN NEW;
      END;
      $$`);
    await query('DROP TRIGGER IF EXISTS test_fail_service_recalc ON establishments');
    await query(`
      CREATE TRIGGER test_fail_service_recalc BEFORE UPDATE ON establishments
      FOR EACH ROW EXECUTE FUNCTION test_fail_service_recalc()`);
  };

  test('отказ пересчёта откатывает отзыв: строки нет, слот квоты возвращён', async () => {
    const establishmentId = await newEstablishment();
    await failServiceRecalc();
    // Самопроверка приёма: прямой UPDATE с updated_at обязан упасть.
    await expect(query('UPDATE establishments SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [establishmentId]))
      .rejects.toThrow('service recalculation failed');

    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 5, content: CONTENT });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('REVIEW_CREATION_FAILED');
    expect(await reviewsOfUser()).toBe(0);
    expect(await getCounter(quotaKey(user.id))).toBe(0);
    const { rows: [est] } = await query(
      'SELECT review_count, average_rating FROM establishments WHERE id = $1', [establishmentId],
    );
    expect(est.review_count).toBe(0);
  });

  test('без отказа: отзыв записан, рейтинг заведения пересчитан, слот занят', async () => {
    const establishmentId = await newEstablishment();

    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId, rating: 4, content: CONTENT })
      .expect(201);

    expect(response.body.data.review.user_id).toBe(user.id);
    const { rows: [est] } = await query(
      'SELECT review_count, average_rating::text AS average_rating FROM establishments WHERE id = $1',
      [establishmentId],
    );
    expect(est.review_count).toBe(1);
    expect(est.average_rating).toBe('4.00');
    expect(await getCounter(quotaKey(user.id))).toBe(1);
  });
});
