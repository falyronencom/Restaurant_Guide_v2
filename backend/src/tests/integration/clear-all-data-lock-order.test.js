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
 */

import { jest } from '@jest/globals';
import { pool } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { TEST_STATE_TABLES } from '../testTables.js';

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
