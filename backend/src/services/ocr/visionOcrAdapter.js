/**
 * Vision OCR Adapter
 *
 * Calls OpenRouter with a vision-capable model to extract raw text from images
 * (or PDF pages rendered to images via Cloudinary pg_N transformations).
 *
 * Follows the inline fetch pattern from smartSearchService.js:136-155 — no SDK,
 * no shared client abstraction yet, direct POST to OpenRouter chat completions.
 */

import logger from '../../utils/logger.js';
import { getOcrConfig } from '../../config/openrouter.js';

const VISION_SYSTEM_PROMPT =
  'You are an OCR engine. Extract all visible text from the provided image(s) ' +
  'verbatim. Preserve line breaks. Do not summarize, interpret, or translate. ' +
  'If multiple images are provided, separate output by "--- PAGE N ---" markers.';

const VISION_USER_PROMPT =
  'Extract text from this menu image. Return only the raw extracted text.';

const REQUEST_TIMEOUT_MS = 60000;

/**
 * Extract text from a set of image URLs by calling OpenRouter vision API.
 *
 * @param {string[]} cloudinaryUrls - Image URLs (PDF pages via pg_N or direct photos)
 * @returns {Promise<{ rawText: string, confidenceOverall: number }>}
 * @throws {Error} on network / API / missing API key
 */
export const extractFromImages = async (cloudinaryUrls) => {
  if (!cloudinaryUrls || cloudinaryUrls.length === 0) {
    throw new Error('extractFromImages: cloudinaryUrls is empty');
  }

  const config = getOcrConfig();
  if (!config.apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured — cannot run vision OCR');
  }

  const messages = [
    { role: 'system', content: VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_USER_PROMPT },
        ...cloudinaryUrls.map((url) => ({
          type: 'image_url',
          image_url: { url },
        })),
      ],
    },
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter vision call failed: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const rawText = data?.choices?.[0]?.message?.content || '';

    // OpenRouter does not expose a per-call confidence score for vision. Use a
    // coarse heuristic based on output length — empty or very short output
    // signals low confidence. Future: extract logprobs if provider supports it.
    const confidenceOverall = rawText.length < 50 ? 0.3 : 0.85;

    logger.debug('Vision OCR complete', {
      imagesCount: cloudinaryUrls.length,
      rawTextLength: rawText.length,
      confidenceOverall,
      model: config.model,
    });

    return { rawText, confidenceOverall };
  } finally {
    clearTimeout(timeoutId);
  }
};

export { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT, REQUEST_TIMEOUT_MS };
