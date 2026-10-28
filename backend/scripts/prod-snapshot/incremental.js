/**
 * Снимок прода — «только новое» и «только база» (D7 нитки «Нагрузка и расходы», 28.10.2026).
 *
 * Каждый полный снимок скачивал из Cloudinary всё облако (≈ 0,95 ГБ — почти
 * кредит из 25 бесплатных; 76 % трафика за 30 дней на 26.10). Теперь основа —
 * прошлый ПРОВЕРЕННЫЙ снимок на диске: файл, совпавший с ним, берётся из его
 * архива, скачиваются только новые и изменённые.
 *
 * Новый архив по-прежнему самодостаточен: в нём лежат все файлы, а не ссылка
 * на основу. Восстановление — из одного архива, как раньше; потеря или порча
 * основы не задевает снимков, сделанных после; проверка восстановлением
 * (verifyArchive) проверяет его теми же (а)–(в), что и полный.
 *
 * Тождество файла: ключ resource_type/type/public_id, версия Cloudinary
 * (перезапись под тем же public_id даёт новую), размер, и sha256 файла из
 * основы против её манифеста — его когда-то сверили с md5 доставки.
 *
 * Счёт трафика: 1 ГБ (2^30 байт) скачанного = 1 кредит Cloudinary
 * (калибровка 30.09.2026 на этом облаке: +0,77 кредита за 0,752 ГБ).
 */

import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { mkdir, rename } from 'fs/promises';
import { createHash } from 'crypto';
import { basename, dirname, join } from 'path';
import { assetKey } from './media.js';

export const MEDIA_MODE = Object.freeze({
  INCREMENTAL: 'incremental',
  FULL: 'full',
  DB_ONLY: 'db-only',
});

export const BYTES_PER_CREDIT = 1024 ** 3;
export const FREE_PLAN_CREDITS = 25;

export const credits = (bytes) => (bytes || 0) / BYTES_PER_CREDIT;

/** «0,95», «0,004», «0» — по-русски, с запятой. */
export const fmtCredits = (bytes) => {
  const c = credits(bytes);
  if (c === 0) return '0';
  return c.toFixed(c < 0.1 ? 3 : 2).replace('.', ',');
};

/** Снимки до 28.10.2026 поля media не имеют — это полные снимки. */
export const mediaModeOf = (doc) => doc?.media?.mode ?? MEDIA_MODE.FULL;
export const hasMedia = (doc) => mediaModeOf(doc) !== MEDIA_MODE.DB_ONLY;

const RUN_DIR_RE = /^\d{4}-\d{2}-\d{2}_\d{4}$/;

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/** Прогон проверен: verify.json от --apply ИЛИ verify-<время>.json от --verify с ok: true. */
export const isVerifiedRun = (dir) => readdirSync(dir)
  .filter((n) => /^verify(-.+)?\.json$/.test(n))
  .some((n) => readJson(join(dir, n))?.ok === true);

/**
 * Проверенные прогоны раньше runId, новые первыми: { dir, index }.
 * Битый index.json — прогон пропускается, ищем раньше.
 */
export const listVerifiedRuns = (root, runId) => {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => RUN_DIR_RE.test(n) && n < runId)
    .map((n) => join(root, n))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'index.json')))
    .sort()
    .reverse()
    .filter(isVerifiedRun)
    .map((dir) => ({ dir, index: readJson(join(dir, 'index.json')) }))
    .filter((r) => r.index);
};

/** Почему прогон не годится в основу (null — годится). */
export const baseProblem = ({ dir, index }) => {
  if (!hasMedia(index)) return 'снимок только базы — файлов в нём нет';
  if (!index.archive?.file || !index.archive?.tar_sha256) return 'в index.json нет архива или его sha256';
  if (!existsSync(join(dir, index.archive.file))) return `архива ${index.archive.file} нет на диске`;
  return null;
};

/**
 * Основа — самый свежий проверенный снимок с файлами и с архивом на диске.
 * Снимки «только база» и прогоны без архива пропускаются (с причиной).
 */
export const pickBase = (runs) => {
  const skipped = [];
  for (const r of runs) {
    const problem = baseProblem(r);
    if (!problem) return { base: { ...r, runId: r.index.run_id ?? basename(r.dir), archivePath: join(r.dir, r.index.archive.file) }, skipped };
    skipped.push({ run_id: r.index.run_id ?? basename(r.dir), why: problem });
  }
  return { base: null, skipped };
};

/**
 * Режим и основа до всякого скачивания.
 * - «только новое» без годной основы — полный снимок (с причиной в skipped);
 * - «только база» основы не ищет; её диф — к последнему проверенному прогону
 *   любого вида, диф снимка с файлами — к последнему проверенному с файлами;
 * - estimate — по index.json основы (сухой прогон пароля не спрашивает).
 *
 * @param {{ requested: string, verifiedRuns: Array<{dir, index}>, entries: Array<{asset}> }} o
 */
