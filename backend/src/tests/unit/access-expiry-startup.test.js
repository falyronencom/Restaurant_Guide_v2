/* eslint-env jest */
/**
 * The startup log warns when JWT_ACCESS_EXPIRY gives a day or more, and the
 * server goes on starting (Coordinator 29.10.2026, after PR #155): the
 * variable is set in the Railway dashboard and shows nowhere else.
 *
 * Each start is a process of its own: server.js with NODE_ENV production and
 * a database that refuses at once (port 1), so the start runs up to the
 * database check and stops there — every line before it is in the output.
 * Nothing is imported from the code under test: the file runs against the
 * code before the change too, and fails there.
 */
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(resolve(HERE, '..', '..'), 'server.js');

/** Starts server.js with this JWT_ACCESS_EXPIRY; the log lines of the start. */
const startWith = (expiry) => {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: randomBytes(32).toString('hex'),
    JWT_ACCESS_EXPIRY: expiry,
    DB_HOST: '127.0.0.1',
    DB_PORT: '1',
    PORT: '0',
    // .env.test and CI log errors only; the line under test is a warning.
    LOG_LEVEL: 'info',
  };
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SERVER).href)});`],
    // A directory without a .env: server.js loads one from its working directory.
    { env, cwd: tmpdir(), encoding: 'utf8', timeout: 40000 },
  );
  return `${child.stdout}${child.stderr}`.split('\n');
};

const warningsOf = (lines) => lines.filter((line) => line.includes('"level":"warn"')
  && line.includes('Access token lifetime'));

const startedPastIt = (lines) => lines.some((line) => line.includes('Testing database connection'));

describe('the startup line of JWT_ACCESS_EXPIRY', () => {
  test('a day (24h) warns, and the start goes on', () => {
    const lines = startWith('24h');
    expect(warningsOf(lines)).toHaveLength(1);
    expect(warningsOf(lines)[0]).toMatch(/86400 s, a day or more/);
    expect(startedPastIt(lines)).toBe(true);
  }, 60000);

  test('a second less than a day (86399s) does not warn — nor 4h', () => {
    ['86399s', '4h'].forEach((expiry) => {
      const lines = startWith(expiry);
      expect(warningsOf(lines)).toEqual([]);
      expect(lines.some((line) => line.includes('Access token lifetime resolved'))).toBe(true);
      expect(startedPastIt(lines)).toBe(true);
    });
  }, 90000);
});
