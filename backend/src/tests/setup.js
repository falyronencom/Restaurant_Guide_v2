/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Jest per-file setup (wired via setupFilesAfterEnv).
 *
 * Runs inside each test file's context. The one-time global baseline
 * (database truncate) lives in globalSetup.js, which Jest invokes once in a
 * separate context before the whole run — see jest.config.js `globalSetup`.
 */

import logger from '../utils/logger.js';

// Load-bearing side-effect import. As a setupFilesAfterEnv module, this runs
// before any test file body — so config/database.js is evaluated (and its pool
// 'connect'/'error' handlers capture the REAL logger) BEFORE a test can register
// a logger mock. Without it, unit tests that mock logger without a `debug`
// method while using the real pool throw "logger.debug is not a function" in
// the async pool 'connect' handler. Do not remove because it looks unused.
import '../config/database.js';

/**
 * Before each test file: silence logs unless explicitly debugging.
 */
beforeAll(async () => {
  if (process.env.LOG_LEVEL !== 'debug') {
    logger.transports.forEach(transport => {
      transport.silent = true;
    });
  }
});

/**
 * After each test file: small delay to let async operations settle.
 */
afterAll(async () => {
  await new Promise(resolve => setTimeout(resolve, 100));
});
