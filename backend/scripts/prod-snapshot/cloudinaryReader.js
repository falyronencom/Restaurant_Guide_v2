/**
 * Снимок прода — Cloudinary только на чтение: Admin API (ping, usage,
 * листинг resources) и скачивание файлов по ссылкам доставки.
 *
 * SDK cloudinary и модуль проекта src/config/cloudinary.js сюда не
 * импортируются: в них есть destroy/rename/update. Здесь — голые GET-запросы,
 * и путь каждого проверяется списком чтения ДО отправки
 * (assertReadOnlyAdminCall). Изменяющего вызова в этом файле нет и быть не может.
 */

import { writeFile, rename, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { dirname } from 'path';

const API_BASE = 'https://api.cloudinary.com/v1_1';

/** Единственные пути Admin API, которые скрипт вправе вызвать. */
const READ_ONLY_PATHS = [
  /^ping$/,
  /^usage$/,
  /^resources\/(image|raw|video)$/,
  /^resources\/(image|raw|video)\/(upload|private|authenticated)$/,
];

export const assertReadOnlyAdminCall = (method, path) => {
  if (method !== 'GET') throw new Error(`Admin API: разрешён только GET, запрошено ${method} ${path}`);
  if (!READ_ONLY_PATHS.some((re) => re.test(path))) throw new Error(`Admin API: путь вне списка чтения: ${path}`);
};

export const RESOURCE_TYPES = Object.freeze(['image', 'raw', 'video']);
export const DELIVERY_TYPES = Object.freeze(['upload', 'private', 'authenticated']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchWithTimeout = async (url, init, timeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

export class CloudinaryReader {
  constructor({ cloudName, apiKey, apiSecret }) {
    this.cloudName = cloudName;
    this.auth = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
    this.secrets = [apiKey, apiSecret];
    this.calls = 0;
    this.rateLimit = null; // { limit, remaining, reset } из заголовков последнего ответа
  }

  /** Текст ошибки без ключей (ответ API может эхом вернуть api_key). */
  clean(text) {
    let s = String(text);
    for (const secret of this.secrets) if (secret) s = s.split(secret).join('***');
    return s.slice(0, 300);
  }

  async get(path, query = {}) {
    assertReadOnlyAdminCall('GET', path);
    const url = new URL(`${API_BASE}/${encodeURIComponent(this.cloudName)}/${path}`);
    for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));

    for (let attempt = 1; ; attempt += 1) {
      this.calls += 1;
      let res;
      try {
        res = await fetchWithTimeout(url, { headers: { Authorization: this.auth } }, 60000);
      } catch (err) {
        if (attempt >= 3) throw new Error(`Admin API ${path}: сеть — ${this.clean(err.message)}`);
        await sleep(3000 * attempt);
        continue;
      }
      const limit = res.headers.get('x-featureratelimit-limit');
      if (limit) {
        this.rateLimit = {
          limit: Number(limit),
          remaining: Number(res.headers.get('x-featureratelimit-remaining')),
          reset: res.headers.get('x-featureratelimit-reset'),
        };
      }
      if (res.ok) return res.json();
      const body = this.clean(await res.text().catch(() => ''));
      // 420/429 — исчерпан часовой бюджет: ждать до сброса дольше пары минут не станем.
      if ((res.status === 420 || res.status === 429) && attempt < 3) {
        const resetAt = Date.parse(this.rateLimit?.reset || '');
        const wait = Number.isNaN(resetAt) ? 60000 : resetAt - Date.now();
        if (wait > 120000) throw new Error(`Admin API ${path}: бюджет вызовов исчерпан до ${this.rateLimit?.reset} (HTTP ${res.status})`);
        await sleep(Math.max(wait, 5000));
        continue;
      }
      if (res.status >= 500 && attempt < 3) {
        await sleep(3000 * attempt);
        continue;
      }
      throw new Error(`Admin API ${path}: HTTP ${res.status} ${body}`);
    }
  }

  ping() {
    return this.get('ping');
  }

  usage() {
    return this.get('usage');
  }

  /** Все ассеты resource_type (и type, если задан) — с пагинацией по 500. */
  async listAll(resourceType, type = null) {
    const path = type ? `resources/${resourceType}/${type}` : `resources/${resourceType}`;
    const out = [];
    let cursor = null;
    do {
      const page = await this.get(path, { max_results: 500, next_cursor: cursor });
      out.push(...(page.resources || []));
      cursor = page.next_cursor || null;
    } while (cursor);
    return out;
  }
}

/**
 * Скачивание одного файла с проверкой: байты против листинга, md5 против
 * ETag ответа (у Cloudinary это md5 содержимого), sha256 — в манифест.
 * Запись через .part + rename: оборванная загрузка не выглядит файлом.
 *
 * @returns {Promise<{ ok: boolean, status: number, bytes?, sha256?, md5?, checks?, error? }>}
 */
export const downloadFile = async (url, destPath, { expectedBytes = null, listingEtag = null, attempts = 3, timeoutMs = 180000 } = {}) => {
  let last = { ok: false, status: 0, error: 'не начато' };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, {}, timeoutMs);
      if (res.status === 404) return { ok: false, status: 404, error: 'HTTP 404' };
      if (!res.ok) {
        last = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        const md5 = createHash('md5').update(buf).digest('hex');
        const sha256 = createHash('sha256').update(buf).digest('hex');
        const httpEtag = (res.headers.get('etag') || '').replace(/^W\//, '').replace(/"/g, '');
        const checks = {
          bytes: expectedBytes == null ? 'нет эталона' : buf.length === expectedBytes ? 'совпал' : `РАСХОЖДЕНИЕ ${buf.length} ≠ ${expectedBytes}`,
          http_etag: /^[0-9a-f]{32}$/i.test(httpEtag) ? (httpEtag.toLowerCase() === md5 ? 'совпал' : 'РАСХОЖДЕНИЕ') : 'нет md5 в ETag',
          listing_etag: listingEtag ? (String(listingEtag).toLowerCase() === md5 ? 'совпал' : 'РАСХОЖДЕНИЕ') : 'нет в листинге',
        };
        const bad = Object.values(checks).some((v) => v.startsWith('РАСХОЖДЕНИЕ'));
        if (!bad || attempt >= attempts) {
          await mkdir(dirname(destPath), { recursive: true });
          await writeFile(`${destPath}.part`, buf);
          await rename(`${destPath}.part`, destPath);
          return { ok: !bad, status: res.status, bytes: buf.length, sha256, md5, checks, error: bad ? 'проверка не сошлась' : null };
        }
        last = { ok: false, status: res.status, error: 'проверка не сошлась', checks };
      }
    } catch (err) {
      last = { ok: false, status: 0, error: err.name === 'AbortError' ? 'таймаут' : err.message };
    }
    await sleep(2000 * attempt);
  }
  return last;
};

/**
 * Ассет, которого нет в листинге, — прямым запросом по public_id без
 * трансформаций (HEAD). Нашёлся — псевдо-ассет для плана скачивания.
 */
export const probeByPublicId = async (cloudName, ref) => {
  const ext = ref.extension === 'pdf' ? '.pdf' : '';
  const url = `https://res.cloudinary.com/${cloudName}/${ref.resourceType}/${ref.deliveryType}/${ref.publicId}${ext}`;
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD' }, 30000);
    if (!res.ok) return { found: false, status: res.status };
    const type = res.headers.get('content-type') || '';
    const format = ext ? 'pdf' : (type.split('/')[1] || '').replace('jpeg', 'jpg');
    return {
      found: true,
      asset: {
        public_id: ref.publicId,
        resource_type: ref.resourceType,
        type: ref.deliveryType,
        format,
        bytes: Number(res.headers.get('content-length')) || null,
        created_at: null,
        secure_url: url,
      },
    };
  } catch (err) {
    return { found: false, status: 0, error: err.message };
  }
};
