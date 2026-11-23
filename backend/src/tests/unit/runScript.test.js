/* eslint-env jest */
/**
 * runScript: a script that does not exit fails the test within the limit
 * runScript: скрипт, который не выходит, роняет тест в пределах предела
 *
 * The helper (src/tests/utils/runScript.js) runs project scripts for the
 * integration tests with spawnSync. A child that never exits is the case it is
 * for; it is driven here from a separate process started with the async spawn,
 * so that a broken helper hangs that process, not jest, and the test fails on
 * its own wait with a plain message. The child scripts are written per run
 * under backend/tmp (gitignored).
 */

import { spawn } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { SCRIPT_TIMEOUT_MS, runScript } from '../utils/runScript.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(HERE, '..', '..', '..');
const HELPER_URL = pathToFileURL(join(HERE, '..', 'utils', 'runScript.js')).href;

const LIMIT_MS = 1500;
/** How long the driver may take before the test calls the helper broken. */
const DRIVER_WAIT_MS = 20000;

let dir;
let rel;
const child = (name, source) => {
  writeFileSync(join(dir, name), source);
  return join(dir, name);
};

beforeAll(() => {
  mkdirSync(join(BACKEND_DIR, 'tmp'), { recursive: true });
  dir = mkdtempSync(join(BACKEND_DIR, 'tmp', 'run-script-'));
  rel = `tmp/${dir.split(/[\\/]/).pop()}`;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Call runScript(script, [], { timeout }) in a separate node process; resolve with
 * what it reports, or with { hung: true } when it is still there after DRIVER_WAIT_MS.
 * With a broken helper only the driver is killed: its child (setInterval) is left
 * running until the machine or the CI job ends it. A working helper leaves none.
 */
const drive = (script, timeout) => new Promise((resolveDrive) => {
  const program = `
    import { runScript } from ${JSON.stringify(HELPER_URL)};
    const started = Date.now();
    try {
      const result = runScript(${JSON.stringify(script)}, [], { timeout: ${timeout} });
      console.log(JSON.stringify({ returned: true, status: result.status, ms: Date.now() - started }));
    } catch (error) {
      console.log(JSON.stringify({
        code: error.code, message: error.message, script: error.script,
        timeoutMs: error.timeoutMs, waitedMs: error.waitedMs, ms: Date.now() - started,
      }));
    }
  `;
  const driver = spawn(process.execPath, ['--input-type=module', '-e', program], { env: { ...process.env } });
  let stdout = '';
  let stderr = '';
  driver.stdout.on('data', (chunk) => { stdout += chunk; });
  driver.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => {
    driver.kill('SIGKILL');
    resolveDrive({ hung: true, stderr });
  }, DRIVER_WAIT_MS);
  driver.on('close', () => {
    clearTimeout(timer);
    try {
      resolveDrive(JSON.parse(stdout.trim().split('\n').pop()));
    } catch {
      resolveDrive({ unreadable: stdout, stderr });
    }
  });
});

describe('runScript', () => {
  test('the default limit is 60 s', () => {
    expect(SCRIPT_TIMEOUT_MS).toBe(60000);
  });

  test('a limit that is no limit is refused before anything runs', () => {
    const script = child('never-run.js', "throw new Error('не должен был запуститься');\n");
    for (const timeout of [0, -1, Infinity, null, '60000']) {
      expect(() => runScript(script, [], { timeout })).toThrow('runScript: предел ожидания должен быть положительным числом мс');
    }
  });

  test('a script that exits: its status and output come back as from spawnSync', () => {
    const script = child('exits.js', "process.stdout.write('готово\\n'); process.stderr.write('шум'); process.exitCode = 3;\n");
    const result = runScript(script, ['--a=1']);

    expect(result.status).toBe(3);
    expect(result.signal).toBe(null);
    expect(result.stdout).toBe('готово\n');
    expect(result.stderr).toBe('шум');
  });

  test('arguments, env and input reach the script', () => {
    const script = child('echo.js', `
      let input = '';
      process.stdin.on('data', (chunk) => { input += chunk; });
      process.stdin.on('end', () => {
        console.log(JSON.stringify({ args: process.argv.slice(2), mark: process.env.RUN_SCRIPT_MARK, input }));
      });
    `);
    const result = runScript(script, ['--x=1', 'два'], { env: { ...process.env, RUN_SCRIPT_MARK: 'м' }, input: 'ввод' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ args: ['--x=1', 'два'], mark: 'м', input: 'ввод' });
  });

  test('a script that never exits: an error naming it, at the limit', async () => {
    const script = child('never.js', "console.log('начал'); setInterval(() => {}, 1000);\n");
    const report = await drive(script, LIMIT_MS);

    expect(report).toMatchObject({ code: 'SCRIPT_TIMEOUT', script: `${rel}/never.js`, timeoutMs: LIMIT_MS });
    expect(report.message).toContain(`Скрипт ${rel}/never.js не завершился за 1,5 с (предел ожидания) и снят сигналом SIGKILL`);
    expect(report.message).toContain('stdout (хвост): начал');
    expect(report.waitedMs).toBeGreaterThanOrEqual(LIMIT_MS);
    expect(report.waitedMs).toBeLessThan(LIMIT_MS + 8000);
  }, DRIVER_WAIT_MS + 5000);

  test('a script that ignores SIGTERM is still stopped (SIGKILL)', async () => {
    const script = child('stubborn.js', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n");
    const report = await drive(script, LIMIT_MS);

    expect(report).toMatchObject({ code: 'SCRIPT_TIMEOUT', script: `${rel}/stubborn.js` });
    expect(report.waitedMs).toBeLessThan(LIMIT_MS + 8000);
  }, DRIVER_WAIT_MS + 5000);
});
