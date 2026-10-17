/**
 * How many files in the cloud nothing in the database names. Read only —
 * the database and the cloud alike; it deletes nothing and writes nothing.
 *
 * Why: the cloud is on the free plan, and establishments/temp holds about 70 %
 * of its files and more than half of its storage (panel check, 2026-10-16).
 * «temp» is not rubbish — the wizard files every card photo there for good
 * (src/config/cloudinary.js, ownedFolders) — so the question whether to clean
 * it up is answered by the database, not by the folder: which files no row
 * names. This script counts them, per folder, with their size and age.
 * Deleting is a separate decision and a separate tool.
 *
 * What counts as a reference — scripts/lib/mediaOrphans.js: the file's
 * public_id as a whole path token anywhere in the database, in the stored text
 * and in every Cloudinary link read the way a browser reads it. Every text,
 * JSON and array column of every user table is searched (not a list of known
 * columns), and the column decides what the reference means: live (card
 * media, the cover, a promotion, an avatar, a partner document, the registry
 * of an unfinished import), history (audit log, a finished import's registry,
 * OCR errors) or an unknown place (named, never taken for an orphan). The
 * database cannot see the site wizard's unsaved drafts (browser) or the app's
 * registration before it is sent — the report keeps living accounts' files
 * and fresh files apart.
 *
 * What it prints: numbers and column names only — no public_id, no account
 * or card id, no names, no cloud names (the output goes into chats and reports).
 *
 * Two pairings, nothing else — the database and the cloud must be of one moment:
 *   --production --cloud
 *       production: DATABASE_URL from the environment or backend/.env.production,
 *       over TLS to the pinned certificate only (scripts/lib/productionDb.js);
 *       the cloud: the Admin API, GET calls of the read list only
 *       (prod-snapshot/cloudinaryReader.js refuses any other call before
 *       sending it): usage, then resources/<type>/<delivery> for image, raw
 *       and video × upload, private, authenticated, and resources/<type>
 *       for any other delivery — about 13 calls + one per extra 500 files of a
 *       list (the plan allows 500 an hour). Keys: CLOUDINARY_* from the
 *       environment, or all three from backend/.env.
 *   --listing=<file>   (a local database by DB_*)
 *       a restored snapshot with its manifest.json (prod-snapshot): the
 *       database must be that snapshot — its row counts are compared with the
 *       manifest's counts.snapshot in the same moment, or the run refuses;
 *       files uploaded at or after the snapshot's moment are not judged; each
 *       file's own verdict in the manifest is compared with this count.
 *       A plain saved listing (no counts) is accepted with a warning.
 *
 * Database: one REPEATABLE READ READ ONLY transaction in a read-only session
 * (scripts/lib/mediaOrphansDb.js) — the database refuses any write; about
 * 3 + one query per table with text columns + 3 (+ one per table counted
 * against a manifest).
 *
 * Usage (from backend/):
 *   DB_NAME=<restored snapshot> node scripts/media-orphans-audit.js --listing=<manifest.json>
 *   node scripts/media-orphans-audit.js --production --cloud
 *   From a git worktree: a launcher that reads backend/.env.production and the
 *   CLOUDINARY_* of backend/.env of the main checkout into the process
 *   environment (memory feedback_node_env_file_worktree_prod_scripts).
 * Options:
 *   --as-of=<date>  ages on this date (default: the snapshot's moment, else now)
 *   --json          the report as JSON (tests, diffing two runs)
 *
 * Exit: 0 — counted; 1 — could not count (arguments, setup, connection, query);
 * 2 — refused: the database and the listing are not of one cloud or one moment;
 * 3 — counted, but against a manifest a file its own verdict called referenced
 *     came out without a single reference: do not use these numbers.
 */
import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';
import { ProductionClient, loadProductionEnvironment } from './lib/productionDb.js';
import { CloudinaryReader, DELIVERY_TYPES, RESOURCE_TYPES } from './prod-snapshot/cloudinaryReader.js';
import {
  AGE_BUCKETS,
  DELIVERY_URL_REGEX_SOURCE,
  GROUP,
  KNOWN_KINDS,
  STATUS,
  buildReport,
  folderOf,
  formatBytes,
  indexCardStatuses,
  indexReferences,
  isUuid,
  listWholeCloud,
  parseListing,
  percent,
  plural,
  tokenRegexSource,
  topFoldersOf,
} from './lib/mediaOrphans.js';
import { readDatabase } from './lib/mediaOrphansDb.js';

