/* eslint-disable no-console */
/**
 * Видимые копии скрытых блюд — запуск. Логика, правило и защиты — plan.js.
 * Скрипт пишет в базу мимо сервера; запись — только по слову Координатора
 * (п. 3а, П4а, 29.10.2026).
 *
 *   cd backend
 *   # 1. Сухой прогон на восстановленном снимке прода (локальная база по DB_*):
 *   DB_NAME=<база снимка> node scripts/hidden-dish-copies
 *   # 2. Сухой прогон на проде — список, N и отпечаток для вопроса Координатору:
 *   node scripts/hidden-dish-copies --production
 *   # 3. Запись — только после «да, N» Координатора, с N и отпечатком из шага 2:
 *   node scripts/hidden-dish-copies --expect=<N> --plan=<отпечаток> --apply --production
 *
 * Без --production — локальная база по переменным DB_* (как у
 * dismiss-menu-flags): забытый флаг прод не трогает. С --production адрес
 * базы берётся только из backend/.env.production — он перекрывает
 * DATABASE_URL, заданный в оболочке, — и печатается в строке «Цель».
 *
 * Коды выхода: 0 — готово (список или запись); 1 — отказ, ничего не
 * изменено; 2 — ошибка в команде; 3 — сбой.
 */

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { ProductionClient } from '../lib/productionDb.js';
import { Refusal, findCopies, formatCopies, hideCopies } from './plan.js';

const { Client } = pg;

const EXIT = { OK: 0, REFUSED: 1, USAGE: 2, FAILED: 3 };

const VALUE_OPTIONS = ['expect', 'plan'];
const SWITCHES = ['apply', 'production'];

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   node scripts/hidden-dish-copies [--expect=<N> --plan=<отпечаток> --apply] [--production]');
  process.exit(EXIT.USAGE);
};

/** Незнакомый аргумент — ошибка, а не пропуск: --aply молча превратил бы запись в сухой прогон. */
const parseArgs = (argv) => {
  const args = {};
  for (const raw of argv) {
    const match = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(raw);
    if (!match) usage(`Непонятный аргумент: ${raw}`);
    const [, name, value] = match;

    if (SWITCHES.includes(name) && value === undefined) {
      args[name] = true;
    } else if (!VALUE_OPTIONS.includes(name) || value === undefined) {
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
  if (args.apply) {
    if (args.expect === undefined) usage('Запись требует --expect=<N> из сухого прогона.');
    if (!args.plan) usage('Запись требует --plan=<отпечаток> из сухого прогона.');
  }
  return args;
};

const buildClient = (production) => {
  if (production) {
    const envPath = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), '.env.production');
    if (!existsSync(envPath)) {
      console.error('❌ Нет backend/.env.production (нужен DATABASE_URL).');
      process.exit(EXIT.USAGE);
    }
    // override: адрес прода — только из файла.
    dotenv.config({ path: envPath, override: true });
    if (!process.env.DATABASE_URL) {
      console.error('❌ В backend/.env.production не задан DATABASE_URL.');
      process.exit(EXIT.USAGE);
    }
    // Only the server whose certificate is pinned (scripts/lib/productionDb.js)
    return new ProductionClient({ connectionString: process.env.DATABASE_URL });
  }
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'restaurant_guide_belarus',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_dev_password',
  });
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const client = buildClient(args.production);
  await client.connect();

  try {
    const target = `${client.host}:${client.port}/${client.database}`;
    console.log(args.production
      ? `Цель: ПРОД — ${target} (DATABASE_URL из backend/.env.production)`
      : `Цель: локальная база ${target}`);
    console.log('');

    const found = await findCopies(client);
    console.log(formatCopies(found));
    console.log('');

    if (!args.apply) {
      if (found.total === 0) return EXIT.OK;
      console.log(`Сухой прогон — ничего не изменено. Запись после «да, ${found.total}» Координатора: `
        + `--expect=${found.total} --plan=${found.fingerprint} --apply${args.production ? ' --production' : ''}`);
      return EXIT.OK;
    }

    const result = await hideCopies(client, { expect: args.expect, plan: args.plan });
    const memoryNote = result.withMemory
      ? 'блюда — в памяти заведений.'
      : 'память скрытых блюд (038) в этой базе не применена.';
    console.log(`✅ Скрыто позиций: ${result.hidden.length}; записей в журнале действий: `
      + `${result.hidden.length}; ${memoryNote}`);
    console.log('   Вкладка «Скрытые» очереди «Позиции меню» — после обновления страницы; '
      + 'страница карточки на сайте — до часа.');
    return EXIT.OK;
  } finally {
    await client.end();
  }
};

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    if (err instanceof Refusal) {
      console.error(`⛔ Отказ: ${err.message}`);
      process.exitCode = EXIT.REFUSED;
      return;
    }
    console.error(`❌ Сбой: ${err.message}`);
    process.exitCode = EXIT.FAILED;
  });
