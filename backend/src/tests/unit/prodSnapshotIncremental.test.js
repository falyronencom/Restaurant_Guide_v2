/* eslint-env jest */
/**
 * Unit — снимок прода: «только новое», «только база», цена в кредитах
 * (scripts/prod-snapshot/incremental.js; D7 нитки «Нагрузка и расходы», 28.10.2026).
 *
 * Зачем: каждый полный снимок скачивал всё облако (≈ 0,95 ГБ — почти кредит
 * из 25; 76 % трафика за 30 дней). Ошибка здесь стоит одного из двух: лишнего
 * гигабайта трафика (файл, который можно было взять из основы, скачан) или
 * негодного снимка (файл взят из основы, а в облаке уже другой; или не лёг
 * в архив). Проверка — на подставных листингах и файлах, без сети и без прода.
 *
 * Пара «основа + приращение» проходит весь путь файлов: сборка основы →
 * tar → распаковка (как расшифровка основы) → приращение → tar → распаковка
 * (как учебное восстановление) → те же проверки, что у verifyArchive.
 * Шифрования в тесте нет: gpg без окна pinentry здесь не вызвать, а слой
 * tar + gpg у «только нового» тот же, что у полного снимка.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MEDIA_MODE, checkMediaRefs, collectMedia, credits, fmtCredits, hashArchiveFiles, listVerifiedRuns, mediaReport, pickBase,
  planReuse, resolveMediaPlan, reuseTotals, takeFromBase, baseFilesByKey,
} from '../../../scripts/prod-snapshot/incremental.js';
import {
  buildIndex, checkRefsHaveFiles, collectRefs, diffIndexes, fileRecord, planFiles,
} from '../../../scripts/prod-snapshot/manifest.js';
import { archiveFilePath, assetKey } from '../../../scripts/prod-snapshot/media.js';
import { tarCreate, tarExtract } from '../../../scripts/prod-snapshot/archive.js';
import { PLAINTEXT_DIRS } from '../../../scripts/prod-snapshot/cleanup.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const asset = (public_id, { version = 1, bytes = 100 } = {}) => ({
  public_id, resource_type: 'image', type: 'upload', format: 'jpg', version, bytes,
  secure_url: `https://res.cloudinary.com/demo/image/upload/v${version}/${public_id}.jpg`,
});
const entryOf = (a) => ({ asset: a, refs: [], secondaryRefs: [] });

describe('цена в кредитах Cloudinary', () => {
  test('1 ГБ (2^30) = 1 кредит; прогон 5 (1 018 144 681 байт) — «0,95»; мелочь — три знака; ноль — «0»', () => {
    expect(credits(1024 ** 3)).toBe(1);
    expect(fmtCredits(1018144681)).toBe('0,95');
    expect(fmtCredits(5 * 1024 ** 2)).toBe('0,005');
    expect(fmtCredits(0)).toBe('0');
  });
});

describe('что взять из основы, что скачать', () => {
  const base = baseFilesByKey([
    { key: 'image/upload/same', bytes: 100, sha256: 's1', version: 1, path: 'media/same.jpg' },
    { key: 'image/upload/resized', bytes: 100, sha256: 's2', version: 1, path: 'media/resized.jpg' },
    { key: 'image/upload/reuploaded', bytes: 100, sha256: 's3', version: 1, path: 'media/reuploaded.jpg' },
    { key: 'image/upload/failed-before', bytes: 100, sha256: null, version: 1, path: 'media/failed.jpg' },
    { key: 'image/upload/old-index', bytes: 100, sha256: 's5', path: 'media/old.jpg' },
  ]);
  const entries = [
    asset('same'),
    asset('resized', { bytes: 120 }),
    asset('reuploaded', { version: 2 }),
    asset('failed-before'),
    asset('old-index'),
    asset('new'),
  ].map(entryOf);

  test('по манифесту основы (точно): совпасть обязаны версия, размер и проверенная копия', () => {
    const plan = planReuse(entries, base, { requireVersion: true });
    expect(plan.reuse.map((r) => r.entry.asset.public_id)).toEqual(['same']);
    expect(Object.fromEntries(plan.download.map((d) => [d.entry.asset.public_id, d.why]))).toEqual({
      resized: 'размер другой',
      reuploaded: 'версия другая',
      'failed-before': 'в основе без проверенной копии',
      'old-index': 'версия неизвестна',
      new: 'нет в основе',
    });
  });

  test('оценка сухого прогона по index.json до 28.10 (без версий) — по размеру; итог в файлах и байтах', () => {
    const plan = planReuse(entries, base, { requireVersion: false });
    expect(plan.reuse.map((r) => r.entry.asset.public_id)).toEqual(['same', 'old-index']);
    expect(reuseTotals(plan)).toEqual({
      from_base: { files: 2, bytes: 200 },
      download: { files: 4, bytes: 420 },
      download_reasons: { 'размер другой': 1, 'версия другая': 1, 'в основе без проверенной копии': 1, 'нет в основе': 1 },
    });
  });
});

describe('основа — последний проверенный снимок с файлами и архивом на диске', () => {
  let root;
  const run = (id, { verified = 'verify.json', ok = true, media = null, archive = true, archiveOnDisk = true } = {}) => {
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    const index = {
      run_id: id, counts: {}, establishments: [], media_rows: [],
      files: [{ key: 'image/upload/a', bytes: 1, sha256: 'x', version: 1 }],
      ...(archive ? { archive: { file: `nirivio-snapshot-${id}.tar.gpg`, tar_sha256: 't' } } : {}),
      ...(media ? { media } : {}),
    };
    writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
    if (verified) writeFileSync(join(dir, verified), JSON.stringify({ ok }));
    if (archive && archiveOnDisk) writeFileSync(join(dir, index.archive.file), 'enc');
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'prod-snapshot-runs-'));
    run('2026-10-11_2058');
    run('2026-10-22_1251', { verified: 'verify-2026-10-23_1000.json' }); // прошёл повторную проверку
    run('2026-10-24_1458', { archiveOnDisk: false }); // архив унесён на флешку
    run('2026-10-25_1000', { ok: false }); // проверка не прошла
    run('2026-10-26_1000', { verified: null }); // проверки не было
    run('2026-10-27_1000', { media: { mode: MEDIA_MODE.DB_ONLY } });
    run('2026-10-29_1000'); // позже текущего прогона
    mkdirSync(join(root, 'not-a-run'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('проверенные прогоны раньше текущего, новые первыми; без проверки и с проваленной — не в списке', () => {
    expect(listVerifiedRuns(root, '2026-10-28_1500').map((r) => r.index.run_id))
      .toEqual(['2026-10-27_1000', '2026-10-24_1458', '2026-10-22_1251', '2026-10-11_2058']);
  });

  test('«только база» и снимок без архива на диске основой не становятся — с причиной', () => {
    const { base, skipped } = pickBase(listVerifiedRuns(root, '2026-10-28_1500'));
    expect(base.runId).toBe('2026-10-22_1251');
    expect(base.archivePath).toBe(join(root, '2026-10-22_1251', 'nirivio-snapshot-2026-10-22_1251.tar.gpg'));
    expect(skipped).toEqual([
      { run_id: '2026-10-27_1000', why: 'снимок только базы — файлов в нём нет' },
      { run_id: '2026-10-24_1458', why: 'архива nirivio-snapshot-2026-10-24_1458.tar.gpg нет на диске' },
    ]);
  });

  test('режим: «только новое» с основой — пароль до скачивания; диф — к последнему с файлами', () => {
    const p = resolveMediaPlan({ requested: MEDIA_MODE.INCREMENTAL, verifiedRuns: listVerifiedRuns(root, '2026-10-28_1500'), entries: [entryOf(asset('a', { bytes: 1 }))] });
    expect(p.mode).toBe(MEDIA_MODE.INCREMENTAL);
    expect(p.passwordFirst).toBe(true);
    expect(p.previous.run_id).toBe('2026-10-24_1458');
    expect(p.lastSnapshotWithFiles).toBe('2026-10-24_1458');
    expect(reuseTotals(p.estimate).download.files).toBe(0);
  });

  test('«только база»: основы нет, скачивать нечего, диф — к последнему проверенному любого вида', () => {
    const p = resolveMediaPlan({ requested: MEDIA_MODE.DB_ONLY, verifiedRuns: listVerifiedRuns(root, '2026-10-28_1500'), entries: [entryOf(asset('a'))] });
    expect(p).toMatchObject({ mode: MEDIA_MODE.DB_ONLY, base: null, passwordFirst: false, baseSkipped: [] });
    expect(p.previous.run_id).toBe('2026-10-27_1000');
    expect(reuseTotals(p.estimate).download).toEqual({ files: 0, bytes: 0 });
  });

  test('--full: всё скачивается, но пароль всё равно до скачивания — окном основы', () => {
    const p = resolveMediaPlan({ requested: MEDIA_MODE.FULL, verifiedRuns: listVerifiedRuns(root, '2026-10-28_1500'), entries: [entryOf(asset('a', { bytes: 1 }))] });
    expect(p.mode).toBe(MEDIA_MODE.FULL);
    expect(p.passwordFirst).toBe(true);
    expect(reuseTotals(p.estimate).download.files).toBe(1);
  });

  test('«только новое» без основы — полный снимок, пароль после скачивания (спросить заранее нечем)', () => {
    const p = resolveMediaPlan({ requested: MEDIA_MODE.INCREMENTAL, verifiedRuns: [], entries: [entryOf(asset('a'))] });
    expect(p).toMatchObject({ mode: MEDIA_MODE.FULL, base: null, passwordFirst: false, previous: null });
  });
});

describe('файл из основы', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'prod-snapshot-take-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('годен — переносится, отчёт как у скачанного, с пометкой «основа»', async () => {
    const body = Buffer.from('jpeg bytes');
    writeFileSync(join(dir, 'src.jpg'), body);
    const r = await takeFromBase(join(dir, 'src.jpg'), join(dir, 'new', 'media', 'a.jpg'), {
      sha256: sha(body), bytes: body.length, version: 3, baseRunId: '2026-10-24_1458',
    });
    expect(r).toMatchObject({ ok: true, bytes: body.length, sha256: sha(body), source: 'base', base_run_id: '2026-10-24_1458' });
    expect(r.md5).toBe(createHash('md5').update(body).digest('hex'));
    expect(existsSync(join(dir, 'src.jpg'))).toBe(false);
    expect(readFileSync(join(dir, 'new', 'media', 'a.jpg'))).toEqual(body);
  });

  test('испорчен, другого размера или пропал — не берётся (будет скачан), исходник не тронут', async () => {
    writeFileSync(join(dir, 'src.jpg'), 'changed');
    expect(await takeFromBase(join(dir, 'src.jpg'), join(dir, 'out.jpg'), { sha256: sha('original'), bytes: 7, baseRunId: 'b' }))
      .toMatchObject({ ok: false, error: 'sha256 файла основы не совпал с её манифестом' });
    expect(await takeFromBase(join(dir, 'src.jpg'), join(dir, 'out.jpg'), { sha256: sha('changed'), bytes: 8, baseRunId: 'b' }))
      .toMatchObject({ ok: false, error: 'размер в основе 7 ≠ листинг 8' });
    expect(await takeFromBase(join(dir, 'none.jpg'), join(dir, 'out.jpg'), { sha256: 'x', bytes: 1, baseRunId: 'b' }))
      .toMatchObject({ ok: false, error: 'нет файла в основе' });
    expect(existsSync(join(dir, 'src.jpg'))).toBe(true);
    expect(existsSync(join(dir, 'out.jpg'))).toBe(false);
  });

  test('папка расшифровки основы — открытые данные для уборки', () => {
    expect(PLAINTEXT_DIRS).toEqual(expect.arrayContaining(['build', 'decrypt-tmp', 'base-tmp']));
  });
});

describe('«только база»', () => {
  test('(б) не применима и сказано почему; у полного снимка и снимков до 28.10 — обычная (б)', () => {
    const check = () => ({ checked: 3, found: 2, explained: 0, failed: [{ id: 'x' }] });
    expect(checkMediaRefs({ media: { mode: MEDIA_MODE.DB_ONLY } }, check))
      .toEqual({ checked: 0, found: 0, explained: 0, failed: [], skipped: 'снимок только базы — файлов облака в архиве нет' });
    expect(checkMediaRefs({}, check).failed).toHaveLength(1);
    expect(checkMediaRefs({ media: { mode: MEDIA_MODE.INCREMENTAL } }, check).failed).toHaveLength(1);
  });

  test('диф к снимку «только база» и от него файлы не сравнивает (иначе — «пропали все»)', () => {
    const idx = (media, files) => ({ run_id: 'r', counts: {}, establishments: [], media_rows: [], files, ...(media ? { media } : {}) });
    const full = idx(null, [{ key: 'k', sha256: 'a' }]);
    const dbOnly = idx({ mode: MEDIA_MODE.DB_ONLY }, [{ key: 'k', sha256: null }]);
    expect(diffIndexes(full, dbOnly).files).toBeNull();
    expect(diffIndexes(dbOnly, full).files).toBeNull();
    expect(diffIndexes(full, full).files).toEqual({ added: [], missing: [], sha256_changed: [] });
  });

  test('отчёт: ничего не скачано, листинг облака назван «не в архиве» вместе со снимком, где файлы есть', () => {
    expect(mediaReport({
      mode: MEDIA_MODE.DB_ONLY, base: null, downloads: new Map(),
      skipped: { files: 612, bytes: 1018144681, last_snapshot_with_files: '2026-10-24_1458' },
    })).toEqual({
      mode: 'db-only', requested: 'db-only', base_run_id: null,
      downloaded: { files: 0, bytes: 0 }, from_base: { files: 0, bytes: 0 }, credits_cloudinary: 0,
      not_in_archive: { files: 612, bytes: 1018144681, last_snapshot_with_files: '2026-10-24_1458' },
    });
  });
});

/**
 * Пара «основа + приращение» на подставном облаке. Облако — словарь
 * public_id → { version, body }; «скачивание» пишет тело и считает байты:
 * это и есть трафик Cloudinary.
 */