const { Client } = pg;

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

class SetupError extends Error {}
class Refusal extends Error {}

const parseArgs = (argv) => {
  const out = { production: false, cloud: false, listing: null, asOf: null, json: false };
  for (const arg of argv) {
    if (arg === '--production') out.production = true;
    else if (arg === '--cloud') out.cloud = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--listing=')) out.listing = arg.slice('--listing='.length);
    else if (arg.startsWith('--as-of=')) out.asOf = arg.slice('--as-of='.length);
    // A mistyped --production must not quietly become a local run.
    else throw new SetupError(`Неизвестный аргумент: ${arg}`);
  }
  if (out.cloud === Boolean(out.listing)) {
    throw new SetupError('Нужен ровно один источник облака: --cloud (Admin API, только чтение) или --listing=<файл>.');
  }
  // The live cloud belongs with the live database, a saved listing with its restored copy.
  if (out.cloud && !out.production) {
    throw new SetupError('--cloud — только вместе с --production: живое облако сверяется только с живой базой. Для локальной базы — --listing=<манифест её снимка>.');
  }
  if (out.production && !out.cloud) {
    throw new SetupError('--production — только вместе с --cloud: старый листинг против живой базы ничего не скажет.');
  }
  return out;
};

/** Cloudinary keys: all three from the environment, else all three from backend/.env — never mixed. */
const cloudCredentials = () => {
  const pick = (v) => ({ cloudName: v.CLOUDINARY_CLOUD_NAME, apiKey: v.CLOUDINARY_API_KEY, apiSecret: v.CLOUDINARY_API_SECRET });
  const complete = (c) => Boolean(c.cloudName && c.apiKey && c.apiSecret);
  const fromEnv = pick(process.env);
  if (complete(fromEnv)) return { ...fromEnv, source: 'окружение' };
  const file = join(BACKEND_DIR, '.env');
  if (existsSync(file)) {
    const fromFile = pick(dotenv.parse(readFileSync(file)));
    if (complete(fromFile)) return { ...fromFile, source: 'backend/.env' };
  }
  throw new SetupError('Нет ключей Cloudinary: CLOUDINARY_CLOUD_NAME, _API_KEY, _API_SECRET — ни в окружении, ни в backend/.env.');
};

/** The live cloud: usage, then every list (scripts/lib/mediaOrphans.js listWholeCloud). */
const readCloud = async () => {
  const credentials = cloudCredentials();
  const reader = new CloudinaryReader(credentials);
  const startedAt = new Date().toISOString();
  const usage = await reader.usage();
  const resources = await listWholeCloud(reader, { resourceTypes: RESOURCE_TYPES, deliveryTypes: DELIVERY_TYPES });
  const { assets } = parseListing({ resources });
  return {
    assets,
    cloudName: credentials.cloudName,
    dbMoment: null,
    counts: null,
    excludedTables: [],
    source: {
      kind: 'admin-api',
      keys: credentials.source,
      listedAt: startedAt,
      calls: reader.calls,
      rateLimit: reader.rateLimit,
      usageResources: Number.isFinite(usage?.resources) ? usage.resources : null,
    },
  };
};

const readListingFile = (path) => {
  if (!existsSync(path)) throw new SetupError(`Файла листинга нет: ${path}`);
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new SetupError(`Файл листинга не читается как JSON: ${error.message}`);
  }
  const listing = parseListing(json);
  if (!listing.cloudName) throw new SetupError('Облако листинга неизвестно: в файле нет target.cloud_name (манифест) или cloud_name.');
  return { ...listing, source: { kind: 'listing', file: basename(path), manifest: Boolean(listing.counts) } };
};

const buildClient = (production) => {
  if (production) return new ProductionClient({ connectionString: loadProductionEnvironment() });
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'restaurant_guide_belarus',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_dev_password',
    application_name: 'media-orphans-audit (read-only)',
  });
};

/** Ids of the accounts and cards whose folders hold files: only UUIDs go to the database. */
const ownerIdsOf = (assets) => {
  const users = new Set();
  const cards = new Set();
  for (const a of assets) {
    const f = folderOf(a.public_id);
    if (!f.ownerId || !isUuid(f.ownerId)) continue;
    if (f.group === GROUP.CARDS) cards.add(f.ownerId);
    else if (f.group === GROUP.TEMP || f.group === GROUP.AVATARS) users.add(f.ownerId);
  }
  return { users: [...users].sort(), cards: [...cards].sort() };
};

