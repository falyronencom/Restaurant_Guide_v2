/**
 * Снимок прода — откуда берутся адреса и ключи.
 *
 * Все значения читаются dotenv.parse из файлов и в process.env НЕ пишутся:
 * - адрес прода — ТОЛЬКО backend/.env.production (DATABASE_URL, заданный в
 *   оболочке от другой работы, не может выиграть у файла);
 * - ключи Cloudinary — backend/.env (боевое облако, бриф §2);
 * - учётка pg-test для учебного восстановления — backend/.env.test.
 * Ни одно значение не печатается; адрес базы — только маской.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

export const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_DIR = resolve(BACKEND_DIR, '..');

/** Отказ до начала работы: среда не готова, ничего не сделано. */
export class SetupError extends Error {}

const readEnvFile = (name) => {
  const file = join(BACKEND_DIR, name);
  if (!existsSync(file)) return null;
  return dotenv.parse(readFileSync(file));
};

export const loadProdDatabaseUrl = () => {
  const values = readEnvFile('.env.production');
  if (!values) throw new SetupError('Нет backend/.env.production (нужен DATABASE_URL прода).');
  if (!values.DATABASE_URL) throw new SetupError('В backend/.env.production не задан DATABASE_URL.');
  return values.DATABASE_URL;
};

export const loadCloudinaryCredentials = () => {
  const values = readEnvFile('.env');
  if (!values) throw new SetupError('Нет backend/.env (нужны CLOUDINARY_*).');
  const cloudName = values.CLOUDINARY_CLOUD_NAME;
  const apiKey = values.CLOUDINARY_API_KEY;
  const apiSecret = values.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new SetupError('В backend/.env нет CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET.');
  }
  return { cloudName, apiKey, apiSecret };
};

/** Учётка локального pg-test (как у scripts/test-isolated): хост-порт и пароль из .env.test. */
export const loadLocalPg = () => {
  const values = readEnvFile('.env.test');
  if (!values) throw new SetupError('Нет backend/.env.test (учётка pg-test для учебного восстановления).');
  if (!values.DB_PASSWORD) throw new SetupError('В backend/.env.test не задан DB_PASSWORD.');
  return {
    host: values.DB_HOST || 'localhost',
    port: Number(values.DB_PORT) || 5432,
    user: values.DB_USER || 'postgres',
    password: values.DB_PASSWORD,
  };
};

/** postgresql://user:***@host:port/db — для строки «Цель». */
export const maskDatabaseUrl = (url) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${decodeURIComponent(u.username)}:***@${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(неразборчивый DATABASE_URL)';
  }
};

/**
 * Переменные libpq для pg_dump/psql в контейнере. Передаются контейнеру
 * ИМЕНАМИ (docker run -e PGPASSWORD без значения): в командной строке и
 * в списке процессов их значений нет. sslmode=require — скрипты проекта
 * ходят к проду по SSL без проверки сертификата (rejectUnauthorized:false).
 */
export const pgEnvFromUrl = (url) => {
  const u = new URL(url);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
    PGSSLMODE: 'require',
  };
};

/** Хосты, на которых /uploads/… значит legacy-local (API прода и локальный запуск). */
export const LEGACY_HOSTS = Object.freeze([
  'restaurantguidev2-production.up.railway.app',
  'localhost',
  '127.0.0.1',
  '10.0.2.2',
]);
