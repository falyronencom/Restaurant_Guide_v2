/**
 * The production database, from this computer: only the server whose
 * certificate is pinned.
 *
 * The operator scripts reach production through Railway's public TCP proxy,
 * over whatever network this machine is on. The connection has always been
 * encrypted; until now the server at the other end was never checked
 * (`ssl: { rejectUnauthorized: false }`), so a script would have talked to —
 * and signed in to — whichever server answered.
 *
 * Railway's Postgres presents a self-signed certificate (issued to
 * "localhost", valid for ten years), so no public certificate authority can
 * vouch for it. The certificate itself is pinned instead: once, by
 * `node scripts/pin-production-db-cert.js`, into backend/.env.production as
 * DATABASE_TLS_CERT. From then on a script connects only if the server
 * presents exactly that certificate. The check is part of the TLS handshake,
 * so it happens before the user name or the password leaves this machine.
 *
 * The host name is not compared: the certificate names "localhost", the
 * proxy has a name of its own. The pinned certificate is the only trust
 * anchor and its fingerprint must match, which is the stronger check.
 *
 * No pin — no connection: the scripts refuse with the command that sets one.
 */

import { readFileSync, existsSync } from 'fs';
import net from 'net';
import tls from 'tls';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  PIN_VARIABLE,
  certificateFromPin,
  pinValue,
  sslForPinnedCertificate,
} from '../../src/config/databaseTls.js';

// The pin's format and the TLS options it makes are shared with the app's
// pool (src/config/databaseTls.js); re-exported for the scripts and tests.
export { PIN_VARIABLE, certificateFromPin, pinValue, sslForPinnedCertificate };

/** backend/.env.production — gitignored, kept by the operator. */
export const PRODUCTION_ENV_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env.production');

const PIN_COMMAND = 'node scripts/pin-production-db-cert.js (из папки backend)';

/**
 * The production environment for a script: what the process already has,
 * completed from backend/.env.production next to the scripts.
 *
 * Variables already set win — so a script run from a git worktree, which has
 * no .env.production of its own, is pointed at the operator's file without
 * copying it: `node --env-file=<main checkout>/backend/.env.production
 * scripts/<script>.js --production`. The keys stay in the one file the
 * operator keeps; nothing is written.
 *
 * @param {Object} [options]
 * @param {Object} [options.env=process.env] - completed in place
 * @param {string|null} [options.envFile=PRODUCTION_ENV_FILE]
 * @returns {string} DATABASE_URL
 * @throws {Error} code PRODUCTION_DB_URL_MISSING
 */
export const loadProductionEnvironment = ({ env = process.env, envFile = PRODUCTION_ENV_FILE } = {}) => {
  if (envFile && existsSync(envFile)) {
    const parsed = dotenv.parse(readFileSync(envFile));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) env[key] = value;
    }
  }
  if (!env.DATABASE_URL) {
    throw errorWithCode(
      'PRODUCTION_DB_URL_MISSING',
      'DATABASE_URL рабочей базы не найден: нет ни в окружении, ни в backend/.env.production рядом со скриптом. ' +
        'Из worktree: node --env-file=<основная папка>/backend/.env.production scripts/<скрипт>.js --production',
    );
  }
  return env.DATABASE_URL;
};

/** OpenSSL verdicts that mean "this is not the pinned certificate". */
const NOT_THE_PINNED_CERTIFICATE = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_SIGNATURE_FAILURE',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'PRODUCTION_DB_CERT_MISMATCH',
]);

const errorWithCode = (code, message, cause) => {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
};

/**
 * The pinned certificate: from the environment, or — for a script that did
 * not load it — straight from backend/.env.production.
 *
 * @param {Object} [options]
 * @param {Object} [options.env=process.env]
 * @param {string|null} [options.envFile=PRODUCTION_ENV_FILE] - null: env only
 * @returns {X509Certificate}
 * @throws {Error} code PRODUCTION_DB_CERT_NOT_PINNED / PRODUCTION_DB_CERT_PIN_UNREADABLE
 */
