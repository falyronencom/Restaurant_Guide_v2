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
// Cloudinary: здесь пустая строка НЕ годится. Media-путь строит pg_1 preview-URL
// для PDF через cloudinary.url(), а тот без cloud_name бросает исключение —
// наблюдалось как HTTP 500 в CI 2026-08-24 (два теста establishments.test.js).
// Поэтому подставляем заведомо нерабочие заглушки: протёк БОЕВЫХ ключей из .env
// заблокирован, а сборка URL продолжает работать. Сетевых вызовов на этом пути
// нет — фикстуры содержат готовые res.cloudinary.com/test/... URL, а проверки
// структурные (file_type, наличие pg_1). Значения совпадают с теми, что пишет
// .github/workflows/ci.yml, чтобы локальная среда и CI не расходились.
if (process.env.CLOUDINARY_CLOUD_NAME === undefined) {
  process.env.CLOUDINARY_CLOUD_NAME = 'test';
}
if (process.env.CLOUDINARY_API_KEY === undefined) {
  process.env.CLOUDINARY_API_KEY = '000000000000000';
}
if (process.env.CLOUDINARY_API_SECRET === undefined) {
  process.env.CLOUDINARY_API_SECRET = 'ci-dummy-no-network-calls-in-tests';
}

// Verify we're in test environment
if (process.env.NODE_ENV !== 'test') {
  console.error('ERROR: Tests must run in NODE_ENV=test environment!');
  process.exit(1);
}

console.log('✅ Test environment variables loaded from .env.test');
