/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: scripts/lib/productionDb.js
 *
 * The operator scripts reach the production database only when it presents
 * the pinned certificate, and they find that out before anything about the
 * account — user name, password — is sent. Exercised against a Postgres
 * stand-in on 127.0.0.1 that presents a certificate shaped like Railway's
 * (self-signed, issued to "localhost"); see tests/utils/fakePostgresTls.js.
 *
 * The last block keeps every script on that path: a script that connects to
 * production with the server unchecked fails the suite.
 */

import pg from 'pg';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import {
  PIN_VARIABLE,
  ProductionClient,
  certificateFromPin,
  fetchServerCertificate,
  pinValue,
  productionSsl,
  readPinnedCertificate,
  upsertEnvLine,
  verifyPinnedHandshake,
  withoutTlsParameters,
} from '../../../scripts/lib/productionDb.js';
import { databaseSsl } from '../../config/databaseTls.js';
import {
  FAKE_SERVER_STOP,
  selfSignedCertificate,
  startFakePostgres,
} from '../utils/fakePostgresTls.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..', '..', '..', 'scripts');

// What production presents, and a server that took its name but not its key.
const production = selfSignedCertificate();
const impostor = selfSignedCertificate();

const pinned = (certificate) => ({ env: { [PIN_VARIABLE]: pinValue(certificate.der) }, envFile: null });
const databaseUrl = (port, query = '') => `postgresql://postgres:operator-password@127.0.0.1:${port}/railway${query}`;
const failureOf = (promise) => promise.then(() => null, (error) => error);

describe('ProductionClient', () => {
  let server;

  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  test('connects to the server that presents the pinned certificate', async () => {
    server = await startFakePostgres(production);
    const client = new ProductionClient({ connectionString: databaseUrl(server.port) }, pinned(production));

    // The stand-in stops every client right after the startup message, so a
    // failure with its message means the handshake was accepted.
    await expect(client.connect()).rejects.toThrow(FAKE_SERVER_STOP);
    expect(server.received).toHaveLength(1);
    expect(server.received[0].toString('latin1')).toContain('postgres');
  });

  test('stops at a server with another certificate — before the user name is sent', async () => {
    server = await startFakePostgres(impostor);
    const client = new ProductionClient({ connectionString: databaseUrl(server.port) }, pinned(production));

    const error = await failureOf(client.connect());

    expect(error.code).toBe('PRODUCTION_DB_CERT_MISMATCH');
    expect(error.message).toMatch(/не тот сертификат/);
    expect(error.message).toMatch(/до отправки пароля/);
    expect(error.message).toContain(production.fingerprint256);
    expect(server.sslRequests).toBe(1);
    expect(server.received).toHaveLength(0);
  });

  test('control: the way the scripts connected before lets that server in', async () => {
    // Shows what the pin protects against, and that the stand-in would take
    // a lax client — so "nothing received" above is not the stand-in's doing.
    server = await startFakePostgres(impostor);
    const client = new pg.Client({
      connectionString: databaseUrl(server.port),
      ssl: { rejectUnauthorized: false },
    });

    await expect(client.connect()).rejects.toThrow(FAKE_SERVER_STOP);
    expect(server.received).toHaveLength(1);
  });

  test('without a pin it does not open a connection at all', async () => {
    server = await startFakePostgres(production);
    const client = new ProductionClient({ connectionString: databaseUrl(server.port) }, { env: {}, envFile: null });

    const error = await failureOf(client.connect());

    expect(error.code).toBe('PRODUCTION_DB_CERT_NOT_PINNED');
    expect(error.message).toMatch(/pin-production-db-cert\.js/);
    expect(server.sslRequests).toBe(0);
  });

  test('neither the connection string nor an ssl option of the script can switch the check off', async () => {
    server = await startFakePostgres(impostor);

    const viaUrl = new ProductionClient(
      { connectionString: databaseUrl(server.port, '?sslmode=no-verify') },
      pinned(production),
    );
    expect((await failureOf(viaUrl.connect())).code).toBe('PRODUCTION_DB_CERT_MISMATCH');

    const viaOption = new ProductionClient(
      { connectionString: databaseUrl(server.port), ssl: { rejectUnauthorized: false } },
      pinned(production),
    );
    expect((await failureOf(viaOption.connect())).code).toBe('PRODUCTION_DB_CERT_MISMATCH');

    expect(server.received).toHaveLength(0);
  });

  test('works as the Client of a pg.Pool, pin taken from the environment', async () => {
    server = await startFakePostgres(impostor);
    const saved = process.env[PIN_VARIABLE];
    process.env[PIN_VARIABLE] = pinValue(production.der);
    const pool = new pg.Pool({ connectionString: databaseUrl(server.port), Client: ProductionClient });
    try {
      const error = await failureOf(pool.connect());
      expect(error.code).toBe('PRODUCTION_DB_CERT_MISMATCH');
      expect(server.received).toHaveLength(0);
    } finally {
      await pool.end();
      if (saved === undefined) delete process.env[PIN_VARIABLE];
      else process.env[PIN_VARIABLE] = saved;
    }
  });
});