export const readPinnedCertificate = ({ env = process.env, envFile = PRODUCTION_ENV_FILE } = {}) => {
  let value = env[PIN_VARIABLE];
  if ((value === undefined || String(value).trim() === '') && envFile && existsSync(envFile)) {
    value = dotenv.parse(readFileSync(envFile))[PIN_VARIABLE];
  }
  if (value === undefined || String(value).trim() === '') {
    throw errorWithCode(
      'PRODUCTION_DB_CERT_NOT_PINNED',
      'Сертификат рабочей базы не закреплён, подключение не начато. ' +
        `Один раз выполните: ${PIN_COMMAND} — и повторите.`,
    );
  }
  try {
    return certificateFromPin(value);
  } catch (cause) {
    throw errorWithCode(
      'PRODUCTION_DB_CERT_PIN_UNREADABLE',
      `${PIN_VARIABLE} в backend/.env.production не читается как сертификат, подключение не начато. ` +
        `Закрепите сертификат заново: ${PIN_COMMAND}.`,
      cause,
    );
  }
};

/**
 * node-pg `ssl` options for production, from the pin.
 *
 * @param {Object} [options] - as readPinnedCertificate
 * @returns {Object}
 */
export const productionSsl = (options) => sslForPinnedCertificate(readPinnedCertificate(options));

/**
 * A connection failure in words the operator can act on. Anything that is
 * not about the certificate is returned as it is.
 *
 * @param {Error} error
 * @param {X509Certificate} pinned
 * @returns {Error}
 */
export const explainConnectionFailure = (error, pinned) => {
  if (!error) {
    return error;
  }
  if (error.code === 'CERT_HAS_EXPIRED') {
    return errorWithCode(
      'PRODUCTION_DB_CERT_EXPIRED',
      'Сертификат рабочей базы истёк, подключение остановлено до отправки пароля. ' +
        `Сверьте новый сертификат и закрепите его: ${PIN_COMMAND}.`,
      error,
    );
  }
  if (!NOT_THE_PINNED_CERTIFICATE.has(error.code)) {
    return error;
  }
  return errorWithCode(
    'PRODUCTION_DB_CERT_MISMATCH',
    'Рабочая база предъявила не тот сертификат, что закреплён ' +
      `(закреплён ${pinned.fingerprint256}). Подключение остановлено до отправки пароля. ` +
      'Если Railway пересоздавал или переносил базу — сверьте новый сертификат и закрепите его: ' +
      `${PIN_COMMAND}. Если нет — не продолжайте: связь могла быть перехвачена.`,
    error,
  );
};

/** Query parameters through which a connection string would override `ssl`. */
const SSL_URL_PARAMETERS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslcrl', 'uselibpqcompat'];

/**
 * A connection string without TLS parameters. node-pg lets the parameters of
 * a connection string win over the `ssl` option, so `?sslmode=require` would
 * quietly replace the pin.
 *
 * @param {string} connectionString
 * @returns {string}
 * @throws {Error} code PRODUCTION_DB_URL_UNREADABLE — a string that does not
 *   parse as a URL cannot be cleaned, so it is not used at all
 */
export const withoutTlsParameters = (connectionString) => {
  let url;
  try {
    url = new URL(connectionString);
  } catch (cause) {
    throw errorWithCode(
      'PRODUCTION_DB_URL_UNREADABLE',
      'DATABASE_URL не читается как адрес, подключение не начато. Проверьте строку в backend/.env.production.',
      cause,
    );
  }
  SSL_URL_PARAMETERS.forEach((name) => url.searchParams.delete(name));
  return url.toString();
};

/**
 * pg.Client for the production database. Takes the usual config without
 * `ssl` and adds the pinned certificate. The pin is read when the client is
 * created; a missing or unreadable pin, and a certificate that is not the
 * pinned one, surface from connect() as an error worded for the operator —
 * the way every script already reports a failed connect().
 *
 * Usable as the `Client` of a pg.Pool.
 */
export class ProductionClient extends pg.Client {
  constructor(config = {}, pinOptions = undefined) {
    // pg.Client also takes a bare connection string
    const { ssl: _ignored, ...rest } = typeof config === 'string' ? { connectionString: config } : config;
    let pinned = null;
    let refusal = null;
    let connectionString = rest.connectionString;
    try {
      pinned = readPinnedCertificate(pinOptions);
      if (connectionString) connectionString = withoutTlsParameters(connectionString);
    } catch (error) {
      refusal = error;
    }
    super({
      ...rest,
      // After a refusal connect() rejects before opening a socket; the
      // placeholder only keeps pg's own parsing of the address from throwing.
      ...(rest.connectionString ? { connectionString: refusal ? 'postgresql://refused.invalid/x' : connectionString } : {}),
      // Without a pin there is nothing to trust; connect() refuses before
      // opening a socket, and this value is never used.
      ssl: pinned ? sslForPinnedCertificate(pinned) : { rejectUnauthorized: true },
    });
    this.pinnedCertificate = pinned;
    this.refusal = refusal;
  }

