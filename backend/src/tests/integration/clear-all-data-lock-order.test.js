/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * clearAllData locks every FK child before its parent
 * Очистка берёт блокировки от детей к родителям
 *
 * clearAllData (and globalSetup) truncate TEST_STATE_TABLES in ONE statement.
 * PostgreSQL locks the listed tables in list order, ACCESS EXCLUSIVE, holds
 * them all until COMMIT, and locks whatever CASCADE pulls in after the whole
 * list. A fire-and-forget write the previous test left behind — a
 * notification, a verification code, an analytics upsert, an OCR job — holds
 * its own table from the start and asks for every parent of that table only
 * at the end, on its FK checks (even for a NULL column: the check opens the
 * parent before it looks at the value). With a parent listed before its child
 * the two close a ring — the cleanup holds the parent and waits for the
 * child, the insert holds the child and waits for the parent — PostgreSQL
 * breaks it after a second by failing the cleanup, and the next test's hook
 * goes red. With every child first both take their locks the same way round,
 * and the cleanup just waits for the insert.
 *
 * On a stand, 2026-09-25 (real model calls as tails, a BEFORE INSERT
 * pg_sleep widening each insert's window, 11 start offsets × 5 tails): the
 * former loop of one TRUNCATE ... CASCADE per table deadlocked 28 times out of
 * 55, one statement in the former list order 9, one statement children-first
 * 0.
 *
 * The FK graph comes from the live schema, so a migration that adds a table or
 * a reference is checked the day it lands. Each check carries an anchor — the
 * same check shown a literal list it must report on — because a check whose
 * query went blind would otherwise stay green for good. The anchors do not use
 * TEST_STATE_TABLES: a wrong list must fail the check itself, not its anchor.
 *
 * clearTableTree does the same for one parent and what hangs on it, for files
 * that keep users from beforeAll. Its lists get the same checks, and a source
 * scan keeps a new `TRUNCATE <parent> CASCADE` out of the tests: on 2026-11-05
 * a statement of that form was what failed on main, and this guard could not see
 * it, because a test file's own statement went through no list at all.
 */

import { readdirSync, readFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import { jest } from '@jest/globals';
import { pool } from '../../config/database.js';
import { clearAllData, clearTableTree, query } from '../utils/database.js';
import { TABLE_TREES, TEST_STATE_TABLES } from '../testTables.js';

const traverse = traverseModule.default;
const TESTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// Tables that reference a listed table without being test state. CASCADE
// clears them after the whole list, parent first — harmless while nothing
// writes them in the background.
const NOT_TEST_STATE = {
  seed_import_registry:
    'bulk-import sidecar (migration 031), written only by scripts/seed-import; '
    + 'in the CI schema, absent from a pg-test built before 031',
};

const foreignKeys = async () => {
  const { rows } = await query(
    `SELECT DISTINCT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
     FROM pg_constraint
     WHERE contype = 'f' AND conrelid <> confrelid`
  );
  return rows;
};

/** `parent → child` for every FK between listed tables whose parent comes first. */
const parentFirst = (tables, fks) => fks
  .filter(({ child, parent }) => tables.includes(child) && tables.includes(parent))
  .filter(({ child, parent }) => tables.indexOf(parent) < tables.indexOf(child))
  .map(({ child, parent }) => `${parent} → ${child}`)
  .sort();

/** Tables that reference a listed table without being listed themselves. */
const unlistedChildren = (tables, fks) => [...new Set(
  fks
    .filter(({ child, parent }) => tables.includes(parent) && !tables.includes(child))
    .map(({ child }) => child)
    .filter((child) => !(child in NOT_TEST_STATE))
)].sort();

/** The table and everything CASCADE reaches from it. */
const cascadeFrom = (root, fks) => {
  const reached = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const { child, parent } of fks) {
      if (reached.has(parent) && !reached.has(child)) {
        reached.add(child);
        grew = true;
      }
    }
  }
  return reached;
};

// These two take the table list from a constant, the guards above check it.
const BUILDS_ITS_LIST_FROM_TESTTABLES = ['globalSetup.js', 'utils/database.js'];
const THIS_FILE = 'integration/clear-all-data-lock-order.test.js';
// Parsing every test file takes seconds on a slower machine; jest's default is 10.
const SCAN_TIMEOUT_MS = 60000;
const TRUNCATE_STATEMENT = /\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?([^;]*?)(?:\s+(?:RESTART|CONTINUE)\s+IDENTITY)?(?:\s+(?:CASCADE|RESTRICT))?\s*(?:;|$)/gi;