describe('pin tool helpers', () => {
  let server;

  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  test('fetchServerCertificate reads what the server presents and sends nothing about the account', async () => {
    server = await startFakePostgres(production);

    const certificate = await fetchServerCertificate({ host: '127.0.0.1', port: server.port });

    expect(certificate.fingerprint256).toBe(production.fingerprint256);
    expect(server.received).toHaveLength(0);
  });

  test('verifyPinnedHandshake passes for the pinned server and stops at another one', async () => {
    server = await startFakePostgres(production);
    await expect(verifyPinnedHandshake(
      { host: '127.0.0.1', port: server.port },
      certificateFromPin(pinValue(production.der)),
    )).resolves.toBeUndefined();
    await server.close();

    server = await startFakePostgres(impostor);
    const error = await failureOf(verifyPinnedHandshake(
      { host: '127.0.0.1', port: server.port },
      certificateFromPin(pinValue(production.der)),
    ));
    expect(error.code).toBe('PRODUCTION_DB_CERT_MISMATCH');
    expect(server.received).toHaveLength(0);
  });

  test('a pin round-trips, as one line or as a PEM block', () => {
    expect(certificateFromPin(pinValue(production.der)).fingerprint256).toBe(production.fingerprint256);
    expect(pinValue(production.der)).not.toMatch(/\s/);
    expect(certificateFromPin(production.certPem).fingerprint256).toBe(production.fingerprint256);
  });

  test('the pin is read from backend/.env.production when the environment does not carry it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pin-'));
    try {
      const file = join(dir, '.env.production');
      writeFileSync(file, `DATABASE_URL=postgresql://x@h:1/db\r\n${PIN_VARIABLE}=${pinValue(production.der)}\r\n`);
      expect(readPinnedCertificate({ env: {}, envFile: file }).fingerprint256).toBe(production.fingerprint256);
      // The environment wins when it has one
      expect(readPinnedCertificate({ env: { [PIN_VARIABLE]: pinValue(impostor.der) }, envFile: file })
        .fingerprint256).toBe(impostor.fingerprint256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unreadable pin refuses like a missing one, with the way to fix it', () => {
    expect(() => productionSsl({ env: { [PIN_VARIABLE]: 'not a certificate' }, envFile: null }))
      .toThrow(expect.objectContaining({ code: 'PRODUCTION_DB_CERT_PIN_UNREADABLE' }));
  });

  test('upsertEnvLine replaces the line in place and keeps the rest of the file', () => {
    const crlf = 'DATABASE_URL=postgresql://x@h:1/db\r\nDATABASE_TLS_CERT=old\r\nOTHER=1\r\n';
    expect(upsertEnvLine(crlf, PIN_VARIABLE, 'new'))
      .toBe('DATABASE_URL=postgresql://x@h:1/db\r\nDATABASE_TLS_CERT=new\r\nOTHER=1\r\n');

    expect(upsertEnvLine('DATABASE_URL=u\n', PIN_VARIABLE, 'v')).toBe('DATABASE_URL=u\nDATABASE_TLS_CERT=v\n');
    expect(upsertEnvLine('DATABASE_URL=u', PIN_VARIABLE, 'v')).toBe('DATABASE_URL=u\nDATABASE_TLS_CERT=v\n');
    expect(upsertEnvLine('', PIN_VARIABLE, 'v')).toBe('DATABASE_TLS_CERT=v\n');
  });

  test('withoutTlsParameters drops only what would override the pin', () => {
    expect(withoutTlsParameters('postgresql://u:p@h:5/db?sslmode=require&application_name=x&sslrootcert=/a'))
      .toBe('postgresql://u:p@h:5/db?application_name=x');
  });

  // Each parameter through which node-pg lets a connection string replace the
  // ssl option, one by one — the line above shows two of them.
  test.each(['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslcrl', 'uselibpqcompat'])(
    'withoutTlsParameters drops %s',
    (name) => {
      expect(withoutTlsParameters(`postgresql://u:p@h:5/db?${name}=0&application_name=x`))
        .toBe('postgresql://u:p@h:5/db?application_name=x');
    },
  );

  test('an address that cannot be cleaned is refused, not used as it is', async () => {
    expect(() => withoutTlsParameters('not a url ?sslmode=disable'))
      .toThrow(expect.objectContaining({ code: 'PRODUCTION_DB_URL_UNREADABLE' }));

    const client = new ProductionClient({ connectionString: 'not a url ?sslmode=disable' }, pinned(production));
    expect((await failureOf(client.connect())).code).toBe('PRODUCTION_DB_URL_UNREADABLE');
  });

  test('upsertEnvLine keeps a single line for the key — dotenv would read the last duplicate', () => {
    expect(upsertEnvLine('A=1\nDATABASE_TLS_CERT=one\nB=2\nDATABASE_TLS_CERT=two\n', PIN_VARIABLE, 'new'))
      .toBe('A=1\nDATABASE_TLS_CERT=new\nB=2\n');
  });
});

