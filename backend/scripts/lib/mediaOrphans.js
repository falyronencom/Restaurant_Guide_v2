/**
 * Files in the cloud that nothing in the database names — the counting half
 * of scripts/media-orphans-audit.js. Pure functions: no network, no database.
 *
 * What counts as a reference. A file is named by its public_id
 * (establishments/temp/<user>/interior/abc123). The database holds it inside
 * delivery links of every shape the project has produced — transformation
 * segments, a version, an extension, a query string, a PDF page (pg_2) — and,
 * in the seed registry, as a bare public_id in JSON. Two readings, united:
 * - the text as stored: every maximal run of path characters that starts at a
 *   top folder of the cloud, after a character that cannot belong to an id
 *   (tokenRegexSource; extracted in SQL, so rows never leave the database);
 * - every Cloudinary delivery link the way a browser reads it (WHATWG URL:
 *   backslashes become slashes, dot segments are resolved), tokenised again —
 *   links stored before the input gate of 06.10.2026 may be spelled so.
 * A token whose inner segment is a top folder also counts from there
 * (expandToken): a top folder named like a segment of the link (the cloud,
 * «image», «upload») must not swallow the public_id behind it. A file is
 * referenced when its public_id equals one of these tokens. Widening only adds
 * references; it never makes an orphan.
 *
 * Where a reference lives decides what it means:
 * - live — a column whose row shows the file today (card media, the catalogue
 *   cover, a promotion, an avatar, a partner document), and the seed registry
 *   of an import not yet finished (a resume re-attaches its files);
 * - history — a column that only remembers it (the audit log, the registry of
 *   a finished import, OCR error texts);
 * - any other column holding a token is an unknown place: counted as a
 *   reference and named in the report, never taken for an orphan.
 *
 * Outside the database, invisible to this count: the site's wizard keeps a new
 * card in the browser until name, address, category, cuisine and hours are
 * filled; the app's registration keeps it in memory until it is sent. Their
 * uploads have no row yet — the report keeps the files of living accounts and
 * the fresh ones apart.
 *
 * Folders (registry v4.39 amendment, memory feedback_cabinet_put_media_sync_path):
 * establishments/temp/<userId>/… is permanent storage despite its name — the
 * wizard uploads every card photo there. A folder, a prefix or an age is not a
 * criterion; the report gives them only to describe what has no reference.
 */

import { parseCloudinaryUrl } from '../prod-snapshot/media.js';

export const STATUS = Object.freeze({
  LIVE: 'live',
  OTHER: 'other',
  HISTORY: 'history',
  NONE: 'none',
  UNCHECKED: 'unchecked',
});

/** Pseudo-column: the media_state of seed registry rows whose import has not finished. */
export const UNFINISHED_IMPORT_COLUMN = 'public.seed_import_registry.media_state (незавершённая загрузка)';

/** Columns whose rows show the file in the product (schema.table.column). */
export const LIVE_COLUMNS = Object.freeze([
  'public.establishment_media.url',
  'public.establishment_media.preview_url',
  'public.establishment_media.thumbnail_url',
  'public.establishments.primary_image_url',
  'public.promotions.image_url',
  'public.promotions.preview_url',
  'public.promotions.thumbnail_url',
  'public.users.avatar_url',
  'public.partner_documents.document_url',
  UNFINISHED_IMPORT_COLUMN,
]);

/** Columns that only remember a file: they show nothing to anyone. */
export const HISTORY_COLUMNS = Object.freeze([
  'public.audit_log.old_data',
  'public.audit_log.new_data',
  'public.seed_import_registry.media_state',
  'public.ocr_jobs.error_message',
  'public.ocr_jobs.result_summary',
]);

const LIVE = new Set(LIVE_COLUMNS);
const HISTORY = new Set(HISTORY_COLUMNS);

export const columnRole = (column) => {
  if (LIVE.has(column)) return STATUS.LIVE;
  if (HISTORY.has(column)) return STATUS.HISTORY;
  return STATUS.OTHER;
};

