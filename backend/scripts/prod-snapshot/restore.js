/**
 * Снимок прода — учебное восстановление в pg-test.
 *
 * База prod_snapshot_verify_<ГГГГММДД_ЧЧММ> создаётся из template_postgis,
 * расширения ставятся по списку манифеста, дамп разворачивается pg_restore
 * одноразового контейнера в сети pg-test (--network container:pg-test):
 * файл дампа читается с хоста через bind-mount только на чтение, внутрь
 * pg-test ничего не копируется. После проверок база удаляется — в ней
 * персональные данные.
 */

import pg from 'pg';
import { CONTAINER_PREFIX, VERIFY_CONTAINER, dockerRun } from './proc.js';

const { Client } = pg;

export const VERIFY_DB_PREFIX = 'prod_snapshot_verify_';

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

/** Время в имени — повтор после сбоя в тот же день не упрётся в занятое имя. */
export const verifyDbName = (d = new Date()) =>
  `${VERIFY_DB_PREFIX}${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;

export const localClient = async (localPg, database = 'postgres') => {
  const c = new Client({ host: localPg.host, port: localPg.port, user: localPg.user, password: localPg.password, database });
  await c.connect();
  return c;
};

export const createVerifyDb = async (localPg, name) => {
  const c = await localClient(localPg);
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await c.query(`CREATE DATABASE ${ident(name)} TEMPLATE template_postgis`);
        return;
      } catch (err) {
        // Шаблон занят соседней сессией (test-isolated тоже клонирует template_postgis).
        if (/being accessed by other users/.test(err.message) && attempt < 10) {
          await sleep(3000);
          continue;
        }
        throw err;
      }
    }
  } finally {
    await c.end();
  }
};

export const dropVerifyDb = async (localPg, name) => {
  const c = await localClient(localPg);
  try {
    await c.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
  } finally {
    await c.end();
  }
};

export const listVerifyDbs = async (localPg) => {
  const c = await localClient(localPg);
  try {
    const { rows } = await c.query(`SELECT datname FROM pg_database WHERE datname LIKE 'prod\\_snapshot\\_verify\\_%' ORDER BY 1`);
    return rows.map((r) => r.datname);
  } finally {
    await c.end();
  }
};

/** Расширения по списку манифеста (plpgsql есть всегда). */
export const installExtensions = async (client, extensions) => {
  const out = [];
  for (const ext of extensions) {
    if (ext.name === 'plpgsql') continue;
    try {
      if (ext.schema !== 'public') await client.query(`CREATE SCHEMA IF NOT EXISTS ${ident(ext.schema)}`);
      await client.query(`CREATE EXTENSION IF NOT EXISTS ${ident(ext.name)} WITH SCHEMA ${ident(ext.schema)}`);
      const { rows } = await client.query('SELECT extversion FROM pg_extension WHERE extname = $1', [ext.name]);
      out.push({ name: ext.name, prod: ext.version, local: rows[0]?.extversion ?? null, ok: true });
    } catch (err) {
      out.push({ name: ext.name, prod: ext.version, local: null, ok: false, error: err.message });
    }
  }
  return out;
};

export const runPgRestore = ({ runId, localPg, dbName, dumpDir }) =>
  dockerRun({
    name: `${CONTAINER_PREFIX}restore-${runId}`,
    env: { PGUSER: localPg.user, PGPASSWORD: localPg.password },
    mounts: [{ source: dumpDir, target: '/in', readonly: true }],
    network: `container:${VERIFY_CONTAINER}`,
    command: ['pg_restore', '--no-owner', '--no-privileges', '-h', 'localhost', '-p', '5432', '-d', dbName, '/in/prod.dump'],
  });

/**
 * Ожидаемые ошибки pg_restore — по тексту, узко. Шаблон уже несёт PostGIS и
 * его набор расширений, поэтому часть объектов может «уже существовать».
 * Любая ошибка вне списка — провал проверки. Список пополняется только с
 * объяснением, почему ошибка безвредна.
 */
export const EXPECTED_RESTORE_ERRORS = Object.freeze([
  // Схемы расширений postgis_tiger_geocoder и postgis_topology: template_postgis их
  // уже несёт, а pg_dump пишет CREATE SCHEMA без IF NOT EXISTS. Репетиция 30.09.2026
  // на pg-test (дамп базы с тем же набором расширений → база из template_postgis):
  // ровно эти три ошибки, счётчики всех 21 таблиц совпали.
  /^schema "(tiger|tiger_data|topology)" already exists$/,
]);

/**
 * Ошибки из stderr pg_restore. Берётся только строка ERROR — не DETAIL и не
 * CONTEXT (там бывают данные строк). Вымарываются значения:
 * - после «: "» — до конца строки: значение стоит в конце сообщения и само может
 *   нести кавычки (json) или обрываться переводом строки;
 * - «value "…"» посреди строки («value "…" is out of range»).
 * Имена объектов («relation "public.users"») остаются — без них ошибку не разобрать.
 */
export const redactValues = (text) => text.replace(/value "[^"]*"/g, 'value "…"').replace(/: ".*$/, ': "…"');

export const parseRestoreErrors = (stderr) => {
  const errors = [];
  for (const line of String(stderr).split(/\r?\n/)) {
    const m = /^pg_restore: error: (.*)$/.exec(line);
    if (!m) continue;
    const sql = /could not execute query: ERROR:\s+(.*)$/.exec(m[1]);
    const text = redactValues(sql ? sql[1] : m[1]).trim();
    errors.push({ text, expected: EXPECTED_RESTORE_ERRORS.some((re) => re.test(text)) });
  }
  return errors;
};

/** Проверка (а): счётчики восстановленной базы против снимка; у четырёх исключённых таблиц — 0. */
export const compareCounts = (snapshotCounts, restoredCounts, excludedTables) => {
  const excluded = new Set(excludedTables.map((t) => `public.${t}`));
  const mismatches = [];
  for (const [table, n] of Object.entries(snapshotCounts)) {
    const expected = excluded.has(table) ? 0 : n;
    const got = restoredCounts[table];
    if (got !== expected) mismatches.push({ table, expected, got: got ?? null });
  }
  const extra = Object.keys(restoredCounts).filter((t) => !(t in snapshotCounts));
  return { tables: Object.keys(snapshotCounts).length, mismatches, extra_tables_in_restore: extra };
};
