/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * The production snapshot (scripts/prod-snapshot) talks only to the server
 * that presents the pinned certificate — on both of its roads to the
 * database: the Node session (database.js openProdClient) and pg_dump/psql in
 * a container (env.js pgEnvFromUrl, pinMountFor). Until 2026-10-24 the first
 * went with rejectUnauthorized: false and the second with sslmode=require —
 * encrypted, the server unchecked (Railway incident 21–24.10, finding 1; the
 * exception the guard of productionDb.test.js carried as "review EN3").
 *
 * Against the same stand-in as productionDb.test.js: a Postgres on 127.0.0.1
 * that presents a self-signed "localhost" certificate, as Railway's does, and
 * records the startup message — the one with the user name — if a client
 * gets that far.
 *
 * The last block runs the real libpq: psql of the snapshot's own image, in a
 * container, with the snapshot's own variables and mount. It needs Docker
 * Desktop and the image (the operator's machine, where the snapshot runs);
 * elsewhere — CI — it is skipped and says so.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { X509Certificate } from 'crypto';
import { spawnSync } from 'child_process';
import { openProdClient } from '../../../scripts/prod-snapshot/database.js';
import {
  PIN_CONTAINER_DIR,
  PIN_CONTAINER_FILE,
  SetupError,
  explainContainerTlsFailure,
  loadProdPinnedCertificate,
  pgEnvFromUrl,
  pinMountFor,
} from '../../../scripts/prod-snapshot/env.js';
import { PG_IMAGE, dockerRun } from '../../../scripts/prod-snapshot/proc.js';
import { PIN_VARIABLE, pinValue } from '../../../scripts/lib/productionDb.js';
import {
  FAKE_SERVER_STOP,
  selfSignedCertificate,
  startFakePostgres,
} from '../utils/fakePostgresTls.js';

// What production presents, and a server that took its name but not its key.
const production = selfSignedCertificate();
const impostor = selfSignedCertificate();
const pinnedProduction = new X509Certificate(production.certPem);

const databaseUrl = (host, port) => `postgresql://postgres:operator-password@${host}:${port}/railway`;
const failureOf = (promise) => promise.then(() => null, (error) => error);

describe('the Node session of the snapshot (openProdClient)', () => {
  let server;
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  test('stops at a server with another certificate — before the user name is sent, in the operator\'s words', async () => {
    server = await startFakePostgres(impostor);

    const error = await failureOf(openProdClient(databaseUrl('127.0.0.1', server.port), pinnedProduction));

    expect(error.code).toBe('PRODUCTION_DB_CERT_MISMATCH');
    expect(error.message).toMatch(/до отправки пароля/);
    expect(error.message).toContain(production.fingerprint256);
    expect(server.sslRequests).toBe(1);
    expect(server.received).toHaveLength(0);
  });

  test('control: goes on with the server that presents the pinned certificate', async () => {
    server = await startFakePostgres(production);

    // The stand-in stops every client right after the startup message
    await expect(openProdClient(databaseUrl('127.0.0.1', server.port), pinnedProduction)).rejects.toThrow(FAKE_SERVER_STOP);
    expect(server.received).toHaveLength(1);
  });
});

describe('pg_dump/psql in the container (pgEnvFromUrl, pinMountFor)', () => {
  test('libpq verifies the server against the pinned certificate as its only root — not sslmode=require', () => {
    const env = pgEnvFromUrl('postgresql://postgres:p%40ss@proxy.example:5433/railway');
    expect(env).toEqual({
      PGHOST: 'proxy.example',
      PGPORT: '5433',
      PGUSER: 'postgres',
      PGPASSWORD: 'p@ss',
      PGDATABASE: 'railway',
      // verify-full would compare the host with "localhost" and refuse always
      PGSSLMODE: 'verify-ca',
      PGSSLROOTCERT: PIN_CONTAINER_FILE,
    });
    expect(PIN_CONTAINER_FILE.startsWith(`${PIN_CONTAINER_DIR}/`)).toBe(true);
  });

  test('the pinned certificate is handed to the container as that file, read-only, and removed after', () => {
    const pin = pinMountFor(pinnedProduction);
    try {
      expect(pin.mount).toEqual({ source: pin.dir, target: PIN_CONTAINER_DIR, readonly: true });
      const written = new X509Certificate(readFileSync(join(pin.dir, 'root.crt')));
      expect(written.fingerprint256).toBe(production.fingerprint256);
    } finally {
      pin.remove();
    }
    expect(existsSync(pin.dir)).toBe(false);
  });

  test('a refusal of libpq reads as the Node session\'s: not the pinned certificate, stopped before the password', () => {
    const mismatch = explainContainerTlsFailure(
      'psql: error: connection to server at "proxy" (1.2.3.4), port 5433 failed: SSL error: certificate verify failed',
      pinnedProduction,
    );
    expect(mismatch).toMatch(/не тот сертификат/);
    expect(mismatch).toMatch(/до отправки пароля/);
    expect(mismatch).toContain(production.fingerprint256);
    expect(explainContainerTlsFailure('SSL error: certificate has expired', pinnedProduction)).toMatch(/истёк/);
    expect(explainContainerTlsFailure('psql: error: timeout expired', pinnedProduction)).toBeNull();
  });
});

describe('the pin comes from backend/.env.production, as the address does (loadProdPinnedCertificate)', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prod-snapshot-env-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('pinned: the certificate', () => {
    writeFileSync(join(dir, '.env.production'), `DATABASE_URL=postgresql://u:p@h:1/d\n${PIN_VARIABLE}=${pinValue(production.der)}\n`);
    expect(loadProdPinnedCertificate({ backendDir: dir }).fingerprint256).toBe(production.fingerprint256);
  });

  test('not pinned, or no file: the snapshot refuses before it starts, with the command that pins', () => {
    writeFileSync(join(dir, '.env.production'), 'DATABASE_URL=postgresql://u:p@h:1/d\n');
    const notPinned = (() => {
      try {
        loadProdPinnedCertificate({ backendDir: dir });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(notPinned).toBeInstanceOf(SetupError);
    expect(notPinned.message).toMatch(/pin-production-db-cert\.js/);

    rmSync(join(dir, '.env.production'));
    expect(() => loadProdPinnedCertificate({ backendDir: dir })).toThrow(SetupError);
  });
});

// The real libpq of the snapshot's image. host.docker.internal reaches this
// machine's 127.0.0.1 from a container on Docker Desktop (Windows, macOS).
const dockerReady = ['win32', 'darwin'].includes(process.platform)
  && spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', PG_IMAGE], { encoding: 'utf8', timeout: 30000 }).status === 0;
const withDocker = dockerReady ? describe : describe.skip;
if (!dockerReady) {
  // eslint-disable-next-line no-console
  console.log(`prodSnapshotTls: the libpq block is skipped — no Docker Desktop with ${PG_IMAGE} here`);
}

withDocker(`psql of ${PG_IMAGE} in a container, as the snapshot runs it`, () => {
  let server;
  let pin;
  beforeAll(() => {
    pin = pinMountFor(pinnedProduction);
  });
  afterAll(() => pin.remove());
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  const psql = (port, { old = false } = {}) => {
    const { PGSSLROOTCERT: _root, ...env } = pgEnvFromUrl(databaseUrl('host.docker.internal', port));
    return dockerRun({
      name: `prod-snapshot-test-${process.pid}-${port}`,
      // old: the variables as they were until 24.10 — sslmode=require, no root
      // file (with one, libpq's require verifies the chain like verify-ca)
      env: old
        ? { ...env, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10' }
        : { ...env, PGSSLROOTCERT: _root, PGCONNECT_TIMEOUT: '10' },
      mounts: old ? [] : [pin.mount],
      command: ['psql', '-X', '-tA', '-c', 'SELECT 1'],
      timeoutMs: 60000,
    });
  };

  test('stops at a server with another certificate — the startup message (user name) never leaves', async () => {
    server = await startFakePostgres(impostor);
    const result = await psql(server.port);

    expect(result.code).not.toBe(0);
    expect(server.sslRequests).toBe(1);
    expect(server.received).toHaveLength(0);
    expect(explainContainerTlsFailure(result.stderr, pinnedProduction)).toMatch(/не тот сертификат/);
  }, 90000);

  test('control: with the pinned certificate libpq goes on to the startup message', async () => {
    server = await startFakePostgres(production);
    const result = await psql(server.port);

    expect(result.stderr).toContain(FAKE_SERVER_STOP);
    expect(server.received).toHaveLength(1);
  }, 90000);

  test('control: the old sslmode=require would have signed in to the impostor', async () => {
    server = await startFakePostgres(impostor);
    const result = await psql(server.port, { old: true });

    expect(result.stderr).toContain(FAKE_SERVER_STOP);
    expect(server.received).toHaveLength(1);
  }, 90000);
});