describe('основа + приращение: восстановление из архива приращения', () => {
  let work;
  const cloudV1 = {
    'est/a': { version: 1, body: 'фото A' },
    'est/b': { version: 1, body: 'фото B (сирота)' },
    'est/d': { version: 1, body: 'меню D, первая версия' },
  };
  const cloudV2 = {
    'est/a': cloudV1['est/a'],
    'est/b': cloudV1['est/b'],
    'est/c': { version: 1, body: 'фото C — новое' },
    'est/d': { version: 7, body: 'меню D, перезалито — вторая версия' },
  };
  const listing = (cloud) => Object.entries(cloud).map(([pid, f]) => asset(pid, { version: f.version, bytes: Buffer.byteLength(f.body) }));
  const U = (pid) => `https://res.cloudinary.com/demo/image/upload/v1/${pid}`;
  const inventory = {
    mediaRows: [
      { id: 'm1', establishment_id: 'e1', url: U('est/a'), preview_url: null, thumbnail_url: null },
      { id: 'm2', establishment_id: 'e1', url: U('est/c'), preview_url: null, thumbnail_url: null },
      { id: 'm3', establishment_id: 'e1', url: U('est/d'), preview_url: null, thumbnail_url: null },
    ],
    promotions: [], avatars: [], partnerDocuments: [], seedRegistry: [], secondaryUrls: [],
    establishments: [{ id: 'e1', name: 'Одна', status: 'active', primary_image_url: U('est/a') }],
  };
  const ctx = { cloudName: 'demo', legacyHosts: [] };

  /** Один прогон до tar: план, файлы, записи манифеста. Возвращает и сколько «скачано из облака». */
  const runSnapshot = async ({ runDir, cloud, plan: planFor, baseBuildDir = null, baseRunId = null }) => {
    const refs = collectRefs(inventory, ctx);
    const { files, rowsWithoutFile } = planFiles(refs, listing(cloud));
    const entries = [...files.values()];
    const pathByKey = new Map(entries.map((e) => [assetKey(e.asset), archiveFilePath(e.asset)]));
    const fetchedKeys = [];
    const downloadAll = async (list) => {
      const out = new Map();
      for (const e of list) {
        const body = Buffer.from(cloud[e.asset.public_id].body);
        const p = join(runDir, 'build', ...pathByKey.get(assetKey(e.asset)).split('/'));
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, body);
        fetchedKeys.push(e.asset.public_id);
        out.set(assetKey(e.asset), { ok: true, status: 200, bytes: body.length, sha256: sha(body), md5: 'm', checks: {} });
      }
      return out;
    };
    const plan = planFor(entries);
    const { downloads } = await collectMedia({
      plan, pathByKey, buildDir: join(runDir, 'build'), baseBuildDir, baseRunId, downloadAll,
    });
    const records = entries.map((e) => fileRecord(e, downloads.get(assetKey(e.asset))));
    const manifest = { run_id: runDir, files: records, rows_without_file: rowsWithoutFile };
    writeFileSync(join(runDir, 'build', 'manifest.json'), JSON.stringify(manifest));
    return { manifest, downloads, fetchedKeys };
  };

  /** tar → распаковка в чистую папку: как расшифровка основы и как учебное восстановление. */
  const roundTrip = async (runDir, into) => {
    expect((await tarCreate(runDir, 's.tar', 'build')).code).toBe(0);
    mkdirSync(into, { recursive: true });
    writeFileSync(join(into, 's.tar'), readFileSync(join(runDir, 's.tar')));
    expect((await tarExtract(into, 's.tar')).code).toBe(0);
    return join(into, 'build');
  };

  /** Проверки verifyArchive по файлам: sha256 на диске и (б) по ссылкам базы. */
  const verifyFiles = async (buildDir) => {
    const manifest = JSON.parse(readFileSync(join(buildDir, 'manifest.json'), 'utf8'));
    const { disk, filesOnDisk } = await hashArchiveFiles(buildDir, manifest.files);
    const manifestFiles = new Map(manifest.files.filter((f) => f.sha256).map((f) => [f.key, f]));
    const b = checkMediaRefs(manifest, () => checkRefsHaveFiles(collectRefs(inventory, ctx), manifestFiles, disk, manifest.rows_without_file));
    return { filesOnDisk, b };
  };

  let base;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'prod-snapshot-pair-'));
    const baseRun = join(work, 'base');
    mkdirSync(join(baseRun, 'build'), { recursive: true });
    base = await runSnapshot({ runDir: baseRun, cloud: cloudV1, plan: (entries) => planReuse(entries, new Map(), { requireVersion: true }) });
    base.buildDir = await roundTrip(baseRun, join(work, 'base-tmp'));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  test('основа: скачано всё облако (3 файла), её архив проходит проверки файлов', async () => {
    expect(base.fetchedKeys.sort()).toEqual(['est/a', 'est/b', 'est/d']);
    const v = await verifyFiles(join(work, 'base', 'build'));
    expect(v.filesOnDisk).toEqual({ in_manifest: 3, downloaded_in_manifest: 3, on_disk: 3, sha256_match: 3 });
  });

  test('приращение: скачаны только новое и перезалитое; архив самодостаточен и восстанавливается целиком', async () => {
    const incRun = join(work, 'inc');
    mkdirSync(join(incRun, 'build'), { recursive: true });
    const baseManifest = JSON.parse(readFileSync(join(base.buildDir, 'manifest.json'), 'utf8'));
    const inc = await runSnapshot({
      runDir: incRun, cloud: cloudV2, baseBuildDir: base.buildDir, baseRunId: '2026-10-24_1458',
      plan: (entries) => planReuse(entries, baseFilesByKey(baseManifest.files), { requireVersion: true }),
    });

    // Трафик: только C (новый) и D (новая версия). A и сирота B — из основы.
    expect(inc.fetchedKeys.sort()).toEqual(['est/c', 'est/d']);
    const media = mediaReport({ mode: MEDIA_MODE.INCREMENTAL, base: { runId: '2026-10-24_1458' }, downloads: inc.downloads });
    expect(media).toMatchObject({
      mode: 'incremental', base_run_id: '2026-10-24_1458',
      downloaded: { files: 2, bytes: Buffer.byteLength(cloudV2['est/c'].body) + Buffer.byteLength(cloudV2['est/d'].body) },
      from_base: { files: 2, bytes: Buffer.byteLength(cloudV1['est/a'].body) + Buffer.byteLength(cloudV1['est/b'].body) },
    });
    expect(Object.fromEntries(inc.manifest.files.map((f) => [f.public_id, f.source]))).toEqual({
      'est/a': 'base', 'est/b': 'base', 'est/c': 'download', 'est/d': 'download',
    });
    expect(inc.manifest.files.find((f) => f.public_id === 'est/d').version).toBe(7);

    // Восстановление — из ОДНОГО архива приращения: основа к этому моменту удалена.
    rmSync(join(work, 'base-tmp'), { recursive: true, force: true });
    rmSync(join(work, 'base'), { recursive: true, force: true });
    const restored = await roundTrip(incRun, join(work, 'restore'));
    const v = await verifyFiles(restored);
    expect(v.filesOnDisk).toEqual({ in_manifest: 4, downloaded_in_manifest: 4, on_disk: 4, sha256_match: 4 });
    expect(v.b).toEqual({ checked: 4, found: 4, explained: 0, failed: [] });
    expect(readFileSync(join(restored, ...archiveFilePath(asset('est/d')).split('/')), 'utf8')).toBe(cloudV2['est/d'].body);

    // index.json приращения несёт версии — следующий сухой прогон оценит точно.
    const index = buildIndex({
      runId: 'inc', snapshotTimeUtc: 't', cloudName: 'demo', counts: {}, establishments: inventory.establishments,
      mediaRows: inventory.mediaRows, fileRecords: inc.manifest.files, media,
    });
    expect(index.files.find((f) => f.key === 'image/upload/est/d')).toMatchObject({ version: 7 });
    expect(index.media.from_base.files).toBe(2);

    // Мутация: файл, взятый из основы, не лёг в архив — проверка восстановлением это ловит.
    unlinkSync(join(restored, ...archiveFilePath(asset('est/a')).split('/')));
    const broken = await verifyFiles(restored);
    expect(broken.filesOnDisk.sha256_match).toBe(3);
    expect(broken.b.failed.map((f) => `${f.table}.${f.id}:${f.why}`)).toEqual([
      'establishment_media.m1:нет файла на диске', 'establishments.e1:нет файла на диске',
    ]);
  });

  test('файл основы испорчен — не берётся, а скачивается: снимок цел ценой лишнего трафика', async () => {
    const baseRun = join(work, 'base2');
    mkdirSync(join(baseRun, 'build'), { recursive: true });
    const b2 = await runSnapshot({ runDir: baseRun, cloud: cloudV1, plan: (entries) => planReuse(entries, new Map(), { requireVersion: true }) });
    writeFileSync(join(baseRun, 'build', ...archiveFilePath(asset('est/a')).split('/')), 'порча');

    const incRun = join(work, 'inc2');
    mkdirSync(join(incRun, 'build'), { recursive: true });
    const warnings = [];
    const refs = collectRefs(inventory, ctx);
    const entries = [...planFiles(refs, listing(cloudV1)).files.values()];
    const pathByKey = new Map(entries.map((e) => [assetKey(e.asset), archiveFilePath(e.asset)]));
    const fetched = [];
    const { downloads } = await collectMedia({
      plan: planReuse(entries, baseFilesByKey(b2.manifest.files), { requireVersion: true }),
      pathByKey, buildDir: join(incRun, 'build'), baseBuildDir: join(baseRun, 'build'), baseRunId: 'b2',
      onWarn: (t) => warnings.push(t),
      downloadAll: async (list) => {
        fetched.push(...list.map((e) => e.asset.public_id));
        return new Map(list.map((e) => [assetKey(e.asset), { ok: true, status: 200, bytes: e.asset.bytes, sha256: 'x' }]));
      },
    });
    expect(fetched).toEqual(['est/a']);
    expect(warnings).toEqual(['из основы не взят image/upload/est/a: sha256 файла основы не совпал с её манифестом — скачается']);
    expect(downloads.get('image/upload/est/a').source).toBe('download');
    expect(downloads.get('image/upload/est/b').source).toBe('base');
  });
});
