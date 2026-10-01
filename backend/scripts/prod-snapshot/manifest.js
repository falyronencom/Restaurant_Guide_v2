/**
 * Снимок прода — ссылки базы, сводки, манифест, индекс и диф между прогонами.
 *
 * Чистые функции. Два выходных документа:
 * - manifest.json — внутри зашифрованного архива; полный (внешние ссылки
 *   целиком, пути legacy-local).
 * - index.json — рядом с архивом, НЕ шифруется: только id, public_id,
 *   хеши, счётчики и названия карточек (публичные данные каталога).
 *   Персональных данных в нём нет: внешние ссылки — только хостом.
 *   Прогон 2 строит диф по index.json прошлого прогона, не расшифровывая
 *   прошлый архив.
 */

import {
  CLOUDINARY_CLASSES,
  FILE_STATUS,
  KNOWN_PREFIXES,
  URL_CLASS,
  archiveFilePath,
  assetKey,
  classifyUrl,
  fileStatus,
  originalStatus,
  refKey,
  resolveClass,
  topPrefix,
} from './media.js';

/** Живые носители ссылок: строка сама показывает файл. */
export const PRIMARY_CARRIERS = Object.freeze([
  { table: 'establishment_media', columns: ['url', 'preview_url', 'thumbnail_url'] },
  { table: 'promotions', columns: ['image_url', 'preview_url', 'thumbnail_url'] },
  { table: 'users', columns: ['avatar_url'] },
  { table: 'establishments', columns: ['primary_image_url'] },
  { table: 'partner_documents', columns: ['document_url'] },
]);

/** Вторичные носители: происхождение файла, не живая ссылка. */
export const SECONDARY_CARRIERS = Object.freeze([
  { table: 'seed_import_registry', columns: ['media_state'] },
  { table: 'audit_log', columns: ['old_data', 'new_data'] },
  // Текст ошибки OCR цитирует ссылку страницы (…/upload/pg_N/v…/…jpg, сухой прогон
  // 30.09.2026: 2 строки). Сегмент pg_N без запятой разбор проекта public_id не
  // отдаёт — происхождения такая ссылка не даёт; её PDF и так держат живые строки.
  { table: 'ocr_jobs', columns: ['error_message'] },
]);

const carrierSet = (list) => new Set(list.flatMap((c) => c.columns.map((col) => `${c.table}.${col}`)));
export const PRIMARY_COLUMNS = carrierSet(PRIMARY_CARRIERS);
export const SECONDARY_COLUMNS = carrierSet(SECONDARY_CARRIERS);

/** Таблицы, у которых дамп несёт схему, но не данные (секреты открытым текстом, #8). */
export const EXCLUDED_DATA_TABLES = Object.freeze([
  'refresh_tokens',
  'password_reset_tokens',
  'email_verification_codes',
  'device_tokens',
]);

/**
 * Все ссылки инвентаря — одним списком.
 *
 * @param {object} inv инвентарь (database.js readInventory)
 * @param {{ cloudName: string, legacyHosts: string[] }} ctx
 */
export const collectRefs = (inv, ctx) => {
  const refs = [];
  const push = (table, id, column, value, carrier, establishmentId = null) => {
    refs.push({ table, id, column, value, carrier, establishmentId, ...classifyUrl(value, ctx) });
  };

  for (const r of inv.mediaRows) {
    for (const col of ['url', 'preview_url', 'thumbnail_url']) {
      push('establishment_media', r.id, col, r[col], 'primary', r.establishment_id);
    }
  }
  for (const r of inv.promotions) {
    for (const col of ['image_url', 'preview_url', 'thumbnail_url']) {
      push('promotions', r.id, col, r[col], 'primary', r.establishment_id);
    }
  }
  for (const r of inv.avatars) push('users', r.id, 'avatar_url', r.avatar_url, 'primary');
  for (const r of inv.establishments) {
    push('establishments', r.id, 'primary_image_url', r.primary_image_url, 'primary', r.id);
  }
  for (const r of inv.partnerDocuments) {
    push('partner_documents', r.id, 'document_url', r.document_url, 'primary', r.establishment_id);
  }

  // Реестр сида хранит и ссылки, и голый public_id: последний даёт ключ,
  // даже если ссылка в реестре другой формы.
  for (const r of inv.seedRegistry) {
    for (const url of r.urls) push('seed_import_registry', r.stable_id, 'media_state', url, 'secondary', r.establishment_id);
    for (const publicId of r.publicIds) {
      refs.push({
        table: 'seed_import_registry', id: r.stable_id, column: 'media_state.public_id', value: publicId,
        carrier: 'secondary', establishmentId: r.establishment_id,
        cls: URL_CLASS.CLOUDINARY_IMAGE, resourceType: 'image', deliveryType: 'upload', publicId,
      });
    }
  }
  for (const s of inv.secondaryUrls) push(s.table, s.id, s.column, s.url, 'secondary');
  return refs;
};

