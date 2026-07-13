/**
 * Thin standalone OpenRouter caller for the benchmark.
 *
 * Reuses the EXACT production prompts and validation schema by importing them
 * from src/services/ocr/* (never copying), so every candidate model sees the
 * same input the deployed pipeline sends — the benchmark compares models on
 * EQUAL prompts by construction, and a future prompt change in src/ flows in
 * automatically.
 *
 * The fetch itself is re-implemented here rather than calling
 * visionOcrAdapter/llmStructurer directly for one reason only: the production
 * functions discard the OpenRouter `usage` block and per-call latency, which
 * the benchmark must record. Request shape is kept identical to the
 * production calls (same messages, temperature 0, same response_format) apart
 * from `model` being a per-call parameter and `usage:{include:true}` being
 * added — an OpenRouter accounting flag that adds usage.cost to the response
 * without affecting generation.
 *
 * Model override mechanics: `model` is passed straight into the request body,
 * so no env mutation, no child processes, zero diff in backend/src/.
 */

import { readFileSync } from 'fs';
import { getOcrConfig } from '../../src/config/openrouter.js';
import {
  VISION_SYSTEM_PROMPT,
  VISION_USER_PROMPT,
  REQUEST_TIMEOUT_MS,
} from '../../src/services/ocr/visionOcrAdapter.js';
import {
  STRUCTURER_SYSTEM_PROMPT,
  ResponseSchema,
} from '../../src/services/ocr/llmStructurer.js';

const TRANSIENT_RETRIES = 1;
const RETRY_DELAY_MS = 2000;

/** Read a local image into a data: URI (OpenRouter accepts base64 data URIs
 *  in image_url content parts — verified at smoke; production sends Cloudinary
 *  URLs through the same field). */
export function toDataUri(abspath, mime) {
  const b64 = readFileSync(abspath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST /chat/completions with timeout + one retry on transient failures
 * (timeout, 429, 5xx). Non-transient HTTP errors (e.g. a model rejecting
 * data: URIs with 400) surface immediately.
 *
 * @returns {Promise<{ content: string, usage: object|null, ms: number }>}
 */
async function postChat(body) {
  const config = getOcrConfig();
  if (!config.apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured — cannot run benchmark');
  }

  let lastError;
  for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const ms = Date.now() - startedAt;

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`OpenRouter call failed: ${response.status} ${errorText.slice(0, 300)}`);
        if ([429, 500, 502, 503, 504].includes(response.status)) {
          lastError = error;
          continue; // transient — retry once
        }
        throw error;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';
      return { content, usage: data?.usage || null, ms };
    } catch (e) {
      if (e.name === 'AbortError') {
        lastError = new Error(`OpenRouter call timed out after ${REQUEST_TIMEOUT_MS}ms`);
        continue; // transient — retry once
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

/**
 * Vision OCR call — message shape mirrors visionOcrAdapter.extractFromImages.
 *
 * @param {string[]} imageDataUris
 * @param {string} model
 * @returns {Promise<{ rawText, confidenceHeuristic, usage, ms }>}
 */
export async function visionExtract(imageDataUris, model) {
  const messages = [
    { role: 'system', content: VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_USER_PROMPT },
        ...imageDataUris.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    },
  ];

  const { content, usage, ms } = await postChat({
    model,
    messages,
    temperature: 0,
    usage: { include: true },
  });

  // Same coarse heuristic the production adapter records (visionOcrAdapter.js:84).
  const confidenceHeuristic = content.length < 50 ? 0.3 : 0.85;
  return { rawText: content, confidenceHeuristic, usage, ms };
}

/**
 * Structurer call — mirrors llmStructurer.structureMenu, but reports parse and
 * schema failures as data instead of throwing: a candidate model that returns
 * broken JSON is a benchmark FINDING, not a crash.
 *
 * @param {string} rawText
 * @param {string} model
 * @returns {Promise<{ items, parseOk, zodOk, zodError, usage, ms }>}
 */
export async function structureText(rawText, model) {
  if (!rawText || rawText.trim().length === 0) {
    // ms stays null — no API call happened, and a phantom 0 would flatter
    // exactly the models that return empty OCR text (latency averages).
    return { items: [], parseOk: true, zodOk: true, zodError: null, usage: null, ms: null };
  }

  const { content, usage, ms } = await postChat({
    model,
    messages: [
      { role: 'system', content: STRUCTURER_SYSTEM_PROMPT },
      { role: 'user', content: rawText },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
    usage: { include: true },
  });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { items: [], parseOk: false, zodOk: false, zodError: null, usage, ms };
  }

  const validated = ResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      items: [],
      parseOk: true,
      zodOk: false,
      zodError: String(validated.error?.message || '').slice(0, 500),
      usage,
      ms,
    };
  }

  return { items: validated.data.items, parseOk: true, zodOk: true, zodError: null, usage, ms };
}
