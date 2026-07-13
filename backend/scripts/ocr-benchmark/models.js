/**
 * Candidate model registry + OpenRouter catalog verification.
 *
 * The default set is fixed by DIRECTIVE_benchmark (2026-07-12): the current
 * production model as the baseline, its fuller sibling, the 2026 flagship
 * flash (catalog-verified 2026-07-13), plus one strong non-Gemini vision
 * model for a cross-family signal (optional per BENCHMARK_BRIEF — drop it
 * via --models). Override the whole set with --models=id1,id2,…
 *
 * Every candidate is re-verified against the LIVE catalog at run time —
 * model names are the most perishable part of the AI stack, so existence,
 * vision input and response_format support are checked per run, never
 * assumed. A failing candidate is skipped and reported, not fatal.
 */

export const DEFAULT_MODELS = [
  'google/gemini-2.5-flash-lite', // baseline — current prod fallback (never deliberately chosen for OCR)
  'google/gemini-2.5-flash',
  'google/gemini-3.5-flash',
  'qwen/qwen3.5-flash-02-23', // cross-family vision signal
];

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const CATALOG_TIMEOUT_MS = 30000;

/**
 * Fetch the public OpenRouter model catalog (no API key required).
 * Returns Map<id, {pricing, inputModalities, supportedParameters}>,
 * or null when the catalog is unreachable (verification then degrades
 * to a warning — the run itself can still proceed).
 */
export async function fetchCatalog() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await fetch(CATALOG_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    const map = new Map();
    for (const m of data?.data || []) {
      map.set(m.id, {
        pricing: m.pricing || null,
        inputModalities: m.architecture?.input_modalities || [],
        supportedParameters: m.supported_parameters || [],
      });
    }
    return map;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Verify candidates against the catalog. A usable candidate must exist,
 * accept image input, and support response_format (the structurer sends
 * response_format:{type:'json_object'} — llmStructurer.js:83).
 *
 * @param {string[]} ids
 * @param {Map|null} catalog - from fetchCatalog(); null = unverifiable
 * @returns {{ usable: Array<{id, pricing}>, skipped: Array<{id, reason}> }}
 */
export function verifyModels(ids, catalog) {
  if (!catalog) {
    return { usable: ids.map((id) => ({ id, pricing: null })), skipped: [] };
  }
  const usable = [];
  const skipped = [];
  for (const id of ids) {
    const entry = catalog.get(id);
    if (!entry) {
      skipped.push({ id, reason: 'not found in OpenRouter catalog' });
    } else if (!entry.inputModalities.includes('image')) {
      skipped.push({ id, reason: `no image input (modalities: ${entry.inputModalities.join(',')})` });
    } else if (!entry.supportedParameters.includes('response_format')) {
      skipped.push({ id, reason: 'response_format not supported (structurer requires json_object)' });
    } else {
      usable.push({ id, pricing: entry.pricing });
    }
  }
  return { usable, skipped };
}

/**
 * Compute call cost in USD. Prefers the cost OpenRouter itself reports in
 * the usage block (usage:{include:true} → usage.cost, denominated in USD
 * credits); falls back to catalog per-token pricing when absent.
 *
 * @param {object|null} usage - usage block from the API response
 * @param {object|null} pricing - catalog pricing {prompt, completion} ($/token)
 * @returns {number|null} USD, or null when not computable
 */
export function computeCostUsd(usage, pricing) {
  if (!usage) return null;
  if (typeof usage.cost === 'number') return usage.cost;
  if (!pricing) return null;
  const promptRate = Number(pricing.prompt);
  const completionRate = Number(pricing.completion);
  if (Number.isNaN(promptRate) || Number.isNaN(completionRate)) return null;
  return (usage.prompt_tokens || 0) * promptRate + (usage.completion_tokens || 0) * completionRate;
}
