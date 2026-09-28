/**
 * Изолированный прогон backend-тестов — логика. Запуск — index.js:
 * `node scripts/test-isolated <сессия> [аргументы jest]`.
 *
 * Зачем (28.09.2026, чип из сессии «модель OCR»). Локальная тестовая база
 * restaurant_guide_test и индекс Redis 1 общие для всех сессий на машине.
 * globalSetup усекает таблицы в начале КАЖДОГО прогона, сьюты чистят их в
 * beforeEach, четыре интеграционных файла пишут настоящие ключи Redis
 * (счётчики лимитов; глобальный лимитер «300 запросов в час» ключуется по IP,
 * а под supertest IP всегда один), canon-check пересоздаёт служебную базу.
 * Поэтому два одновременных прогона из разных сессий портят друг другу
 * данные: 07.09.2026 — 44 ошибки «duplicate key … users_email_key» и
 * производные TypeError против 2 настоящих expect, по одному сьюты зелёные.
 *
 * Что раннер даёт сессии:
 * - свою базу restaurant_guide_test_session_<сессия>, пересобранную на старте
 *   каждого прогона по рецепту CI. Список файлов читается из ci.yml
 *   (parseSchemaRecipe), поэтому состав совпадает с гейтом и не отстаёт от
 *   него, когда туда добавят миграцию. Шаблон — template_postgis: в CI база
 *   создаётся init-скриптом образа postgis с тем же набором расширений;
 * - свой индекс Redis из 2…15 (0 — dev по backend/.env, 1 — обычные прогоны
 *   по .env.test), закреплённый за сессией в комментарии её базы и очищаемый
 *   на старте прогона;
 * - свою служебную базу canon-check — её имя выводится из DB_NAME
 *   (tests/testDatabases.js);
 * - замок сессии на время прогона: второй прогон с тем же именем получает
 *   отказ, а не тихое столкновение.
 *
 * Уборка (решение Координатора 28.09.2026): сессий не больше, чем индексов
 * Redis. Когда новой сессии не хватает индекса, раннер удаляет базу самой
 * давно собранной из простаивающих сессий и забирает её индекс
 * (planRedisDb). База пересобирается на каждом прогоне, так что удаление
 * теряет только данные последнего прогона для разбора.
 *
 * Не изолирует backend/tmp/uploads: каталог временных файлов multer зашит в
 * middleware/upload.js относительно модуля. Два прогона из ОДНОГО checkout
 * делят его, и тесты media/promotions, сверяющие «новых файлов не
 * появилось», могут изредка покраснеть — раннер предупреждает о таком
 * соседстве. У прогонов из разных worktree каталоги разные.
 */

import { join } from 'path';
import { canonScratchDbName } from '../../src/tests/testDatabases.js';

export const SESSION_DB_PREFIX = 'restaurant_guide_test_session_';
export const SESSION_NAME_MAX = 20;

/**
 * Латиница в нижнем регистре и цифры, одиночные «_» между ними, первая —
 * буква. Двойное подчёркивание запрещено: им отделяется служебная база
 * (`<база сессии>__canon`), и она не должна читаться как база другой сессии.
 */
const SESSION_NAME_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** 0 — dev (backend/.env), 1 — обычные тестовые прогоны (.env.test). */
export const REDIS_DB_FIRST = 2;
export const REDIS_DB_LAST = 15;

/** Метка комментария базы сессии: по ней раннер узнаёт свою запись реестра. */
export const REGISTRY_KIND = 'rg-test-session';

/** Префикс application_name соединений раннера и ключей его advisory-замков. */
export const RUN_LABEL_PREFIX = 'rgtest:';

/** Замок раздачи индексов Redis: выбор индекса и запись его в реестр идут под ним. */
export const PROVISION_LOCK = `${RUN_LABEL_PREFIX}provision`;

export const EXIT = { USAGE: 2, BUSY: 3, NO_SLOT: 4, ENV: 5 };

export function validateSessionName(name) {
  if (typeof name !== 'string' || name.length > SESSION_NAME_MAX || !SESSION_NAME_RE.test(name)) {
    throw new Error(
      `Имя сессии — латиница в нижнем регистре и цифры, одиночные "_" между ними, `
      + `начинается с буквы, не длиннее ${SESSION_NAME_MAX} символов (получено: ${JSON.stringify(name)})`,
    );
  }
  return name;
}

export function sessionDbName(session) {
  return SESSION_DB_PREFIX + validateSessionName(session);
}

/** Имя сессии по имени базы или null, если база не база сессии (в том числе служебная). */
export function sessionNameOf(dbName) {
  if (typeof dbName !== 'string' || !dbName.startsWith(SESSION_DB_PREFIX)) return null;
  const name = dbName.slice(SESSION_DB_PREFIX.length);
  return name.length <= SESSION_NAME_MAX && SESSION_NAME_RE.test(name) ? name : null;
}

/**
 * Раннер удаляет только базу сессии и её служебную базу canon-check — ни
 * одной другой: ни общую restaurant_guide_test, ни её служебную, ни базы
 * без "test" в имени. Проверка стоит перед каждым DROP DATABASE раннера.
 */
export function isDroppableByRunner(dbName) {
  if (typeof dbName !== 'string' || !dbName.includes('test')) return false;
  if (sessionNameOf(dbName)) return true;
  const base = dbName.slice(0, Math.max(dbName.lastIndexOf('__'), 0));
  return sessionNameOf(base) !== null && canonScratchDbName(base) === dbName;
}

/** application_name соединения, которое держит замок сессии, пока идёт прогон. */
export function runLabel(session) {
  return `${RUN_LABEL_PREFIX}${session}`;
}

