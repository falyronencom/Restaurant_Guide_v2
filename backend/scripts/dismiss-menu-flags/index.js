/* eslint-disable no-console */
/**
 * Пакетное снятие флагов проверки с позиций меню — запуск. Логика, защиты и
 * причины — dismiss.js. Скрипт пишет в базу мимо сервера; запускает его
 * сессия по слову Координатора (решение 29.09.2026).
 *
 *   cd backend
 *   # 1. У каких заведений есть флаги причины (только чтение):
 *   node scripts/dismiss-menu-flags --reason=price_delta_anomaly --production
 *   # 2. Сухой прогон: таблица позиций, N, отпечаток пачки и вопрос Координатору:
 *   node scripts/dismiss-menu-flags --reason=price_delta_anomaly --establishment=<id> [--establishment=<id> …] --production
 *   # 3. Запись — только после «да, N» Координатора, с N и отпечатком из шага 2:
 *   node scripts/dismiss-menu-flags --reason=price_delta_anomaly --establishment=<id> --expect=<N> --plan=<отпечаток> --admin-email=<почта> --apply --production
 *
 * Без --production — локальная база по переменным DB_* (как у
 * set-user-active.js): забытый флаг прод не трогает. С --production адрес
 * базы берётся только из backend/.env.production — он перекрывает
 * DATABASE_URL, заданный в оболочке, — и печатается в строке «Цель».
 * Заведение — id или точное название; id надёжнее: кириллица в аргументах
 * shell на Windows может исказиться, и тогда скрипт ответит «не найдено».
 *
 * Подтверждение — число. Вопроса «yes» нет: «да» Координатор говорит в чате,
 * глядя на таблицу сухого прогона; --expect=N привязывает запись к этому
 * числу, --plan — к составу пачки, которую он видел.
 *
 * Коды выхода: 0 — готово (список, сухой прогон или запись); 1 — отказ,
 * ничего не изменено; 2 — ошибка в команде; 3 — сбой. При сбое до COMMIT
 * транзакция откатывается; если оборвался сам ответ на COMMIT, исход
 * неизвестен — повторный сухой прогон покажет, что осталось.
 */

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  Refusal,
  applyDismissal,
  confirmationText,
  formatPlan,
  formatVenueList,
  listFlaggedVenues,
  planDismissal,
} from './dismiss.js';

const { Client } = pg;

const EXIT = { OK: 0, REFUSED: 1, USAGE: 2, FAILED: 3 };

const VALUE_OPTIONS = ['reason', 'establishment', 'expect', 'plan', 'admin-email'];
const SWITCHES = ['apply', 'production'];

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   node scripts/dismiss-menu-flags --reason=<причина> [--establishment=<id|название> …]');
  console.error('        [--expect=<N> --plan=<отпечаток> --admin-email=<почта> --apply] [--production]');
  process.exit(EXIT.USAGE);
};

/**
 * Разбор аргументов. Незнакомый аргумент — ошибка, а не пропуск: опечатка
 * вроде --establishments= молча превратила бы сухой прогон в список, а
 * --aply — запись в сухой прогон.
 */
const parseArgs = (argv) => {
  const args = { establishments: [] };
  for (const raw of argv) {
    const match = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(raw);
    if (!match) usage(`Непонятный аргумент: ${raw}`);
    const [, name, value] = match;

    if (SWITCHES.includes(name) && value === undefined) {
      args[name] = true;
    } else if (!VALUE_OPTIONS.includes(name) || value === undefined) {
      usage(`Неизвестный аргумент: ${raw}`);
    } else if (name === 'establishment') {
      args.establishments.push(value);
    } else if (args[name] !== undefined) {
      usage(`--${name} указан дважды`);
    } else {
      args[name] = value;
    }
  }

  if (!args.reason) usage('Нужен --reason=<причина>.');
  if (args.expect !== undefined) {
    if (!/^\d+$/.test(args.expect)) usage(`--expect — целое число, получено «${args.expect}».`);
    args.expect = Number(args.expect);
  }
  if (args.apply) {
    if (args.establishments.length === 0) usage('Запись требует --establishment.');
    if (args.expect === undefined) usage('Запись требует --expect=<N> из сухого прогона.');
    if (!args.plan) usage('Запись требует --plan=<отпечаток> из сухого прогона.');
    if (!args['admin-email']) usage('Запись требует --admin-email=<почта администратора>.');
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
    // override: адрес прода — только из файла. DATABASE_URL, оставшийся в
    // оболочке от другой работы, иначе молча выиграл бы у файла.
    dotenv.config({ path: envPath, override: true });
    if (!process.env.DATABASE_URL) {
      console.error('❌ В backend/.env.production не задан DATABASE_URL.');
      process.exit(EXIT.USAGE);
    }
    return new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
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

    if (args.establishments.length === 0) {
      const venues = await listFlaggedVenues(client, args.reason);
      console.log(formatVenueList(args.reason, venues));
      if (venues.length > 0) {
        console.log('');
        console.log('Сухой прогон по заведению: добавьте --establishment=<id> (можно несколько).');
      }
      return EXIT.OK;
    }

    const plan = await planDismissal(client, {
      establishments: args.establishments,
      reason: args.reason,
    });
    console.log(formatPlan(plan));
    console.log('');

    if (!args.apply) {
      if (plan.total === 0) {
        console.log('Снимать нечего.');
        return EXIT.OK;
      }
      console.log(`Вопрос Координатору: ${confirmationText(plan)}`);
      console.log('');
      console.log(`Сухой прогон — ничего не изменено. Запись после «да, ${plan.total}»: те же аргументы и `
        + `--expect=${plan.total} --plan=${plan.fingerprint} --admin-email=<почта> --apply`);
      return EXIT.OK;
    }

    const result = await applyDismissal(client, {
      establishments: args.establishments,
      reason: args.reason,
      expect: args.expect,
      plan: args.plan,
      adminEmail: args['admin-email'],
    });
    const n = result.dismissed.length;
    console.log(`✅ Снято флагов: ${n}; записей в журнале действий: ${n} (автор ${result.author.email}).`);
    console.log('   Очередь «Позиции меню» — сразу после обновления страницы; счётчик в меню — '
      + 'после обновления страницы не раньше чем через 30 с; «Здоровье данных» — через 2 мин '
      + 'или сразу по кнопке обновления.');
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