describe('ProductionClient given a bare connection string', () => {
  let server;
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  test('keeps the address and the pin, as pg.Client would keep the address', async () => {
    server = await startFakePostgres(impostor);
    const saved = process.env[PIN_VARIABLE];
    process.env[PIN_VARIABLE] = pinValue(production.der);
    try {
      const client = new ProductionClient(databaseUrl(server.port));
      expect((await failureOf(client.connect())).code).toBe('PRODUCTION_DB_CERT_MISMATCH');
      expect(server.sslRequests).toBe(1);
    } finally {
      if (saved === undefined) delete process.env[PIN_VARIABLE];
      else process.env[PIN_VARIABLE] = saved;
    }
  });
});

describe('databaseSsl — the app pool (src/config/database.js)', () => {
  let server;
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  test('outside production: no TLS; in production without a pin: as before (EN1, a separate decision)', () => {
    expect(databaseSsl({ NODE_ENV: 'test', [PIN_VARIABLE]: pinValue(production.der) })).toBe(false);
    expect(databaseSsl({ NODE_ENV: 'production' })).toEqual({ rejectUnauthorized: false });
    expect(databaseSsl({ NODE_ENV: 'production', [PIN_VARIABLE]: ' ' })).toEqual({ rejectUnauthorized: false });
  });

  test('in production with a pin — seed-import --target=prod — only the pinned server', async () => {
    const ssl = databaseSsl({ NODE_ENV: 'production', [PIN_VARIABLE]: pinValue(production.der) });

    server = await startFakePostgres(impostor);
    const toImpostor = new pg.Pool({ connectionString: databaseUrl(server.port), ssl });
    await expect(toImpostor.connect()).rejects.toThrow();
    await toImpostor.end();
    expect(server.received).toHaveLength(0);
    await server.close();

    server = await startFakePostgres(production);
    const toProduction = new pg.Pool({ connectionString: databaseUrl(server.port), ssl });
    await expect(toProduction.connect()).rejects.toThrow(FAKE_SERVER_STOP);
    await toProduction.end();
    expect(server.received).toHaveLength(1);
  });
});

describe('every script that connects to production checks the server', () => {
  // Where an unchecked TLS connection is deliberate, and why.
  const ALLOWED = {
    // The pin tool's probe: nothing is pinned yet, and nothing about the
    // account is sent over it — only the SSLRequest.
    'lib/productionDb.js': 'fetchServerCertificate',
    // The production snapshot runs pg_dump in a container over libpq; moving
    // it to the pin is its own task (review EN3), not done here.
    'prod-snapshot/database.js': 'snapshot (EN3)',
    'prod-snapshot/env.js': 'snapshot (EN3)',
    'prod-snapshot/index.js': 'snapshot (EN3)',
  };
  const UNCHECKED = [
    /rejectUnauthorized['"]?\s*:\s*(?:false|0|!1|null|undefined)\b/,
    /no-verify/,
    /NODE_TLS_REJECT_UNAUTHORIZED/,
    /PGSSLMODE\s*:\s*['"](?:require|prefer|allow)['"]/,
  ];
  // Reading the production address obliges a script to take the pinned path.
  const PRODUCTION_ADDRESS = /\.env\.production/;
  const PINNED_PATH = /lib\/productionDb\.js/;

  const scriptFiles = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : scriptFiles(path);
    return /\.(c|m)?js$/.test(name) ? [path] : [];
  });

  /** Script names relative to backend/scripts, with their code (comments dropped). */
  const scriptsWithCode = () => scriptFiles(SCRIPTS).map((path) => ({
    name: relative(SCRIPTS, path).split(sep).join('/'),
    // A comment that names the old setting is not a connection
    code: readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1'),
  }));

  test('no script outside the named exceptions connects with the server unchecked', () => {
    const offenders = scriptsWithCode()
      .filter(({ name }) => !ALLOWED[name])
      .filter(({ code }) => UNCHECKED.some((pattern) => pattern.test(code)))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  test('every script that reads the production address goes through the pinned path', () => {
    // Catches the indirect ways too — a script that sets NODE_ENV=production
    // and borrows the app's pool (seed-import does, and passes the pin on).
    const offenders = scriptsWithCode()
      .filter(({ name }) => !ALLOWED[name] && name !== 'lib/productionDb.js')
      .filter(({ code }) => PRODUCTION_ADDRESS.test(code) && !PINNED_PATH.test(code))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  test('the guard can fail: it sees each way of switching the check off', () => {
    ['ssl: { rejectUnauthorized: false }', "'rejectUnauthorized': 0", 'rejectUnauthorized: !1',
      '?sslmode=no-verify', "ssl: 'no-verify'", "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'",
      "PGSSLMODE: 'require'"]
      .forEach((line) => expect(UNCHECKED.some((pattern) => pattern.test(line))).toBe(true));
    expect(UNCHECKED.some((pattern) => pattern.test('rejectUnauthorized: true'))).toBe(false);
  });

  test('the migration script goes through the pin', () => {
    const text = readFileSync(join(SCRIPTS, 'apply-migration-production.js'), 'utf8');
    expect(text).toMatch(/ProductionClient/);
  });
});
