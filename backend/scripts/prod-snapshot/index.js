/* eslint-disable no-console */
/**
 * Снимок прода: база и оригиналы медиа (#6a обзора 23.09.2026) — запуск.
 * Бриф: docs/handoffs/prod_snapshot_20260930/BRIEF.md; ранбук — README.md рядом.
 *
 *   cd backend
 *   node scripts/prod-snapshot                            # сухой прогон: план, ничего не пишется
 *   node scripts/prod-snapshot --pinentry-check           # окно pinentry на пробном файле и пробном пароле
 *   node scripts/prod-snapshot --apply                    # снимок → архив → шифрование → учебное восстановление
 *   node scripts/prod-snapshot --verify=<архив.tar.gpg>   # учебное восстановление готового архива
 *   node scripts/prod-snapshot --check-copy=<папка копии> # копия цела: sha256 архива против index.json
 *   node scripts/prod-snapshot --cleanup                  # уборка открытых данных после оборванного прогона
 *   [--out=<папка снимков>]   по умолчанию %USERPROFILE%\NirivioSnapshots
 *
 * Прод — только чтение: сессия базы READ ONLY, в Admin API Cloudinary —
 * только GET по списку чтения (cloudinaryReader.js). Адрес прода — только из
 * backend/.env.production, печатается маской в строке «Цель».
 *
 * Коды выхода: 0 — готово; 1 — отказ предполётной проверки, ничего не
 * сделано; 2 — ошибка в команде; 3 — сбой (открытые данные убраны — см.
 * вывод уборки); 4 — архив записан, но проверка не прошла (verify.json — почему).
 */

import dns from 'dns';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { randomBytes } from 'crypto';

import {
  LEGACY_HOSTS, SetupError, loadCloudinaryCredentials, loadLocalPg, loadProdDatabaseUrl, maskDatabaseUrl, pgEnvFromUrl,
} from './env.js';
import {
  CONTAINER_PREFIX, PG_IMAGE, VERIFY_CONTAINER, containerRunning, dockerRun, dockerServerVersion, imagePgVersion, imagePresent,
} from './proc.js';
import {
  beginSnapshot, countRows, countRowsAfter, endTransaction, extractCloudinaryUrls, listUserTables, openProdClient,
  readInventory, scanTextColumns, serverInfo,
} from './database.js';
import { CloudinaryReader, DELIVERY_TYPES, RESOURCE_TYPES, downloadFile, probeByPublicId } from './cloudinaryReader.js';
import { CLOUDINARY_CLASSES, URL_CLASS, archiveFilePath, assetKey, checkPrimaryImages, refKey } from './media.js';
import {
  EXCLUDED_DATA_TABLES, PRIMARY_COLUMNS, SECONDARY_COLUMNS, buildIndex, checkRefsHaveFiles, collectRefs, diffIndexes,
  fileRecord, planFiles, summarize,
} from './manifest.js';
import {
  describePacketFormat, findGpg, gpgDecrypt, gpgEncrypt, readPacketHeaders, sha256File, tarCreate, tarExtract, tarVersion,
} from './archive.js';
import {
  compareCounts, createVerifyDb, installExtensions, localClient, parseRestoreErrors, runPgRestore, verifyDbName,
} from './restore.js';
import { checkClean, cleanup } from './cleanup.js';
import { checkSnapshotRoot, freeBytes, gitState } from './preflight.js';

const EXIT = { OK: 0, REFUSED: 1, USAGE: 2, FAILED: 3, UNVERIFIED: 4 };
const VALUE_OPTIONS = ['out', 'verify', 'check-copy'];
const SWITCHES = ['apply', 'pinentry-check', 'cleanup'];
const RUN_DIR_RE = /^\d{4}-\d{2}-\d{2}_\d{4}$/;

// Мёртвый IPv6 этой машины вешает соединения (память npm/urllib) — сначала IPv4.
dns.setDefaultResultOrder('ipv4first');

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   node scripts/prod-snapshot [--apply] [--out=<папка>]');
  console.error('   node scripts/prod-snapshot --pinentry-check | --cleanup [--out=<папка>]');
  console.error('   node scripts/prod-snapshot --verify=<архив.tar.gpg> | --check-copy=<папка копии>');
  process.exit(EXIT.USAGE);
};

/** Незнакомый аргумент — ошибка, а не пропуск: --aply молча стал бы сухим прогоном. */
const parseArgs = (argv) => {
  const args = {};
  for (const raw of argv) {
    const m = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(raw);
    if (!m) usage(`Непонятный аргумент: ${raw}`);
    const [, name, value] = m;
    if (SWITCHES.includes(name) && value === undefined) args[name] = true;
    else if (VALUE_OPTIONS.includes(name) && value) {
      if (args[name] !== undefined) usage(`--${name} указан дважды`);
      args[name] = value;
    } else usage(`Неизвестный аргумент: ${raw}`);
  }
  const modes = ['apply', 'pinentry-check', 'cleanup', 'verify', 'check-copy'].filter((k) => args[k]);
  if (modes.length > 1) usage(`Режимы несовместимы: ${modes.map((k) => `--${k}`).join(' ')}`);
  return args;
};

// ───────────────────────── печать ─────────────────────────