/** Счётчик по ключу. */
const tally = (items, keyOf) => {
  const out = {};
  for (const it of items) {
    const k = keyOf(it);
    out[k] = (out[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};

/**
 * Файлы к скачиванию и строки без файла — единственное место сопоставления
 * ссылок базы с ассетами (по ключу resource_type/type/public_id).
 * Попутно уточняет ref.cls на месте: pdf или image решает формат ассета.
 *
 * @param {Array} refs collectRefs
 * @param {Array} assets листинг Cloudinary (все resource_type × type)
 * @param {Map<string, object>} fallback ключ → ассет, найденный прямым запросом по public_id (не в листинге)
 */
export const planFiles = (refs, assets, fallback = new Map()) => {
  const all = [...assets, ...fallback.values()];
  const byKey = new Map(all.map((a) => [assetKey(a), a]));

  const files = new Map();
  for (const a of all) files.set(assetKey(a), { asset: a, refs: [], secondaryRefs: [], viaFallback: fallback.has(assetKey(a)) });

  const rowsWithoutFile = [];
  for (const ref of refs) {
    if (!CLOUDINARY_CLASSES.has(ref.cls)) continue;
    const entry = files.get(refKey(ref));
    const pointer = { table: ref.table, id: ref.id, column: ref.column };
    if (entry) {
      (ref.carrier === 'primary' ? entry.refs : entry.secondaryRefs).push(pointer);
      ref.cls = resolveClass(ref, byKey.get(refKey(ref)));
    } else if (ref.carrier === 'primary') {
      rowsWithoutFile.push({ ...pointer, cls: ref.cls, public_id: ref.publicId, reason: 'нет в Cloudinary: ни в листинге, ни по прямому запросу public_id' });
    }
  }

  // Ссылки, которые не ведут в наше облако, — тоже «строки без файла», с причиной-классом.
  const REASON = {
    [URL_CLASS.LEGACY_LOCAL]: 'legacy-local: файл жил на временной ФС контейнера Railway',
    [URL_CLASS.EXTERNAL]: 'внешняя ссылка — не наш файл, не качается',
    [URL_CLASS.CLOUDINARY_FOREIGN]: 'чужое облако Cloudinary — листингом не видно',
    [URL_CLASS.UNKNOWN]: 'значение не похоже на ссылку',
  };
  for (const ref of refs) {
    if (ref.carrier !== 'primary' || !REASON[ref.cls]) continue;
    rowsWithoutFile.push({ table: ref.table, id: ref.id, column: ref.column, cls: ref.cls, host: ref.host || null, reason: REASON[ref.cls] });
  }
  return { files, rowsWithoutFile };
};

/** Сводка для печати и манифеста. Без персональных данных. */
export const summarize = ({ refs, files, rowsWithoutFile, establishments, mediaRows }) => {
  const primary = refs.filter((r) => r.carrier === 'primary');
  const fileList = [...files.values()];
  const withStatus = fileList.map((f) => ({ ...f, status: fileStatus(f), original: originalStatus(f.asset) }));

  // Карточки, чьи фото лежат без настоящего оригинала (#13): только живые ссылки establishment_media.
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));
  const cardById = new Map(establishments.map((e) => [e.id, e]));
  const perCard = new Map();
  for (const f of withStatus) {
    if (f.original === 'original' || f.original === 'avatar-256') continue;
    const cards = new Set(
      f.refs.filter((p) => p.table === 'establishment_media').map((p) => mediaById.get(p.id)?.establishment_id).filter(Boolean),
    );
    for (const id of cards) {
      if (!perCard.has(id)) perCard.set(id, { id, name: cardById.get(id)?.name ?? '(нет в снимке)', status: cardById.get(id)?.status ?? null, compressed: 0, possibly: 0 });
      perCard.get(id)[f.original === 'compressed-at-upload' ? 'compressed' : 'possibly'] += 1;
    }
  }

  return {
    refs: {
      primary_by_class: tally(primary, (r) => r.cls),
      primary_by_column: tally(primary, (r) => `${r.table}.${r.column} · ${r.cls}`),
      secondary_by_source: tally(refs.filter((r) => r.carrier === 'secondary'), (r) => `${r.table}.${r.column} · ${r.cls}`),
      external_by_host: tally(primary.filter((r) => r.cls === URL_CLASS.EXTERNAL), (r) => r.host),
    },
    files: {
      total: fileList.length,
      bytes: fileList.reduce((s, f) => s + (f.asset.bytes || 0), 0),
      by_status: tally(withStatus, (f) => f.status),
      by_original: tally(withStatus, (f) => f.original),
      by_prefix: tally(fileList, (f) => topPrefix(f.asset.public_id)),
      by_type: tally(fileList, (f) => `${f.asset.resource_type}/${f.asset.type}`),
      by_format: tally(fileList, (f) => f.asset.format || '(нет)'),
      outside_known_prefixes: fileList.filter((f) => !KNOWN_PREFIXES.has(topPrefix(f.asset.public_id))).length,
      via_fallback: fileList.filter((f) => f.viaFallback).length,
      orphans_with_provenance_by_source: tally(
        withStatus.filter((f) => f.status === FILE_STATUS.ORPHAN_WITH_PROVENANCE),
        (f) => [...new Set(f.secondaryRefs.map((p) => p.table))].sort().join('+'),
      ),
    },
    rows_without_file: tally(rowsWithoutFile, (r) => `${r.table}.${r.column} · ${r.cls}`),
    cards_without_true_original: [...perCard.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  };
};

/**
 * Проверка (б) брифа по ВОССТАНОВЛЕННОЙ базе: каждая живая ссылка cloudinary-*
 * находит файл, лежащий на диске после расшифровки, с тем же sha256, что в
 * манифесте; иначе промах объяснён строкой манифеста «без файла».
 *
 * @param {Array} refs collectRefs по восстановленной базе
 * @param {Map<string,{path,sha256}>} manifestFiles ключ → файл манифеста
 * @param {Map<string,string>} diskSha256 путь в архиве → sha256 файла после расшифровки
 * @param {Array} explainedRows rows_without_file манифеста
 */
export const checkRefsHaveFiles = (refs, manifestFiles, diskSha256, explainedRows) => {
  const explained = new Set(explainedRows.map((r) => `${r.table}|${r.id}|${r.column}`));
  const result = { checked: 0, found: 0, explained: 0, failed: [] };
  for (const ref of refs) {
    if (ref.carrier !== 'primary' || !CLOUDINARY_CLASSES.has(ref.cls)) continue;
    result.checked += 1;
    const file = manifestFiles.get(refKey(ref));
    const onDisk = file && diskSha256.get(file.path);
    if (file && onDisk && onDisk === file.sha256) {
      result.found += 1;
    } else if (explained.has(`${ref.table}|${ref.id}|${ref.column}`)) {
      result.explained += 1;
    } else {
      result.failed.push({
        table: ref.table, id: ref.id, column: ref.column, public_id: ref.publicId,
        why: !file ? 'нет в манифесте' : !onDisk ? 'нет файла на диске' : 'sha256 не совпал',
      });
    }
  }
  return result;
};

/** Запись файла в манифест/индекс. */
export const fileRecord = (entry, download) => ({
  key: assetKey(entry.asset),
  public_id: entry.asset.public_id,
  resource_type: entry.asset.resource_type,
  type: entry.asset.type,
  format: entry.asset.format || '',
  version: entry.asset.version ?? null,
  created_at: entry.asset.created_at ?? null,
  width: entry.asset.width ?? null,
  height: entry.asset.height ?? null,
  bytes: download?.bytes ?? entry.asset.bytes ?? null,
  // Файл, не прошедший сверку на последней попытке, записан для разбора, но
  // хорошей копией не считается: без sha256 его не засчитают ни (б), ни диск.
  sha256: download?.ok ? download.sha256 : null,
  md5: download?.md5 ?? null,
  checks: download?.checks ?? null,
  path: archiveFilePath(entry.asset),
  status: fileStatus(entry),
  original: originalStatus(entry.asset),
  via_fallback: Boolean(entry.viaFallback),
  refs: entry.refs,
  secondary_refs: entry.secondaryRefs,
});

/** index.json: без персональных данных — для дифа следующего прогона. */
export const buildIndex = ({ runId, snapshotTimeUtc, cloudName, counts, establishments, mediaRows, fileRecords }) => {
  const keysByMedia = new Map();
  for (const f of fileRecords) {
    for (const p of f.refs) {
      if (p.table !== 'establishment_media') continue;
      if (!keysByMedia.has(p.id)) keysByMedia.set(p.id, new Set());
      keysByMedia.get(p.id).add(f.key);
    }
  }
  return {
    format: 'nirivio-prod-snapshot-index/1',
    run_id: runId,
    snapshot_time_utc: snapshotTimeUtc,
    cloud_name: cloudName,
    counts,
    establishments: establishments.map((e) => ({ id: e.id, name: e.name, status: e.status })),
    media_rows: mediaRows.map((m) => ({ id: m.id, establishment_id: m.establishment_id, keys: [...(keysByMedia.get(m.id) || [])].sort() })),
    files: fileRecords.map((f) => ({ key: f.key, bytes: f.bytes, sha256: f.sha256, status: f.status, original: f.original })),
  };
};

/**
 * Диф к индексу прошлого прогона: новые и исчезнувшие карточки, новые и
 * пропавшие файлы, сменившийся sha256, и у каждой новой карточки — дошли ли
 * все её файлы (цель прогона 2: ~15 новых карточек пришли целиком).
 */
export const diffIndexes = (prev, cur) => {
  const prevCards = new Map(prev.establishments.map((e) => [e.id, e]));
  const curCards = new Map(cur.establishments.map((e) => [e.id, e]));
  const prevFiles = new Map(prev.files.map((f) => [f.key, f]));
  const curFiles = new Map(cur.files.map((f) => [f.key, f]));

  const added = cur.establishments.filter((e) => !prevCards.has(e.id));
  const removed = prev.establishments.filter((e) => !curCards.has(e.id));

  const newCards = added.map((e) => {
    const rows = cur.media_rows.filter((m) => m.establishment_id === e.id);
    const complete = rows.filter((m) => m.keys.length > 0 && m.keys.every((k) => curFiles.get(k)?.sha256));
    return { id: e.id, name: e.name, media_rows: rows.length, rows_with_all_files: complete.length };
  });

  const counts = {};
  for (const t of new Set([...Object.keys(prev.counts || {}), ...Object.keys(cur.counts || {})])) {
    if ((prev.counts || {})[t] !== (cur.counts || {})[t]) counts[t] = { prev: prev.counts?.[t] ?? null, cur: cur.counts?.[t] ?? null };
  }

  return {
    previous_run_id: prev.run_id,
    establishments: {
      added: added.map((e) => ({ id: e.id, name: e.name })),
      removed: removed.map((e) => ({ id: e.id, name: e.name })),
    },
    files: {
      added: [...curFiles.keys()].filter((k) => !prevFiles.has(k)).sort(),
      missing: [...prevFiles.keys()].filter((k) => !curFiles.has(k)).sort(),
      sha256_changed: [...curFiles.keys()].filter((k) => prevFiles.has(k) && prevFiles.get(k).sha256 !== curFiles.get(k).sha256).sort(),
    },
    new_cards: newCards,
    counts_changed: counts,
  };
};
