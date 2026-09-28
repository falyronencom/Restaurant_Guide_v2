/**
 * Имена баз, которые тестовый прогон создаёт сам, — единый источник для
 * canon-check (integration/canon-check.integration.test.js поднимает
 * служебную базу) и для раннера изолированных прогонов (scripts/test-isolated),
 * который убирает служебную базу вместе с базой сессии.
 *
 * Имя служебной базы выводится из DB_NAME прогона, а не зашито. До 28.09.2026
 * оно было фиксированным (seed_canon_itest) и потому общим для параллельных
 * сессий: beforeAll одного прогона делал pg_terminate_backend + DROP DATABASE
 * под другим. Теперь служебная база принадлежит той же базе, что и весь
 * прогон: подменили DB_NAME — изолирована и она.
 */

/**
 * Разделитель — двойное подчёркивание: в имени сессии его быть не может
 * (scripts/test-isolated/session.js), поэтому служебная база никогда не
 * совпадёт с базой другой сессии.
 */
export const SCRATCH_SEPARATOR = '__';

/** PostgreSQL молча обрезает идентификатор до 63 байт: два длинных имени слились бы в одно. */
export const PG_IDENTIFIER_MAX_BYTES = 63;

/** Имя подставляется в DROP/CREATE DATABASE без кавычек — только такие символы. */
const SAFE_IDENTIFIER = /^[a-z0-9_]+$/;

/**
 * Имя служебной базы прогона: `<DB_NAME>__<purpose>`.
 * Бросает, если база прогона не тестовая, если имя не годится в
 * идентификатор без кавычек или длиннее, чем PostgreSQL сохранит.
 */
export function scratchDbName(dbName, purpose) {
  if (!dbName || !dbName.includes('test')) {
    throw new Error(
      `Служебная база выводится только из тестовой: DB_NAME должен содержать "test" (сейчас: ${dbName})`,
    );
  }
  const name = `${dbName}${SCRATCH_SEPARATOR}${purpose}`;
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Имя служебной базы допускает только a-z, 0-9 и "_": ${name}`);
  }
  if (Buffer.byteLength(name, 'utf8') > PG_IDENTIFIER_MAX_BYTES) {
    throw new Error(`Имя служебной базы длиннее ${PG_IDENTIFIER_MAX_BYTES} байт: ${name}`);
  }
  return name;
}

/** Служебная база canon-check (миграции 030 + 031 на копии схемы) для базы прогона dbName. */
export function canonScratchDbName(dbName) {
  return scratchDbName(dbName, 'canon');
}
