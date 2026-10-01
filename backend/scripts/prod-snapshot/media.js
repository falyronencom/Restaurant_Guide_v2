/**
 * Снимок прода — ссылки на медиа: разбор ссылок Cloudinary, классы ссылок,
 * имена файлов в архиве, сопоставление ссылок базы с ассетами облака,
 * признак «настоящего оригинала».
 *
 * Чистые функции: ни сети, ни базы, ни файлов. Их пинит
 * src/tests/unit/prodSnapshot.test.js — в том числе на выводе ЖИВЫХ
 * построителей ссылок из src/config/cloudinary.js: если проект сменит форму
 * ссылок, разбор здесь покраснеет первым.
 *
 * Модуль Cloudinary проекта сюда не импортируется (в нём есть destroy);
 * нужная чистая функция скопирована — extractPublicIdFromUrl ниже.
 */

/** Классы ссылок (бриф §3.1 шаг 3) и два, которые надо уметь назвать, если встретятся. */
export const URL_CLASS = Object.freeze({
  CLOUDINARY_IMAGE: 'cloudinary-image',
  CLOUDINARY_PDF: 'cloudinary-pdf',
  // Ссылка на ЧУЖОЕ облако: листинг нашего её не видит, скачивать нечем.
  CLOUDINARY_FOREIGN: 'cloudinary-foreign',
  // /uploads/… — аватары до переезда в Cloudinary (1d9d5ad, 06.03.2026): файлы
  // лежали на временной ФС контейнера Railway.
  LEGACY_LOCAL: 'legacy-local',
  EXTERNAL: 'external',
  EMPTY: 'empty',
  // Не URL и не /uploads/… — строка, которую не понять.
  UNKNOWN: 'unknown',
});

export const CLOUDINARY_CLASSES = new Set([URL_CLASS.CLOUDINARY_IMAGE, URL_CLASS.CLOUDINARY_PDF]);

/**
 * Копия extractPublicIdFromUrl из backend/src/config/cloudinary.js (версия
 * 66b799d, 22.07.2026) без логгера. Тест сверяет копию с оригиналом на одних
 * и тех же ссылках: разойдутся — покраснеет.
 */
export const extractPublicIdFromUrl = (cloudinaryUrl) => {
  try {
    const urlParts = String(cloudinaryUrl).split('?')[0].split('/upload/');

    if (urlParts.length < 2) {
      return null;
    }

    const pathParts = urlParts[1].split('/');
    let startIndex = 0;
    while (
      startIndex < pathParts.length - 1 &&
      (pathParts[startIndex].includes(',') || /^v\d+$/.test(pathParts[startIndex]))
    ) {
      startIndex += 1;
    }

    const remaining = pathParts.slice(startIndex);
    const last = remaining[remaining.length - 1].replace(/\.[^.]+$/, '');
    const publicId = [...remaining.slice(0, -1), last].join('/');

    if (!publicId) {
      return null;
    }

    return publicId;
  } catch {
    return null;
  }
};

const DELIVERY_HOST = /^res(-\d+)?\.cloudinary\.com$/i;

/** Расширение последнего сегмента пути ('' если нет). */
const lastSegmentExtension = (pathname) => {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  return dot === -1 ? '' : last.slice(dot + 1).toLowerCase();
};

/**
 * Разбор ссылки доставки Cloudinary:
 *   https://res.cloudinary.com/<облако>/<resource_type>/<type>/[трансформации/][vNNN/]<public_id>[.ext]
 *
 * public_id извлекается скопированной функцией проекта — один разборщик на
 * всё. Для type, отличного от upload, ссылка нормализуется к /upload/, чтобы
 * функция её поняла. У raw расширение — часть public_id, его возвращаем.
 *
 * @returns {null | { cloud, resourceType, deliveryType, publicId, version, extension, transformed }}
 */