/** A folder name that can go into the token pattern as it is. */
const PLAIN_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Top folders of the cloud, from the listing: the first segment of every
 * public_id that has a folder. Only plain names — a folder with other
 * characters cannot be searched for, and its files stay unchecked.
 */
export const topFoldersOf = (assets) => [...new Set(
  assets
    .map((a) => String(a.public_id))
    .filter((id) => id.includes('/'))
    .map((id) => id.slice(0, id.indexOf('/')))
    .filter((top) => PLAIN_SEGMENT.test(top)),
)].sort();

/**
 * The token pattern (PostgreSQL ARE; JavaScript reads it the same way): a top
 * folder, a slash, then id characters and slashes, ending on an id character.
 * The lookbehind keeps a token from starting inside a word
 * (myestablishments/…); the run stops at the first character an id cannot
 * hold — the dot of an extension, '?', ',', a quote, a space. One capture
 * group: regexp_matches returns the token as m[1].
 */
export const tokenRegexSource = (topFolders) => {
  if (!topFolders.length) return null;
  return `(?<![A-Za-z0-9_-])((?:${topFolders.join('|')})/[A-Za-z0-9_/-]*[A-Za-z0-9_-])`;
};

/**
 * Cloudinary delivery links in text (used with flags 'gi'). Backslashes are
 * kept — a browser reads them as slashes; a link ends at a space, a quote or
 * an angle bracket.
 */
export const DELIVERY_URL_REGEX_SOURCE = String.raw`https?://res(?:-[0-9]+)?\.cloudinary\.com/[^[:space:]"'<>]+`;

/** Path tokens of a text — the JavaScript twin of the SQL extraction. */
export const tokensIn = (text, topFolders) => {
  const source = tokenRegexSource(topFolders);
  if (!source) return [];
  return [...String(text).matchAll(new RegExp(source, 'g'))].map((m) => m[1]);
};

/**
 * A token, and its tails that start at an inner top folder: in
 * test/image/upload/v1/avatars/u/x (a top folder «test» named like the cloud)
 * the public_id avatars/u/x is the tail. A tail keeps at least a folder and a
 * name.
 */
export const expandToken = (token, topFolders) => {
  const parts = String(token).split('/');
  const out = [];
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (topFolders.includes(parts[i])) out.push(parts.slice(i).join('/'));
  }
  return out.length ? out : [String(token)];
};

const DELIVERY_HOST = /^res(-\d+)?\.cloudinary\.com$/i;

/**
 * A delivery link the way a browser resolves it (WHATWG URL: backslashes in a
 * path become slashes, dot segments are removed, the host is case-blind).
 * Null for anything that is not a Cloudinary delivery link.
 *
 * @returns {{ cloud: string, path: string } | null}
 */
export const normalizeDeliveryUrl = (raw) => {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (!DELIVERY_HOST.test(u.hostname)) return null;
  const first = u.pathname.split('/').filter(Boolean)[0];
  if (!first) return null;
  return { cloud: first, path: u.pathname, href: u.href };
};

/**
 * The database's hits → which columns name each public_id, which live links
 * on our cloud name no listed file, and how many links point to which cloud.
 *
 * @param {Object} input
 * @param {Array<{column, token, mentions}>} input.tokenHits - raw tokens from SQL
 * @param {Array<{column, url, mentions}>} input.urlHits - delivery links from SQL
 * @param {string[]} input.topFolders
 * @param {string} input.cloudName - the listing's cloud
 * @param {Set<string>} input.listed - public_ids of the listing
 */
