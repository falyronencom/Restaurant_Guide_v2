/**
 * Candidate model registry + OpenRouter catalog verification.
 *
 * The default set is fixed by DIRECTIVE_benchmark (2026-07-12): the current
 * production model as the baseline, its fuller sibling, the 2026 flagship
 * flash (catalog-verified 2026-07-13), plus one strong non-Gemini vision
 * model for a cross-family signal (optional per BENCHMARK_BRIEF — drop it
 * via --models). Override the whole set with --models=id1,id2,… — an id may
 * carry a reasoning effort, id@minimal (parseModelSpec).
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
  'google/gemini-3.1-flash-lite', // gen-3.1 successor of the baseline lite (Coordinator, 2026-07-13)
];

/** OpenRouter `reasoning.effort` values accepted in a spec suffix. */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'];

/**
 * A candidate spec is a catalog id, optionally with a reasoning effort:
 * `google/gemini-3.8-flash@minimal`. No suffix = no `reasoning` field in the
 * request, which is what production sends today — the model's own default
 * (2026-07: gemini-3.5-flash thought by default, 98k reasoning tokens on 24
 * photos, ×10 cost). The suffix measures the configuration production would
 * get only after the OCR adapters learn to send the field.
 *
 * @param {string} spec
 * @returns {{ spec: string, id: string, effort: string|null }}
 * @throws {Error} on an effort outside REASONING_EFFORTS
 */
export function parseModelSpec(spec) {
  const at = spec.lastIndexOf('@');
  if (at === -1) return { spec, id: spec, effort: null };
  const id = spec.slice(0, at);
  const effort = spec.slice(at + 1);
  if (!id || !REASONING_EFFORTS.includes(effort)) {
    throw new Error(`bad model spec "${spec}" — expected <id> or <id>@<${REASONING_EFFORTS.join('|')}>`);
  }
  return { spec, id, effort };
}

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
 * response_format:{type:'json_object'} — llmStructurer.js:83); a spec with
 * an effort suffix also needs the `reasoning` parameter.
 *
 * @param {Array<{spec, id, effort}>} specs - from parseModelSpec()
 * @param {Map|null} catalog - from fetchCatalog(); null = unverifiable
 * @returns {{ usable: Array<{spec, id, effort, pricing}>, skipped: Array<{id, reason}> }}
 */
export function verifyModels(specs, catalog) {
  if (!catalog) {
    return { usable: specs.map((s) => ({ ...s, pricing: null })), skipped: [] };
  }
  const usable = [];
  const skipped = [];
  for (const s of specs) {
    const entry = catalog.get(s.id);
    if (!entry) {
      skipped.push({ id: s.spec, reason: 'not found in OpenRouter catalog' });
    } else if (!entry.inputModalities.includes('image')) {
      skipped.push({ id: s.spec, reason: `no image input (modalities: ${entry.inputModalities.join(',')})` });
    } else if (!entry.supportedParameters.includes('response_format')) {
      skipped.push({ id: s.spec, reason: 'response_format not supported (structurer requires json_object)' });
    } else if (s.effort && !entry.supportedParameters.includes('reasoning')) {
      skipped.push({ id: s.spec, reason: 'reasoning parameter not supported' });
    } else {
      usable.push({ ...s, pricing: entry.pricing });
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
