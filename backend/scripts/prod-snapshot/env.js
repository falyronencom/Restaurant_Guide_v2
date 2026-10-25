/**
 * Снимок прода — откуда берутся адреса и ключи.
 *
 * Все значения читаются dotenv.parse из файлов и в process.env НЕ пишутся:
 * - адрес прода и закреплённый сертификат его базы — ТОЛЬКО
 *   backend/.env.production (DATABASE_URL, заданный в оболочке от другой
 *   работы, не может выиграть у файла);
 * - ключи Cloudinary — backend/.env (боевое облако, бриф §2);
 * - учётка pg-test для учебного восстановления — backend/.env.test.
 * Ни одно значение не печатается; адрес базы — только маской.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { explainConnectionFailure, readPinnedCertificate } from '../lib/productionDb.js';

export const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_DIR = resolve(BACKEND_DIR, '..');

/** Отказ до начала работы: среда не готова, ничего не сделано. */
export class SetupError extends Error {}

const readEnvFile = (name, dir = BACKEND_DIR) => {
  const file = join(dir, name);
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
 * Закреплённый сертификат прода — из того же backend/.env.production, что и
 * адрес (DATABASE_TLS_CERT, его кладёт scripts/pin-production-db-cert.js).
 * С 24.10.2026 (инцидент Railway, находка 1) обе дороги снимка — сессия Node
 * и pg_dump/psql в контейнере — говорят только с сервером, который
 * предъявил этот сертификат; до того обе шли без проверки.
 *
 * @param {Object} [options]
 * @param {string} [options.backendDir=BACKEND_DIR] - папка с .env.production (тесты — своя)
 * @returns {import('crypto').X509Certificate}
 * @throws {SetupError} нет файла, нет закрепления, закрепление не читается —
 *   с командой, которая его ставит (текст scripts/lib/productionDb.js)
 */
export const loadProdPinnedCertificate = ({ backendDir = BACKEND_DIR } = {}) => {
  const values = readEnvFile('.env.production', backendDir);
  if (!values) throw new SetupError('Нет backend/.env.production (нужен DATABASE_TLS_CERT прода).');
  try {
    return readPinnedCertificate({ env: values, envFile: null });
  } catch (err) {
    throw new SetupError(err.message);
  }
};

/** Где закреплённый сертификат лежит внутри контейнера (только чтение). */
export const PIN_CONTAINER_DIR = '/pin';
export const PIN_CONTAINER_FILE = `${PIN_CONTAINER_DIR}/root.crt`;

/**
 * Переменные libpq для pg_dump/psql в контейнере. Передаются контейнеру
 * ИМЕНАМИ (docker run -e PGPASSWORD без значения): в командной строке и
 * в списке процессов их значений нет.
 *
 * TLS — verify-ca с закреплённым сертификатом как единственным корнем
 * (PGSSLROOTCERT; файл кладёт pinMountFor). Сертификат прода самоподписан,
 * поэтому цепочка сходится к корню, только если сервер предъявил его самого
 * (или сертификат, подписанный его ключом, — а ключ и есть то, что
 * закрепление проверяет; сессия Node сверяет ещё и отпечаток). Имя узла не
 * сверяется: сертификат выписан на «localhost» — verify-full отказал бы
 * всегда. Проверка — в рукопожатии TLS, до стартового сообщения: при
 * несовпадении ни имя, ни пароль не уходят. До 24.10 здесь был require —
 * шифрование без проверки сервера.
 */
export const pgEnvFromUrl = (url) => {
  const u = new URL(url);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
    PGSSLMODE: 'verify-ca',
    PGSSLROOTCERT: PIN_CONTAINER_FILE,
  };
};

/**
 * Закреплённый сертификат — файлом для контейнеров: папка во временном
 * каталоге с root.crt (PEM) и монтирование её в PIN_CONTAINER_DIR только на
 * чтение. Сертификат — не секрет (его предъявляет каждому, кто подключится),
 * но папка убирается сразу после снимка: remove().
 *
 * @param {import('crypto').X509Certificate} pinned
 * @returns {{ dir: string, mount: {source: string, target: string, readonly: boolean}, remove: () => void }}
 */
export const pinMountFor = (pinned) => {
  const dir = mkdtempSync(join(tmpdir(), 'prod-snapshot-pin-'));
  writeFileSync(join(dir, 'root.crt'), pinned.toString());
  return {
    dir,
    mount: { source: dir, target: PIN_CONTAINER_DIR, readonly: true },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
};

/**
 * Отказ libpq в контейнере словами оператора — тем же текстом, что у сессии
 * Node (scripts/lib/productionDb.js explainConnectionFailure). Остальное — null.
 *
 * @param {string} stderr psql / pg_dump
 * @param {import('crypto').X509Certificate} pinned
 * @returns {string|null}
 */
export const explainContainerTlsFailure = (stderr, pinned) => {
  const text = String(stderr);
  let code = null;
  if (/certificate has expired/i.test(text)) code = 'CERT_HAS_EXPIRED';
  else if (/certificate verify failed|self[- ]signed certificate|unable to get (local )?issuer certificate/i.test(text)) {
    code = 'PRODUCTION_DB_CERT_MISMATCH';
  }
  if (!code) return null;
  const error = new Error(text);
  error.code = code;
  return explainConnectionFailure(error, pinned).message;
};

/** Хосты, на которых /uploads/… значит legacy-local (API прода и локальный запуск). */
export const LEGACY_HOSTS = Object.freeze([
  'restaurantguidev2-production.up.railway.app',
  'localhost',
  '127.0.0.1',
  '10.0.2.2',
]);