/**
 * Every TRUNCATE a source sends, read from its string and template literals, so
 * a comment that mentions one does not count and a query built in a helper does.
 * A `${…}` in the list makes it unreadable: `dynamic`.
 */
const truncatesIn = (source) => {
  const found = [];
  const inspect = (text, node) => {
    for (const statement of text.matchAll(TRUNCATE_STATEMENT)) {
      const list = statement[1].trim().replace(/"/g, '').replace(/\bpublic\./gi, '');
      const dynamic = list === '' || list.includes('${'); // '' is 'TRUNCATE TABLE ' + name
      if (dynamic || /^\w+(\s*,\s*\w+)*$/.test(list)) { // otherwise prose, not a statement
        found.push({
          line: node.loc.start.line,
          dynamic,
          tables: dynamic ? [] : list.split(',').map((table) => table.trim().toLowerCase()),
        });
      }
    }
  };
  traverse(parser.parse(source, { sourceType: 'module', allowAwaitOutsideFunction: true }), {
    StringLiteral(path) { inspect(path.node.value, path.node); },
    TemplateLiteral(path) {
      const text = path.node.quasis.map((quasi) => quasi.value.raw).join('${}');
      inspect(text, path.node);
    },
  });
  return found;
};

/** What is wrong with a TRUNCATE the file sends, in words a reader can act on. */
const truncateProblems = (file, source, fks) => truncatesIn(source).flatMap(({ line, dynamic, tables }) => {
  if (dynamic) {
    return BUILDS_ITS_LIST_FROM_TESTTABLES.includes(file) ? [] : [`${file}:${line}: список таблиц не читается`];
  }
  const missed = unlistedChildren(tables, fks);
  const reversed = parentFirst(tables, fks);
  return [...missed, ...reversed].length === 0 ? [] : [
    `${file}:${line}: TRUNCATE ${tables.join(', ')} — родитель раньше детей`
    + ` (${[...missed, ...reversed].join(', ')})`,
  ];
});

const testSources = (dir = TESTS_DIR) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return testSources(path);
  const file = relative(TESTS_DIR, path).replaceAll('\\', '/');
  return entry.name.endsWith('.js') && file !== THIS_FILE ? [[file, readFileSync(path, 'utf8')]] : [];
});

describe('clearAllData lock order', () => {
  test('TEST_STATE_TABLES lists every FK child before its parent', async () => {
    const fks = await foreignKeys();

    // Anchor: a parent-first list must be reported.
    expect(parentFirst(['reviews', 'notifications'], fks)).toEqual(['reviews → notifications']);

    expect(parentFirst(TEST_STATE_TABLES, fks)).toEqual([]);
  });

  test('TEST_STATE_TABLES leaves out no table that references a listed one', async () => {
    const fks = await foreignKeys();

    // Anchor: a referencing table missing from a list must be reported.
    expect(unlistedChildren(['users', 'establishments', 'reviews'], fks)).toContain('notifications');

    expect(unlistedChildren(TEST_STATE_TABLES, fks)).toEqual([]);
  });

  test('clearAllData truncates the list in one statement, as listed', async () => {
    const sent = jest.spyOn(pool, 'query');

    await clearAllData();

    expect(sent.mock.calls.map(([sql]) => sql)).toEqual([
      `TRUNCATE TABLE ${TEST_STATE_TABLES.join(', ')} CASCADE`,
    ]);
  });
});