export const indexReferences = ({ tokenHits, urlHits, topFolders, cloudName, listed }) => {
  const byId = new Map();
  const note = (id, column) => {
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id).add(column);
  };
  for (const h of tokenHits) {
    for (const id of expandToken(h.token, topFolders)) note(id, h.column);
  }

  const brokenLive = new Set();
  const clouds = { ours: 0, others: 0, otherClouds: 0 };
  const otherCloudNames = new Set();
  for (const h of urlHits) {
    const link = normalizeDeliveryUrl(h.url);
    if (!link) continue;
    if (link.cloud === cloudName) clouds.ours += h.mentions;
    else {
      clouds.others += h.mentions;
      otherCloudNames.add(link.cloud);
    }
    const tokens = tokensIn(link.path, topFolders).flatMap((t) => expandToken(t, topFolders));
    // The project's own reading of the link too (prod-snapshot/media.js) — it
    // also names a file in the cloud's root, which has no folder to start a token.
    const parsed = parseCloudinaryUrl(link.href)?.publicId;
    const ids = parsed && !tokens.includes(parsed) ? [...tokens, parsed] : tokens;
    for (const id of ids) note(id, h.column);
    if (columnRole(h.column) === STATUS.LIVE && link.cloud === cloudName && !ids.some((id) => listed.has(id))) {
      // One missing file is named by several links (original, preview, thumbnail): count the file —
      // the project's reading of the link, else the path's last token (the public_id ends the path;
      // an earlier token can be a transformation behind a top folder named like the cloud).
      brokenLive.add(parsed || tokens[tokens.length - 1] || link.path);
    }
  }
  clouds.otherClouds = otherCloudNames.size;
  return { byId, brokenLive, clouds };
};

/**
 * Card rows' hits → the statuses of the cards that show each public_id.
 *
 * @param {Array<{status, kind: 'token'|'url', hit}>} rows
 */
export const indexCardStatuses = (rows, topFolders) => {
  const out = new Map();
  for (const r of rows) {
    let ids;
    if (r.kind === 'url') {
      const link = normalizeDeliveryUrl(r.hit);
      ids = link ? tokensIn(link.path, topFolders).flatMap((t) => expandToken(t, topFolders)) : [];
    } else {
      ids = expandToken(r.hit, topFolders);
    }
    for (const id of ids) {
      if (!out.has(id)) out.set(id, new Set());
      out.get(id).add(r.status);
    }
  }
  return out;
};

/**
 * Whether a public_id can be found by the token search: under a searchable top
 * folder, made of plain segments only. Anything else (a file in the root, a
 * space or a dot in the name) is reported as unchecked, never as an orphan.
 */