export const resolveMediaPlan = ({ requested, verifiedRuns, entries }) => {
  const dbOnly = requested === MEDIA_MODE.DB_ONLY;
  const { base, skipped } = dbOnly ? { base: null, skipped: [] } : pickBase(verifiedRuns);
  const previous = (dbOnly ? verifiedRuns : verifiedRuns.filter((r) => hasMedia(r.index)))[0]?.index ?? null;
  const mode = requested === MEDIA_MODE.INCREMENTAL && !base ? MEDIA_MODE.FULL : requested;
  const estimate = mode === MEDIA_MODE.DB_ONLY ? { reuse: [], download: [] }
    : mode === MEDIA_MODE.INCREMENTAL ? planReuse(entries, baseFilesByKey(base.index.files), { requireVersion: false })
      : wholeDownload(entries);
  return {
    mode,
    base,
    baseSkipped: requested === MEDIA_MODE.INCREMENTAL ? skipped : [],
    previous,
    estimate,
    // Пароль до скачивания — окном расшифровки основы; без основы спросить его заранее нечем.
    passwordFirst: Boolean(base) && mode !== MEDIA_MODE.DB_ONLY,
    lastSnapshotWithFiles: verifiedRuns.find((r) => hasMedia(r.index))?.index.run_id ?? null,
  };
};

export const wholeDownload = (entries) => ({ reuse: [], download: entries.map((entry) => ({ entry, why: 'полный снимок' })) });

/** Файлы основы по ключу: из index.json (оценка) или из манифеста архива (точно). */
export const baseFilesByKey = (files) => new Map((files || []).map((f) => [f.key, f]));

/**
 * Что взять из основы, что скачать.
 *
 * requireVersion: true — по манифесту основы (в нём версия есть с первого
 * прогона 30.09): совпасть обязаны и версия, и размер. false — оценка по
 * index.json сухого прогона: в индексах до 28.10 версии нет, тогда только размер.
 *
 * @param {Array<{asset}>} entries план файлов (manifest.planFiles)
 * @param {Map<string, {bytes, sha256, version?, path?}>} baseFiles
 */
export const planReuse = (entries, baseFiles, { requireVersion }) => {
  const reuse = [];
  const download = [];
  for (const e of entries) {
    const a = e.asset;
    const b = baseFiles.get(assetKey(a));
    let why = null;
    if (!b) why = 'нет в основе';
    else if (!b.sha256) why = 'в основе без проверенной копии';
    else if (a.bytes == null || b.bytes !== a.bytes) why = 'размер другой';
    else if (requireVersion && (a.version == null || b.version == null)) why = 'версия неизвестна';
    else if (a.version != null && b.version != null && String(a.version) !== String(b.version)) why = 'версия другая';
    if (why) download.push({ entry: e, why });
    else reuse.push({ entry: e, base: b });
  }
  return { reuse, download };
};

const sum = (list) => list.reduce((s, x) => s + (x.entry.asset.bytes || 0), 0);

/** Итог плана: файлов и байт по обе стороны, причины скачивания. */
export const reuseTotals = ({ reuse, download }) => {
  const reasons = {};
  for (const d of download) reasons[d.why] = (reasons[d.why] || 0) + 1;
  return {
    from_base: { files: reuse.length, bytes: sum(reuse) },
    download: { files: download.length, bytes: sum(download) },
    download_reasons: reasons,
  };
};

const hashFile = (path) => new Promise((resolvePromise, reject) => {
  const sha = createHash('sha256');
  const md5 = createHash('md5');
  let bytes = 0;
  createReadStream(path)
    .on('data', (d) => {
      sha.update(d);
      md5.update(d);
      bytes += d.length;
    })
    .on('end', () => resolvePromise({ sha256: sha.digest('hex'), md5: md5.digest('hex'), bytes }))
    .on('error', reject);
});

/**
 * Файл из расшифрованной основы — в папку сборки нового снимка (перенос:
 * обе папки — внутри папки прогона, один диск). Годен, только если sha256
 * совпал с манифестом основы и размер — с листингом облака сейчас.
 * Результат той же формы, что у downloadFile: manifest.fileRecord его примет.
 */
export const takeFromBase = async (srcPath, destPath, { sha256, bytes, version, baseRunId }) => {
  if (!existsSync(srcPath)) return { ok: false, status: 0, error: 'нет файла в основе' };
  const h = await hashFile(srcPath);
  if (h.sha256 !== sha256) return { ok: false, status: 0, error: 'sha256 файла основы не совпал с её манифестом' };
  if (bytes != null && h.bytes !== bytes) return { ok: false, status: 0, error: `размер в основе ${h.bytes} ≠ листинг ${bytes}` };
  await mkdir(dirname(destPath), { recursive: true });
  await rename(srcPath, destPath);
  return {
    ok: true,
    status: 0,
    bytes: h.bytes,
    sha256: h.sha256,
    md5: h.md5,
    source: 'base',
    base_run_id: baseRunId,
    checks: {
      source: `основа ${baseRunId}`,
      base_sha256: 'совпал',
      bytes: bytes == null ? 'нет эталона' : 'совпал',
      version: version == null ? 'нет эталона' : 'совпала',
    },
  };
};

