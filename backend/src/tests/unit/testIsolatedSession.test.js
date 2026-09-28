/**
 * Unit — изолированный прогон backend-тестов (scripts/test-isolated/session.js)
 * и имена служебных баз прогона (tests/testDatabases.js).
 *
 * Зачем (28.09.2026, чип «изоляция тестовой базы»). Раннер удаляет базы и
 * очищает индексы Redis, поэтому дороже всего его границы: он не должен
 * дотянуться до общей restaurant_guide_test и её служебной базы, до баз без
 * "test" в имени, до индекса Redis 0 (dev) и 1 (обычные прогоны). Второе —
 * рецепт тестовой схемы читается из ci.yml: если формат шага изменится так,
 * что раннер перестанет его понимать, краснеть должен этот тест в CI, а не
 * чья-то сессия с молча другой схемой.
 *
 * Ожидания — литералы решения: префикс restaurant_guide_test_session_,
 * индексы Redis 2…15, служебная база <база прогона>__canon, предел
 * идентификатора PostgreSQL 63 байта.
 */

import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { canonScratchDbName } from '../testDatabases.js';
import {
  buildChildEnv,
  findEnvTestFile,
  formatRegistryComment,
  isDroppableByRunner,
  normalizeSql,
  parseRegistryComment,
  parseSchemaRecipe,
  planRedisDb,
  sessionDbName,
  sessionNameOf,
  validateSessionName,
} from '../../../scripts/test-isolated/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CI_WORKFLOW = resolve(__dirname, '../../../../.github/workflows/ci.yml');
const MIGRATIONS_DIR = resolve(__dirname, '../../../migrations');

describe('имя сессии', () => {
  test.each(['ocr', 'trunk_t1', 'a', 'a1_b2', 'x'.repeat(20)])('принимает %p', (name) => {
    expect(validateSessionName(name)).toBe(name);
  });

  test.each([
    '', 'OCR', 'Ocr', '1ocr', '_ocr', 'ocr_', 'a__b', 'a-b', 'a b', "ocr';drop", 'x'.repeat(21), undefined, null, 42,
  ])('отвергает %p', (name) => {
    expect(() => validateSessionName(name)).toThrow('Имя сессии');
  });

  test('база сессии — префикс плюс имя', () => {
    expect(sessionDbName('ocr')).toBe('restaurant_guide_test_session_ocr');
  });

  test('служебная база самой длинной сессии помещается в 63 байта идентификатора', () => {
    const scratch = canonScratchDbName(sessionDbName('x'.repeat(20)));
    expect(Buffer.byteLength(scratch, 'utf8')).toBeLessThanOrEqual(63);
  });

  test('имя сессии читается обратно только из базы сессии', () => {
    expect(sessionNameOf('restaurant_guide_test_session_ocr')).toBe('ocr');
    expect(sessionNameOf('restaurant_guide_test_session_ocr__canon')).toBeNull();
    expect(sessionNameOf('restaurant_guide_test')).toBeNull();
    expect(sessionNameOf('restaurant_guide_test_ci')).toBeNull();
  });
});

describe('какие базы раннер может удалить', () => {
  test.each([
    'restaurant_guide_test_session_ocr',
    'restaurant_guide_test_session_ocr__canon',
  ])('свою: %p', (name) => {
    expect(isDroppableByRunner(name)).toBe(true);
  });

  test.each([
    'restaurant_guide_test',
    'restaurant_guide_test__canon',
    'restaurant_guide_test_ci',
    'restaurant_guide_belarus',
    'seed_canon_itest',
    'smart_search_a2_scale',
    'postgres',
    'template1',
    'template_postgis',
    'restaurant_guide_test_session_',
    'restaurant_guide_test_session_Bad',
    'restaurant_guide_test_session_a__b',
    'restaurant_guide_test_session_ocr__other',
    'restaurant_guide_test_session_ocr__canon__canon',
    '',
    undefined,
  ])('чужую — никогда: %p', (name) => {
    expect(isDroppableByRunner(name)).toBe(false);
  });
});

describe('служебная база canon-check', () => {
  test('выводится из базы прогона', () => {
    expect(canonScratchDbName('restaurant_guide_test')).toBe('restaurant_guide_test__canon');
    expect(canonScratchDbName('restaurant_guide_test_session_ocr')).toBe('restaurant_guide_test_session_ocr__canon');
  });

  test.each([undefined, '', 'restaurant_guide_belarus'])('только из тестовой базы: %p', (dbName) => {
    expect(() => canonScratchDbName(dbName)).toThrow('"test"');
  });

  test.each(['Restaurant_test', 'my-test', 'test db'])('только из имени без кавычек: %p', (dbName) => {
    expect(() => canonScratchDbName(dbName)).toThrow('a-z, 0-9');
  });

  test('не длиннее 63 байт — PostgreSQL обрезал бы молча', () => {
    expect(() => canonScratchDbName(`test_${'x'.repeat(52)}`)).toThrow('63');
    expect(() => canonScratchDbName(`test_${'x'.repeat(51)}`)).not.toThrow();
  });
});

