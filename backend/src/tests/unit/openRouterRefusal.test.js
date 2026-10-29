/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * OpenRouter's error answers to the recognition calls, as one error each
 * (services/ocr/openRouterRefusal.js, directive D8 of 28.10.2026).
 *
 * The key's refusal — 401, 402, 403 of a spent budget — carries the code
 * KEY_REFUSED and a message the partner's classifier reads as «unavailable»;
 * every other answer keeps the message these calls have always thrown, so the
 * job retries it as before. The bodies are the shapes of OpenRouter's docs
 * (api-reference/errors, …/limits, read 28.10.2026), not live answers.
 */

const { KEY_REFUSED, callError, isKeyRefusal, limitSourceOf } = await import('../../services/ocr/openRouterRefusal.js');
const { KEY_REFUSED_MESSAGE, failureReasonOf } = await import('../../services/ocr/failureReason.js');

const body = (code, limitSource, message = 'refused') => JSON.stringify({
  error: { code, message, ...(limitSource && { metadata: { limit_source: limitSource, remedy_hint: 'x' } }) },
});

describe('callError — the key\'s refusal fails the job at once', () => {
  test.each([
    ['401, the key disabled or deleted (the incident of 22.10)', 401, '{"error":{"message":"User not found.","code":401}}', null],
    ['401 of an expired key', 401, body(401, null, 'API key expired'), null],
    ['402, the key\'s limit spent', 402, body(402, 'openrouter_key_limit'), 'openrouter_key_limit'],
    ['402, the balance spent', 402, body(402, 'openrouter_credits'), 'openrouter_credits'],
    ['402 without a body to read', 402, 'Payment Required', null],
    ['403, the key\'s own limit spent', 403, body(403, 'openrouter_key_limit'), 'openrouter_key_limit'],
    ['403, a workspace budget spent', 403, body(403, 'openrouter_workspace_budget'), 'openrouter_workspace_budget'],
    ['403, a guardrail budget spent', 403, body(403, 'openrouter_guardrail_budget'), 'openrouter_guardrail_budget'],
  ])('%s', (_label, status, bodyText, limitSource) => {
    for (const stage of ['vision', 'structurer']) {
      const error = callError({ stage, status, bodyText });

      expect(error.code).toBe(KEY_REFUSED);
      const source = limitSource ? ` ${limitSource}` : '';
      expect(error.message).toBe(`${KEY_REFUSED_MESSAGE} (${stage} call): ${status}${source} ${bodyText.slice(0, 200)}`);
      expect(failureReasonOf(error.message)).toBe('unavailable');
    }
  });
});

describe('callError — every other answer as before: retried by the job', () => {
  test.each([
    ['500', 500, 'upstream failure'],
    ['503, no provider', 503, body(503, null)],
    ['429, rate limited', 429, body(429, null)],
    ['400, a bad request', 400, body(400, null)],
    // Passing: requests in flight filled the budget; Retry-After says when.
    ['402 of the in-flight budget', 402, body(402, 'openrouter_in_flight_budget')],
    // Not the key: a flagged input or a guardrail's rule.
    ['403 of a moderation flag', 403, JSON.stringify({ error: { code: 403, message: 'flagged', metadata: { reasons: ['x'] } } })],
    ['403 without a body to read', 403, 'Forbidden'],
  ])('%s', (_label, status, bodyText) => {
    const error = callError({ stage: 'vision', status, bodyText });

    expect(error.code).toBeUndefined();
    expect(error.message).toBe(`OpenRouter vision call failed: ${status} ${bodyText.slice(0, 200)}`);
    expect(failureReasonOf(error.message)).toBe('serviceFailure');
  });

  test('the body in the message stays cut to 200 characters, as before', () => {
    const long = body(402, 'openrouter_credits', 'x'.repeat(500));
    expect(callError({ stage: 'vision', status: 402, bodyText: long }).message.endsWith(long.slice(0, 200))).toBe(true);
    expect(callError({ stage: 'vision', status: 500, bodyText: 'y'.repeat(500) }).message)
      .toBe(`OpenRouter vision call failed: 500 ${'y'.repeat(200)}`);
  });

  test('limit_source is read from the whole body, not its first 200 characters', () => {
    const metadataLate = JSON.stringify({
      error: { code: 403, message: 'm'.repeat(300), metadata: { limit_source: 'openrouter_key_limit' } },
    });
    expect(callError({ stage: 'vision', status: 403, bodyText: metadataLate }).code).toBe(KEY_REFUSED);
  });
});

describe('limitSourceOf and isKeyRefusal', () => {
  test.each([
    ['not JSON', 'oops', null],
    ['JSON without error', '{}', null],
    ['metadata without limit_source', body(402, null), null],
    ['a number where the name should be', JSON.stringify({ error: { metadata: { limit_source: 1 } } }), null],
    ['a name', body(402, 'openrouter_credits'), 'openrouter_credits'],
    ['an empty body', '', null],
  ])('limitSourceOf: %s', (_label, text, expected) => {
    expect(limitSourceOf(text)).toBe(expected);
  });

  test('a status of its own decides 401 and 402, limit_source decides 403', () => {
    expect(isKeyRefusal(401, null)).toBe(true);
    expect(isKeyRefusal(402, null)).toBe(true);
    expect(isKeyRefusal(402, 'openrouter_in_flight_budget')).toBe(false);
    expect(isKeyRefusal(403, null)).toBe(false);
    expect(isKeyRefusal(403, 'openrouter_credits')).toBe(false);
    expect(isKeyRefusal(403, 'openrouter_key_limit')).toBe(true);
    expect(isKeyRefusal(500, 'openrouter_key_limit')).toBe(false);
    expect(isKeyRefusal(429, null)).toBe(false);
  });
});
