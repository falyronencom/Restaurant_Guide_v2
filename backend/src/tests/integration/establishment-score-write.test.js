/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Оценка заполненности при создании карточки: запись идёт до ответа сервера,
 * а её сбой ответ не портит (нитка «Расходы посторонних», слово Координатора
 * 05.11.2026; `docs/handoffs/parked/fire-and-forget-tails/BRIEF.md`, B8).
 *
 * Запись двигает updated_at карточки. Пока ответ её не ждал, прочитавший карточку
 * сразу после ответа видел, как время правки сдвигается на миллисекунды, — и тест
 * реквизитов случайно краснел. Паузу и сбой здесь задаёт подмена одного этого
 * запроса к настоящей базе: окно не зависит от скорости машины.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server.js';
import { pool } from '../../config/database.js';
import logger from '../../utils/logger.js';
import { clearAllData, clearTableTree, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';

const SCORE_WRITE = 'UPDATE establishments SET base_score';
const PAUSE_MS = 100;

const realQuery = pool.query.bind(pool);

/** Пропускает всё, кроме записи оценки: с ней поступает `onWrite`. */
const interceptScoreWrite = (onWrite) => jest.spyOn(pool, 'query').mockImplementation((text, ...rest) => (
  typeof text === 'string' && text.startsWith(SCORE_WRITE)
    ? onWrite(() => realQuery(text, ...rest))
    : realQuery(text, ...rest)
));

const createCard = () => request(app)
  .post('/api/v1/partner/establishments')
  .set('Authorization', `Bearer ${partnerToken}`)
  .send({
    name: 'Оценка заполненности',
    description: 'Кафе для проверки записи оценки',
    categories: ['Кафе'],
    cuisines: ['Народная'],
    city: 'Минск',
    address: 'ул. Немига, 5',
    latitude: 53.9045,
    longitude: 27.556,
    working_hours: {
      monday: { is_open: true, open: '09:00', close: '21:00' },
    },
    phone: '+375291112233',
    price_range: '$$',
  });

const cardRow = async (id) => (await query(
  'SELECT base_score, updated_at FROM establishments WHERE id = $1',
  [id],
)).rows[0];

let partnerToken;

beforeAll(async () => {
  partnerToken = (await createUserAndGetTokens(testUsers.partner)).accessToken;
});

beforeEach(async () => {
  await clearTableTree('establishments');
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

describe('создание карточки: оценка заполненности', () => {
  test('ответ уходит после записи: время правки потом не двигается', async () => {
    interceptScoreWrite(async (write) => {
      await new Promise((resolve) => { setTimeout(resolve, PAUSE_MS); });
      return write();
    });

    const response = await createCard().expect(201);
    const { id, base_score: answered } = response.body.data.establishment;
    expect(answered).toBeGreaterThan(0);

    const justAfter = await cardRow(id);
    expect(justAfter.base_score).toBe(answered);

    await new Promise((resolve) => { setTimeout(resolve, PAUSE_MS * 2); });
    expect((await cardRow(id)).updated_at).toEqual(justAfter.updated_at);
  });

  test('сбой записи: партнёр получает обычный ответ, карточка создана, ошибка в журнале', async () => {
    const errorLine = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    interceptScoreWrite(async () => { throw new Error('score write failed'); });

    const response = await createCard().expect(201);
    const { id } = response.body.data.establishment;

    expect(response.body.success).toBe(true);
    expect(await cardRow(id)).toBeDefined();
    expect(errorLine).toHaveBeenCalledWith(
      'Error updating base score',
      expect.objectContaining({ establishmentId: id, error: 'score write failed' }),
    );
  });
});
