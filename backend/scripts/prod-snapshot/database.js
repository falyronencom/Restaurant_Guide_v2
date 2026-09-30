/**
 * Снимок прода — сессия базы: экспорт снимка, счётчики строк, инвентарь
 * медиа, скан носителей ссылок. Всё читается в ОДНОЙ транзакции
 * REPEATABLE READ READ ONLY, id которой уходит в pg_dump --snapshot: дамп,
 * счётчики и список файлов согласованы по построению.
 *
 * Сессия открывается только на чтение (SET SESSION CHARACTERISTICS …
 * READ ONLY): любая запись упала бы «cannot execute … in a read-only
 * transaction». Содержимое строк наружу не печатается — модуль возвращает
 * данные вызывающему, печать решает он (только id, счётчики, public_id).
 */

import pg from 'pg';
import { scanMediaState } from './media.js';

const { Client } = pg;

/** Ссылка Cloudinary в тексте (jsonb::text и пр.): без групп захвата — regexp_matches вернёт совпадение целиком. */
export const CLOUDINARY_URL_PG_REGEX = String.raw`https?://res(?:-[0-9]+)?\.cloudinary\.com/[^[:space:]"'<>\\]+`;

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;
const qualified = (t) => `${ident(t.schema)}.${ident(t.name)}`;
export const tableKey = (t) => `${t.schema}.${t.name}`;

export const openProdClient = async (databaseUrl) => {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    application_name: 'prod-snapshot (read-only)',
  });
  await client.connect();
  await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  await client.query("SET statement_timeout = '120s'");
  return client;
};

export const serverInfo = async (client) => {
  const [version, extensions, db, ssl] = await Promise.all([
    client.query('SHOW server_version'),
    client.query(`SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema
                  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname`),
    client.query('SELECT current_database() AS name, pg_database_size(current_database())::bigint AS bytes'),
    client.query('SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()'),
  ]);
  return {
    serverVersion: version.rows[0].server_version,
    serverMajor: Number(String(version.rows[0].server_version).split('.')[0]),
    extensions: extensions.rows,
    database: db.rows[0].name,
    databaseBytes: Number(db.rows[0].bytes),
    ssl: ssl.rows[0] ? { on: ssl.rows[0].ssl, version: ssl.rows[0].version } : { on: false, version: null },
  };
};

/** Открыть транзакцию снимка и экспортировать его. Держать открытой, пока идёт pg_dump. */
export const beginSnapshot = async (client) => {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const { rows } = await client.query(
    `SELECT pg_export_snapshot() AS id,
            to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`,
  );
  return { id: rows[0].id, at: rows[0].at };
};

export const endTransaction = (client) => client.query('ROLLBACK');

/** Пользовательские таблицы: без системных схем и без таблиц расширений (spatial_ref_sys и пр.). */
export const listUserTables = async (client) => {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    ORDER BY 1, 2`);
  return rows;
};

/** Счётчики строк — в текущей транзакции клиента. */
export const countRows = async (client, tables) => {
  const counts = {};
  for (const t of tables) {
    const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM ${qualified(t)}`);
    counts[tableKey(t)] = Number(rows[0].n);
  }
  return counts;
};

/** Счётчики «после»: отдельная транзакция по завершении снимка — признак записи во время снимка. */
export const countRowsAfter = async (client, tables) => {
  await client.query('BEGIN READ ONLY');
  try {
    return await countRows(client, tables);
  } finally {
    await client.query('ROLLBACK');
  }
};

/**
 * Инвентарь медиа — только колонки со ссылками и id. Колонки с
 * персональными данными (email, телефон, контакты) не выбираются вовсе.
 */
