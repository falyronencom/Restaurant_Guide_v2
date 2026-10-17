/**
 * The database half of scripts/media-orphans-audit.js: everything the count
 * needs, read in one snapshot that cannot write.
 *
 * Read only by construction: the session is switched to read-only first, the
 * work runs in one REPEATABLE READ READ ONLY transaction (one moment for every
 * query), and the transaction is rolled back. The database refuses any write
 * inside it; the integration test proves that refusal on a real database.
 *
 * What leaves the database: path tokens and Cloudinary delivery links found in
 * text (regexp matches, never rows), card statuses, account roles and flags,
 * row counts. No e-mail, no name, no text of a row.
 */
import { UNFINISHED_IMPORT_COLUMN } from './mediaOrphans.js';

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** User tables: no system schemas, no tables of extensions, no partitions (their parent covers them). */
export const TABLES_SQL = `
  SELECT n.nspname AS schema, c.relname AS name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  ORDER BY 1, 2`;

/** Every column that can hold a link as text: strings, arrays, JSON, XML. */
export const COLUMNS_SQL = `
  SELECT n.nspname AS schema, c.relname AS name, a.attname AS column
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE a.attnum > 0 AND NOT a.attisdropped
    AND c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND (t.typcategory IN ('S', 'A') OR t.typname IN ('json', 'jsonb', 'xml'))
  ORDER BY 1, 2, a.attnum`;

/** Card rows: tokens and links of media, promotions and covers, with the card's status. */
const CARD_STATUS_SQL = `
  SELECT s.status, s.kind, s.hit FROM (
    SELECT e.status, 'token' AS kind, m[1] AS hit
    FROM public.establishment_media em JOIN public.establishments e ON e.id = em.establishment_id,
         LATERAL regexp_matches(concat_ws(' ', em.url, em.preview_url, em.thumbnail_url), $1, 'g') AS m
    UNION ALL
    SELECT e.status, 'url', m[1]
    FROM public.establishment_media em JOIN public.establishments e ON e.id = em.establishment_id,
         LATERAL regexp_matches(concat_ws(' ', em.url, em.preview_url, em.thumbnail_url), $2, 'gi') AS m
    UNION ALL
    SELECT e.status, 'token', m[1]
    FROM public.promotions p JOIN public.establishments e ON e.id = p.establishment_id,
         LATERAL regexp_matches(concat_ws(' ', p.image_url, p.preview_url, p.thumbnail_url), $1, 'g') AS m
    UNION ALL
    SELECT e.status, 'url', m[1]
    FROM public.promotions p JOIN public.establishments e ON e.id = p.establishment_id,
         LATERAL regexp_matches(concat_ws(' ', p.image_url, p.preview_url, p.thumbnail_url), $2, 'gi') AS m
    UNION ALL
    SELECT e.status, 'token', m[1]
    FROM public.establishments e, LATERAL regexp_matches(COALESCE(e.primary_image_url, ''), $1, 'g') AS m
    UNION ALL
    SELECT e.status, 'url', m[1]
    FROM public.establishments e, LATERAL regexp_matches(COALESCE(e.primary_image_url, ''), $2, 'gi') AS m
  ) s
  GROUP BY 1, 2, 3`;

const CARD_STATUS_NEEDS = [
  'public.establishment_media.url', 'public.establishment_media.preview_url', 'public.establishment_media.thumbnail_url',
  'public.establishments.primary_image_url', 'public.establishments.status',
  'public.promotions.image_url', 'public.promotions.preview_url', 'public.promotions.thumbnail_url',
];

/** The registry of an import that has not finished: a resume re-attaches these files (seed-import/pipeline.js). */
const UNFINISHED_IMPORT_SQL = `
  SELECT 'token' AS kind, m[1] AS hit, count(*)::int AS n
  FROM public.seed_import_registry r, LATERAL regexp_matches(r.media_state::text, $1, 'g') AS m
  WHERE r.phase <> 'activated'
  GROUP BY 1, 2
  UNION ALL
  SELECT 'url', m[1], count(*)::int
  FROM public.seed_import_registry r, LATERAL regexp_matches(r.media_state::text, $2, 'gi') AS m
  WHERE r.phase <> 'activated'
  GROUP BY 1, 2`;

const UNFINISHED_IMPORT_NEEDS = ['public.seed_import_registry.media_state', 'public.seed_import_registry.phase'];

const USERS_SQL = `
  SELECT id::text AS id, role,
         COALESCE((to_jsonb(u) ->> 'is_service_account')::boolean, false) AS service
  FROM public.users u WHERE id = ANY($1::uuid[])`;

const CARDS_SQL = 'SELECT id::text AS id, status FROM public.establishments WHERE id = ANY($1::uuid[])';

