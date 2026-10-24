/* eslint-disable no-console */
/**
 * Три размера у старых фото карточек — запуск. Что меняется и что нет —
 * plan.js. Скрипт пишет в базу мимо сервера: --apply на проде — только по
 * слову Координатора в окне сессии, которая запускает, и после свежего снимка
 * прода (решение 21.10.2026, директива D2 нитки «Нагрузка и расходы»).
 *
 *   cd backend
 *   # 1. Сухой прогон: сколько фото и обложек, образец адресов. Ничего не пишет.
 *   node scripts/photo-sizes --production
 *   # 2. Запись — с числом фото из шага 1. До записи кладёт файл отката
 *   #    backend/photo-sizes-backup-<время>.json.
 *   node scripts/photo-sizes --expect=<N> --apply --production
 *   # Откат по файлу: сначала сухой прогон, потом --apply.
 *   node scripts/photo-sizes --rollback=<файл> --production
 *   node scripts/photo-sizes --rollback=<файл> --apply --production
 *
 * Без --production — локальная база по переменным DB_*: забытый флаг прод не
 * трогает. С --production адрес базы — из backend/.env.production
 * (loadProductionEnvironment), и только сервер с закреплённым сертификатом.
 * Облако — CLOUDINARY_CLOUD_NAME из окружения или из .env текущей папки
 * (utils/logger.js; запускать из backend/ основной папки, где он есть); без
 * него скрипт отказывает. Ссылки другого облака сухой прогон покажет
 * пропущенными. Файл отката — в backend/ (или --backup-dir=<папка>): из
 * рабочей копии (worktree) указывайте папку вне неё — уборка копии унесёт файл.
 *
 * Коды выхода: 0 — готово; 1 — отказ, ничего не изменено; 2 — ошибка в
 * команде; 3 — сбой (до COMMIT транзакция откатывается).
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { ProductionClient, loadProductionEnvironment } from '../lib/productionDb.js';

const EXIT = { OK: 0, REFUSED: 1, USAGE: 2, FAILED: 3 };
const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALUE_OPTIONS = ['expect', 'rollback', 'backup-dir'];
const SWITCHES = ['apply', 'production'];
const SAMPLE_SIZE = 3;

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   node scripts/photo-sizes [--expect=<N> --apply] [--production]');
  console.error('   node scripts/photo-sizes --rollback=<файл> [--apply] [--production]');
  process.exit(EXIT.USAGE);
};

/** Незнакомый аргумент — ошибка: опечатка вроде --aply молча дала бы сухой прогон. */
const parseArgs = (argv) => {
  const args = {};
  for (const raw of argv) {
    const match = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(raw);
    if (!match) usage(`Непонятный аргумент: ${raw}`);
    const [, name, value] = match;
    if (SWITCHES.includes(name) && value === undefined) {
      args[name] = true;
    } else if (!VALUE_OPTIONS.includes(name) || value === undefined || value === '') {
      usage(`Неизвестный аргумент: ${raw}`);
    } else if (args[name] !== undefined) {
      usage(`--${name} указан дважды`);
    } else {
      args[name] = value;
    }
  }
  if (args.expect !== undefined) {
    if (!/^\d+$/.test(args.expect)) usage(`--expect — целое число, получено «${args.expect}».`);
    args.expect = Number(args.expect);
  }
  if (args.rollback !== undefined && args.expect !== undefined) usage('--expect не нужен откату.');
  if (args.apply && args.rollback === undefined && args.expect === undefined) {
    usage('Запись требует --expect=<N> — число фото из сухого прогона.');
  }
  return args;
};

const buildClient = (production) => {
  if (production) {
    let connectionString;
    try {
      connectionString = loadProductionEnvironment();
    } catch (error) {
      usage(error.message);
    }
    return new ProductionClient({ connectionString });
  }
  return new pg.Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'restaurant_guide_belarus',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_dev_password',
  });
};