/**
 * Файлы нового снимка в папке сборки: совпавшие — переносом из расшифрованной
 * основы, остальные (и те, что из основы взять не вышло) — через downloadAll.
 *
 * @param {object} o
 * @param {{ reuse: Array<{entry, base}>, download: Array<{entry}> }} o.plan
 * @param {Map<string,string>} o.pathByKey ключ → путь в архиве (media/…)
 * @param {string} o.buildDir папка сборки нового снимка
 * @param {string|null} o.baseBuildDir папка build/ расшифрованной основы
 * @param {string|null} o.baseRunId
 * @param {(entries: Array<{asset}>) => Promise<Map<string, object>>} o.downloadAll ключ → результат downloadFile
 * @param {(text: string) => void} [o.onWarn]
 * @returns {Promise<{ downloads: Map<string, object>, toDownload: Array<{asset}> }>}
 */
export const collectMedia = async ({ plan, pathByKey, buildDir, baseBuildDir, baseRunId, downloadAll, onWarn = () => {} }) => {
  const downloads = new Map();
  const toDownload = plan.download.map((d) => d.entry);
  for (const { entry, base: b } of plan.reuse) {
    const key = assetKey(entry.asset);
    const rel = pathByKey.get(key);
    const r = await takeFromBase(join(baseBuildDir, ...b.path.split('/')), join(buildDir, ...rel.split('/')), {
      sha256: b.sha256, bytes: entry.asset.bytes ?? null, version: entry.asset.version ?? null, baseRunId,
    });
    if (r.ok) downloads.set(key, { ...r, path: rel });
    else {
      onWarn(`из основы не взят ${key}: ${r.error} — скачается`);
      toDownload.push(entry);
    }
  }
  const fetched = toDownload.length ? await downloadAll(toDownload) : new Map();
  for (const e of toDownload) {
    const key = assetKey(e.asset);
    const r = fetched.get(key) ?? { ok: false, status: 0, error: 'не скачивался' };
    downloads.set(key, { ...r, source: 'download', path: pathByKey.get(key) });
  }
  return { downloads, toDownload };
};

/**
 * Файлы архива после распаковки против его манифеста: sha256 каждого
 * лежащего на диске файла. Одинаково для полного снимка, «только нового» и
 * «только базы» (у последнего файлов с sha256 в манифесте нет).
 */
export const hashArchiveFiles = async (buildDir, manifestFiles) => {
  const disk = new Map();
  for (const f of manifestFiles) {
    const p = join(buildDir, ...f.path.split('/'));
    if (existsSync(p)) disk.set(f.path, (await hashFile(p)).sha256);
  }
  return {
    disk,
    filesOnDisk: {
      in_manifest: manifestFiles.length,
      downloaded_in_manifest: manifestFiles.filter((f) => f.sha256).length,
      on_disk: disk.size,
      sha256_match: manifestFiles.filter((f) => f.sha256 && disk.get(f.path) === f.sha256).length,
    },
  };
};

/**
 * Проверка (б) по виду снимка. «Только база»: файлов в архиве нет по замыслу —
 * (б) не применима, и это записано словами, а не засчитано молча. Остальные
 * (полный, «только новое», снимки до 28.10) — checkRefsHaveFiles как раньше.
 */
export const checkMediaRefs = (manifest, check) => (mediaModeOf(manifest) === MEDIA_MODE.DB_ONLY
  ? { checked: 0, found: 0, explained: 0, failed: [], skipped: 'снимок только базы — файлов облака в архиве нет' }
  : check());

/**
 * Поле media для index.json и manifest.json: режим, основа, что скачано, что
 * взято из основы, во что обошлось.
 */
export const mediaReport = ({ mode, requested, base, downloads, skipped = null }) => {
  const list = [...(downloads?.values?.() ?? [])].filter((d) => d.ok);
  const fromBase = list.filter((d) => d.source === 'base');
  const fetched = list.filter((d) => d.source !== 'base');
  const bytesOf = (xs) => xs.reduce((s, d) => s + (d.bytes || 0), 0);
  const downloadedBytes = bytesOf(fetched);
  return {
    mode,
    requested: requested ?? mode,
    base_run_id: base?.runId ?? null,
    downloaded: { files: fetched.length, bytes: downloadedBytes },
    from_base: { files: fromBase.length, bytes: bytesOf(fromBase) },
    credits_cloudinary: Math.round(credits(downloadedBytes) * 1000) / 1000,
    ...(skipped ? { not_in_archive: skipped } : {}),
  };
};