/**
 * @param {pg.Client} client - connected
 * @param {Object} options
 * @param {string} options.tokenRegex - tokenRegexSource()
 * @param {string} options.urlRegex - DELIVERY_URL_REGEX_SOURCE
 * @param {{users: string[], cards: string[]}} options.ownerIds - UUIDs only
 * @param {Object|null} [options.expectedCounts] - a snapshot's row counts
 *   (schema.table → n): compared with this database inside the same moment
 * @param {string[]} [options.excludedTables] - tables whose data the snapshot left out
 */
export const readDatabase = async (client, { tokenRegex, urlRegex, ownerIds, expectedCounts = null, excludedTables = [] }) => {
  let queries = 0;
  const q = async (sql, params) => {
    queries += 1;
    return (await client.query(sql, params)).rows;
  };

  await q('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  await q('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await q("SET LOCAL statement_timeout = '60s'");
    const tables = await q(TABLES_SQL);
    const tableKeys = new Set(tables.map((t) => `${t.schema}.${t.name}`));
    const textColumns = (await q(COLUMNS_SQL)).filter((c) => tableKeys.has(`${c.schema}.${c.name}`));

    // Is this database the snapshot the listing came from? Row counts at the same moment.
    let countsCheck = null;
    if (expectedCounts) {
      const excluded = new Set(excludedTables.flatMap((t) => [t, `public.${t}`]));
      const mismatched = [];
      let checked = 0;
      for (const [table, expected] of Object.entries(expectedCounts)) {
        if (excluded.has(table)) continue;
        checked += 1;
        if (!tableKeys.has(table)) {
          mismatched.push(table);
          continue;
        }
        const [schema, ...rest] = table.split('.');
        const rows = await q(`SELECT count(*)::bigint AS n FROM ${ident(schema)}.${ident(rest.join('.'))}`);
        if (Number(rows[0].n) !== Number(expected)) mismatched.push(table);
      }
      countsCheck = { checked, mismatched };
    }

    const byTable = new Map();
    for (const c of textColumns) {
      const key = `${c.schema}.${c.name}`;
      if (!byTable.has(key)) byTable.set(key, { schema: c.schema, name: c.name, columns: [] });
      byTable.get(key).columns.push(c.column);
    }

    const tokenHits = [];
    const urlHits = [];
    for (const t of byTable.values()) {
      const from = `${ident(t.schema)}.${ident(t.name)}`;
      const parts = t.columns.flatMap((col, i) => [
        `SELECT ${i} AS col, 'token' AS kind, m[1] AS hit FROM ${from} t, LATERAL regexp_matches(t.${ident(col)}::text, $1, 'g') AS m`,
        `SELECT ${i}, 'url', m[1] FROM ${from} t, LATERAL regexp_matches(t.${ident(col)}::text, $2, 'gi') AS m`,
      ]);
      const rows = await q(
        `SELECT col, kind, hit, count(*)::int AS n FROM (${parts.join('\n UNION ALL ')}) s GROUP BY 1, 2, 3`,
        [tokenRegex, urlRegex],
      );
      for (const r of rows) {
        const column = `${t.schema}.${t.name}.${t.columns[r.col]}`;
        if (r.kind === 'token') tokenHits.push({ column, token: r.hit, mentions: r.n });
        else urlHits.push({ column, url: r.hit, mentions: r.n });
      }
    }

    const present = new Set(textColumns.map((c) => `${c.schema}.${c.name}.${c.column}`));
    if (UNFINISHED_IMPORT_NEEDS.every((c) => present.has(c))) {
      for (const r of await q(UNFINISHED_IMPORT_SQL, [tokenRegex, urlRegex])) {
        if (r.kind === 'token') tokenHits.push({ column: UNFINISHED_IMPORT_COLUMN, token: r.hit, mentions: r.n });
        else urlHits.push({ column: UNFINISHED_IMPORT_COLUMN, url: r.hit, mentions: r.n });
      }
    }

    // establishments.status is a string column too, so it is in the list when the table is.
    let cardRows = [];
    const cardStatusesRead = CARD_STATUS_NEEDS.every((c) => present.has(c));
    if (cardStatusesRead) cardRows = await q(CARD_STATUS_SQL, [tokenRegex, urlRegex]);

    const users = new Map();
    const cards = new Map();
    if (ownerIds.users.length) {
      for (const r of await q(USERS_SQL, [ownerIds.users])) users.set(r.id, { role: r.role, service: r.service === true });
    }
    if (ownerIds.cards.length) {
      for (const r of await q(CARDS_SQL, [ownerIds.cards])) cards.set(r.id, { status: r.status });
    }

    return {
      tokenHits,
      urlHits,
      cardRows,
      cardStatusesRead,
      countsCheck,
      owners: { users, cards },
      scanned: { tables: byTable.size, columns: textColumns.length },
      queries: () => queries,
    };
  } finally {
    await q('ROLLBACK');
  }
};