export const isCheckable = (publicId, topFolders) => {
  const id = String(publicId);
  const slash = id.indexOf('/');
  if (slash === -1) return false;
  if (!topFolders.includes(id.slice(0, slash))) return false;
  return id.split('/').every((segment) => PLAIN_SEGMENT.test(segment));
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => UUID.test(String(value));

export const GROUP = Object.freeze({
  TEMP: 'temp',
  CARDS: 'cards',
  AVATARS: 'avatars',
  OTHER: 'other',
});

/**
 * The folder a file sits in, read from its public_id — the uploader's layout
 * (src/config/cloudinary.js, ownedFolders):
 *   establishments/temp/<userId>/<kind>/…  — the wizard's uploads of an account
 *   establishments/<cardId>/<kind>/…       — uploads filed under a card
 *   avatars/<userId>/…
 * ownerId is the id in the path when it is a UUID, otherwise null.
 */
export const folderOf = (publicId) => {
  const parts = String(publicId).split('/');
  if (parts[0] === 'establishments' && parts[1] === 'temp' && parts.length >= 4) {
    return { group: GROUP.TEMP, ownerId: isUuid(parts[2]) ? parts[2].toLowerCase() : null, owner: parts[2], kind: parts.length >= 5 ? parts[3] : null };
  }
  if (parts[0] === 'establishments' && parts.length >= 3 && parts[1] !== 'temp') {
    return { group: GROUP.CARDS, ownerId: isUuid(parts[1]) ? parts[1].toLowerCase() : null, owner: parts[1], kind: parts.length >= 4 ? parts[2] : null };
  }
  if (parts[0] === 'avatars' && parts.length >= 3) {
    return { group: GROUP.AVATARS, ownerId: isUuid(parts[1]) ? parts[1].toLowerCase() : null, owner: parts[1], kind: null };
  }
  return { group: GROUP.OTHER, ownerId: null, owner: null, kind: null };
};

/** Upload sections the uploaders use (src/config/cloudinary.js, media types); anything else is «other». */
export const KNOWN_KINDS = Object.freeze(['interior', 'exterior', 'menu', 'dishes', 'menu_pdf', 'promotions']);

const DAY_MS = 24 * 60 * 60 * 1000;

export const AGE_BUCKETS = Object.freeze(['under1', 'upTo7', 'upTo30', 'upTo90', 'older', 'unknown']);

/** Whole days between upload and asOf: under a day, 1–7, 8–30, 31–90, more; no date — unknown. */
export const ageBucket = (createdAt, asOf) => {
  const created = Date.parse(createdAt ?? '');
  if (Number.isNaN(created)) return 'unknown';
  const days = Math.floor((asOf.getTime() - created) / DAY_MS);
  if (days < 1) return 'under1';
  if (days <= 7) return 'upTo7';
  if (days <= 30) return 'upTo30';
  if (days <= 90) return 'upTo90';
  return 'older';
};

/** A snapshot manifest's per-file verdicts (prod-snapshot/media.js FILE_STATUS). */
const SNAPSHOT_VERDICTS = Object.freeze(['referenced', 'orphan-with-provenance', 'orphan']);

/**
 * The whole cloud through a read-only reader (prod-snapshot/cloudinaryReader.js):
 * each delivery type asked for by name — a list without one may hold «upload»
 * only — then the list without a type, for any other delivery; an asset once,
 * by resource_type/type/public_id.
 *
 * @param {{ listAll(resourceType: string, type?: string|null): Promise<Array> }} reader
 */
export const listWholeCloud = async (reader, { resourceTypes, deliveryTypes }) => {
  const byKey = new Map();
  const keep = (a) => byKey.set(`${a.resource_type}/${a.type}/${a.public_id}`, a);
  for (const rt of resourceTypes) {
    for (const type of deliveryTypes) (await reader.listAll(rt, type)).forEach(keep);
    (await reader.listAll(rt)).forEach(keep);
  }
  return [...byKey.values()];
};

/**
 * A listing in any of the shapes the operator has: the Admin API's resources,
 * a saved array of them, or a snapshot manifest (backend/scripts/prod-snapshot:
 * the cloud in target.cloud_name, the database's moment in snapshot.time_utc,
 * its row counts in counts.snapshot, and each file's own verdict in status).
 * Only what the count needs is kept.
 *
 * @returns {{ assets, cloudName, dbMoment, counts, excludedTables }}
 */
export const parseListing = (json) => {
  const list = Array.isArray(json) ? json
    : Array.isArray(json?.files) ? json.files
      : Array.isArray(json?.resources) ? json.resources
        : null;
  if (!list) throw new Error('Листинг не распознан: нужен массив ассетов, { resources: [...] } или манифест снимка { files: [...] }.');
  const assets = list.map((a, i) => {
    if (!a || typeof a.public_id !== 'string' || !a.public_id) {
      throw new Error(`Листинг: у записи ${i + 1} нет public_id.`);
    }
    return {
      public_id: a.public_id,
      resource_type: a.resource_type || 'image',
      type: a.type || 'upload',
      format: a.format || '',
      bytes: Number.isFinite(Number(a.bytes)) ? Number(a.bytes) : 0,
      created_at: a.created_at ?? null,
      // Only a snapshot's own verdicts: the Admin API has a «status» field of its own.
      ...(SNAPSHOT_VERDICTS.includes(a.status) ? { snapshotStatus: a.status } : {}),
    };
  });
  const top = Array.isArray(json) ? {} : json;
  const counts = top.counts?.snapshot;
  return {
    assets,
    cloudName: top.target?.cloud_name || top.cloud_name || null,
    dbMoment: top.snapshot?.time_utc || top.snapshot_time_utc || null,
    counts: counts && typeof counts === 'object' ? counts : null,
    excludedTables: Array.isArray(top.counts?.excluded_data_tables) ? top.counts.excluded_data_tables : [],
  };
};

/** live > other > history > none: the strongest place a file is named in. */
export const statusOf = (columns) => {
  if (!columns || columns.size === 0) return STATUS.NONE;
  const roles = new Set([...columns].map(columnRole));
  if (roles.has(STATUS.LIVE)) return STATUS.LIVE;
  if (roles.has(STATUS.OTHER)) return STATUS.OTHER;
  return STATUS.HISTORY;
};

/** This count's status in the snapshot's words (prod-snapshot/media.js FILE_STATUS). */
const AS_SNAPSHOT = {
  [STATUS.LIVE]: 'referenced',
  [STATUS.OTHER]: 'referenced',
  [STATUS.HISTORY]: 'orphan-with-provenance',
  [STATUS.NONE]: 'orphan',
  [STATUS.UNCHECKED]: 'unchecked',
};

const emptyAge = () => Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0]));
const emptyBucket = () => ({ files: 0, bytes: 0, age: emptyAge(), oldest: null, newest: null });
const dayOf = (createdAt) => {
  const t = Date.parse(createdAt ?? '');
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
};