describe('индекс Redis сессии', () => {
  const entry = (session, redisDb, { idle = false, createdAt = '2026-09-28T10:00:00.000Z' } = {}) => ({
    session, redisDb, idle, createdAt,
  });
  const allHeld = (overrides = {}) => Array.from({ length: 14 }, (_, i) => {
    const session = `s${i + 2}`;
    return entry(session, i + 2, overrides[session]);
  });

  test('первая сессия получает индекс 2 — не 0 (dev) и не 1 (обычные прогоны)', () => {
    expect(planRedisDb({ own: null, others: [] })).toEqual({ redisDb: 2, reclaim: null });
  });

  test('наименьший свободный', () => {
    expect(planRedisDb({ own: null, others: [entry('a', 2), entry('b', 3)] }))
      .toEqual({ redisDb: 4, reclaim: null });
  });

  test('свой индекс сессия сохраняет', () => {
    expect(planRedisDb({ own: entry('me', 7), others: [entry('a', 2)] }))
      .toEqual({ redisDb: 7, reclaim: null });
  });

  test('свой индекс, заявленный другой сессией, не сохраняется', () => {
    expect(planRedisDb({ own: entry('me', 7), others: [entry('a', 7)] }))
      .toEqual({ redisDb: 2, reclaim: null });
  });

  test('записи вне 2…15 ничего не занимают', () => {
    const others = [entry('a', 0), entry('b', 1), entry('c', 16), entry('d', null), entry('e', '3')];
    expect(planRedisDb({ own: null, others })).toEqual({ redisDb: 2, reclaim: null });
  });

  test('все заняты — забирается индекс самой давно собранной простаивающей сессии', () => {
    const others = allHeld({
      s5: { idle: true, createdAt: '2026-09-20T10:00:00.000Z' },
      s9: { idle: true, createdAt: '2026-09-10T10:00:00.000Z' },
      s12: { idle: false, createdAt: '2026-09-01T10:00:00.000Z' },
    });
    expect(planRedisDb({ own: null, others })).toEqual({ redisDb: 9, reclaim: 's9' });
  });

  test('все заняты идущими прогонами — индекса нет', () => {
    expect(planRedisDb({ own: null, others: allHeld() })).toEqual({ redisDb: null, reclaim: null });
  });
});

describe('реестр в комментарии базы', () => {
  test('запись читается обратно', () => {
    const record = {
      session: 'ocr', redisDb: 3, checkout: 'C:/repo/backend', createdAt: '2026-09-28T18:00:00.000Z',
    };
    expect(parseRegistryComment(formatRegistryComment(record))).toEqual(record);
  });

  test.each([0, 1, 16, 2.5, '3', null])('индекс %p не принимается — раннер его очистил бы', (redisDb) => {
    const comment = formatRegistryComment({ session: 'ocr', redisDb, checkout: null, createdAt: null });
    expect(parseRegistryComment(comment).redisDb).toBeNull();
  });

  test.each([
    'default administrative connection database', '{"kind":"other","redisDb":3}', '{broken', '', null,
  ])('чужой комментарий — не запись: %p', (text) => {
    expect(parseRegistryComment(text)).toBeNull();
  });
});