/**
 * The listing and the database must be of one cloud: a database read against
 * a listing of another cloud would report every file as an orphan.
 */
const checkSameCloud = (clouds, assetCount) => {
  if (assetCount > 0 && (clouds.ours === 0 || clouds.others > clouds.ours)) {
    throw new Refusal(
      `Сопоставлять нечего: ссылок базы на облако листинга ${clouds.ours}, на другие облака ${clouds.others}. ` +
        'Похоже, база и облако из разных сред — ничего не посчитано.',
    );
  }
};

const GROUP_TITLE = {
  [GROUP.TEMP]: 'establishments/temp — загрузки мастера по учёткам',
  [GROUP.CARDS]: 'establishments/<карточка> — загрузки по карточкам (каталог, акции)',
  [GROUP.AVATARS]: 'avatars — аватары',
  [GROUP.OTHER]: 'вне establishments/ и avatars/',
};
const GROUP_ORDER = [GROUP.TEMP, GROUP.CARDS, GROUP.AVATARS, GROUP.OTHER];

const AGE_TITLE = {
  under1: 'моложе суток', upTo7: '1–7 дн.', upTo30: '8–30 дн.', upTo90: '31–90 дн.', older: 'старше 90 дн.', unknown: 'без даты',
};
const OWNER_TITLE = {
  service: 'служебная учётка',
  partner: 'партнёры',
  otherRole: 'учётки без роли партнёра',
  missing: 'хозяина нет (учётка или карточка удалена)',
  exists: 'хозяин есть',
  none: '—',
};
const KIND_TITLE = {
  interior: 'интерьер', exterior: 'фасад', menu: 'меню (фото)', dishes: 'блюда', menu_pdf: 'меню PDF', promotions: 'акции',
  other: 'прочие разделы', none: 'без раздела',
};
const ROLE_TITLE = { [STATUS.LIVE]: 'живая', [STATUS.HISTORY]: 'история', [STATUS.OTHER]: 'НЕИЗВЕСТНОЕ место' };

const ageLine = (b) => AGE_BUCKETS.filter((k) => b.age[k] > 0 || k !== 'unknown')
  .map((k) => `${AGE_TITLE[k]} ${b.age[k]}`).join(' · ');
const range = (b) => (b.oldest ? `, загружены с ${b.oldest} по ${b.newest}` : '');
const counted = (b) => `${b.files} (${formatBytes(b.bytes)})`;