/** Ключ advisory-замка сессии (в SQL — hashtextextended(ключ, 0)). */
export function sessionLockKey(session) {
  return `${RUN_LABEL_PREFIX}session:${session}`;
}

export function isSessionRedisDb(value) {
  return Number.isInteger(value) && value >= REDIS_DB_FIRST && value <= REDIS_DB_LAST;
}

/**
 * Рецепт тестовой схемы из ci.yml: файлы `-f backend/migrations/<файл>.sql`
 * в порядке появления. CI накатывает их psql-ом на пустую базу — раннер
 * повторяет то же самое, поэтому источник один и отдельного списка, который
 * отстал бы от гейта, нет. Бросает, если рецепт не читается: раннер,
 * молча собравший другую схему, был бы хуже раннера, который отказался.
 *
 * Комментарии отбрасываются до разбора — и YAML-овские, и shell-овские
 * внутри блока run (и там и там `#` в начале строки или после пробела):
 * закомментированный `-f …` — обычный способ выключить файл, и собрать его
 * значило бы разойтись с CI (ревью Phase 3.5, 28.09.2026).
 */
export function parseSchemaRecipe(ciYaml) {
  const uncommented = ciYaml
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
  const files = [...uncommented.matchAll(/(?:^|\s)-f\s+backend\/migrations\/([A-Za-z0-9_.-]+\.sql)(?=\s|$)/gm)]
    .map((match) => match[1]);
  if (files.length === 0) {
    throw new Error('В ci.yml нет ни одного `-f backend/migrations/<файл>.sql` — рецепт тестовой схемы не прочитан');
  }
  if (files[0] !== 'production_schema.sql') {
    throw new Error(`Рецепт ci.yml должен начинаться со снапшота production_schema.sql, а начинается с ${files[0]}`);
  }
  const duplicate = files.find((file, index) => files.indexOf(file) !== index);
  if (duplicate) {
    throw new Error(`Файл ${duplicate} встречается в рецепте ci.yml дважды`);
  }
  return files;
}

/**
 * Текст файла рецепта в том виде, в каком его видит CI: в репозитории строки
 * заканчиваются LF, а checkout на Windows (core.autocrlf) отдаёт CRLF — без
 * нормализации тела функций в базе сессии несли бы лишние \r.
 */
export function normalizeSql(text) {
  return text.replace(/\r\n/g, '\n');
}

export function formatRegistryComment({ session, redisDb, checkout, createdAt }) {
  return JSON.stringify({ kind: REGISTRY_KIND, session, redisDb, checkout, createdAt });
}

/** Запись реестра из комментария базы или null, если комментарий не раннера. */
export function parseRegistryComment(text) {
  if (!text) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || data.kind !== REGISTRY_KIND) return null;
  return {
    session: typeof data.session === 'string' ? data.session : null,
    // Индекс вне 2…15 не принимается ни при каком содержимом комментария:
    // раннер очищает индекс сессии FLUSHDB, а 0 и 1 принадлежат dev и
    // обычным прогонам.
    redisDb: isSessionRedisDb(data.redisDb) ? data.redisDb : null,
    checkout: typeof data.checkout === 'string' ? data.checkout : null,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
  };
}

/**
 * Индекс Redis для сессии.
 *   own    — запись реестра самой сессии (её база уже есть) или null;
 *   others — записи остальных сессий: { session, redisDb, createdAt, idle }.
 * Возвращает { redisDb, reclaim }: reclaim — имя сессии, чью базу надо
 * удалить, чтобы забрать её индекс, иначе null. Свой индекс сохраняется,
 * если его не заявила другая сессия; иначе берётся наименьший свободный;
 * если свободных нет — индекс самой давно собранной простаивающей сессии.
 * Если заняты все и все прогоны идут — { redisDb: null, reclaim: null }.
 */
export function planRedisDb({ own, others }) {
  const held = new Set(others.map((entry) => entry.redisDb).filter(isSessionRedisDb));
  if (own && isSessionRedisDb(own.redisDb) && !held.has(own.redisDb)) {
    return { redisDb: own.redisDb, reclaim: null };
  }
  for (let index = REDIS_DB_FIRST; index <= REDIS_DB_LAST; index += 1) {
    if (!held.has(index)) return { redisDb: index, reclaim: null };
  }
  const victim = others
    .filter((entry) => entry.idle && isSessionRedisDb(entry.redisDb))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))[0];
  return victim
    ? { redisDb: victim.redisDb, reclaim: victim.session }
    : { redisDb: null, reclaim: null };
}

/**
 * Где лежит .env.test: в этом checkout, а в свежем worktree (файл
 * гитигнорен и туда не попадает) — в основном checkout. Копий не делается
 * (решение Координатора 28.09.2026): копия отстала бы от оригинала, как уже
 * бывало с заглушками Cloudinary.
 */
export function findEnvTestFile({ backendDir, mainCheckoutDir, exists }) {
  const candidates = [join(backendDir, '.env.test')];
  if (mainCheckoutDir) candidates.push(join(mainCheckoutDir, 'backend', '.env.test'));
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

/**
 * Окружение jest. Как у dotenv, заданное в процессе сильнее файла; но базу,
 * индекс Redis и NODE_ENV раннер назначает сам — ради них он и запущен.
 * setup-env.js и globalSetup.js потом грузят .env.test ещё раз, и dotenv
 * заданное не перезаписывает.
 */
export function buildChildEnv({ fileEnv, processEnv, dbName, redisDb }) {
  return {
    ...fileEnv,
    ...processEnv,
    NODE_ENV: 'test',
    DB_NAME: dbName,
    REDIS_DB: String(redisDb),
  };
}
