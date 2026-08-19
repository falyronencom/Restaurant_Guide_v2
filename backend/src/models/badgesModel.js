/**
 * Badges Model — счётчики очередей для навигационного рейла админки.
 *
 * Одна выборка на все очереди: рейл рисуется один раз на весь шелл, но
 * счётчики нужны на каждом экране, поэтому цена запроса умножается на число
 * переходов. Разбивать её на три обращения — ровно то, чего эндпоинт
 * /admin/badges и должен избежать.
 *
 * Read-only. Таблицы: establishments.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Размеры очередей по статусам заведений.
 *
 * Возвращает { pending, suspended } — оба int, ноль вместо NULL.
 */
export const getEstablishmentQueueCounts = async () => {
  const query = `
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended
    FROM establishments
  `;

  try {
    const { rows } = await pool.query(query);
    return rows[0];
  } catch (error) {
    logger.error('Error getting establishment queue counts', {
      error: error.message,
    });
    throw error;
  }
};
