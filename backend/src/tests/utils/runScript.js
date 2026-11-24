/**
 * Run a project script from a test and wait for it — with a time limit
 * Запуск скрипта проекта из теста с пределом ожидания
 *
 * spawnSync stops jest's event loop until the child exits, so jest's own test
 * timeout cannot fire meanwhile. A script that never exits (an open connection,
 * a timer, a wait with no end) would hold the whole run until the CI job's own
 * limit — 30 minutes, with no line naming the file (23.11.2026, the job
 * «Backend — jest (полный сьют)»). Here the child gets SCRIPT_TIMEOUT_MS and is
 * then killed with SIGKILL: SIGTERM can be caught or ignored by the child, and
 * spawnSync would keep waiting for it. The test then fails with an error that
 * names the script and the wait.
 *
 * The guard src/tests/unit/sync-child-timeout-guard.test.js keeps every
 * synchronous child call in the server tests limited.
 */

import { spawnSync } from 'child_process';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * 60 s, not less than 30: the slowest test file runs 27 s as a whole today, a
 * slow machine must not turn that into a false red (directive B, 23.11.2026).
 */
export const SCRIPT_TIMEOUT_MS = 60000;

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** How much of each output stream the error quotes. */
const TAIL_CHARS = 800;

/** The script as backend/-relative path when it lies there, else as given. */
const shown = (script) => {
  const inside = isAbsolute(script) ? relative(BACKEND_DIR, script) : script;
  const path = inside.startsWith('..') || isAbsolute(inside) ? script : inside;
  return path.split('\\').join('/');
};

const tail = (text) => {
  const value = String(text ?? '').trimEnd();
  if (value === '') return '(пусто)';
  return value.length > TAIL_CHARS ? `…${value.slice(-TAIL_CHARS)}` : value;
};

const seconds = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;

/**
 * Run `node <script> ...args` and wait for it, at most `timeout` ms.
 *
 * @param {string} script  path of the script (absolute, or relative to the cwd)
 * @param {string[]} [args]
 * @param {import('child_process').SpawnSyncOptions} [options]  as for spawnSync;
 *   `encoding` defaults to utf8, `timeout` to SCRIPT_TIMEOUT_MS; `killSignal` is
 *   always SIGKILL.
 * @returns {import('child_process').SpawnSyncReturns<string>}
 * @throws {Error} when the script did not exit within the limit (code
 *   'SCRIPT_TIMEOUT'), or could not be started at all
 */
export function runScript(script, args = [], options = {}) {
  const { timeout = SCRIPT_TIMEOUT_MS, ...rest } = options;
  // 0, Infinity or no number would mean «wait forever» — the case this helper is for.
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`runScript: предел ожидания должен быть положительным числом мс, получено ${String(timeout)}`);
  }
  const started = Date.now();
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    ...rest,
    timeout,
    killSignal: 'SIGKILL',
  });
  if (!result.error) return result;

  const waited = Date.now() - started;
  const name = shown(script);
  if (result.error.code === 'ETIMEDOUT') {
    const error = new Error(
      `Скрипт ${name} не завершился за ${seconds(timeout)} (предел ожидания) и снят сигналом SIGKILL; `
      + `ждали ${seconds(waited)}.\n`
      + `Аргументы: ${JSON.stringify(args)}\n`
      + `stdout (хвост): ${tail(result.stdout)}\n`
      + `stderr (хвост): ${tail(result.stderr)}`,
    );
    error.code = 'SCRIPT_TIMEOUT';
    error.script = name;
    error.timeoutMs = timeout;
    error.waitedMs = waited;
    error.result = result;
    throw error;
  }
  const error = new Error(`Скрипт ${name} не удалось запустить или дождаться: ${result.error.message}`);
  error.code = result.error.code;
  error.cause = result.error;
  error.result = result;
  throw error;
}
