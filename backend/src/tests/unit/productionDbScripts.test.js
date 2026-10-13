/* eslint-env jest */
/**
 * The pin tool and the migration script, run as the operator runs them.
 *
 * Both take the database address from backend/.env.production, and in the
 * main checkout that file is the real one — so they are not run from here.
 * Byte-for-byte copies run in a sandbox under backend/tmp/ with their own
 * .env.production that points at a Postgres stand-in on 127.0.0.1
 * (tests/utils/fakePostgresTls.js), as cleanupSeedCardsScript.test.js does.
 * The stand-in stops every client right after the startup message: a
 * script's "fake server: stopped…" means its TLS handshake was accepted.
 */

import { spawn } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PIN_VARIABLE, certificateFromPin, pinValue } from '../../../scripts/lib/productionDb.js';
import {
  FAKE_SERVER_STOP,
  selfSignedCertificate,
  startFakePostgres,
} from '../utils/fakePostgresTls.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '../../..');

const production = selfSignedCertificate();
const impostor = selfSignedCertificate();

let sandbox;
let server;

const envFile = () => join(sandbox, '.env.production');
const writeEnv = (port, pin = null) => writeFileSync(
  envFile(),
  `DATABASE_URL=postgresql://postgres:operator-password@127.0.0.1:${port}/railway\n${
    pin ? `${PIN_VARIABLE}=${pin}\n` : ''}`,
);
const pinnedFingerprint = () => {
  const value = dotenv.parse(readFileSync(envFile()))[PIN_VARIABLE];
  return value ? certificateFromPin(value).fingerprint256 : null;
};

/** Runs a sandbox copy; the stand-in lives in this process, so not spawnSync. */
function run(script, args = [], input = '') {
  const env = { ...process.env };
  // dotenv does not override the environment: both must come from the file.
  delete env.DATABASE_URL;
  delete env[PIN_VARIABLE];
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [join(sandbox, 'scripts', script), ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', rej);
    child.on('close', (code) => res({ code, out }));
    child.stdin.end(input);
  });
}

beforeAll(() => {
  mkdirSync(join(BACKEND, 'tmp'), { recursive: true });
  sandbox = mkdtempSync(join(BACKEND, 'tmp', 'production-db-scripts-'));
  mkdirSync(join(sandbox, 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(sandbox, 'migrations'));
  ['pin-production-db-cert.js', 'apply-migration-production.js', join('lib', 'productionDb.js')]
    .forEach((name) => copyFileSync(join(BACKEND, 'scripts', name), join(sandbox, 'scripts', name)));
  writeFileSync(join(sandbox, 'migrations', '999_noop.sql'), 'SELECT 1;\n');
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

afterEach(async () => {
  if (server) await server.close();
  server = null;
});

describe('pin-production-db-cert.js', () => {
  test('--check before anything is pinned: shows the certificate, exit 2, nothing sent, nothing written', async () => {
    server = await startFakePostgres(production);
    writeEnv(server.port);

    const { code, out } = await run('pin-production-db-cert.js', ['--check']);

    expect(code).toBe(2);
    expect(out).toContain(production.fingerprint256);
    expect(out).toMatch(/закреплённый: нет/);
    expect(server.received).toHaveLength(0);
    expect(pinnedFingerprint()).toBeNull();
  });

  test('"yes" pins the certificate, keeps DATABASE_URL, and the verified handshake passes', async () => {
    server = await startFakePostgres(production);
    writeEnv(server.port);

    const { code, out } = await run('pin-production-db-cert.js', [], 'yes\n');

    expect(code).toBe(0);
    expect(out).toMatch(/✓ Проверка/);
    expect(pinnedFingerprint()).toBe(production.fingerprint256);
    expect(readFileSync(envFile(), 'utf8')).toContain(`127.0.0.1:${server.port}/railway`);
    expect(server.received).toHaveLength(0);

    expect((await run('pin-production-db-cert.js', ['--check'])).code).toBe(0);
  });

  test('anything but "yes" writes nothing', async () => {
    server = await startFakePostgres(production);
    writeEnv(server.port);

    const { out } = await run('pin-production-db-cert.js', [], 'no\n');

    expect(out).toMatch(/ничего не изменено/);
    expect(pinnedFingerprint()).toBeNull();
  });

  test('another certificate is never pinned over the old one without --replace', async () => {
    server = await startFakePostgres(impostor);
    writeEnv(server.port, pinValue(production.der));

    const check = await run('pin-production-db-cert.js', ['--check']);
    expect(check.code).toBe(1);
    expect(check.out).toMatch(/ДРУГОЙ/);

    const refused = await run('pin-production-db-cert.js', [], 'yes\n');
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/не тот сертификат/);
    expect(pinnedFingerprint()).toBe(production.fingerprint256);

    const replaced = await run('pin-production-db-cert.js', ['--replace'], 'yes\n');
    expect(replaced.code).toBe(0);
    expect(pinnedFingerprint()).toBe(impostor.fingerprint256);
  });
});

describe('apply-migration-production.js', () => {
  test('connects to the database whose certificate is pinned', async () => {
    server = await startFakePostgres(production);
    writeEnv(server.port, pinValue(production.der));

    const { code, out } = await run('apply-migration-production.js', ['999_noop', '--yes']);

    expect(code).toBe(1);
    expect(out).toContain(FAKE_SERVER_STOP);
    expect(server.received).toHaveLength(1);
  });

  test('stops at a server with another certificate before the user name is sent', async () => {
    server = await startFakePostgres(impostor);
    writeEnv(server.port, pinValue(production.der));

    const { code, out } = await run('apply-migration-production.js', ['999_noop', '--yes']);

    expect(code).toBe(1);
    expect(out).toMatch(/не тот сертификат/);
    expect(out).not.toContain(FAKE_SERVER_STOP);
    expect(server.sslRequests).toBe(1);
    expect(server.received).toHaveLength(0);
  });

  test('without a pin it stops before showing the SQL or connecting', async () => {
    server = await startFakePostgres(production);
    writeEnv(server.port);

    const { code, out } = await run('apply-migration-production.js', ['999_noop', '--yes']);

    expect(code).toBe(1);
    expect(out).toMatch(/не закреплён/);
    expect(out).not.toMatch(/SQL preview/);
    expect(server.sslRequests).toBe(0);
  });
});
