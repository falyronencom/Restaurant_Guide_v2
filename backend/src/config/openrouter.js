/**
 * OpenRouter AI Configuration
 *
 * Configures OpenRouter API access for AI-powered intent parsing in Smart Search.
 * Follows the same pattern as cloudinary.js — simple env var config with graceful
 * degradation when credentials are missing.
 */

import logger from '../utils/logger.js';

let _warned = false;

/**
 * Check if OpenRouter AI parsing is available.
 * Reads env var lazily (after dotenv has loaded).
 * @returns {boolean}
 */
export const isAvailable = () => {
  const available = !!process.env.OPENROUTER_API_KEY;
  if (!available && !_warned) {
    _warned = true;
    logger.warn(
      'OpenRouter API key not configured. Smart Search will use fallback (ILIKE). ' +
      'Set OPENROUTER_API_KEY environment variable to enable AI parsing.',
    );
  }
  return available;
};

/**
 * Get OpenRouter configuration for Smart Search intent parsing.
 * Reads env vars lazily to ensure dotenv has loaded.
 *
 * Умолчание — модель, выбранная замером 24.09.2026 вместе с промптом разбора
 * (SDL CAT-C-2.2, поправка 24.09): у прежней google/gemini-2.5-flash-lite в
 * каталоге OpenRouter срок 2026-10-20. Модель и промпт меняются и проверяются
 * вместе. У OCR своё умолчание (getOcrConfig), от этого не зависящее.
 * @returns {{ apiKey: string, baseUrl: string, model: string }}
 */
export const getConfig = () => ({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  model: process.env.AI_MODEL || 'google/gemini-3.5-flash-lite',
});

/**
 * Get OpenRouter configuration for OCR menu pipeline (Этап 2).
 *
 * Shares apiKey and baseUrl with intent parsing; model and reasoning are
 * OCR's own. Умолчание — модель, выбранная замером 28.09.2026 по эталону
 * 480 строк меню (`backend/session_reports/ocr_model_swap_2026_report.md`):
 * у прежних google/gemini-2.5-flash и 2.5-flash-lite в каталоге OpenRouter
 * срок 2026-10-20.
 *
 * reasoning — обе стадии (vision и структурер) шлют его в запросе.
 * gemini-3.8-flash без поля рассуждает на medium: ≈ 2,9 тыс. служебных
 * токенов на фото, ×1,7 цены и хуже качество (2 сбоя JSON на 24 фото);
 * с minimal — 0 служебных токенов и лучший результат замера. Модель в
 * AI_OCR_MODEL обязана принимать effort "minimal", иначе каждый вызов даст
 * 400. У gemini-2.5-flash "minimal" рассуждения ВКЛЮЧАЕТ (структурер 44 с
 * при таймауте 60 с) — возвращать её с этим кодом нельзя.
 *
 * Второе требование к модели (с 29.09.2026): законченный ответ vision
 * приходит с finish_reason "stop" — любой другой visionOcrAdapter считает
 * обрывом страницы, и попытка задачи падает. У gemini-3.8-flash все ≈ 70
 * вызовов замера 29.09 — "stop"; стенд ocr-benchmark пишет finish_reason
 * ответов vision в дамп и считает обрывы в сводке — смотреть при замене.
 *
 * @returns {{ apiKey: string, baseUrl: string, model: string, reasoning: { effort: string, exclude: boolean } }}
 */
export const getOcrConfig = () => ({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  model: process.env.AI_OCR_MODEL || 'google/gemini-3.8-flash',
  reasoning: { effort: 'minimal', exclude: true },
});