export const parseCloudinaryUrl = (raw) => {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (!DELIVERY_HOST.test(u.hostname)) return null;

  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 4) return null;
  const [cloud, resourceType, deliveryType, ...afterType] = segs;
  // Подписанная ссылка (private/authenticated) несёт первым сегментом s--<подпись>--.
  const rest = /^s--[^/]+--$/.test(afterType[0]) ? afterType.slice(1) : afterType;
  if (rest.length === 0) return null;

  const normalized = `https://res.cloudinary.com/${cloud}/${resourceType}/upload/${rest.join('/')}`;
  let publicId = extractPublicIdFromUrl(normalized);
  if (!publicId) return null;

  const extension = lastSegmentExtension(u.pathname);
  if (resourceType === 'raw' && extension) publicId = `${publicId}.${extension}`;

  const versionSeg = rest.find((s) => /^v\d+$/.test(s));
  return {
    cloud,
    resourceType,
    deliveryType,
    publicId,
    version: versionSeg ? Number(versionSeg.slice(1)) : null,
    extension,
    transformed: rest.some((s) => s.includes(',')),
  };
};

/**
 * Класс ссылки из строки базы.
 *
 * Класс cloudinary-* здесь предварительный: pdf, если ссылка кончается на
 * .pdf. У строки медиа PDF превью — это .jpg от того же public_id, поэтому
 * окончательный класс решает формат ассета в листинге (resolveClass).
 *
 * @param {string|null} value значение колонки
 * @param {{ cloudName: string, legacyHosts?: string[] }} ctx
 */
