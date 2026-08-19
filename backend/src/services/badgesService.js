/**
 * Badges Service — счётчики очередей для рейла админки и панели «Требует
 * внимания» на дашборде.
 *
 * Зачем отдельный эндпоинт. Рейл живёт в шелле и рисуется на каждом экране, а
 * счётчики в нём нужны везде. Альтернатива — дозапрашивать три списка с
 * per_page=1 ради meta.total — даёт три лишних round-trip на каждый переход
 * между разделами. Здесь это одна выборка, да ещё и под кэшем.
 *
 * Кэш внутрипроцессный, не Redis. В проекте Redis обслуживает счётчики
 * rate-limit, приёма кэширования ответов нет, а заводить его ради четырёх
 * чисел — лишний режим отказа: при недоступном Redis эндпоинт обязан был бы
 * деградировать, и это пришлось бы отдельно продумывать и тестировать.
 * Данные не критичны к свежести: показать очередь 30-секундной давности
 * безопасно, счётчик всё равно меняется реже, чем модератор переходит между
 * экранами.
 */

import * as BadgesModel from '../models/badgesModel.js';
import * as QualityHealthModel from '../models/qualityHealthModel.js';
import logger from '../utils/logger.js';

/** Время жизни кэша. Нижняя граница диапазона 30–60 с из брифа. */
export const CACHE_TTL_MS = 30_000;

let cache = null;

/** Сбрасывает кэш. Нужен тестам и ручной инвалидации. */
export const resetCache = () => {
  cache = null;
};

/**
 * Счётчики очередей.
 *
 * Форма ответа:
 * {
 *   establishments_pending: int,
 *   establishments_suspended: int,
 *   menu_flags: int,
 *   menu_flags_aged_over_7d: int,
 *   generated_at: ISO-строка
 * }
 *
 * Намеренно НЕ содержит «сигналов здоровья данных» и «отзывов на разбор»:
 * ни то ни другое не имеет в коде определения «сколько требует разбора», и
 * придумывать его на ходу — значит зашить в бейдж произвольную политику.
 * Обе величины добавляются сюда же, когда правило будет решено.
 *
 * @param {{ force?: boolean }} [options] force обходит кэш.
 */
export const getBadges = async ({ force = false } = {}) => {
  const now = Date.now();

  if (!force && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  try {
    const [queues, flags] = await Promise.all([
      BadgesModel.getEstablishmentQueueCounts(),
      QualityHealthModel.getHangingFlags(),
    ]);

    const value = {
      establishments_pending: queues.pending,
      establishments_suspended: queues.suspended,
      menu_flags: flags.hanging_count,
      menu_flags_aged_over_7d: flags.aged_over_7d,
      generated_at: new Date(now).toISOString(),
    };

    cache = { at: now, value };
    return value;
  } catch (error) {
    logger.error('Error building admin badges', { error: error.message });
    throw error;
  }
};
