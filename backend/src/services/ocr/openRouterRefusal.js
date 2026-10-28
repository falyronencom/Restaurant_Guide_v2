/**
 * An error answer of OpenRouter to a recognition call — vision
 * (visionOcrAdapter) or the structurer (llmStructurer) — as one error to throw.
 *
 * Why (directive D8 of 28.10.2026, item 13 of the list of that day). The
 * server's key has a spending limit, and the account's balance is shared by
 * every key. When either is spent, or the key is revoked, every call answers
 * the same refusal until the owner acts in OpenRouter's panel. The job used to
 * repeat it three times in a row and tell the partner «Сбой распознавания»;
 * now such an error carries the code KEY_REFUSED, the job fails for good at
 * once (ocrService processJob), and the partner reads «Распознавание меню
 * временно недоступно» (failureReason.js, unavailable).
 *
 * Which answers are the key's (https://openrouter.ai/docs/api-reference/errors,
 * …/limits; read 28.10.2026):
 *   - 401 — invalid credentials: the key is disabled, deleted or wrong;
 *   - 402 — the account or the key has no credits left. Except
 *     limit_source = openrouter_in_flight_budget: requests in flight filled a
 *     short-lived budget, the answer comes with Retry-After — passing, so the
 *     job keeps its usual retries;
 *   - 403 — only with limit_source of a spent budget: the key's own limit,
 *     a workspace's or a guardrail's. Any other 403 (a moderation flag, a
 *     guardrail's rule) is not the key: as before.
 * Every other answer — 429, 5xx, 400 — is an error as before, retried by the
 * job.
 *
 * The message keeps the provider's body to 200 characters, as before: the
 * moderator and the log read it. The body is OpenRouter's answer — it does not
 * echo the key.
 */

import { KEY_REFUSED_MESSAGE } from './failureReason.js';

/** Code of an error OpenRouter answered with because of the key or the balance. */
export const KEY_REFUSED = 'OPENROUTER_KEY_REFUSED';

/** 402 of a passing budget of requests in flight — retried, not the key. */
const PASSING_402 = 'openrouter_in_flight_budget';

/** 403 of a spent budget — the key's own limit, a workspace's, a guardrail's. */
const SPENT_BUDGET_403 = new Set([
  'openrouter_key_limit',
  'openrouter_workspace_budget',
  'openrouter_guardrail_budget',
]);

const BODY_LIMIT = 200;

/**
 * error.metadata.limit_source of OpenRouter's error body, or null when the
 * body is not JSON or names none.
 *
 * @param {string} bodyText
 * @returns {string|null}
 */
export const limitSourceOf = (bodyText) => {
  try {
    const source = JSON.parse(bodyText)?.error?.metadata?.limit_source;
    return typeof source === 'string' ? source : null;
  } catch {
    return null;
  }
};

/**
 * Whether an answer is the key's refusal (see the header).
 *
 * @param {number} status - HTTP status
 * @param {string|null} limitSource - error.metadata.limit_source
 * @returns {boolean}
 */
export const isKeyRefusal = (status, limitSource) => status === 401
  || (status === 402 && limitSource !== PASSING_402)
  || (status === 403 && SPENT_BUDGET_403.has(limitSource));

/**
 * The error to throw for a call OpenRouter answered with an error status.
 *
 * @param {Object} answer
 * @param {'vision'|'structurer'} answer.stage - Which call
 * @param {number} answer.status - HTTP status
 * @param {string} answer.bodyText - The answer's body
 * @returns {Error} code KEY_REFUSED and the message KEY_REFUSED_MESSAGE for
 *   the key's refusal; otherwise «OpenRouter <stage> call failed: <status> …»,
 *   the message these calls have always thrown
 */
export const callError = ({ stage, status, bodyText }) => {
  const body = String(bodyText ?? '').slice(0, BODY_LIMIT);
  const limitSource = limitSourceOf(bodyText);
  if (!isKeyRefusal(status, limitSource)) {
    return new Error(`OpenRouter ${stage} call failed: ${status} ${body}`);
  }
  const source = limitSource ? ` ${limitSource}` : '';
  const error = new Error(`${KEY_REFUSED_MESSAGE} (${stage} call): ${status}${source} ${body}`);
  error.code = KEY_REFUSED;
  return error;
};
