/**
 * Снимок прода — проверки места записи и сведения о коде.
 *
 * Папка снимков обязана лежать вне git-дерева (репозиторий публичный) и вне
 * OneDrive: до шифрования в ней лежат открытые данные, а OneDrive выгрузил
 * бы их в облако раньше, чем их зашифруют.
 */

import { existsSync, statfsSync } from 'fs';
import { dirname, resolve, sep } from 'path';
import { REPO_DIR } from './env.js';
import { run } from './proc.js';

/** Ближайший существующий предок пути (для git и statfs). */
export const nearestExisting = (p) => {
  let cur = resolve(p);
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
  return cur;
};

const isInside = (child, parent) => {
  const c = resolve(child).toLowerCase();
  const p = resolve(parent).toLowerCase();
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

/** @returns {Promise<string[]>} причины отказа (пусто — годится) */
export const checkSnapshotRoot = async (root) => {
  const problems = [];
  const existing = nearestExisting(root);
  if (!existing) return [`нет ни одного существующего предка у ${root}`];

  const git = await run('git', ['-C', existing, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 30000 });
  if (git.code === 0 && git.stdout.trim() === 'true') problems.push(`${root} внутри git-дерева — архивы в репозиторий попасть не должны`);
  if (isInside(root, REPO_DIR)) problems.push(`${root} внутри репозитория проекта`);

  for (const name of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const od = process.env[name];
    if (od && isInside(root, od)) problems.push(`${root} внутри OneDrive (${od}) — открытые данные ушли бы в облако до шифрования`);
  }
  return problems;
};

export const freeBytes = (p) => {
  const existing = nearestExisting(p);
  if (!existing) return null;
  const s = statfsSync(existing);
  return Number(s.bavail) * Number(s.bsize);
};

/** origin/main после git fetch — «не обязательно выкаченный коммит». */
export const gitState = async () => {
  const fetch = await run('git', ['-C', REPO_DIR, 'fetch', '--quiet', 'origin', 'main'], { timeoutMs: 120000 });
  const origin = await run('git', ['-C', REPO_DIR, 'rev-parse', 'origin/main'], { timeoutMs: 30000 });
  const head = await run('git', ['-C', REPO_DIR, 'rev-parse', 'HEAD'], { timeoutMs: 30000 });
  return {
    fetch_ok: fetch.code === 0,
    fetch_error: fetch.code === 0 ? null : fetch.stderr.trim().slice(0, 200),
    origin_main: origin.code === 0 ? origin.stdout.trim() : null,
    origin_main_note: 'origin/main после git fetch — не обязательно выкаченный на прод коммит',
    local_head: head.code === 0 ? head.stdout.trim() : null,
  };
};