export const readInventory = async (client) => {
  const q = async (sql) => (await client.query(sql)).rows;
  const mediaRows = await q(`SELECT id, establishment_id, type, file_type, url, preview_url, thumbnail_url
                             FROM public.establishment_media ORDER BY id`);
  const promotions = await q(`SELECT id, establishment_id, image_url, preview_url, thumbnail_url
                              FROM public.promotions ORDER BY id`);
  const avatars = await q(`SELECT id, avatar_url FROM public.users
                           WHERE avatar_url IS NOT NULL AND avatar_url <> '' ORDER BY id`);
  const establishments = await q(`SELECT id, name, status, primary_image_url FROM public.establishments ORDER BY id`);
  const partnerDocuments = await q(`SELECT id, establishment_id, document_url FROM public.partner_documents ORDER BY id`);
  const seedRegistry = (await q(`SELECT stable_id, establishment_id, media_state
                                 FROM public.seed_import_registry ORDER BY stable_id`))
    .map((r) => ({ stable_id: r.stable_id, establishment_id: r.establishment_id, ...scanMediaState(r.media_state) }));
  return { mediaRows, promotions, avatars, establishments, partnerDocuments, seedRegistry };
};

/**
 * Скан всех текстовых колонок всех пользовательских таблиц: сколько строк
 * несут «res.cloudinary.com» и «/uploads/». Доказывает, что носителей ссылок
 * вне известного списка нет, а не предполагает это.
 *
 * @returns {Promise<Array<{ table, column, cloudinary, uploads }>>} только колонки с ненулевым счётом
 */
export const scanTextColumns = async (client, tables) => {
  const { rows: cols } = await client.query(`
    SELECT c.table_schema AS schema, c.table_name AS name, c.column_name AS column
    FROM information_schema.columns c
    WHERE c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY')
    ORDER BY 1, 2, c.ordinal_position`);
  const wanted = new Set(tables.map(tableKey));
  const byTable = new Map();
  for (const c of cols) {
    const key = `${c.schema}.${c.name}`;
    if (!wanted.has(key)) continue;
    if (!byTable.has(key)) byTable.set(key, { schema: c.schema, name: c.name, columns: [] });
    byTable.get(key).columns.push(c.column);
  }

  const out = [];
  for (const t of byTable.values()) {
    const parts = t.columns.flatMap((col, i) => [
      `count(*) FILTER (WHERE ${ident(col)}::text LIKE '%res.cloudinary.com%') AS c${i}`,
      `count(*) FILTER (WHERE ${ident(col)}::text LIKE '%/uploads/%') AS u${i}`,
    ]);
    const { rows } = await client.query(`SELECT ${parts.join(', ')} FROM ${qualified(t)}`);
    t.columns.forEach((col, i) => {
      const cloudinary = Number(rows[0][`c${i}`]);
      const uploads = Number(rows[0][`u${i}`]);
      if (cloudinary || uploads) out.push({ table: t.name, schema: t.schema, column: col, cloudinary, uploads });
    });
  }
  return out;
};

/** Первичный ключ таблицы, если он из одной колонки; иначе null (тогда адресуем ctid). */
const singlePk = async (client, t) => {
  const { rows } = await client.query(
    `SELECT a.attname FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [qualified(t)],
  );
  return rows.length === 1 ? rows[0].attname : null;
};

/**
 * Ссылки Cloudinary из колонок вне живых носителей (журнал аудита, реестр
 * сида, неожиданные). Возвращаются ТОЛЬКО совпадения регулярки — сами
 * строки (с персональными данными журнала) из базы не выходят.
 */
export const extractCloudinaryUrls = async (client, columns) => {
  const out = [];
  for (const c of columns) {
    const t = { schema: c.schema, name: c.table };
    const pk = await singlePk(client, t);
    const idExpr = pk ? `t.${ident(pk)}::text` : 't.ctid::text';
    const { rows } = await client.query(
      `SELECT ${idExpr} AS id, m[1] AS url
       FROM ${qualified(t)} t, LATERAL regexp_matches(t.${ident(c.column)}::text, $1, 'g') AS m`,
      [CLOUDINARY_URL_PG_REGEX],
    );
    for (const r of rows) out.push({ table: c.table, id: r.id, column: c.column, url: r.url });
  }
  return out;
};
