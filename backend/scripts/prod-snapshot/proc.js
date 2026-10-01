/**
 * Снимок прода — запуск внешних программ (docker, tar, gpg, git).
 *
 * Аргументы — массивом, без оболочки: пути Windows не проходят через
 * преобразование путей Git Bash (MSYS), кавычки не нужны. Секреты в
 * аргументы не попадают никогда — только в окружение дочернего процесса.
 */

import { spawn } from 'child_process';

/** Образ той же мажорной версии, что прод (16): архив pg_dump 18 не прочтёт pg_restore 16. */
export const PG_IMAGE = 'postgis/postgis:16-3.4';
export const VERIFY_CONTAINER = 'pg-test';
/** Имена одноразовых контейнеров снимка — по ним уборка находит брошенные. */
export const CONTAINER_PREFIX = 'prod-snapshot-';

/**
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} code -1 — программа не запустилась
 */
export const run = (cmd, args, { env, cwd, timeoutMs = 0, hideWindow = true, onStderr } = {}) =>
  new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(cmd, args, {
        env: env ? { ...process.env, ...env } : process.env,
        cwd,
        windowsHide: hideWindow,
      });
    } catch (err) {
      resolvePromise({ code: -1, stdout: '', stderr: err.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (onStderr) onStderr(String(d));
    });
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs) : null;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code: -1, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });

export const dockerServerVersion = async () => {
  const r = await run('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 30000 });
  return r.code === 0 ? r.stdout.trim() : null;
};

export const containerRunning = async (name) => {
  const r = await run('docker', ['inspect', '-f', '{{.State.Running}}', name], { timeoutMs: 30000 });
  return r.code === 0 && r.stdout.trim() === 'true';
};

export const imagePresent = async (image) => {
  const r = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 30000 });
  return r.code === 0;
};

/** Контейнеры снимка, оставшиеся от прошлых запусков (в т. ч. убитых). */
export const listSnapshotContainers = async () => {
  const r = await run('docker', ['ps', '-a', '--filter', `name=${CONTAINER_PREFIX}`, '--format', '{{.Names}}'], { timeoutMs: 30000 });
  return r.code === 0 ? r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
};

export const removeContainer = (name) => run('docker', ['rm', '-f', name], { timeoutMs: 60000 });

/**
 * Одноразовый контейнер образа PG_IMAGE (--rm): файлы — только через
 * bind-mount на хост, во внутреннюю ФС контейнера ничего не пишется.
 *
 * @param {object} o
 * @param {string} o.name имя контейнера (CONTAINER_PREFIX + …)
 * @param {Record<string,string>} [o.env] переменные: в команду docker идут только ИМЕНА
 * @param {Array<{source:string,target:string,readonly?:boolean}>} [o.mounts]
 * @param {string} [o.network] например container:pg-test
 * @param {string[]} o.command
 */
export const dockerRun = async ({ name, env = {}, mounts = [], network, command, timeoutMs = 0, onStderr }) => {
  const args = ['run', '--rm', '--pull=never', '--name', name];
  for (const k of Object.keys(env)) args.push('-e', k);
  for (const m of mounts) {
    args.push('--mount', `type=bind,source=${m.source},target=${m.target}${m.readonly ? ',readonly' : ''}`);
  }
  if (network) args.push('--network', network);
  args.push(PG_IMAGE, ...command);
  const r = await run('docker', args, { env, timeoutMs, onStderr });
  // Таймаут убивает только клиент docker: сам контейнер (и его сессия с продом) жил бы дальше.
  if (r.timedOut) await removeContainer(name);
  return r;
};

/** Мажорная версия pg_dump/pg_restore в образе. */
export const imagePgVersion = async (tool) => {
  const r = await dockerRun({ name: `${CONTAINER_PREFIX}version-${process.pid}`, command: [tool, '--version'], timeoutMs: 60000 });
  const m = /\(PostgreSQL\) (\d+)\.(\d+)/.exec(r.stdout);
  return m ? { major: Number(m[1]), full: `${m[1]}.${m[2]}`, text: r.stdout.trim() } : { major: null, text: (r.stdout + r.stderr).trim() };
};