  connect(callback) {
    const connecting = this.refusal
      ? Promise.reject(this.refusal)
      : super.connect().catch((error) => {
        throw explainConnectionFailure(error, this.pinnedCertificate);
      });
    if (typeof callback === 'function') {
      connecting.then(() => callback(), (error) => callback(error));
      return undefined;
    }
    return connecting;
  }
}

/** PostgreSQL SSLRequest: length 8, code 80877103. */
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);

/**
 * Opens a TLS session with a Postgres server the way a client does — the
 * SSLRequest, then the handshake — and closes it before the startup message.
 * Nothing about the account is sent: no user name, no password.
 *
 * @param {Object} target
 * @param {string} target.host
 * @param {number} target.port
 * @param {Object} tlsOptions - tls.connect options (trust)
 * @param {number} [timeoutMs=20000]
 * @returns {Promise<{ authorized: boolean, authorizationError: string|null, certificate: X509Certificate }>}
 */
const handshake = ({ host, port }, tlsOptions, timeoutMs = 20000) => new Promise((resolvePromise, reject) => {
  const socket = net.connect({ host, port });
  let secure = null;
  const fail = (error) => {
    socket.destroy();
    if (secure) secure.destroy();
    reject(error);
  };
  socket.setTimeout(timeoutMs, () => fail(errorWithCode('ETIMEDOUT', `no answer from ${host}:${port}`)));
  socket.once('error', fail);
  socket.once('connect', () => socket.write(SSL_REQUEST));
  socket.once('data', (answer) => {
    if (answer.toString('latin1') !== 'S') {
      fail(errorWithCode('PRODUCTION_DB_NO_TLS', `${host}:${port} does not offer TLS`));
      return;
    }
    secure = tls.connect({
      socket,
      ...(net.isIP(host) === 0 ? { servername: host } : {}),
      ...tlsOptions,
    }, () => {
      const peer = secure.getPeerX509Certificate();
      const result = {
        authorized: secure.authorized,
        authorizationError: secure.authorizationError || null,
        certificate: peer,
      };
      secure.destroy();
      socket.destroy();
      resolvePromise(result);
    });
    secure.once('error', fail);
  });
});

/**
 * The certificate a Postgres server presents, read without trusting it.
 * Used by the pin tool to show the operator what would be pinned. Sends no
 * credentials: the only thing written is the SSLRequest.
 *
 * @param {{host: string, port: number}} target
 * @returns {Promise<X509Certificate>}
 */
export const fetchServerCertificate = async (target) => {
  // The one place the server is not verified, on purpose: there is no pin yet
  // to verify against, and nothing secret goes over this connection.
  const { certificate } = await handshake(target, { rejectUnauthorized: false });
  return certificate;
};

/**
 * Whether the server presents the pinned certificate — the same check the
 * scripts' connections make, without signing in.
 *
 * @param {{host: string, port: number}} target
 * @param {X509Certificate} pinned
 * @returns {Promise<void>} rejects with explainConnectionFailure's error
 */
export const verifyPinnedHandshake = async (target, pinned) => {
  try {
    await handshake(target, sslForPinnedCertificate(pinned));
  } catch (error) {
    throw explainConnectionFailure(error, pinned);
  }
};

/**
 * Host and port of DATABASE_URL.
 *
 * @param {string} databaseUrl
 * @returns {{host: string, port: number}}
 */
export const targetOf = (databaseUrl) => {
  const url = new URL(databaseUrl);
  return { host: url.hostname, port: Number(url.port || 5432) };
};

/**
 * .env text with KEY set to value: the line replaced where it is (duplicates
 * dropped), appended otherwise. The other lines and the file's line endings
 * are left alone.
 *
 * @param {string} text
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
export const upsertEnvLine = (text, key, value) => {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length > 0 ? text.split(/\r?\n/) : [];
  const line = `${key}=${value}`;
  const isKey = (l) => new RegExp(`^\\s*${key}\\s*=`).test(l);
  const index = lines.findIndex(isKey);
  if (index >= 0) {
    // dotenv reads the last of duplicate lines: keep exactly one, in the
    // place of the first.
    lines[index] = line;
    return lines.filter((l, i) => i === index || !isKey(l)).join(eol);
  }
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.splice(lines.length - 1, 0, line);
    return lines.join(eol);
  }
  return [...lines, line, ''].join(eol);
};
