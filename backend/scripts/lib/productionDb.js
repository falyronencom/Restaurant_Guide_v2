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
import { X509Certificate } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

/** Where the pin lives, next to DATABASE_URL. */
export const PIN_VARIABLE = 'DATABASE_TLS_CERT';

/** backend/.env.production — gitignored, kept by the operator. */
export const PRODUCTION_ENV_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env.production');

const PIN_COMMAND = 'node scripts/pin-production-db-cert.js (из папки backend)';

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
 * The pin as written into .env.production: the certificate's DER, base64,
 * one line.
 *
 * @param {Buffer} der
 * @returns {string}
 */
export const pinValue = (der) => Buffer.from(der).toString('base64');

/**
 * A pin back into a certificate. Accepts the one-line base64 the pin tool
 * writes and, for a hand-made pin, a PEM block.
 *
 * @param {string} value
 * @returns {X509Certificate}
 */
export const certificateFromPin = (value) => {
  const text = String(value).trim();
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    return new X509Certificate(text);
  }
  return new X509Certificate(Buffer.from(text.replace(/\s+/g, ''), 'base64'));
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
 * TLS options that accept only the pinned certificate.
 *
 * @param {X509Certificate} pinned
 * @returns {Object} node-pg `ssl` / tls.connect options
 */
export const sslForPinnedCertificate = (pinned) => ({
  ca: pinned.toString(),
  rejectUnauthorized: true,
  // Called only once the chain has verified against `ca` — that is, the
  // server holds the pinned certificate's key. The name check is replaced by
  // the fingerprint: the certificate is issued to "localhost".
  checkServerIdentity: (_host, cert) => (
    cert && cert.fingerprint256 === pinned.fingerprint256
      ? undefined
      : errorWithCode(
        'PRODUCTION_DB_CERT_MISMATCH',
        `certificate ${cert && cert.fingerprint256} is not the pinned ${pinned.fingerprint256}`,
      )
  ),
});

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
 */
export const withoutTlsParameters = (connectionString) => {
  try {
    const url = new URL(connectionString);
    SSL_URL_PARAMETERS.forEach((name) => url.searchParams.delete(name));
    return url.toString();
  } catch {
    return connectionString;
  }
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
    let pinned = null;
    let pinError = null;
    try {
      pinned = readPinnedCertificate(pinOptions);
    } catch (error) {
      pinError = error;
    }
    const { ssl: _ignored, ...rest } = config;
    super({
      ...rest,
      ...(rest.connectionString ? { connectionString: withoutTlsParameters(rest.connectionString) } : {}),
      // Without a pin there is nothing to trust; connect() refuses before
      // opening a socket, and this value is never used.
      ssl: pinned ? sslForPinnedCertificate(pinned) : { rejectUnauthorized: true },
    });
    this.pinnedCertificate = pinned;
    this.pinError = pinError;
  }

  connect(callback) {
    const connecting = this.pinError
      ? Promise.reject(this.pinError)
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
 * .env text with KEY set to value: the line replaced where it is, appended
 * otherwise. The other lines and the file's line endings are left alone.
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
  const index = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (index >= 0) {
    lines[index] = line;
    return lines.join(eol);
  }
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.splice(lines.length - 1, 0, line);
    return lines.join(eol);
  }
  return [...lines, line, ''].join(eol);
};
