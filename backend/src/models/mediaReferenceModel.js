/**
 * Does anything in the database name this cloud file — asked once more right
 * before the file is removed (thread «Фото людей», step 1, directive п. 9:
 * «непосредственно перед каждым удалением снова проверять, что ссылки из базы
 * нет»).
 *
 * The plan (scripts/lib/mediaOrphanSweep.js) decided on a read of the whole
 * database; a card saved since may have taken the file. This probe looks for
 * the public_id as a plain substring in EVERY column that can hold text — the
 * same catalogue of columns as the audit (scripts/lib/mediaOrphansDb.js,
 * COLUMNS_SQL): strings, arrays, JSON, XML, of every user table, the journal
 * included. A substring is wider than a reference: it can only keep a file, it
 * never makes one an orphan.
 *
 * Reads only. The column list is read once per run (loadTextColumns) and the
 * probe is one statement per file.
 */

import { COLUMNS_SQL, TABLES_SQL } from '../../scripts/lib/mediaOrphansDb.js';

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Every text-holding column of every user table, grouped by table.
 *
 * @param {Object} db - pool or a connected client
 * @returns {Promise<Array<{schema: string, name: string, columns: string[]}>>}
 */
export const loadTextColumns = async (db) => {
  const tables = new Set((await db.query(TABLES_SQL)).rows.map((t) => `${t.schema}.${t.name}`));
  const byTable = new Map();
  for (const c of (await db.query(COLUMNS_SQL)).rows) {
    const key = `${c.schema}.${c.name}`;
    if (!tables.has(key)) continue;
    if (!byTable.has(key)) byTable.set(key, { schema: c.schema, name: c.name, columns: [] });
    byTable.get(key).columns.push(c.column);
  }
  return [...byTable.values()];
};

/**
 * True when any of these columns holds the public_id anywhere in its text.
 *
 * @param {Object} db - pool or a connected client
 * @param {Array} tables - loadTextColumns()
 * @param {string} publicId
 * @returns {Promise<boolean>}
 */
export const isNamedAnywhere = async (db, tables, publicId) => {
  if (!tables.length) return false;
  const probes = tables.map((t) => {
    const where = t.columns
      .map((col) => `position($1 in COALESCE(${ident(col)}::text, '')) > 0`)
      .join(' OR ');
    return `SELECT 1 FROM ${ident(t.schema)}.${ident(t.name)} WHERE ${where}`;
  });
  const result = await db.query(
    `SELECT EXISTS (${probes.join(' UNION ALL ')}) AS named`,
    [String(publicId)],
  );
  return result.rows[0]?.named === true;
};
