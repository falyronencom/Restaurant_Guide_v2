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

// Чистка refresh_tokens: ключи есть в .env.example, значит попадут в чей-нибудь
// .env — и оттуда в тестовый процесс, потому что политика резолвится лениво из
// process.env. Пустая строка = «не задано» для резолвера, то есть тест всегда
// начинает с умолчаний, а не с настройки разработчика.
if (process.env.REFRESH_TOKEN_RETENTION_DAYS === undefined) {
  process.env.REFRESH_TOKEN_RETENTION_DAYS = '';
}
if (process.env.REFRESH_TOKEN_PRUNE_INTERVAL_MS === undefined) {
  process.env.REFRESH_TOKEN_PRUNE_INTERVAL_MS = '';
}

// Принимаемые приложения Яндекса: ключ есть в .env.example. Пустая строка =
// «не задано» для резолвера (config/oauth.js), то есть тесты начинают с
// умолчания, а не с настройки разработчика.
if (process.env.YANDEX_CLIENT_ID === undefined) {
  process.env.YANDEX_CLIENT_ID = '';
}

// Пределы общего лимитера — как в CI, где они не заданы: пустая строка =
// «не задано» для резолвера (middleware/rateLimiter.js), то есть умолчания.
// Безусловно, а не «если не задано»: в .env разработчика они бывают (1000 и
// 3000 вместо 100 и 300), а наборы на умолчаниях с ними вели себя не как в CI.
// Набор, которому нужны свои пределы, ставит их сам до загрузки сервера
// (rate-limit-by-account, суточные пределы загрузок) — этот файл идёт раньше.
// Счётчики живут в Redis: в CI он свежий, раннер изоляции (scripts/test-isolated)
// чистит свой индекс на старте; обычная команда (индекс 1) не чистит — второй
// полный прогон ею в тот же час может упереться в 300 запросов анонима.
for (const name of [
  'RATE_LIMIT_AUTHENTICATED',
  'RATE_LIMIT_WINDOW_AUTHENTICATED',
  'RATE_LIMIT_UNAUTHENTICATED',
  'RATE_LIMIT_WINDOW_UNAUTHENTICATED',
]) {
  process.env[name] = '';
}

// Число доверенных узлов края (config/trustProxy.js) — как в CI: пустая
// строка = умолчание. Безусловно: значение из .env разработчика поменяло бы,
// чей адрес становится req.ip, во всех наборах сразу.
process.env.TRUST_PROXY_HOPS = '';

// Verify we're in test environment
if (process.env.NODE_ENV !== 'test') {
  console.error('ERROR: Tests must run in NODE_ENV=test environment!');
  process.exit(1);
}

console.log('✅ Test environment variables loaded from .env.test');