const printReport = (r) => {
  const line = '════════════════════════════════════════════════════════════';
  console.log(line);
  console.log('  ФАЙЛЫ ОБЛАКА БЕЗ ССЫЛОК ИЗ БАЗЫ — только чтение, ничего не удаляется');
  console.log(line);
  console.log(`  База:   ${r.target.database}`);
  const c = r.target.cloud;
  if (c.source.kind === 'admin-api') {
    const rl = c.source.rateLimit;
    console.log(`  Облако: ${c.name} — Admin API (ключи: ${c.source.keys}); вызовов ${c.source.calls}` +
      `${rl ? `, осталось ${rl.remaining} из ${rl.limit} до ${rl.reset}` : ''}`);
    console.log(`  Момент: листинг облака ${c.source.listedAt.slice(0, 16).replace('T', ' ')} UTC, база — сразу после него`);
  } else {
    console.log(`  Облако: ${c.name} — листинг из файла ${c.source.file}; Admin API не вызывался`);
    console.log(`  Момент базы: ${r.dbMoment ? `${r.dbMoment.slice(0, 16).replace('T', ' ')} UTC (снимок); загруженное позже — не проверяется` : 'неизвестен'}`);
  }
  if (r.countsCheck) {
    console.log(`  Сверка базы со снимком: таблиц ${r.countsCheck.checked}, расходятся ${r.countsCheck.mismatched}`);
  } else if (c.source.kind === 'listing') {
    console.log('  ⚠ В листинге нет счётчиков строк: что база — тот же снимок, не проверено.');
  }
  console.log(`  Запросов к базе: ${r.queries}, в одной транзакции «только чтение»; просмотрено таблиц ${r.scanned.tables}, текстовых колонок ${r.scanned.columns}`);
  console.log(`  Возраст файлов — на ${r.asOf.slice(0, 10)}`);
  console.log('');

  console.log(`Ссылок на облако листинга в базе: ${r.clouds.ours}; на другие облака: ${r.clouds.others}` +
    `${r.clouds.otherClouds ? ` (облаков: ${r.clouds.otherClouds})` : ''}`);
  if (c.source.kind === 'admin-api' && c.source.usageResources != null && c.source.usageResources !== r.totals.files) {
    console.log(`⚠ Панель тарифа считает файлов ${c.source.usageResources}, листинг показал ${r.totals.files} — список неполон, счёт ниже только по листингу.`);
  }
  console.log('Где нашлись ссылки (колонка — сколько файлов облака она называет):');
  for (const col of r.columns) console.log(`    ${col.column.padEnd(44)} ${String(col.files).padStart(5)}  ${ROLE_TITLE[col.role]}`);
  const unknownPlaces = r.columns.filter((col) => col.role === STATUS.OTHER);
  console.log(unknownPlaces.length
    ? `⚠ Ссылки в неизвестных местах: ${plural(unknownPlaces.length, ['колонка', 'колонки', 'колонок'])} — их файлы считаются занятыми, не сиротами; место стоит разобрать.`
    : 'Ссылок вне известных мест нет.');
  console.log(`Живых ссылок на файлы, которых в облаке нет: ${r.brokenLinks}`);
  console.log('');

  for (const name of GROUP_ORDER) {
    const g = r.groups[name];
    if (!g) continue;
    const s = g.status;
    console.log(`${GROUP_TITLE[name]}: ${plural(g.files, ['файл', 'файла', 'файлов'])}, ${formatBytes(g.bytes)}${g.folders ? `; подпапок ${g.folders}` : ''}`);
    const live = s[STATUS.LIVE];
    const byCard = r.cardStatusesRead
      ? ` — в опубликованных карточках ${g.liveByCard.active}, только в неопубликованных ${g.liveByCard.notActive}, не в карточке (аватар, документ, загрузка каталога) ${g.liveByCard.notCard}`
      : '';
    console.log(`  со ссылкой из карточек, акций, аватаров, документов: ${counted(live)}${byCard}`);
    if (live.files) console.log(`      возраст: ${ageLine(live)}${range(live)}`);
    if (s[STATUS.OTHER].files) console.log(`  ссылка в неизвестном месте (занят, не сирота): ${counted(s[STATUS.OTHER])}`);
    console.log(`  только в истории (журнал действий, реестр завершённой загрузки каталога, ошибки распознавания меню) — не сироты: ${counted(s[STATUS.HISTORY])}`);
    const none = s[STATUS.NONE];
    console.log(`  БЕЗ ЕДИНОЙ ССЫЛКИ: ${counted(none)} — ${percent(none.files, g.files)} файлов и ${percent(none.bytes, g.bytes)} объёма папки`);
    if (none.files) {
      console.log(`      возраст: ${ageLine(none)}${range(none)}`);
      console.log(`      чья папка: ${Object.entries(g.noneByOwner).map(([k, n]) => `${OWNER_TITLE[k] || '—'} ${n}`).join(' · ')}`);
      const kinds = Object.entries(g.noneByKind).filter(([k]) => k !== 'none' && (KNOWN_KINDS.includes(k) || k === 'other'));
      console.log(`      что за файлы: фото ${g.noneByFormat.image} · PDF ${g.noneByFormat.pdf}` +
        `${kinds.length ? `; по разделам: ${kinds.map(([k, n]) => `${KIND_TITLE[k]} ${n}`).join(' · ')}` : ''}`);
      if (name === GROUP.TEMP) {
        console.log('      ⚠ Базе не видны несохранённый черновик мастера на сайте (до названия, адреса, вида, кухни и часов — только в браузере)');
        console.log('        и регистрация в приложении до отправки: файлы живых учёток, особенно свежие, ещё могут понадобиться.');
      }
    }
    if (s[STATUS.UNCHECKED].files) {
      console.log(`  не проверены: ${counted(s[STATUS.UNCHECKED])} — имя необычной формы или в корне облака ${g.uncheckedWhy.shape}, загружены после снимка базы ${g.uncheckedWhy.afterDb}`);
    }
    console.log('');
  }

  if (r.snapshotComparison) {
    const cmp = r.snapshotComparison;
    console.log(`Сверка со статусами самого снимка (${cmp.files} файлов, снимок → этот счёт):`);
    for (const [was, mine] of Object.entries(cmp.matrix)) {
      console.log(`    ${was.padEnd(24)} → ${Object.entries(mine).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
    }
    console.log(cmp.referencedButNone
      ? `⛔ Снимок считал занятыми, а этот счёт — без единой ссылки: ${cmp.referencedButNone}. Числам не верить, разбираться.`
      : 'Ни одного файла, занятого по снимку, этот счёт не назвал сиротой.');
    console.log('');
  }

  const t = r.totals;
  const none = t.status[STATUS.NONE];
  console.log(line);
  console.log(`  Всего ${plural(t.files, ['файл', 'файла', 'файлов'])} (${formatBytes(t.bytes)}); без единой ссылки из базы — ${counted(none)}, ${percent(none.bytes, t.bytes)} объёма`);
  console.log('  Удаление — отдельное решение; этот счёт ничего не трогал.');
  console.log(line);
};

const main = async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }

  let cloud;
  try {
    cloud = args.cloud ? await readCloud() : readListingFile(resolve(args.listing));
  } catch (error) {
    console.error(`❌ Облако: ${error.message}`);
    return 1;
  }

  const asOfSource = args.asOf || cloud.dbMoment;
  const asOf = asOfSource ? new Date(asOfSource) : new Date();
  if (Number.isNaN(asOf.getTime())) {
    console.error(`❌ Дата --as-of не читается: ${args.asOf}`);
    return 1;
  }

  const topFolders = topFoldersOf(cloud.assets);
  // No file in a folder leaves no token to search for: a pattern that never matches.
  const tokenRegex = tokenRegexSource(topFolders) || '(?!)';

  let client;
  try {
    client = buildClient(args.production);
    await client.connect();
  } catch (error) {
    console.error(`❌ База: ${error.message}`);
    return 1;
  }

  let db;
  try {
    db = await readDatabase(client, {
      tokenRegex,
      urlRegex: DELIVERY_URL_REGEX_SOURCE,
      ownerIds: ownerIdsOf(cloud.assets),
      expectedCounts: args.production ? null : cloud.counts,
      excludedTables: cloud.excludedTables,
    });
  } catch (error) {
    console.error(`❌ База: ${error.message}`);
    await client.end().catch(() => {});
    return 1;
  }
  const target = args.production
    ? `ПРОД (база ${client.database}), сертификат закреплён`
    : `локальная (${client.host}:${client.port}/${client.database})`;
  await client.end().catch(() => {});

  const listed = new Set(cloud.assets.map((a) => a.public_id));
  const refs = indexReferences({
    tokenHits: db.tokenHits, urlHits: db.urlHits, topFolders, cloudName: cloud.cloudName, listed,
  });

  try {
    if (db.countsCheck?.mismatched.length) {
      throw new Refusal(
        `Локальная база — не тот снимок, что листинг: расходятся счётчики строк ${plural(db.countsCheck.mismatched.length, ['таблицы', 'таблиц', 'таблиц'])} ` +
          `из ${db.countsCheck.checked} — ничего не посчитано.`,
      );
    }
    checkSameCloud(refs.clouds, cloud.assets.length);
  } catch (error) {
    if (error instanceof Refusal) {
      console.error(`⛔ ${error.message}`);
      return 2;
    }
    throw error;
  }

  const counts = buildReport({
    assets: cloud.assets,
    refs,
    cardStatuses: indexCardStatuses(db.cardRows, topFolders),
    owners: db.owners,
    topFolders,
    asOf,
    dbMoment: cloud.dbMoment,
  });
  const report = {
    // The listing's own cloud only: names of other clouds come from user text and are not printed.
    target: { database: target, cloud: { name: cloud.cloudName, source: cloud.source } },
    queries: db.queries(),
    scanned: db.scanned,
    clouds: refs.clouds,
    cardStatusesRead: db.cardStatusesRead,
    countsCheck: db.countsCheck ? { checked: db.countsCheck.checked, mismatched: db.countsCheck.mismatched.length } : null,
    ...counts,
  };

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report.snapshotComparison?.referencedButNone ? 3 : 0;
};

process.exitCode = await main();