describe('рецепт схемы из ci.yml', () => {
  const step = (lines) => ['      - name: Развернуть схему тестовой БД', '        run: |', ...lines].join('\n');
  const psql = (file) => `          psql -h localhost -U postgres -d restaurant_guide_test -v ON_ERROR_STOP=1 -q -f backend/migrations/${file}`;

  test('файлы -f backend/migrations/… в порядке появления', () => {
    const yaml = step([psql('production_schema.sql'), psql('031_seed_import_registry.sql')]);
    expect(parseSchemaRecipe(yaml)).toEqual(['production_schema.sql', '031_seed_import_registry.sql']);
  });

  test('перенос строки перед -f и окончания CRLF не теряют файл', () => {
    const yaml = step([
      psql('production_schema.sql'),
      '          psql -h localhost -U postgres -d restaurant_guide_test \\',
      '            -f backend/migrations/032_password_reset_tokens.sql',
    ]).replace(/\n/g, '\r\n');
    expect(parseSchemaRecipe(yaml)).toEqual(['production_schema.sql', '032_password_reset_tokens.sql']);
  });

  test('упоминание файла без -f (комментарий) в рецепт не входит', () => {
    const yaml = step([
      '        # 030 НЕ применяется намеренно: backend/migrations/030_category_cuisine_canon_check.sql',
      psql('production_schema.sql'),
    ]);
    expect(parseSchemaRecipe(yaml)).toEqual(['production_schema.sql']);
  });

  test('закомментированная строка с -f в рецепт не входит — так файл выключают', () => {
    const yaml = step([
      psql('production_schema.sql'),
      `          # ${psql('030_category_cuisine_canon_check.sql').trim()}`,
      `        # ${psql('029_restore_mogilev_yo_constraint.sql').trim()}`,
      `${psql('031_seed_import_registry.sql')}  # снапшот уже несёт 031, повтор идемпотентен`,
    ]);
    expect(parseSchemaRecipe(yaml)).toEqual(['production_schema.sql', '031_seed_import_registry.sql']);
  });

  test('нечитаемый рецепт — отказ, а не другая схема', () => {
    expect(() => parseSchemaRecipe('jobs: {}')).toThrow('рецепт тестовой схемы не прочитан');
    expect(() => parseSchemaRecipe(step([psql('031_seed_import_registry.sql')]))).toThrow('production_schema.sql');
    expect(() => parseSchemaRecipe(step([psql('production_schema.sql'), psql('production_schema.sql')])))
      .toThrow('дважды');
  });

  describe('настоящий ci.yml', () => {
    const ciYaml = readFileSync(CI_WORKFLOW, 'utf8');
    const recipe = parseSchemaRecipe(ciYaml);

    test('начинается со снапшота, дальше миграции по возрастанию номера', () => {
      expect(recipe[0]).toBe('production_schema.sql');
      expect(recipe.length).toBeGreaterThan(1);
      const numbers = recipe.slice(1).map((file) => parseInt(file, 10));
      expect(numbers.every(Number.isInteger)).toBe(true);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    });

    test('каждый файл рецепта существует', () => {
      for (const file of recipe) {
        expect(existsSync(join(MIGRATIONS_DIR, file))).toBe(true);
      }
    });

    // Независимая сверка: любая строка ci.yml вне комментария, называющая
    // файл из backend/migrations/, обязана попасть в рецепт. Если шаг
    // перепишут в форме, которую разбор не видит (цикл, переменная), тест
    // покраснеет здесь, а не раннер соберёт неполную схему.
    test('ни одна строка шага с backend/migrations/ не ускользнула от разбора', () => {
      const named = ciYaml.split(/\r?\n/)
        .filter((line) => line.includes('backend/migrations/') && !line.trim().startsWith('#'))
        .map((line) => line.match(/backend\/migrations\/(\S+)/)[1]);
      expect(named.length).toBeGreaterThan(0);
      expect(named).toEqual(recipe);
    });
  });
});

describe('окружение jest', () => {
  test('заданное в процессе сильнее файла, но базу, индекс и NODE_ENV назначает раннер', () => {
    const env = buildChildEnv({
      fileEnv: { DB_NAME: 'restaurant_guide_test', REDIS_DB: '1', JWT_SECRET: 'file', DB_HOST: 'localhost' },
      processEnv: { DB_NAME: 'other', REDIS_DB: '0', NODE_ENV: 'development', DB_HOST: 'pg.local', PATH: '/bin' },
      dbName: 'restaurant_guide_test_session_ocr',
      redisDb: 3,
    });
    expect(env).toEqual({
      DB_NAME: 'restaurant_guide_test_session_ocr',
      REDIS_DB: '3',
      NODE_ENV: 'test',
      JWT_SECRET: 'file',
      DB_HOST: 'pg.local',
      PATH: '/bin',
    });
  });

  test('.env.test: свой checkout, иначе основной, иначе ничего', () => {
    const local = join('/wt', 'backend', '.env.test');
    const main = join('/main', 'backend', '.env.test');
    const find = (present, mainCheckoutDir = '/main') => findEnvTestFile({
      backendDir: join('/wt', 'backend'), mainCheckoutDir, exists: (path) => present.includes(path),
    });
    expect(find([local, main])).toBe(local);
    expect(find([main])).toBe(main);
    expect(find([])).toBeNull();
    expect(find([main], null)).toBeNull();
  });

  test('SQL рецепта — с окончаниями LF, как его видит CI', () => {
    expect(normalizeSql('CREATE TABLE a ();\r\nSELECT 1;\r\n')).toBe('CREATE TABLE a ();\nSELECT 1;\n');
    expect(normalizeSql('SELECT 1;\nSELECT 2;')).toBe('SELECT 1;\nSELECT 2;');
  });
});
