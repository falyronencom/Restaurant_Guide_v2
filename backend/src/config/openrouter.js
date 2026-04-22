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
      'Set OPENROUTER_API_KEY environment variable to enable AI parsing.'
    );
  }
  return available;
};

/**
 * Get OpenRouter configuration for Smart Search intent parsing.
 * Reads env vars lazily to ensure dotenv has loaded.
 * @returns {{ apiKey: string, baseUrl: string, model: string }}
 */
export const getConfig = () => ({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  model: process.env.AI_MODEL || 'google/gemini-2.5-flash-lite',
});

/**
 * Get OpenRouter configuration for OCR menu pipeline (Этап 2).
 *
 * Shares apiKey and baseUrl with intent parsing — different model tuned for
 * vision + structured extraction tasks. Falls back to the intent default if
 * AI_OCR_MODEL is not set (Gemini Flash Lite supports vision input).
 *
 * @returns {{ apiKey: string, baseUrl: string, model: string }}
 */
export const getOcrConfig = () => ({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  model: process.env.AI_OCR_MODEL || 'google/gemini-2.5-flash-lite',
});