const fmtBytes = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const f = (x) => x.toFixed(1).replace('.', ',');
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${f(n / 1024)} КБ`;
  if (n < 1024 ** 3) return `${f(n / 1024 ** 2)} МБ`;
  return `${f(n / 1024 ** 3)} ГБ`;
};
const ok = (t) => console.log(`  ✓ ${t}`);
const warn = (t) => console.log(`  ⚠ ${t}`);
const lastLines = (s, n = 3) => String(s).trim().split(/\r?\n/).slice(-n).join(' | ');
const pad = (n) => String(n).padStart(2, '0');
const runIdFor = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const printTally = (obj, indent = '    ') => {
  const entries = Object.entries(obj);
  if (entries.length === 0) console.log(`${indent}(нет)`);
  for (const [k, v] of entries) console.log(`${indent}${k}: ${v}`);
};

/** Параллельная обработка с ограничением; после Ctrl+C новые задачи не берутся. */
const pool = async (items, size, worker) => {
  let next = 0;
  const run = async () => {
    while (next < items.length && !state.aborted) {
      const i = next;
      next += 1;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
};

const listRunDirs = (root) => (existsSync(root)
  ? readdirSync(root).filter((n) => RUN_DIR_RE.test(n)).map((n) => join(root, n)).filter((p) => statSync(p).isDirectory())
  : []);

// ───────────────────────── состояние уборки ─────────────────────────

const state = { runDirs: [], verifyDbs: [], localPg: null, cleaning: null, aborted: false };

/**
 * Уборка — одно обещание на процесс: и обработчик Ctrl+C, и finally в main
 * ждут ОДНО и то же, поэтому process.exit не обрывает уборку на середине.
 */
const cleanupState = () => {
  state.cleaning ??= runCleanup();
  return state.cleaning;
};
/** Режимы без открытых данных уборку не запускают вовсе. */
const skipCleanup = () => {
  state.cleaning ??= Promise.resolve(null);
};

const runCleanup = async () => {
  console.log('\nУборка открытых данных');
  const res = await cleanup({ runDirs: state.runDirs, localPg: state.localPg, verifyDbs: state.verifyDbs });
  for (const r of res.removed) ok(`удалено: ${r}`);
  for (const e of res.errors) warn(`не удалось: ${e}`);
  const check = await checkClean({ runDirs: state.runDirs, localPg: state.localPg });
  if (check.clean) ok('проверка: открытых данных снимка нет — ни в папке прогона, ни в контейнерах, ни в pg-test');
  else warn(`проверка НЕ чиста: ${JSON.stringify({ plaintext: check.plaintext, containers: check.containers, verifyDbs: check.verifyDbs, pgTest: check.pgTestFiles })}`);
  state.lastCleanup = { removed: res.removed, errors: res.errors, check };
  return state.lastCleanup;
};

process.once('SIGINT', async () => {
  console.error('\nПрервано (Ctrl+C).');
  state.aborted = true;
  try {
    await cleanupState();
  } finally {
    process.exit(EXIT.FAILED);
  }
});

// ───────────────────────── предполётная проверка ─────────────────────────

const preflight = async ({ root, apply, runId, databaseUrl, cloud, localPg }) => {
  const problems = [];
  const bad = (t) => {
    console.log(`  ✗ ${t}`);
    problems.push(t);
  };
  const stopIfBad = () => {
    if (problems.length) throw new SetupError(`Предполётная проверка: проблем ${problems.length} — см. ✗ выше. Ничего не сделано.`);
  };
  console.log('\nПредполётная проверка');

  const dockerVersion = await dockerServerVersion();
  if (!dockerVersion) bad('Docker не отвечает — запустите Docker Desktop');
  else {
    ok(`Docker ${dockerVersion}`);
    if (await containerRunning(VERIFY_CONTAINER)) ok(`${VERIFY_CONTAINER} запущен`);
    else bad(`${VERIFY_CONTAINER} не запущен — docker start ${VERIFY_CONTAINER}`);
    if (await imagePresent(PG_IMAGE)) ok(`образ ${PG_IMAGE} на месте`);
    else bad(`нет образа ${PG_IMAGE} — docker pull ${PG_IMAGE}`);
  }
  stopIfBad();

  const dumpVersion = await imagePgVersion('pg_dump');
  let client;
  try {
    client = await openProdClient(databaseUrl);
  } catch (err) {
    bad(`прод не отвечает: ${err.message} — VPN не выключать; сообщить Координатору, не обходить`);
    stopIfBad();
  }
  const info = await serverInfo(client);
  if (dumpVersion.major !== info.serverMajor) bad(`pg_dump в образе ${dumpVersion.full ?? dumpVersion.text}, прод ${info.serverVersion}: мажоры обязаны совпасть`);
  else ok(`pg_dump в образе ${dumpVersion.full}; прод PostgreSQL ${info.serverVersion} — мажор совпал`);
  if (info.ssl.on) ok(`соединение с продом: SSL ${info.ssl.version}; база ${info.database}, ${fmtBytes(info.databaseBytes)}`);
  else bad('соединение с продом без SSL');
  ok(`расширения прода: ${info.extensions.map((e) => `${e.name} ${e.version}${e.schema === 'public' ? '' : ` (схема ${e.schema})`}`).join(', ')}`);

  const pgEnv = pgEnvFromUrl(databaseUrl);
  const probe = await dockerRun({
    name: `${CONTAINER_PREFIX}probe-${runId}`,
    env: pgEnv,
    command: ['psql', '-X', '-tA', '-c', 'SELECT 1, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid())'],
    timeoutMs: 180000,
  });
  if (probe.code === 0 && probe.stdout.trim() === '1|t') ok('прод из контейнера: SELECT 1 → 1, SSL: да (sslmode=require)');
  else bad(`прод из контейнера не ответил как ждали: ${probe.stdout.trim() || lastLines(probe.stderr)}`);

  const reader = new CloudinaryReader(cloud);
  let usageInfo = null;
  try {
    const p = await reader.ping();
    usageInfo = await reader.usage();
    ok(`Cloudinary: ping ${p.status}; тариф ${usageInfo.plan}; хранилище ${fmtBytes(usageInfo.storage?.usage)}; ресурсов ${usageInfo.resources ?? '—'} (производных ${usageInfo.derived_resources ?? '—'}); кредиты ${usageInfo.credits?.usage ?? '—'} из ${usageInfo.credits?.limit ?? '—'}`);
  } catch (err) {
    bad(`Cloudinary: ${err.message} — VPN не выключать; сообщить, не обходить`);
  }

  const gpg = await findGpg();
  if (gpg) ok(`gpg: ${gpg.version}`);
  else bad('gpg не найден (ждём Git for Windows: C:\\Program Files\\Git\\usr\\bin\\gpg.exe)');
  const tar = await tarVersion();
  if (tar) ok(`tar: ${tar}`);
  else bad('tar не найден');

  const rootProblems = await checkSnapshotRoot(root);
  for (const p of rootProblems) bad(p);
  if (rootProblems.length === 0) ok(`папка снимков ${root}: вне git-дерева и вне OneDrive`);
  const free = freeBytes(root);
  ok(`свободно на диске: ${fmtBytes(free)}`);

  try {
    const c = await localClient(localPg);
    const t = await c.query("SELECT 1 FROM pg_database WHERE datname = 'template_postgis'");
    await c.end();
    if (t.rowCount) ok(`${VERIFY_CONTAINER}: вход для учебного восстановления есть, template_postgis на месте`);
    else bad(`в ${VERIFY_CONTAINER} нет template_postgis`);
  } catch (err) {
    bad(`${VERIFY_CONTAINER}: ${err.message}`);
  }

  const left = await checkClean({ runDirs: listRunDirs(root), localPg });
  if (!left.clean) {
    const text = `остались открытые данные прошлого прогона: ${JSON.stringify({ plaintext: left.plaintext, containers: left.containers, verifyDbs: left.verifyDbs })} — node scripts/prod-snapshot --cleanup`;
    if (apply) bad(text);
    else warn(text);
  } else ok('следов прошлых прогонов нет (открытых данных, контейнеров снимка, баз verify)');

  if (problems.length && client) await client.end().catch(() => {});
  stopIfBad();
  return { client, info, reader, usageInfo, gpg, tar, dumpVersion, pgEnv, free, dockerVersion };
};

// ───────────────────────── снимок ─────────────────────────

/**
 * Прошлый прогон для дифа — последний, у которого есть index.json и хотя бы одна
 * успешная проверка: verify.json от --apply ИЛИ verify-<время>.json от --verify
 * (прогон 1 30.09.2026 прошёл проверку только повторной — после правки белого списка).
 */
const findPreviousIndex = (root, runId) => {
  const verified = (d) => readdirSync(d).filter((n) => /^verify(-.+)?\.json$/.test(n)).some((n) => {
    try {
      return JSON.parse(readFileSync(join(d, n), 'utf8')).ok === true;
    } catch {
      return false;
    }
  });
  const candidates = listRunDirs(root)
    .filter((d) => basename(d) < runId && existsSync(join(d, 'index.json')))
    .sort()
    .reverse();
  for (const d of candidates) {
    if (!verified(d)) continue;
    try {
      return JSON.parse(readFileSync(join(d, 'index.json'), 'utf8'));
    } catch {
      // битый индекс — ищем раньше
    }
  }
  return null;
};

const snapshot = async ({ root, apply }) => {
  const started = new Date();
  const runId = runIdFor(started);
  const runDir = join(root, runId);
  const databaseUrl = loadProdDatabaseUrl();
  const cloud = loadCloudinaryCredentials();
  const localPg = loadLocalPg();
  state.localPg = localPg;

  console.log(`Цель: ПРОД — ${maskDatabaseUrl(databaseUrl)} (DATABASE_URL из backend/.env.production)`);
  console.log(`      Cloudinary — облако ${cloud.cloudName} (ключи из backend/.env)`);
  console.log(apply
    ? `Режим: СНИМОК (--apply) → ${runDir}`
    : 'Режим: СУХОЙ ПРОГОН — ничего не скачивается и не записывается; запись — только с --apply');

  if (apply && existsSync(runDir)) throw new SetupError(`Папка прогона ${runDir} уже есть — подождите минуту или уберите её.`);

  const pre = await preflight({ root, apply, runId, databaseUrl, cloud, localPg });
  const { client, reader } = pre;
  const git = await gitState();

  // ── 1. Снимок базы: одна транзакция на всё. Сбой где угодно внутри — транзакция
  // закрывается и соединение с продом рвётся здесь же, а не при выходе процесса.
  console.log('\nСнимок базы (одна транзакция REPEATABLE READ READ ONLY)');
  let snap;
  let tables;
  let counts;
  let inventory;
  let scan;
  let dump = null;
  let after = null;
  let inTx = false;
  try {
    snap = await beginSnapshot(client);
    inTx = true;
    ok(`id снимка: ${snap.id}; время снимка (UTC): ${snap.at}`);
    tables = await listUserTables(client);
    counts = await countRows(client, tables);
    inventory = await readInventory(client);
    scan = await scanTextColumns(client, tables);
    const secondaryCols = scan.filter((s) => s.cloudinary > 0 && !PRIMARY_COLUMNS.has(`${s.table}.${s.column}`));
    inventory.secondaryUrls = await extractCloudinaryUrls(client, secondaryCols);

    if (apply) {
      state.runDirs.push(runDir);
      mkdirSync(join(runDir, 'build', 'db'), { recursive: true });
      const t = Date.now();
      const r = await dockerRun({
        name: `${CONTAINER_PREFIX}dump-${runId}`,
        env: pre.pgEnv,
        mounts: [{ source: join(runDir, 'build', 'db'), target: '/out' }],
        command: [
          'pg_dump', '-Fc', '--no-owner', '--no-privileges', `--snapshot=${snap.id}`,
          ...EXCLUDED_DATA_TABLES.map((x) => `--exclude-table-data=public.${x}`),
          '-f', '/out/prod.dump',
        ],
      });
      if (r.code !== 0) throw new Error(`pg_dump завершился с кодом ${r.code}: ${lastLines(r.stderr)}`);
      const dumpPath = join(runDir, 'build', 'db', 'prod.dump');
      dump = { file: 'db/prod.dump', bytes: statSync(dumpPath).size, sha256: await sha256File(dumpPath), seconds: Math.round((Date.now() - t) / 1000) };
      ok(`дамп: ${fmtBytes(dump.bytes)} за ${dump.seconds} с (pg_dump ${pre.dumpVersion.full} в контейнере, --snapshot=${snap.id})`);
    } else {
      const r = await dockerRun({
        name: `${CONTAINER_PREFIX}snapcheck-${runId}`,
        env: pre.pgEnv,
        command: ['pg_dump', '--schema-only', `--snapshot=${snap.id}`, '-f', '/dev/null'],
        timeoutMs: 300000,
      });
      if (r.code === 0) ok('pg_dump принимает экспортированный снимок (проба: схема → /dev/null, на диск ничего)');
      else throw new Error(`pg_dump не принял снимок ${snap.id}: ${lastLines(r.stderr)}`);
    }
    await endTransaction(client);
    inTx = false;
    after = apply ? await countRowsAfter(client, tables) : null;
  } finally {
    if (inTx) await endTransaction(client).catch(() => {});
    await client.end().catch(() => {});
  }

  console.log('  строк по таблицам (в снимке):');
  for (const [t, n] of Object.entries(counts)) {
    const note = EXCLUDED_DATA_TABLES.includes(t.replace(/^public\./, '')) ? '  ← данные не в дампе (секреты открытым текстом)' : '';
    const drift = after && after[t] !== n ? `  ⚠ после снимка: ${after[t]}` : '';
    console.log(`    ${t.padEnd(38)} ${String(n).padStart(7)}${note}${drift}`);
  }
  const afterDiffers = after ? Object.keys(counts).filter((t) => after[t] !== counts[t]) : [];
  if (after) {
    if (afterDiffers.length) warn(`пока шёл снимок, в прод писали: ${afterDiffers.join(', ')} — снимок согласован, это только признак`);
    else ok('счётчики «после» совпали со снимком — записи во время снимка не было');
  }

  // ── Носители ссылок
  console.log('\nНосители ссылок: скан всех текстовых колонок (строк с «res.cloudinary.com» / с «/uploads/»)');
  const refs = collectRefs(inventory, { cloudName: cloud.cloudName, legacyHosts: LEGACY_HOSTS });
  for (const s of scan) {
    const key = `${s.table}.${s.column}`;
    const role = PRIMARY_COLUMNS.has(key) ? 'живой' : SECONDARY_COLUMNS.has(key) ? 'происхождение' : 'НЕОЖИДАННЫЙ';
    let check = '';
    if (PRIMARY_COLUMNS.has(key)) {
      const parsed = refs.filter((r) => r.table === s.table && r.column === s.column
        && (CLOUDINARY_CLASSES.has(r.cls) || r.cls === URL_CLASS.CLOUDINARY_FOREIGN)).length;
      check = parsed === s.cloudinary ? ` · разбор ${parsed} ✓` : ` · разбор ${parsed} ✗ РАСХОЖДЕНИЕ`;
    }
    console.log(`    ${key.padEnd(40)} ${String(s.cloudinary).padStart(5)} / ${String(s.uploads).padStart(3)}  ${role}${check}`);
  }
  const unexpected = scan.filter((s) => s.cloudinary > 0 && !PRIMARY_COLUMNS.has(`${s.table}.${s.column}`) && !SECONDARY_COLUMNS.has(`${s.table}.${s.column}`));
  if (unexpected.length) warn(`неожиданные носители ссылок Cloudinary: ${unexpected.map((s) => `${s.table}.${s.column}`).join(', ')} — их файлы считаются «сиротами с происхождением»`);
  else ok('носителей ссылок Cloudinary вне известного списка нет');

  // ── 2. Листинг Cloudinary
  console.log('\nCloudinary: листинг всего облака (только чтение)');
  const assetsByKey = new Map();
  const listing = {};
  let listingFields = null;
  for (const rt of RESOURCE_TYPES) {
    const parts = [];
    for (const type of DELIVERY_TYPES) {
      const list = await reader.listAll(rt, type);
      listing[`${rt}/${type}`] = list.length;
      parts.push(`${type} ${list.length}`);
      for (const a of list) assetsByKey.set(assetKey(a), a);
      if (!listingFields && list[0]) listingFields = Object.keys(list[0]).sort();
    }
    const untyped = await reader.listAll(rt);
    listing[`${rt}/*`] = untyped.length;
    const other = untyped.filter((a) => !DELIVERY_TYPES.includes(a.type));
    for (const a of other) assetsByKey.set(assetKey(a), a);
    console.log(`    ${rt}: ${parts.join(', ')}; без фильтра type: ${untyped.length}${other.length ? ` (прочие типы: ${[...new Set(other.map((a) => a.type))].join(', ')} — ${other.length})` : ''}`);
  }
  const allAssets = [...assetsByKey.values()];
  const assets = allAssets.filter((a) => a.type === 'upload');
  const notDownloadable = allAssets.filter((a) => a.type !== 'upload');
  if (notDownloadable.length) warn(`ассетов не type=upload: ${notDownloadable.length} — ссылка доставки требует подписи; в этот снимок не качаются (находка)`);
  if (listingFields) ok(`поля листинга: ${listingFields.join(', ')}`);

  const listed = new Set(assets.map(assetKey));
  const unresolved = new Map();
  for (const r of refs) {
    if (r.carrier === 'primary' && CLOUDINARY_CLASSES.has(r.cls) && !listed.has(refKey(r))) unresolved.set(refKey(r), r);
  }
  const fallback = new Map();
  for (const [k, r] of unresolved) {
    const p = await probeByPublicId(cloud.cloudName, r);
    if (p.found) fallback.set(k, p.asset);
  }
  if (unresolved.size) warn(`живых ссылок на public_id вне листинга: ${unresolved.size}; найдены прямым запросом: ${fallback.size}`);

  const { files, rowsWithoutFile } = planFiles(refs, assets, fallback);
  const summary = summarize({ refs, files, rowsWithoutFile, establishments: inventory.establishments, mediaRows: inventory.mediaRows });
  const primaryCheck = checkPrimaryImages(inventory.establishments, inventory.mediaRows);

  console.log('\nСсылки базы (живые носители) по классам');
  printTally(summary.refs.primary_by_class);
  console.log('  по колонкам:');
  printTally(summary.refs.primary_by_column);
  console.log('  внешние — по хостам (не качаются, только перечислены в манифесте):');
  printTally(summary.refs.external_by_host);
  console.log('  вторичные носители (происхождение):');
  printTally(summary.refs.secondary_by_source);

  console.log(`\nФайлы к скачиванию: ${summary.files.total}, ${fmtBytes(summary.files.bytes)}`);
  console.log('  по статусу:');
  printTally(summary.files.by_status);
  console.log('  сироты с происхождением — откуда:');
  printTally(summary.files.orphans_with_provenance_by_source);
  console.log('  по префиксу public_id:');
  printTally(summary.files.by_prefix);
  ok(`вне establishments/ и avatars/: ${summary.files.outside_known_prefixes}`);
  console.log('  по типу и формату:');
  printTally({ ...summary.files.by_type, ...Object.fromEntries(Object.entries(summary.files.by_format).map(([k, v]) => [`формат ${k}`, v])) });
  console.log('  настоящий ли оригинал:');
  printTally(summary.files.by_original);
  console.log(`\nСтроки без файла: ${rowsWithoutFile.length}`);
  printTally(summary.rows_without_file);
  console.log(`\nКарточки с фото без настоящего оригинала (#13 — беречь оригиналы на устройствах): ${summary.cards_without_true_original.length}`);
  for (const c of summary.cards_without_true_original) {
    console.log(`    ${c.name} [${c.status}] (${c.id}) — сжато при загрузке: ${c.compressed}, возможно сжато: ${c.possibly}`);
  }
  console.log(`\nПроверка (в) по снимку: обложек ${primaryCheck.checked}, без обложки ${primaryCheck.withoutCover}, расходятся с медиа карточки: ${primaryCheck.mismatched.length}${primaryCheck.mismatched.length ? ` (${primaryCheck.mismatched.join(', ')})` : ''}`);
  const rl = reader.rateLimit;
  console.log(`Бюджет Admin API: вызовов в этом прогоне ${reader.calls}; осталось ${rl ? `${rl.remaining} из ${rl.limit} (сброс ${rl.reset})` : '— (заголовков лимита нет)'}; скачивание идёт через ссылки доставки и бюджет Admin API не тратит`);

  const previous = findPreviousIndex(root, runId);

  if (!apply) {
    const media = summary.files.bytes;
    const dbUpper = pre.info.databaseBytes;
    const archiveName = `nirivio-snapshot-${runId}.tar.gpg`;
    console.log('\nПлан --apply');
    console.log(`  папка прогона: ${runDir}\\ (время в имени — время запуска)`);
    console.log(`  архив: ${archiveName} ≈ ${fmtBytes(media)} медиа + дамп (≤ ${fmtBytes(dbUpper)}, -Fc сжимает)`);
    console.log(`  пик на диске ≈ 3 объёма архива ≈ ${fmtBytes(3 * (media + dbUpper))}; свободно ${fmtBytes(pre.free)}`);
    console.log('  пароль: два окна pinentry — задать (один раз), проверочная расшифровка (--no-symkey-cache: агент не помнит); перед вводом — раскладка ENG/РУС');
    console.log(`  учебное восстановление: база ${verifyDbName()}… в ${VERIFY_CONTAINER}, после проверок удаляется`);
    console.log(`  диф к прошлому прогону: ${previous ? previous.run_id : 'прошлого прогона нет — это первый'}`);
    if (3 * (media + dbUpper) > pre.free) warn('места на диске может не хватить');
    return EXIT.OK;
  }

  // ── 3. Скачивание
  console.log(`\nСкачивание ${files.size} файлов (${fmtBytes(summary.files.bytes)})`);
  const entries = [...files.values()];
  const pathByKey = new Map();
  const seenPaths = new Map();
  for (const e of entries) {
    let p = archiveFilePath(e.asset);
    const lower = p.toLowerCase(); // NTFS не различает регистр
    if (seenPaths.has(lower)) p = p.replace(/(\.[^./]+)?$/, `~${randomBytes(4).toString('hex')}$1`);
    seenPaths.set(p.toLowerCase(), true);
    pathByKey.set(assetKey(e.asset), p);
  }
  const downloads = new Map();
  let done = 0;
  let bytesDone = 0;
  const tDl = Date.now();
  await pool(entries, 4, async (e) => {
    const key = assetKey(e.asset);
    const rel = pathByKey.get(key);
    const r = await downloadFile(e.asset.secure_url, join(runDir, 'build', ...rel.split('/')), {
      expectedBytes: e.asset.bytes ?? null,
      listingEtag: e.asset.etag ?? null,
    });
    downloads.set(key, { ...r, path: rel });
    done += 1;
    bytesDone += r.bytes || 0;
    if (done % 50 === 0 || done === entries.length) console.log(`    ${done}/${entries.length}, ${fmtBytes(bytesDone)}`);
  });
  // Второй заход по сбойным — по одному: через VPN новое соединение иногда виснет,
  // а повтор спустя минуту проходит (память reference_vpn_geo_blocked_sites).
  const retry = entries.filter((e) => !downloads.get(assetKey(e.asset)).ok && downloads.get(assetKey(e.asset)).status !== 404);
  if (retry.length) {
    warn(`сбой у ${retry.length} файлов — второй заход по одному`);
    for (const e of retry) {
      const key = assetKey(e.asset);
      const rel = pathByKey.get(key);
      const r = await downloadFile(e.asset.secure_url, join(runDir, 'build', ...rel.split('/')), {
        expectedBytes: e.asset.bytes ?? null, listingEtag: e.asset.etag ?? null, attempts: 2,
      });
      downloads.set(key, { ...r, path: rel });
    }
  }
  const failed = [...downloads.entries()].filter(([, d]) => !d.ok);
  for (const [key, d] of failed) warn(`не скачан ${key}: ${d.error}`);
  const checkTally = {};
  for (const d of downloads.values()) {
    for (const [k, v] of Object.entries(d.checks || {})) checkTally[`${k}: ${v}`] = (checkTally[`${k}: ${v}`] || 0) + 1;
  }
  ok(`скачано ${downloads.size - failed.length} из ${downloads.size} за ${Math.round((Date.now() - tDl) / 1000)} с`);
  console.log('  сверки:');
  printTally(checkTally);

  // ── 4. Манифест и индекс
  const fileRecords = entries.map((e) => fileRecord(e, downloads.get(assetKey(e.asset))));
  for (const f of fileRecords) f.path = downloads.get(f.key)?.path ?? f.path;
  const index = buildIndex({
    runId, snapshotTimeUtc: snap.at, cloudName: cloud.cloudName, counts,
    establishments: inventory.establishments, mediaRows: inventory.mediaRows, fileRecords,
  });
  const diff = previous ? diffIndexes(previous, index) : null;
  const manifest = {
    format: 'nirivio-prod-snapshot-manifest/1',
    run_id: runId,
    created_by: 'backend/scripts/prod-snapshot',
    run_started_at_utc: started.toISOString(),
    snapshot: { time_utc: snap.at, exported_snapshot_id: snap.id },
    git,
    versions: {
      server: pre.info.serverVersion,
      extensions: pre.info.extensions,
      pg_dump: pre.dumpVersion.full,
      docker_image: PG_IMAGE,
      docker: pre.dockerVersion,
      node: process.version,
      gpg: pre.gpg.version,
      tar: pre.tar,
    },
    target: { database: maskDatabaseUrl(databaseUrl), cloud_name: cloud.cloudName },
    counts: { snapshot: counts, after, after_differs: afterDiffers, excluded_data_tables: EXCLUDED_DATA_TABLES },
    dump,
    cloudinary: {
      usage: pre.usageInfo,
      listing,
      listing_fields: listingFields,
      not_downloaded_non_upload: notDownloadable.map((a) => ({ key: assetKey(a), bytes: a.bytes })),
      admin_api: { calls: reader.calls, rate_limit: reader.rateLimit },
    },
    carriers_scan: scan,
    summary,
    primary_image_check: primaryCheck,
    files: fileRecords,
    failed_downloads: failed.map(([key, d]) => ({ key, error: d.error, status: d.status })),
    rows_without_file: rowsWithoutFile,
    external_refs: refs.filter((r) => r.carrier === 'primary' && r.cls === URL_CLASS.EXTERNAL)
      .map((r) => ({ table: r.table, id: r.id, column: r.column, host: r.host, url: r.value })),
    legacy_local_refs: refs.filter((r) => r.carrier === 'primary' && r.cls === URL_CLASS.LEGACY_LOCAL)
      .map((r) => ({ table: r.table, id: r.id, column: r.column, value: r.value })),
    diff,
  };
  writeFileSync(join(runDir, 'build', 'manifest.json'), JSON.stringify(manifest, null, 2));

  // ── 5. Архив и шифрование: зашифровать → проверить расшифровку → удалить открытые данные
  const base = `nirivio-snapshot-${runId}`;
  const tarName = `${base}.tar`;
  const gpgName = `${tarName}.gpg`;
  console.log('\nАрхив и шифрование');
  const tr = await tarCreate(runDir, tarName, 'build');
  if (tr.code !== 0) throw new Error(`tar: ${lastLines(tr.stderr)}`);
  const tarSha = await sha256File(join(runDir, tarName));
  ok(`tar: ${fmtBytes(statSync(join(runDir, tarName)).size)}`);
  console.log('  → сейчас откроется окно pinentry: введите пароль архива ОДИН раз (проверьте раскладку ENG/РУС); подтвердит его проверочная расшифровка.');
  const er = await gpgEncrypt(pre.gpg.path, join(runDir, tarName), join(runDir, gpgName));
  if (er.code !== 0) throw new Error(`gpg --symmetric: ${lastLines(er.stderr)}`);
  const format = describePacketFormat(await readPacketHeaders(join(runDir, gpgName)));
  if (!format.ok) throw new Error(`формат шифрования не годится: ${format.text}`);
  const gpgSha = await sha256File(join(runDir, gpgName));
  const gpgBytes = statSync(join(runDir, gpgName)).size;
  ok(`зашифровано: ${gpgName}, ${fmtBytes(gpgBytes)}; формат: ${format.text}`);
  await rm(join(runDir, tarName), { force: true });

  index.archive = { file: gpgName, bytes: gpgBytes, gpg_sha256: gpgSha, tar_sha256: tarSha, format: format.text };
  index.diff = diff;
  writeFileSync(join(runDir, 'index.json'), JSON.stringify(index, null, 2));

  // ── 6. Проверочная расшифровка и учебное восстановление
  const verify = await verifyArchive({
    gpg: pre.gpg, archivePath: join(runDir, gpgName), workDir: runDir, localPg, runId, expectedTarSha: tarSha,
    onDecrypted: async () => {
      await rm(join(runDir, 'build'), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      ok('расшифровка проверена (sha256 tar совпал) — открытая папка сборки удалена');
    },
  });
  await cleanupState();
  verify.cleanup = state.lastCleanup;
  writeFileSync(join(runDir, 'verify.json'), JSON.stringify(verify, null, 2));

  printVerify(verify);
  if (diff) printDiff(diff);
  console.log(`\nИтог: ${verify.ok ? 'снимок записан и проверен' : 'снимок записан, но проверка НЕ прошла'} — ${runDir}`);
  console.log(`  ${gpgName} (${fmtBytes(gpgBytes)}), index.json, verify.json`);
  console.log('  Снимок покрывает БД и медиа, не покрывает конфигурацию (переменные Railway, Redis); RPO = время этого снимка.');
  return verify.ok ? EXIT.OK : EXIT.UNVERIFIED;
};

// ───────────────────────── учебное восстановление ─────────────────────────

const verifyArchive = async ({ gpg, archivePath, workDir, localPg, runId, expectedTarSha, onDecrypted }) => {
  const result = { format: 'nirivio-prod-snapshot-verify/1', run_id: runId, archive: basename(archivePath), verified_at_utc: new Date().toISOString(), ok: false };
  const tmp = join(workDir, 'decrypt-tmp');
  if (!state.runDirs.includes(workDir)) state.runDirs.push(workDir);
  await rm(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const tarName = basename(archivePath).replace(/\.gpg$/, '');

  console.log('\nПроверочная расшифровка');
  console.log('  → окно pinentry: введите тот же пароль из менеджера паролей (агент его не запомнил — так проверяется сохранённый пароль; раскладка ENG/РУС).');
  const t0 = Date.now();
  // Две попытки: опечатка или раскладка при проверке — ещё не повод выбрасывать
  // архив и качать всё заново. Вторая неудача — пароль архива не тот, что сохранён.
  let dr;
  let attempts = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt;
    dr = await gpgDecrypt(gpg.path, archivePath, join(tmp, tarName));
    if (dr.code === 0 || state.aborted) break;
    if (attempt < 2) warn(`не расшифровалось (${lastLines(dr.stderr, 1)}) — вторая попытка: окно pinentry откроется снова`);
  }
  if (dr.code !== 0) {
    result.decryption = { ok: false, attempts, error: lastLines(dr.stderr) };
    return result;
  }
  const sha = await sha256File(join(tmp, tarName));
  result.decryption = { ok: expectedTarSha ? sha === expectedTarSha : true, attempts, tar_sha256: sha, expected_tar_sha256: expectedTarSha ?? null };
  if (!result.decryption.ok) return result;
  ok(expectedTarSha ? 'sha256 расшифрованного tar совпал с исходным' : 'расшифровано (эталона sha256 нет — сверка по манифесту ниже)');
  if (onDecrypted) await onDecrypted();

  const t1 = Date.now();
  const xr = await tarExtract(tmp, tarName);
  if (xr.code !== 0) {
    result.extract = { ok: false, error: lastLines(xr.stderr) };
    return result;
  }
  await rm(join(tmp, tarName), { force: true });
  const buildDir = join(tmp, 'build');
  const manifest = JSON.parse(readFileSync(join(buildDir, 'manifest.json'), 'utf8'));
  result.run_id = manifest.run_id;

  const disk = new Map();
  for (const f of manifest.files) {
    const p = join(buildDir, ...f.path.split('/'));
    if (existsSync(p)) disk.set(f.path, await sha256File(p));
  }
  const filesOnDisk = {
    in_manifest: manifest.files.length,
    downloaded_in_manifest: manifest.files.filter((f) => f.sha256).length,
    on_disk: disk.size,
    sha256_match: manifest.files.filter((f) => f.sha256 && disk.get(f.path) === f.sha256).length,
  };
  // Нескачанную сироту не видят ни (б), ни сверка файлов на диске — поэтому сбои
  // скачивания — отдельная проверка вердикта (ревью Phase 3.5, 30.09.2026).
  const failedKeys = new Set(manifest.failed_downloads.map((f) => f.key));
  const downloads = {
    ok: failedKeys.size === 0,
    failed: failedKeys.size,
    failed_referenced: manifest.files.filter((f) => failedKeys.has(f.key) && f.status === 'referenced').map((f) => f.key),
    failed_other: manifest.files.filter((f) => failedKeys.has(f.key) && f.status !== 'referenced').map((f) => f.key),
  };
  const t2 = Date.now();

  console.log('\nУчебное восстановление');
  const dbName = verifyDbName();
  state.verifyDbs.push(dbName);
  state.localPg = localPg;
  await createVerifyDb(localPg, dbName);
  ok(`база ${dbName} создана из template_postgis`);
  const c = await localClient(localPg, dbName);
  try {
    const extensions = await installExtensions(c, manifest.versions.extensions);
    for (const e of extensions) (e.ok ? ok : warn)(`расширение ${e.name}: прод ${e.prod}, здесь ${e.local ?? '—'}${e.error ? ` — ${e.error}` : ''}`);
    const rr = await runPgRestore({ runId: runId || manifest.run_id, localPg, dbName, dumpDir: join(buildDir, 'db') });
    const errors = parseRestoreErrors(rr.stderr);
    const unexpected = errors.filter((e) => !e.expected);
    (unexpected.length ? warn : ok)(`pg_restore: код ${rr.code}; ошибок ${errors.length}, из них вне белого списка ${unexpected.length}`);
    for (const e of errors) console.log(`    ${e.expected ? 'ожидаемая' : 'НЕОЖИДАННАЯ'}: ${e.text}`);
    const t3 = Date.now();

    const tables = await listUserTables(c);
    const restoredCounts = await countRows(c, tables);
    const a = compareCounts(manifest.counts.snapshot, restoredCounts, manifest.counts.excluded_data_tables);
    const inv = await readInventory(c);
    inv.secondaryUrls = [];
    const refs = collectRefs(inv, { cloudName: manifest.target.cloud_name, legacyHosts: LEGACY_HOSTS });
    const manifestFiles = new Map(manifest.files.filter((f) => f.sha256).map((f) => [f.key, f]));
    const b = checkRefsHaveFiles(refs, manifestFiles, disk, manifest.rows_without_file);
    const cRestored = checkPrimaryImages(inv.establishments, inv.mediaRows);
    const cSame = JSON.stringify(cRestored) === JSON.stringify(manifest.primary_image_check);
    const t4 = Date.now();

    result.restore = { db_name: dbName, extensions, pg_restore_exit_code: rr.code, errors, unexpected_errors: unexpected.length };
    result.checks = {
      a_counts: { ok: a.mismatches.length === 0, ...a },
      b_files: { ok: b.failed.length === 0, ...b },
      c_primary_images: { ok: cSame, restored: cRestored, snapshot: manifest.primary_image_check },
      files_on_disk: { ok: filesOnDisk.sha256_match === filesOnDisk.downloaded_in_manifest, ...filesOnDisk },
      downloads,
    };
    result.rto = {
      minutes: Math.round(((t4 - t0) / 60000) * 10) / 10,
      decrypt_s: Math.round((t1 - t0) / 1000),
      extract_and_hash_s: Math.round((t2 - t1) / 1000),
      restore_s: Math.round((t3 - t2) / 1000),
      checks_s: Math.round((t4 - t3) / 1000),
      note: 'от архива до готовой базы и сверенных файлов; расшифровка включает ввод пароля',
    };
    result.ok = unexpected.length === 0 && extensions.every((e) => e.ok)
      && Object.values(result.checks).every((x) => x.ok);
  } finally {
    await c.end().catch(() => {});
  }
  return result;
};

const printVerify = (v) => {
  console.log('\nРезультат проверки');
  if (!v.decryption?.ok) {
    warn(`расшифровка: ${JSON.stringify(v.decryption)}`);
    return;
  }
  if (!v.checks) {
    warn(`до проверок не дошло: ${JSON.stringify(v.extract || v.restore || {})}`);
    return;
  }
  const { a_counts: a, b_files: b, c_primary_images: c, files_on_disk: f } = v.checks;
  (a.ok ? ok : warn)(`(а) счётчики строк: таблиц ${a.tables}, расхождений ${a.mismatches.length}${a.mismatches.length ? ` ${JSON.stringify(a.mismatches)}` : ''}`);
  (b.ok ? ok : warn)(`(б) живые ссылки cloudinary-*: ${b.checked}, файл найден и sha256 совпал ${b.found}, промах объяснён ${b.explained}, провал ${b.failed.length}`);
  (c.ok ? ok : warn)(`(в) обложки: в восстановленной базе ${c.restored.checked} (расходятся ${c.restored.mismatched.length}) — ${c.ok ? 'то же, что в снимке' : 'НЕ то же, что в снимке'}`);
  (f.ok ? ok : warn)(`файлы после расшифровки: в манифесте ${f.in_manifest}, скачанных ${f.downloaded_in_manifest}, на диске ${f.on_disk}, sha256 совпал ${f.sha256_match}`);
  const d = v.checks.downloads;
  (d.ok ? ok : warn)(`скачивание: не скачано ${d.failed} (со ссылками из базы ${d.failed_referenced.length}, прочих ${d.failed_other.length})`);
  ok(`(г) RTO учебный: ${v.rto.minutes} мин (расшифровка ${v.rto.decrypt_s} с, распаковка и хеши ${v.rto.extract_and_hash_s} с, pg_restore ${v.rto.restore_s} с, проверки ${v.rto.checks_s} с)`);
};

const printDiff = (d) => {
  console.log(`\nДиф к прогону ${d.previous_run_id}`);
  console.log(`  карточки: новых ${d.establishments.added.length}, исчезло ${d.establishments.removed.length}`);
  for (const c of d.new_cards) console.log(`    + ${c.name} (${c.id}): строк медиа ${c.media_rows}, со всеми файлами ${c.rows_with_all_files}`);
  for (const c of d.establishments.removed) console.log(`    − ${c.name} (${c.id})`);
  console.log(`  файлы: новых ${d.files.added.length}, пропало ${d.files.missing.length}, сменился sha256 ${d.files.sha256_changed.length}`);
  for (const k of d.files.missing) console.log(`    пропал: ${k}`);
  for (const k of d.files.sha256_changed) console.log(`    сменился sha256: ${k}`);
};

// ───────────────────────── прочие режимы ─────────────────────────

const pinentryCheck = async (root) => {
  const problems = await checkSnapshotRoot(root);
  if (problems.length) throw new SetupError(problems.join('; '));
  const gpg = await findGpg();
  if (!gpg) throw new SetupError('gpg не найден');
  ok(`gpg: ${gpg.version}`);
  const dir = join(root, '.pinentry-check');
  state.runDirs.push(dir);
  await rm(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const plain = join(dir, 'trial.bin');
    await writeFile(plain, randomBytes(4096));
    const sha = await sha256File(plain);
    console.log('→ окно pinentry: введите ПРОБНЫЙ пароль (не настоящий) один раз; раскладка — ENG/РУС на панели задач.');
    const er = await gpgEncrypt(gpg.path, plain, `${plain}.gpg`);
    if (er.code !== 0) throw new Error(`шифрование не удалось: ${lastLines(er.stderr)}`);
    const format = describePacketFormat(await readPacketHeaders(`${plain}.gpg`));
    (format.ok ? ok : warn)(`формат шифрования: ${format.text}`);
    console.log('→ окно pinentry: введите тот же пробный пароль для расшифровки.');
    const dr = await gpgDecrypt(gpg.path, `${plain}.gpg`, join(dir, 'trial.out'));
    if (dr.code !== 0) throw new Error(`расшифровка не удалась: ${lastLines(dr.stderr)}`);
    const back = await sha256File(join(dir, 'trial.out'));
    if (back !== sha) throw new Error('расшифрованный файл не совпал с исходным');
    ok('окно pinentry появляется из запуска через инструмент; шифрование и расшифровка работают');
    return format.ok ? EXIT.OK : EXIT.FAILED;
  } finally {
    await rm(dir, { recursive: true, force: true });
    skipCleanup();
  }
};

const verifyExisting = async (archiveArg, root) => {
  const archivePath = resolve(archiveArg);
  if (!existsSync(archivePath) || !archivePath.endsWith('.tar.gpg')) throw new SetupError(`нет архива ${archivePath}`);
  // Расшифровка — в локальную папку под корнем снимков, не рядом с архивом:
  // копия на внешнем диске не должна получить открытых данных даже на время.
  const problems = await checkSnapshotRoot(root);
  if (problems.length) throw new SetupError(problems.join('; '));
  const workDir = join(root, '.verify');
  const localPg = loadLocalPg();
  state.localPg = localPg;
  const gpg = await findGpg();
  if (!gpg) throw new SetupError('gpg не найден');
  let expectedTarSha = null;
  const indexPath = join(dirname(archivePath), 'index.json');
  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    if (index.archive?.file === basename(archivePath)) expectedTarSha = index.archive.tar_sha256;
  }
  console.log(`Проверка архива ${archivePath}${expectedTarSha ? '' : ' (index.json с эталоном sha256 не найден)'}`);
  const verify = await verifyArchive({ gpg, archivePath, workDir, localPg, runId: null, expectedTarSha });
  await cleanupState();
  verify.cleanup = state.lastCleanup;
  const out = join(dirname(archivePath), `verify-${runIdFor(new Date())}.json`);
  writeFileSync(out, JSON.stringify(verify, null, 2));
  printVerify(verify);
  console.log(`\n${verify.ok ? 'Архив годен' : 'Архив НЕ прошёл проверку'} — ${out}`);
  return verify.ok ? EXIT.OK : EXIT.UNVERIFIED;
};

const checkCopy = async (dirArg) => {
  const dir = resolve(dirArg);
  const indexPath = join(dir, 'index.json');
  if (!existsSync(indexPath)) throw new SetupError(`в ${dir} нет index.json`);
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const file = join(dir, index.archive?.file || '');
  if (!index.archive?.file || !existsSync(file)) throw new SetupError(`в ${dir} нет архива ${index.archive?.file}`);
  const sha = await sha256File(file);
  const good = sha === index.archive.gpg_sha256 && statSync(file).size === index.archive.bytes;
  (good ? ok : warn)(`${index.archive.file}: ${fmtBytes(statSync(file).size)}, sha256 ${good ? 'совпал с index.json' : 'НЕ совпал с index.json'}`);
  skipCleanup();
  return good ? EXIT.OK : EXIT.FAILED;
};

const sweep = async (root) => {
  state.runDirs = [...listRunDirs(root), join(root, '.pinentry-check'), join(root, '.verify')];
  try {
    state.localPg = loadLocalPg();
  } catch (err) {
    warn(`${err.message} — базы verify не проверяются`);
  }
  state.verifyDbs = 'all';
  const res = await cleanupState();
  for (const d of listRunDirs(root)) {
    if (readdirSync(d).length === 0) {
      await rm(d, { recursive: true, force: true });
      ok(`удалена пустая папка прогона ${d}`);
    }
  }
  return res.check.clean ? EXIT.OK : EXIT.FAILED;
};

// ───────────────────────── вход ─────────────────────────

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.out || join(homedir(), 'NirivioSnapshots'));
  let code;
  try {
    if (args['pinentry-check']) code = await pinentryCheck(root);
    else if (args.verify) code = await verifyExisting(args.verify, root);
    else if (args['check-copy']) code = await checkCopy(args['check-copy']);
    else if (args.cleanup) code = await sweep(root);
    else code = await snapshot({ root, apply: Boolean(args.apply) });
  } catch (err) {
    if (err instanceof SetupError) {
      console.error(`\n❌ ${err.message}`);
      code = EXIT.REFUSED;
    } else {
      console.error(`\n❌ Сбой: ${err.message}`);
      code = EXIT.FAILED;
    }
  } finally {
    // Уже идущая уборка (Ctrl+C) дожидается здесь же — выход её не обрывает.
    if (state.cleaning || state.runDirs.length || state.verifyDbs.length) await cleanupState();
  }
  process.exit(code);
};

main();
