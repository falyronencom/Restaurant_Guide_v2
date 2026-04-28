/**
 * Environment Setup - Runs BEFORE any imports
 *
 * This file loads .env.test before any other modules are imported.
 * This is critical because some modules (like jwt.js) validate environment
 * variables at module load time.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load test environment variables FIRST
const testEnvPath = join(__dirname, '../../.env.test');
dotenv.config({ path: testEnvPath });

// Block .env inheritance for vars that must NOT leak from development into tests.
// When .env.test does not define a var that .env defines, the second dotenv.config()
// call (in src/config/database.js) reads .env and pollutes process.env with real
// production credentials. Setting an explicit empty string here makes the var
// "defined" so dotenv skips it on subsequent loads.
if (process.env.OPENROUTER_API_KEY === undefined) {
  process.env.OPENROUTER_API_KEY = '';
}
if (process.env.RESEND_API_KEY === undefined) {
  process.env.RESEND_API_KEY = '';
}

// Verify we're in test environment
if (process.env.NODE_ENV !== 'test') {
  console.error('ERROR: Tests must run in NODE_ENV=test environment!');
  process.exit(1);
}

console.log('✅ Test environment variables loaded from .env.test');
