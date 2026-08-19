/**
 * Badges Controller.
 *
 * Тонкий HTTP-слой над badgesService: конверт { success, data }, read-only,
 * admin-guard стоит на маршруте.
 *
 * Endpoint: GET /api/v1/admin/badges
 */

import * as badgesService from '../services/badgesService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * GET /api/v1/admin/badges
 *
 * Счётчики очередей для рейла и панели «Требует внимания».
 *
 * Логирования на каждый вызов нет намеренно: рейл запрашивает счётчики при
 * каждой загрузке шелла, и запись в журнал раздувала бы его без пользы —
 * данные read-only и не содержат ничего, что стоило бы аудировать.
 */
export const getBadges = asyncHandler(async (req, res) => {
  const data = await badgesService.getBadges();

  res.status(200).json({ success: true, data });
});
