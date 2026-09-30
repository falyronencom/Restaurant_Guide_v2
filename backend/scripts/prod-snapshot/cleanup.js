/**
 * Снимок прода — уборка открытых данных. Бриф §3.1 шаг 9: открытые данные
 * могут остаться в четырёх местах, уборка проходит все четыре и при сбое:
 *   1) папка сборки (build/) и tar до шифрования;
 *   2) папка расшифровки (decrypt-tmp/);
 *   3) контейнеры снимка (prod-snapshot-*) и файлы внутри pg-test;
 *   4) базы prod_snapshot_verify_* в pg-test.
 * Итог проверяется отдельно (checkClean), а не выводится из того, что
 * команды удаления отработали.
 */

import { existsSync, readdirSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { VERIFY_CONTAINER, listSnapshotContainers, removeContainer, run } from './proc.js';
import { dropVerifyDb, listVerifyDbs } from './restore.js';

export const PLAINTEXT_DIRS = Object.freeze(['build', 'decrypt-tmp']);
/** tar до шифрования; .tar.gpg — не открытые данные. */
export const isPlaintextFile = (name) => /\.tar(\.part)?$/.test(name);

const plaintextIn = (runDir) => {
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir).filter((n) => PLAINTEXT_DIRS.includes(n) || isPlaintextFile(n)).map((n) => join(runDir, n));
};

/**
 * @param {{ runDirs: string[], localPg: object|null, verifyDbs: string[]|'all' }} o
 * @returns {Promise<{ removed: string[], errors: string[] }>}
 */
export const cleanup = async ({ runDirs, localPg, verifyDbs }) => {
  const removed = [];
  const errors = [];
  // Сначала контейнеры: живой pg_dump/pg_restore пишет и читает через bind-mount,
  // папку под ним удалять раньше него бессмысленно.
  for (const name of await listSnapshotContainers()) {
    const r = await removeContainer(name);
    if (r.code === 0) removed.push(`контейнер ${name}`);
    else errors.push(`контейнер ${name}: ${r.stderr.trim()}`);
  }
  for (const dir of runDirs) {
    for (const p of plaintextIn(dir)) {
      try {
        await rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        removed.push(p);
      } catch (err) {
        errors.push(`${p}: ${err.message}`);
      }
    }
  }
  if (localPg) {
    try {
      const names = verifyDbs === 'all' ? await listVerifyDbs(localPg) : verifyDbs;
      for (const name of names) {
        await dropVerifyDb(localPg, name);
        removed.push(`база ${name}`);
      }
    } catch (err) {
      errors.push(`базы verify: ${err.message}`);
    }
  }
  return { removed, errors };
};

/** Файлы снимка внутри pg-test (туда ничего не пишется — проверка, что так и есть). */
const filesInsidePgTest = async () => {
  const r = await run('docker', [
    'exec', VERIFY_CONTAINER, 'sh', '-c',
    'find / \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o \\( -name "prod.dump" -o -name "*prod-snapshot*" -o -name "*prod_snapshot*" -o -name "nirivio-snapshot*" \\) -print 2>/dev/null',
  ], { timeoutMs: 120000 });
  if (r.code !== 0 && !r.stdout) return { ok: false, error: r.stderr.trim() || `код ${r.code}` };
  return { ok: true, files: r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) };
};

/** Независимая проверка итога уборки: четыре места пусты. */
export const checkClean = async ({ runDirs, localPg }) => {
  const plaintext = runDirs.flatMap(plaintextIn);
  const containers = await listSnapshotContainers();
  let verifyDbsLeft = null;
  if (localPg) {
    try {
      verifyDbsLeft = await listVerifyDbs(localPg);
    } catch (err) {
      verifyDbsLeft = [`(не проверено: ${err.message})`];
    }
  }
  const inside = await filesInsidePgTest();
  const clean = plaintext.length === 0 && containers.length === 0
    && (verifyDbsLeft === null || verifyDbsLeft.length === 0) && inside.ok && inside.files.length === 0;
  return { clean, plaintext, containers, verifyDbs: verifyDbsLeft, pgTestFiles: inside };
};