export const classifyUrl = (value, { cloudName, legacyHosts = [] }) => {
  if (value == null || String(value).trim() === '') return { cls: URL_CLASS.EMPTY };
  const s = String(value).trim();
  if (s.startsWith('/uploads/')) return { cls: URL_CLASS.LEGACY_LOCAL };

  let u;
  try {
    u = new URL(s);
  } catch {
    return { cls: URL_CLASS.UNKNOWN };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { cls: URL_CLASS.UNKNOWN };

  const parsed = parseCloudinaryUrl(s);
  if (parsed) {
    if (parsed.cloud !== cloudName) return { cls: URL_CLASS.CLOUDINARY_FOREIGN, host: u.hostname, ...parsed };
    const cls = parsed.extension === 'pdf' ? URL_CLASS.CLOUDINARY_PDF : URL_CLASS.CLOUDINARY_IMAGE;
    return { cls, ...parsed };
  }
  if (DELIVERY_HOST.test(u.hostname)) return { cls: URL_CLASS.UNKNOWN, host: u.hostname };

  if (u.pathname.startsWith('/uploads/') && legacyHosts.includes(u.hostname)) {
    return { cls: URL_CLASS.LEGACY_LOCAL, host: u.hostname };
  }
  return { cls: URL_CLASS.EXTERNAL, host: u.hostname };
};

/** Ключ ассета: resource_type/type/public_id — сопоставление только по нему, не по имени файла. */
export const assetKey = (a) => `${a.resource_type}/${a.type}/${a.public_id}`;
export const refKey = (r) => `${r.resourceType}/${r.deliveryType}/${r.publicId}`;

// Управляющие символы в имени файла Windows тоже запрещены — отсюда \u0000-\u001f.
// eslint-disable-next-line no-control-regex
const WINDOWS_FORBIDDEN = /[<>:"\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * Имя файла в архиве: public_id с заменой / на __, плюс .format.
 * Недопустимые в Windows символы → _. У raw формата нет — расширение уже в public_id.
 */
export const archiveFileName = (publicId, format) => {
  let base = String(publicId).replace(/\//g, '__').replace(WINDOWS_FORBIDDEN, '_').replace(/[. ]+$/, '_');
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  return format ? `${base}.${format}` : base;
};

/** Путь файла внутри папки снимка (прямые слэши — одинаково для манифеста и tar). */
export const archiveFilePath = (asset) =>
  `media/${asset.resource_type}/${asset.type}/${archiveFileName(asset.public_id, asset.format)}`;

/** Коммит, после которого загрузка перестала сжимать мастер (66b799d, 22.07.2026 12:32 МСК). */
export const COMPRESSION_FIX_AT = Date.parse('2026-07-22T09:32:08Z');
/** Выкатка шла после коммита; её время неизвестно — окно в сутки считаем сомнительным. */
export const DEPLOY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const ORIGINAL = Object.freeze({
  TRUE: 'original',
  COMPRESSED: 'compressed-at-upload',
  POSSIBLY: 'possibly-compressed',
  AVATAR: 'avatar-256',
});

/**
 * Настоящий ли оригинал лежит в облаке.
 * - До 66b799d загрузка фото сама жала мастер до 1920×1080 с q_auto (CHANGELOG 22.07).
 * - В сутки после коммита — «возможно»: выкатка позже коммита; решают размеры.
 * - PDF входящей трансформации не имел никогда (uploadPdf до и после 66b799d).
 * - Аватары жмутся до 256² всегда (uploadAvatar).
 */
export const originalStatus = (asset) => {
  if (asset.resource_type !== 'image' || asset.format === 'pdf') return ORIGINAL.TRUE;
  if (String(asset.public_id).startsWith('avatars/')) return ORIGINAL.AVATAR;
  const created = Date.parse(asset.created_at);
  if (Number.isNaN(created)) return ORIGINAL.POSSIBLY;
  if (created < COMPRESSION_FIX_AT) return ORIGINAL.COMPRESSED;
  if (created < COMPRESSION_FIX_AT + DEPLOY_WINDOW_MS && asset.width <= 1920 && asset.height <= 1080) {
    return ORIGINAL.POSSIBLY;
  }
  return ORIGINAL.TRUE;
};

/** Верхний уровень public_id: establishments/, avatars/ или прочее. */
export const topPrefix = (publicId) => {
  const s = String(publicId);
  const slash = s.indexOf('/');
  return slash === -1 ? '(корень)' : s.slice(0, slash);
};
export const KNOWN_PREFIXES = new Set(['establishments', 'avatars']);

export const FILE_STATUS = Object.freeze({
  REFERENCED: 'referenced',
  ORPHAN_WITH_PROVENANCE: 'orphan-with-provenance',
  ORPHAN: 'orphan',
});

/**
 * seed_import_registry.media_state: { <relpath>: { public_id, url, preview_url,
 * thumbnail_url, media_row_id, … } } (scripts/seed-import/pipeline.js). Обход
 * общий, не по именам ключей верхнего уровня: public_id — из полей
 * public_id, ссылки — любые строки со ссылкой Cloudinary.
 */
export const scanMediaState = (json) => {
  const publicIds = new Set();
  const urls = new Set();
  const walk = (node, key) => {
    if (typeof node === 'string') {
      if (key === 'public_id' && node) publicIds.add(node);
      else if (parseCloudinaryUrl(node)) urls.add(node);
    } else if (Array.isArray(node)) {
      for (const v of node) walk(v, null);
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  };
  walk(json, null);
  return { publicIds: [...publicIds].sort(), urls: [...urls].sort() };
};

/** Статус файла по ссылкам на него (refs — живые, secondaryRefs — происхождение). */
export const fileStatus = (entry) => {
  if (entry.refs.length > 0) return FILE_STATUS.REFERENCED;
  if (entry.secondaryRefs.length > 0) return FILE_STATUS.ORPHAN_WITH_PROVENANCE;
  return FILE_STATUS.ORPHAN;
};

/** Окончательный класс ссылки cloudinary-*: по формату ассета, если он найден. */
export const resolveClass = (ref, asset) => {
  if (!CLOUDINARY_CLASSES.has(ref.cls) || !asset) return ref.cls;
  return asset.format === 'pdf' ? URL_CLASS.CLOUDINARY_PDF : URL_CLASS.CLOUDINARY_IMAGE;
};

/**
 * Проверка (в) брифа: primary_image_url карточки совпадает с url или
 * preview_url одной из ЕЁ строк медиа. Карточки без обложки не проверяются —
 * считаются отдельно.
 *
 * @param {Array<{id, primary_image_url}>} establishments
 * @param {Array<{establishment_id, url, preview_url}>} mediaRows
 * @returns {{ checked: number, withoutCover: number, mismatched: string[] }}
 */
export const checkPrimaryImages = (establishments, mediaRows) => {
  const urlsByCard = new Map();
  for (const m of mediaRows) {
    if (!urlsByCard.has(m.establishment_id)) urlsByCard.set(m.establishment_id, new Set());
    const set = urlsByCard.get(m.establishment_id);
    if (m.url) set.add(m.url);
    if (m.preview_url) set.add(m.preview_url);
  }
  let checked = 0;
  let withoutCover = 0;
  const mismatched = [];
  for (const e of establishments) {
    if (!e.primary_image_url) {
      withoutCover += 1;
      continue;
    }
    checked += 1;
    if (!urlsByCard.get(e.id)?.has(e.primary_image_url)) mismatched.push(e.id);
  }
  mismatched.sort();
  return { checked, withoutCover, mismatched };
};
