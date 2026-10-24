/* eslint-env jest */
/**
 * The server does not start with a JWT_SECRET anyone could know (Railway
 * incident 21–24.10.2026, finding 6): the start-up check runs once, when
 * utils/jwt.js loads, so each start is a process of its own — with NODE_ENV
 * production, unset (development) and test. What the check refuses, rule by
 * rule — jwt-secret-guard.test.js.
 *
 * Nothing is imported from utils/jwt.js here: the secrets come from the
 * files that publish them, so the file runs against the old check too — and
 * fails there, which is the point (it let the 52-character placeholder of
 * the root .env.example through).
 */
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..', '..', '..');
const REPO = resolve(BACKEND, '..');
const JWT_MODULE = join(BACKEND, 'src', 'utils', 'jwt.js');

/** A JWT_SECRET line of a published file. */
const secretIn = (file) => readFileSync(file, 'utf8').match(/^\s*JWT_SECRET\s*=\s*(\S+)\s*$/m)[1];

/** Starts what a server start loads first — utils/jwt.js — and reports how it ended. */
const startWith = (env) => {
  const script = `await import(${JSON.stringify(pathToFileURL(JWT_MODULE).href)}); console.log('STARTED');`;
  const childEnv = { ...process.env, ...env };
  Object.keys(env).forEach((key) => {
    if (env[key] === undefined) delete childEnv[key];
  });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: childEnv,
    encoding: 'utf8',
    timeout: 20000,
  });
  return { status: child.status, output: `${child.stdout}${child.stderr}` };
};

const randomHex = (bytes) => randomBytes(bytes).toString('hex');

describe('the start-up check (utils/jwt.js, once, when it loads)', () => {
  const placeholder = secretIn(join(REPO, '.env.example'));
  const backendPlaceholder = secretIn(join(BACKEND, '.env.example'));
  const ci = secretIn(join(REPO, '.github', 'workflows', 'ci.yml'));

  test('in production the server does not start with the placeholder of .env.example — and does not print it', () => {
    const started = startWith({ NODE_ENV: 'production', JWT_SECRET: placeholder });
    expect(started.status).toBe(1);
    expect(placeholder.length).toBeGreaterThanOrEqual(32);
    expect(started.output).not.toContain(placeholder);
    expect(started.output).not.toContain('STARTED');
  });

  test('without NODE_ENV (development) it does not start either, nor with "test-…" or a hand-made secret', () => {
    [placeholder, backendPlaceholder.toLowerCase(), ci, `test-${randomHex(32)}`, 'ab'.repeat(20)].forEach((secret) => {
      const started = startWith({ NODE_ENV: undefined, JWT_SECRET: secret });
      expect(started.status).toBe(1);
      expect(started.output).not.toContain(secret);
    });
  });

  test('with a random secret it starts — the control', () => {
    expect(startWith({ NODE_ENV: 'production', JWT_SECRET: randomHex(32) })).toMatchObject({ status: 0 });
  });

  test('in the tests the secrets of CI and of .env.test are allowed', () => {
    expect(startWith({ NODE_ENV: 'test', JWT_SECRET: ci })).toMatchObject({ status: 0 });
    expect(startWith({ NODE_ENV: 'test', JWT_SECRET: `test-${randomHex(24)}` })).toMatchObject({ status: 0 });
  });
});
