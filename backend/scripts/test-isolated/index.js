/* eslint-disable no-console */
/**
 * Изолированный прогон backend-тестов — запуск. Логика и причины — session.js.
 *
 *   cd backend
 *   node scripts/test-isolated <сессия> [аргументы jest]   # или: npm run test:isolated -- <сессия> …
 *   node scripts/test-isolated --list                      # сессии: индекс Redis, идёт ли прогон
 *   node scripts/test-isolated --drop <сессия>             # удалить базу сессии, если прогон не идёт
 *   node scripts/test-isolated --drop-idle                 # удалить базы всех простаивающих сессий
 *
 * Пример: node scripts/test-isolated ocr --testPathPatterns='promotions|media'
 *
 * Имя сессии выбирает сама сессия — короткое, по теме работы (ocr, trunk_t1).
 * Без раннера всё как прежде: общая restaurant_guide_test и индекс Redis 1;
 * CI раннер не использует.
 *
 * Коды выхода: код jest (0 — зелёный, 1 — красный); 2 — ошибка в команде;
 * 3 — сессия или её база заняты; 4 — все индексы Redis заняты идущими
 * прогонами; 5 — среда не готова (pg-test, .env.test, node_modules, рецепт).
 */

import { execFileSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import { createClient } from 'redis';
import { canonScratchDbName } from '../../src/tests/testDatabases.js';
import {
  EXIT,
  PROVISION_LOCK,
  REDIS_DB_FIRST,
  REDIS_DB_LAST,
  RUN_LABEL_PREFIX,
  SESSION_DB_PREFIX,
  buildChildEnv,
  findEnvTestFile,
  formatRegistryComment,
  isDroppableByRunner,
  isSessionRedisDb,
  normalizeSql,
  parseRegistryComment,
  parseSchemaRecipe,
  planRedisDb,
  runLabel,
  sessionDbName,
  sessionLockKey,
  sessionNameOf,
  validateSessionName,
} from './session.js';

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI_WORKFLOW = resolve(BACKEND_DIR, '..', '.github', 'workflows', 'ci.yml');
const MIGRATIONS_DIR = join(BACKEND_DIR, 'migrations');
const JEST_BIN = join(BACKEND_DIR, 'node_modules', 'jest', 'bin', 'jest.js');
/** Путь checkout в реестре — с прямыми слэшами, чтобы сравнение не зависело от записи. */
const CHECKOUT = BACKEND_DIR.replace(/\\/g, '/');

class RunnerError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

const usageError = (error) => new RunnerError(EXIT.USAGE, error.message);

function mainCheckoutDir() {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return dirname(commonDir);
  } catch {
    return null;
  }
}

/** Значения .env.test и окружение, в котором они действуют (заданное в процессе сильнее файла). */
function loadTestEnv() {
  const file = findEnvTestFile({ backendDir: BACKEND_DIR, mainCheckoutDir: mainCheckoutDir(), exists: existsSync });
  if (!file) {
    throw new RunnerError(EXIT.ENV, `Нет backend/.env.test ни в этом checkout (${BACKEND_DIR}), ни в основном`);
  }
  const values = dotenv.parse(readFileSync(file));
  return { file, values, env: { ...values, ...process.env } };
}

function pgConnection(env) {
  return {
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || '5432', 10),
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD,
  };
}

async function connectMaintenance(conn, applicationName) {
  const client = new pg.Client({ ...conn, database: 'postgres', application_name: applicationName });
  try {
    await client.connect();
  } catch (error) {
    throw new RunnerError(
      EXIT.ENV,
      `Postgres недоступен на ${conn.host}:${conn.port} (${error.message}) — запущен ли контейнер pg-test?`,
    );
  }
  return client;
}

const tryLock = async (client, key) => (
  await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok', [key])
).rows[0].ok;
const unlock = (client, key) => client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);

/** Под этим замком раздаются индексы Redis и удаляются базы сессий — по одному раннеру за раз. */
async function withProvisionLock(client, work) {
  await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [PROVISION_LOCK]);
  try {
    return await work();
  } finally {
    await unlock(client, PROVISION_LOCK);
  }
}

/**
 * Реестр сессий: базы с префиксом сессий, их комментарии и живые
 * соединения. «Идёт прогон» — есть соединение раннера с меткой сессии;
 * «простаивает» — прогона нет и к базе (и её служебной) никто не подключён.
 */
