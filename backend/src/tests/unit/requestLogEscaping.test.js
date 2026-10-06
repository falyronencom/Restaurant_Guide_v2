/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Request log line escapes client-controlled text (morgan ≥ 1.12).
 *
 * server.js pipes every morgan line into logger.info. Before 1.12 morgan
 * wrote request text raw: quotes, backslashes and line separators from the
 * URL, Referer, User-Agent or Basic-auth user landed in the log as-is, so a
 * client could fake fields of its own log entry (GHSA-9f6g-j8ch-79g4,
 * GHSA-jxfw-x594-9x9m, GHSA-4vj7-5mj6-jm8m). 1.12 escapes every token value.
 *
 * Under NODE_ENV=test the format is 'dev', whose only client-controlled token
 * is :url; supertest percent-encodes '"' but sends '\' raw, so the backslash
 * is the observable here. Production ('combined') goes through the same
 * per-token escaping.
 */
import { jest } from '@jest/globals';

// Same isolation as trustProxy.test.js: the real app, no live Redis.
jest.unstable_mockModule('../../config/redis.js', () => ({
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
  incrementWithExpiry: jest.fn(),
  getCounter: jest.fn(),
  getTTL: jest.fn(),
  setWithExpiry: jest.fn(),
  deleteKey: jest.fn(),
  withRedisDeadline: (command) => command,
  default: {},
}));

const { default: app } = await import('../../server.js');
const { default: logger } = await import('../../utils/logger.js');
const { incrementWithExpiry, getTTL } = await import('../../config/redis.js');
const { default: request } = await import('supertest');

describe('request log line', () => {
  let info;

  beforeEach(() => {
    incrementWithExpiry.mockResolvedValue(1);
    getTTL.mockResolvedValue(3600);
    info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
  });

  afterEach(() => {
    info.mockRestore();
  });

  test('a backslash from the request URL is written escaped, not raw', async () => {
    await request(app).get('/api/v1/__request_log_probe__?q=a\\b');

    // morgan writes on 'finish'; give the event loop a turn if it has not yet.
    for (let i = 0; i < 20 && !info.mock.calls.some(([m]) => String(m).includes('__request_log_probe__')); i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const line = info.mock.calls.map(([m]) => String(m)).find((m) => m.includes('__request_log_probe__'));

    expect(line).toBeDefined();
    expect(line).toContain('q=a\\\\b');
  });
});
