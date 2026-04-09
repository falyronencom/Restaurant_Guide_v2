/**
 * OpenRouter AI Configuration
 *
 * Configures OpenRouter API access for AI-powered intent parsing in Smart Search.
 * Follows the same pattern as cloudinary.js — simple env var config with graceful
 * degradation when credentials are missing.
 */

import logger from '../utils/logger.js';

const openrouterConfig = {
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  model: process.env.AI_MODEL || 'google/gemini-2.5-flash-lite',
};

if (!openrouterConfig.apiKey) {
  logger.warn(
    'OpenRouter API key not configured. Smart Search will use fallback (ILIKE). ' +
    'Set OPENROUTER_API_KEY environment variable to enable AI parsing.'
  );
}

/**
 * Check if OpenRouter AI parsing is available.
 * @returns {boolean}
 */
export const isAvailable = () => !!openrouterConfig.apiKey;

/**
 * Get OpenRouter configuration.
 * @returns {{ apiKey: string, baseUrl: string, model: string }}
 */
export const getConfig = () => openrouterConfig;

export default openrouterConfig;