describe('clearTableTree lock order', () => {
  const roots = Object.keys(TABLE_TREES);

  test('there are lists to check', () => {
    expect(roots).toEqual(['establishments', 'reviews']);
  });

  test.each(roots)('the %s list has every FK child before its parent', async (root) => {
    const fks = await foreignKeys();

    expect(parentFirst(TABLE_TREES[root], fks)).toEqual([]);
  });

  test.each(roots)('the %s list leaves out no table that references a listed one', async (root) => {
    const fks = await foreignKeys();

    // Anchor: a child taken off the list must be reported.
    expect(unlistedChildren(TABLE_TREES[root].filter((table) => table !== 'notifications'), fks))
      .toContain('notifications');

    expect(unlistedChildren(TABLE_TREES[root], fks)).toEqual([]);
  });

  test.each(roots)('the %s list truncates what CASCADE from it truncates, no more', async (root) => {
    const fks = await foreignKeys();
    const reached = cascadeFrom(root, fks);

    // Anchors, from the graph, in plain words.
    expect([...cascadeFrom('reviews', fks)].sort()).toEqual(['notifications', 'reviews']);
    expect(cascadeFrom('establishments', fks).has('users')).toBe(false);

    expect(TABLE_TREES[root].filter((table) => !reached.has(table))).toEqual([]);
    expect(TABLE_TREES[root]).toContain(root);
    expect([...reached].filter((table) => !TABLE_TREES[root].includes(table) && !(table in NOT_TEST_STATE)))
      .toEqual([]);
  });

  test('clearTableTree truncates the list in one statement, as listed', async () => {
    const sent = jest.spyOn(pool, 'query');

    await clearTableTree('reviews');

    expect(sent.mock.calls.map(([sql]) => sql)).toEqual(['TRUNCATE TABLE notifications, reviews CASCADE']);
  });

  test('clearTableTree refuses a table it has no list for', async () => {
    await expect(clearTableTree('users')).rejects.toThrow('no list for users');
  });

  test('clearTableTree keeps users and everything outside the tree', async () => {
    const before = await query('SELECT count(*)::int AS rows FROM users');
    const { rows: [user] } = await query(
      `INSERT INTO users (email, password_hash, name, role, auth_method)
       VALUES ('tree-keeps-me@test.local', 'x', 'Tree', 'partner', 'email') RETURNING id`
    );
    const { rows: [audit] } = await query(
      `INSERT INTO audit_log (user_id, action, entity_type) VALUES ($1, 'x', 'x') RETURNING id`,
      [user.id]
    );

    await clearTableTree('establishments');

    const after = await query('SELECT count(*)::int AS rows FROM users');
    const kept = await query('SELECT id FROM audit_log WHERE id = $1', [audit.id]);
    expect(after.rows[0].rows).toBe(before.rows[0].rows + 1);
    expect(kept.rows).toHaveLength(1);

    await query('DELETE FROM audit_log WHERE id = $1', [audit.id]);
    await query('DELETE FROM users WHERE id = $1', [user.id]);
  });
});

describe('TRUNCATE in the tests themselves', () => {
  test('the scan reports a parent truncated on its own, and only that', async () => {
    const fks = await foreignKeys();
    const scan = (source) => truncateProblems('anchor.js', source, fks);

    // Anchors: the form that went red on main, and its neighbours.
    expect(scan("await query('TRUNCATE TABLE establishments CASCADE');")).toHaveLength(1);
    expect(scan('await query(`TRUNCATE reviews CASCADE`);')).toHaveLength(1);
    expect(scan("await pool.query('TRUNCATE TABLE reviews, notifications CASCADE');")).toHaveLength(1);
    expect(scan('await query(`TRUNCATE TABLE ${name} CASCADE`);')).toHaveLength(1);
    expect(scan("await query('TRUNCATE TABLE ' + name + ' CASCADE');")).toHaveLength(1);
    expect(scan("await query('TRUNCATE TABLE public.establishments CASCADE');")).toHaveLength(1);
    expect(scan(`await query('TRUNCATE "reviews" CASCADE');`)).toHaveLength(1);

    expect(scan("await query('TRUNCATE TABLE audit_log');")).toEqual([]);
    expect(scan("await query('TRUNCATE TABLE notifications, reviews CASCADE');")).toEqual([]);
    expect(scan('// TRUNCATE TABLE establishments CASCADE')).toEqual([]);
    expect(scan("test('TRUNCATE of the parent is what failed here', () => {});")).toEqual([]);
  });

  test('no test truncates a parent before its children', async () => {
    const fks = await foreignKeys();
    const sources = testSources();

    // Anchor: the scan really reads this directory, the cleanup included.
    expect(sources.map(([file]) => file)).toEqual(expect.arrayContaining([
      'globalSetup.js',
      'integration/establishments.test.js',
      'utils/database.js',
    ]));
    expect(truncatesIn(sources.find(([file]) => file === 'utils/database.js')[1]))
      .not.toHaveLength(0);

    const problems = sources.flatMap(([file, source]) => truncateProblems(file, source, fks));
    if (problems.length > 0) {
      throw new Error([
        'Очистка, которая берёт родителя раньше детей, сталкивается с записью, отпущенной без ожидания,',
        'и следующий тест падает с deadlock detected. Вместо неё: clearTableTree(...) из utils/database.js',
        'или clearAllData(). Таблицы нет в списке — допиши её в testTables.js.',
        '',
        ...problems,
      ].join('\n'));
    }
  }, SCAN_TIMEOUT_MS);
});