const add = (bucket, asset, asOf) => {
  bucket.files += 1;
  bucket.bytes += asset.bytes || 0;
  bucket.age[ageBucket(asset.created_at, asOf)] += 1;
  const day = dayOf(asset.created_at);
  if (day) {
    if (!bucket.oldest || day < bucket.oldest) bucket.oldest = day;
    if (!bucket.newest || day > bucket.newest) bucket.newest = day;
  }
};

const inc = (obj, key) => {
  obj[key] = (obj[key] || 0) + 1;
};

const sortedObject = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Who stands behind the folder of a file without references:
 * temp — the uploading account: service (the seed house's flag), partner,
 *   another role, or no such account any more;
 * cards — the card exists or not;
 * avatars — the account exists or not.
 */
const ownerKind = (folder, owners) => {
  if (folder.group === GROUP.TEMP) {
    const user = folder.ownerId ? owners.users.get(folder.ownerId) : null;
    if (!user) return 'missing';
    if (user.service) return 'service';
    if (user.role === 'partner') return 'partner';
    return 'otherRole';
  }
  if (folder.group === GROUP.CARDS) {
    return folder.ownerId && owners.cards.has(folder.ownerId) ? 'exists' : 'missing';
  }
  if (folder.group === GROUP.AVATARS) {
    return folder.ownerId && owners.users.has(folder.ownerId) ? 'exists' : 'missing';
  }
  return 'none';
};

/**
 * The report: per folder group, how many files are named in the database and
 * how many are not, with their size and age. Numbers and column names only —
 * no public_id, no account or card id, no names, no cloud names.
 *
 * @param {Object} input
 * @param {Array} input.assets - parseListing().assets
 * @param {{byId: Map<string, Set<string>>, brokenLive: Set<string>}} input.refs - indexReferences()
 * @param {Map<string, Set<string>>} input.cardStatuses - indexCardStatuses()
 * @param {{users: Map<string, {role, service}>, cards: Map<string, {status}>}} input.owners
 * @param {string[]} input.topFolders
 * @param {Date} input.asOf
 * @param {string|null} [input.dbMoment] - when the database was read (a snapshot's
 *   time): a file uploaded at or after it cannot be judged by that database
 */
export const buildReport = ({ assets, refs, cardStatuses, owners, topFolders, asOf, dbMoment = null }) => {
  const dbTime = dbMoment ? Date.parse(dbMoment) : NaN;

  const groups = {};
  const totals = { files: 0, bytes: 0, status: Object.fromEntries(Object.values(STATUS).map((s) => [s, emptyBucket()])) };
  const ensureGroup = (name) => {
    if (!groups[name]) {
      groups[name] = {
        files: 0,
        bytes: 0,
        folders: new Set(),
        status: Object.fromEntries(Object.values(STATUS).map((s) => [s, emptyBucket()])),
        uncheckedWhy: { shape: 0, afterDb: 0 },
        liveByCard: { active: 0, notActive: 0, notCard: 0 },
        noneByOwner: {},
        noneByKind: {},
        noneByFormat: { pdf: 0, image: 0 },
      };
    }
    return groups[name];
  };

  const comparison = {};
  let compared = 0;
  let dangerous = 0;
  const columnFiles = new Map();
  for (const asset of assets) {
    const folder = folderOf(asset.public_id);
    const g = ensureGroup(folder.group);
    g.files += 1;
    g.bytes += asset.bytes || 0;
    if (folder.owner) g.folders.add(folder.owner);

    const created = Date.parse(asset.created_at ?? '');
    let status;
    let columns = null;
    if (!isCheckable(asset.public_id, topFolders)) {
      status = STATUS.UNCHECKED;
      g.uncheckedWhy.shape += 1;
    } else if (!Number.isNaN(dbTime) && !Number.isNaN(created) && created >= dbTime) {
      status = STATUS.UNCHECKED;
      g.uncheckedWhy.afterDb += 1;
    } else {
      columns = refs.byId.get(asset.public_id);
      status = statusOf(columns);
    }
    add(g.status[status], asset, asOf);
    add(totals.status[status], asset, asOf);
    totals.files += 1;
    totals.bytes += asset.bytes || 0;

    for (const column of columns || []) {
      columnFiles.set(column, (columnFiles.get(column) || 0) + 1);
    }

    if (status === STATUS.LIVE) {
      const statuses = cardStatuses.get(asset.public_id);
      if (statuses?.has('active')) g.liveByCard.active += 1;
      else if (statuses && statuses.size > 0) g.liveByCard.notActive += 1;
      else g.liveByCard.notCard += 1;
    }
    if (status === STATUS.NONE) {
      inc(g.noneByOwner, ownerKind(folder, owners));
      inc(g.noneByKind, KNOWN_KINDS.includes(folder.kind) ? folder.kind : folder.kind ? 'other' : 'none');
      g.noneByFormat[asset.format === 'pdf' ? 'pdf' : 'image'] += 1;
    }

    if (asset.snapshotStatus) {
      const mine = AS_SNAPSHOT[status];
      comparison[asset.snapshotStatus] ??= {};
      comparison[asset.snapshotStatus][mine] = (comparison[asset.snapshotStatus][mine] || 0) + 1;
      compared += 1;
      if (asset.snapshotStatus === 'referenced' && status === STATUS.NONE) dangerous += 1;
    }
  }

  const columns = [...columnFiles.keys()].sort().map((column) => ({
    column,
    role: columnRole(column),
    files: columnFiles.get(column),
  }));

  const finalGroups = Object.fromEntries(Object.entries(groups).map(([name, g]) => [name, {
    files: g.files,
    bytes: g.bytes,
    folders: g.folders.size,
    status: g.status,
    uncheckedWhy: g.uncheckedWhy,
    liveByCard: g.liveByCard,
    noneByOwner: sortedObject(g.noneByOwner),
    noneByKind: sortedObject(g.noneByKind),
    noneByFormat: g.noneByFormat,
  }]));

  return {
    asOf: asOf.toISOString(),
    dbMoment: dbMoment || null,
    columns,
    brokenLinks: refs.brokenLive.size,
    groups: finalGroups,
    totals,
    snapshotComparison: compared ? { files: compared, matrix: comparison, referencedButNone: dangerous } : null,
  };
};

/** 1 234 567 bytes → «1,2 МБ». */
export const formatBytes = (bytes) => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2).replace('.', ',')} ГБ`;
  return `${mb.toFixed(1).replace('.', ',')} МБ`;
};

/** Russian plural: plural(3, ['файл', 'файла', 'файлов']) → «3 файла». */
export const plural = (n, [one, few, many]) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
};

/** Share as a whole percent, «—» for an empty whole. */
export const percent = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—');