async function readRegistry(client) {
  const { rows: databases } = await client.query(
    `SELECT datname, shobj_description(oid, 'pg_database') AS comment
       FROM pg_database
      WHERE starts_with(datname, $1)
      ORDER BY datname`,
    [SESSION_DB_PREFIX],
  );
  const { rows: activity } = await client.query(
    'SELECT datname, application_name FROM pg_stat_activity WHERE pid <> pg_backend_pid()',
  );
  return databases.flatMap(({ datname, comment }) => {
    const session = sessionNameOf(datname);
    if (!session) return []; // служебная база сессии — учитывается вместе со своей
    const scratch = canonScratchDbName(datname);
    const record = parseRegistryComment(comment) ?? {};
    const running = activity.some((row) => row.application_name === runLabel(session));
    const connections = activity.filter((row) => row.datname === datname || row.datname === scratch).length;
    return [{
      session,
      dbName: datname,
      redisDb: record.redisDb ?? null,
      checkout: record.checkout ?? null,
      createdAt: record.createdAt ?? null,
      running,
      connections,
      idle: !running && connections === 0,
    }];
  });
}

async function dropDatabase(client, dbName) {
  if (!isDroppableByRunner(dbName)) {
    throw new Error(`Раннер удаляет только базы сессий (${SESSION_DB_PREFIX}…) — отказ удалять ${dbName}`);
  }
  try {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(dbName)}`);
  } catch (error) {
    if (error.code === '55006') { // object_in_use
      throw new RunnerError(
        EXIT.BUSY,
        `К базе ${dbName} подключены другие соединения — осиротевший прогон jest или открытый psql. `
        + 'Заверши его и повтори (живые jest: PowerShell Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" '
        + '| Where-Object { $_.CommandLine -match \'jest\' }).',
      );
    }
    throw error;
  }
}

/** Удаляет базу сессии и её служебную, если прогон сессии не идёт (замок сессии свободен). */
async function dropSession(client, entry) {
  if (!(await tryLock(client, sessionLockKey(entry.session)))) {
    throw new RunnerError(EXIT.BUSY, `у сессии «${entry.session}» идёт прогон`);
  }
  try {
    await dropDatabase(client, canonScratchDbName(entry.dbName));
    await dropDatabase(client, entry.dbName);
  } finally {
    await unlock(client, sessionLockKey(entry.session));
  }
}

/** Очищает индекс Redis сессии. Возвращает null при успехе или текст ошибки. */
async function flushRedisDb(env, index) {
  if (!isSessionRedisDb(index)) {
    throw new Error(`Отказ очищать индекс Redis ${index}: раннеру принадлежат только ${REDIS_DB_FIRST}…${REDIS_DB_LAST}`);
  }
  const client = createClient({
    socket: {
      host: env.REDIS_HOST || 'localhost',
      port: parseInt(env.REDIS_PORT || '6379', 10),
      connectTimeout: 3000,
      reconnectStrategy: false,
    },
    password: env.REDIS_PASSWORD || undefined,
    database: index,
  });
  client.on('error', () => {}); // отказ приходит из connect()/flushDb()
  try {
    await client.connect();
    await client.flushDb();
    return null;
  } catch (error) {
    return error.message;
  } finally {
    if (client.isOpen) await client.quit().catch(() => {});
  }
}

/**
 * Индекс Redis для сессии и её база, созданная заново и записанная в
 * реестр. Всё под замком раздачи: выбор индекса и запись его в комментарий
 * базы не должны разойтись с соседним раннером.
 */
async function provisionSession(client, session, dbName) {
  return withProvisionLock(client, async () => {
    const registry = await readRegistry(client);
    const own = registry.find((entry) => entry.session === session) ?? null;
    const others = registry.filter((entry) => entry.session !== session);
    const plan = planRedisDb({ own, others });
    if (plan.redisDb === null) {
      throw new RunnerError(
        EXIT.NO_SLOT,
        `Все индексы Redis ${REDIS_DB_FIRST}…${REDIS_DB_LAST} заняты сессиями, у которых идёт прогон или открыто `
        + `соединение: ${others.filter((entry) => !entry.idle).map((entry) => entry.session).join(', ')}`,
      );
    }
    if (plan.reclaim) {
      try {
        await dropSession(client, others.find((entry) => entry.session === plan.reclaim));
      } catch (error) {
        if (error instanceof RunnerError && error.exitCode === EXIT.BUSY) {
          throw new RunnerError(
            EXIT.BUSY,
            `Свободных индексов Redis нет, а сессия «${plan.reclaim}», чей индекс забирался как простаивающий, `
            + `только что запустила прогон — повтори запуск «${session}»`,
          );
        }
        throw error;
      }
    }
    await dropDatabase(client, canonScratchDbName(dbName));
    await dropDatabase(client, dbName);
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'template_postgis' AND datistemplate",
    );
    const template = rowCount ? 'template_postgis' : 'template1';
    await client.query(`CREATE DATABASE ${client.escapeIdentifier(dbName)} TEMPLATE ${client.escapeIdentifier(template)}`);
    const comment = formatRegistryComment({
      session,
      redisDb: plan.redisDb,
      checkout: CHECKOUT,
      createdAt: new Date().toISOString(),
    });
    await client.query(`COMMENT ON DATABASE ${client.escapeIdentifier(dbName)} IS ${client.escapeLiteral(comment)}`);
    return {
      redisDb: plan.redisDb,
      template,
      reclaimed: plan.reclaim,
      neighbours: others.filter((entry) => entry.running && entry.checkout === CHECKOUT).map((entry) => entry.session),
    };
  });
}

/**
 * Накатывает рецепт ci.yml на пустую базу. Каждый файл — в своём
 * соединении, как отдельный вызов psql в CI: production_schema.sql обнуляет
 * search_path на весь сеанс, и следующий файл в том же сеансе не нашёл бы
 * свои таблицы. Файл уходит одним запросом, то есть одной неявной
 * транзакцией: команда, которой транзакция запрещена (CREATE INDEX
 * CONCURRENTLY), здесь упадёт с понятной ошибкой — сейчас таких в рецепте нет.
 */
async function applySchema(conn, dbName, files) {
  for (const file of files) {
    const client = new pg.Client({ ...conn, database: dbName, application_name: `${RUN_LABEL_PREFIX}schema` });
    await client.connect();
    try {
      await client.query(normalizeSql(readFileSync(join(MIGRATIONS_DIR, file), 'utf8')));
    } catch (error) {
      throw new RunnerError(EXIT.ENV, `Рецепт ci.yml: ${file} не применился — ${error.message}`);
    } finally {
      await client.end();
    }
  }
}

function runJest(env, args) {
  return new Promise((resolveExit) => {
    const child = spawn(process.execPath, ['--experimental-vm-modules', JEST_BIN, ...args], {
      cwd: BACKEND_DIR,
      env,
      stdio: 'inherit',
    });
    // Ctrl+C получает и jest (консоль общая). Раннер ждёт его конца: выйди он
    // раньше — замок сессии снялся бы при живом прогоне.
    const holdOn = () => {};
    process.on('SIGINT', holdOn);
    child.on('error', (error) => {
      process.off('SIGINT', holdOn);
      console.error(`✖ jest не запустился: ${error.message}`);
      resolveExit(EXIT.ENV);
    });
    child.on('exit', (code) => {
      process.off('SIGINT', holdOn);
      resolveExit(code ?? 1);
    });
  });
}

async function runSession(session, jestArgs) {
  let dbName;
  try {
    dbName = sessionDbName(session);
  } catch (error) {
    throw usageError(error);
  }
  if (!existsSync(JEST_BIN)) {
    throw new RunnerError(
      EXIT.ENV,
      `Нет ${JEST_BIN}. В свежем worktree backend/node_modules отсутствует — подключи основной (PowerShell): `
      + 'New-Item -ItemType Junction -Path "<worktree>\\backend\\node_modules" -Target "<основной checkout>\\backend\\node_modules"',
    );
  }
  let recipe;
  try {
    recipe = parseSchemaRecipe(readFileSync(CI_WORKFLOW, 'utf8'));
  } catch (error) {
    throw new RunnerError(EXIT.ENV, `${CI_WORKFLOW}: ${error.message}`);
  }
  const { file: envFile, values, env } = loadTestEnv();
  const conn = pgConnection(env);

  // Соединение с меткой сессии держит её замок до конца прогона; процесс
  // умрёт — Postgres снимет замок сам.
  const lockClient = await connectMaintenance(conn, runLabel(session));
  try {
    if (!(await tryLock(lockClient, sessionLockKey(session)))) {
      throw new RunnerError(
        EXIT.BUSY,
        `Сессия «${session}» уже идёт в другом процессе — дождись его конца или возьми другое имя`,
      );
    }
    const started = Date.now();
    const provisioned = await provisionSession(lockClient, session, dbName);
    await applySchema(conn, dbName, recipe);
    const flushError = await flushRedisDb(env, provisioned.redisDb);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    console.log(`\n▶ Изолированный прогон «${session}»`);
    console.log(`  база:      ${dbName} — шаблон ${provisioned.template}, схема по ci.yml: `
      + `${recipe[0]} + ${recipe.slice(1).map((file) => file.split('_')[0]).join(', ')} (${seconds} с)`);
    console.log(`  Redis:     индекс ${provisioned.redisDb} ${flushError
      ? `— НЕ очищен: ${flushError}; тесты, которым нужен Redis, упадут сами`
      : '(очищен)'}`);
    console.log(`  .env.test: ${envFile}`);
    if (provisioned.reclaimed) {
      console.log(`  забран индекс простаивающей сессии «${provisioned.reclaimed}» — её база удалена`);
    }
    if (provisioned.neighbours.length) {
      console.log(`  ⚠ в этом же checkout идёт прогон сессии ${provisioned.neighbours.map((name) => `«${name}»`).join(', ')}: `
        + 'backend/tmp/uploads у вас общий, в media/promotions возможен редкий красный. Из разных worktree — не общий.');
    }
    console.log('');

    return await runJest(
      buildChildEnv({ fileEnv: values, processEnv: process.env, dbName, redisDb: provisioned.redisDb }),
      jestArgs,
    );
  } finally {
    await lockClient.end().catch(() => {});
  }
}

async function listSessions() {
  const { env } = loadTestEnv();
  const client = await connectMaintenance(pgConnection(env), `${RUN_LABEL_PREFIX}list`);
  try {
    const registry = await readRegistry(client);
    if (registry.length === 0) {
      console.log('Сессий изолированных прогонов нет.');
      return 0;
    }
    for (const entry of registry) {
      let size = '?';
      try {
        const { rows } = await client.query('SELECT pg_size_pretty(pg_database_size($1)) AS size', [entry.dbName]);
        size = rows[0].size;
      } catch {
        /* база исчезла между запросами */
      }
      const state = entry.running ? 'идёт прогон'
        : entry.connections ? `открыто соединений: ${entry.connections}` : 'простаивает';
      console.log([
        entry.session.padEnd(20),
        `Redis ${entry.redisDb ?? '—'}`.padEnd(9),
        state.padEnd(22),
        `собрана ${entry.createdAt ? new Date(entry.createdAt).toLocaleString('ru-RU') : '—'}`,
        size,
        entry.checkout ?? '',
      ].join('  '));
    }
    const held = new Set(registry.map((entry) => entry.redisDb).filter(isSessionRedisDb));
    console.log(`\nСвободных индексов Redis: ${REDIS_DB_LAST - REDIS_DB_FIRST + 1 - held.size}`
      + ` из ${REDIS_DB_LAST - REDIS_DB_FIRST + 1}.`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

async function dropSessions(session) {
  const { env } = loadTestEnv();
  const client = await connectMaintenance(pgConnection(env), `${RUN_LABEL_PREFIX}drop`);
  try {
    return await withProvisionLock(client, async () => {
      const registry = await readRegistry(client);
      const targets = session
        ? registry.filter((entry) => entry.session === session)
        : registry.filter((entry) => entry.idle);
      if (targets.length === 0) {
        console.log(session ? `Базы сессии «${session}» нет.` : 'Простаивающих сессий нет.');
        return 0;
      }
      let failed = 0;
      for (const entry of targets) {
        try {
          await dropSession(client, entry);
          const flushError = isSessionRedisDb(entry.redisDb) ? await flushRedisDb(env, entry.redisDb) : null;
          console.log(`удалена ${entry.dbName}${isSessionRedisDb(entry.redisDb)
            ? `; индекс Redis ${entry.redisDb} ${flushError ? `не очищен: ${flushError}` : 'очищен'}` : ''}`);
        } catch (error) {
          failed += 1;
          console.error(`✖ ${entry.dbName} не удалена: ${error.message}`);
        }
      }
      return failed ? EXIT.BUSY : 0;
    });
  } finally {
    await client.end().catch(() => {});
  }
}

function printUsage() {
  console.log([
    'Изолированный прогон backend-тестов: своя база и свой индекс Redis на сессию.',
    '',
    '  node scripts/test-isolated <сессия> [аргументы jest]',
    '  node scripts/test-isolated --list',
    '  node scripts/test-isolated --drop <сессия>',
    '  node scripts/test-isolated --drop-idle',
    '',
    'Имя сессии: латиница в нижнем регистре и цифры, одиночные "_", с буквы, до 20 символов.',
  ].join('\n'));
}

async function main(argv) {
  const [first, ...rest] = argv;
  if (!first) {
    printUsage();
    return EXIT.USAGE;
  }
  if (first === '--help' || first === '-h') {
    printUsage();
    return 0;
  }
  if (first === '--list') return listSessions();
  if (first === '--drop-idle') return dropSessions(null);
  if (first === '--drop') {
    try {
      validateSessionName(rest[0]);
    } catch (error) {
      throw usageError(error);
    }
    return dropSessions(rest[0]);
  }
  if (first.startsWith('-')) {
    throw new RunnerError(EXIT.USAGE, `Первым аргументом идёт имя сессии, а не ${first} (--help — справка)`);
  }
  return runSession(first, rest);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof RunnerError) {
      console.error(`✖ ${error.message}`);
      process.exitCode = error.exitCode;
    } else {
      console.error('✖ Раннер упал:', error);
      process.exitCode = EXIT.ENV;
    }
  });