const countBy = (items, keyOf) => items.reduce((counts, item) => {
  const key = keyOf(item);
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

const printPlan = (plan) => {
  const byType = Object.entries(countBy(plan.changes, (change) => change.type))
    .map(([type, count]) => `${type} ${count}`).join(', ');
  const cards = new Set(plan.changes.map((change) => change.establishment_id)).size;
  console.log(`Фото с одной ссылкой во всех трёх полях: ${plan.found}`);
  console.log(`  к пересчёту: ${plan.changes.length}${byType ? ` (${byType})` : ''}, карточек ${cards}`);
  const skippedBy = countBy(plan.skipped, (skip) => skip.reason);
  console.log(`  пропущено: ссылка не нашего облака ${skippedBy.not_our_cloud || 0}, `
    + `не в форме, что выдаёт сервер, ${skippedBy.not_issued_form || 0}, ссылка на PDF ${skippedBy.pdf_link || 0}`);
  console.log(`Обложек каталога на одноразмерной ссылке: ${plan.covers.length}`);
  for (const change of plan.changes.slice(0, SAMPLE_SIZE)) {
    console.log('');
    console.log(`  фото ${change.id} (${change.type})`);
    console.log(`    url (не меняется): ${change.url}`);
    console.log(`    превью:   ${change.next.preview_url}`);
    console.log(`    миниатюра: ${change.next.thumbnail_url}`);
  }
};

const runBackfill = async (client, args, target) => {
  const { buildBackup, buildPlan, applyPlan } = await import('./plan.js');
  const plan = await buildPlan(client);
  printPlan(plan);

  if (!args.apply) {
    console.log('');
    console.log(plan.changes.length === 0
      ? 'Пересчитывать нечего.'
      : `Сухой прогон: ничего не записано. Запись: --expect=${plan.changes.length} --apply`);
    return EXIT.OK;
  }
  if (plan.changes.length !== args.expect) {
    console.error(`❌ Фото к пересчёту ${plan.changes.length}, а --expect=${args.expect}: база изменилась после сухого прогона. Ничего не записано.`);
    return EXIT.REFUSED;
  }
  if (plan.changes.length === 0) {
    console.log('Пересчитывать нечего.');
    return EXIT.OK;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(args['backup-dir'] ? resolve(args['backup-dir']) : BACKEND_ROOT, `photo-sizes-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(buildBackup({ target, ...plan }), null, 2), 'utf8');
  console.log('');
  console.log(`Файл отката: ${backupPath}`);

  const written = await applyPlan(client, plan);
  console.log(`✅ Записано: фото ${written.media} из ${plan.changes.length}, обложек ${written.covers} из ${plan.covers.length}.`);
  if (written.media < plan.changes.length || written.covers < plan.covers.length) {
    console.log('   Остальные изменились между чтением и записью (партнёр сохранил карточку) и не тронуты.');
  }
  return EXIT.OK;
};

const runRollback = async (client, args, target) => {
  const { applyRollback, planRollback } = await import('./plan.js');
  let backup;
  try {
    backup = JSON.parse(readFileSync(resolve(args.rollback), 'utf8'));
  } catch (error) {
    usage(`Файл отката не прочитан: ${error.message}`);
  }
  let plan;
  try {
    plan = await planRollback(client, backup, target);
  } catch (error) {
    if (error.code === 'BACKUP_OTHER_TARGET') {
      console.error(`❌ ${error.message} Ничего не записано.`);
      return EXIT.REFUSED;
    }
    if (error.code !== 'BACKUP_UNREADABLE') throw error;
    usage(error.message);
  }
  console.log(`Файл отката: ${backup.createdAt}, цель записи — ${backup.target}`);
  console.log(`  вернуть фото: ${plan.media.length} из ${backup.media.length}, обложек: ${plan.covers.length} из ${backup.covers.length}`);
  console.log(`  изменились после записи (не трогаются): ${plan.changedSince}`);
  if (!args.apply) {
    console.log('');
    console.log('Сухой прогон отката: ничего не записано. Откат: добавьте --apply.');
    return EXIT.OK;
  }
  const written = await applyRollback(client, plan);
  console.log(`✅ Возвращено: фото ${written.media}, обложек ${written.covers}.`);
  return EXIT.OK;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const client = buildClient(args.production);

  // После окружения прода: облако читается при загрузке config/cloudinary.js.
  const { default: cloudinary } = await import('../../src/config/cloudinary.js');
  const cloudName = cloudinary.config().cloud_name;
  if (!cloudName) usage('CLOUDINARY_CLOUD_NAME не задан: не с чем сверять ссылки.');

  await client.connect();
  try {
    const target = `${client.host}:${client.port}/${client.database}`;
    console.log(args.production
      ? `Цель: ПРОД — ${target}; облако ${cloudName}`
      : `Цель: локальная база ${target}; облако ${cloudName}`);
    console.log('');
    return args.rollback !== undefined
      ? await runRollback(client, args, target)
      : await runBackfill(client, args, target);
  } finally {
    await client.end().catch(() => {});
  }
};

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(`❌ Сбой: ${error.message}`);
    process.exitCode = EXIT.FAILED;
  });
