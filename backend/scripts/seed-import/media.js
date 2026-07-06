/**
 * Media handling — scan a card's stable-ID folder, and upload each asset to
 * Cloudinary (three resolutions for images, pg_1 derivatives for PDFs).
 *
 * Two upload modes:
 *   - 'real'  → the actual Cloudinary SDK path, reusing backend uploadImage /
 *               uploadPdf (same folder layout + the pg_1 PDF handling), wrapped
 *               here with retry + an explicit timeout (Phase-0 finding: ~4000
 *               uploads make a transient failure near-certain — retry, then
 *               collect-and-continue via the resume machine).
 *   - 'stub'  → deterministic fake URLs, no network. The ENTIRE rest of the
 *               pipeline (scan, limits, MediaModel writes, positions, primary,
 *               OCR enqueue) runs on real code — only the two SDK calls are
 *               swapped, so the dry-run exercises everything but Cloudinary.
 *
 * Folder layout under <media-root>/<stable_id>/:
 *   exterior/  interior/  dishes/  menu/   → image buckets (establishment_media.type)
 *   menu_pdf/                              → PDF menus (type='menu', file_type='pdf')
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import {
  uploadImage, uploadPdf,
  generateAllResolutions, generatePdfThumbnailUrl, generatePdfPreviewUrl,
} from '../../src/config/cloudinary.js';
import {
  MEDIA_TYPES, PDF_SUBFOLDER, IMAGE_EXTENSIONS, IMAGE_MAX_BYTES,
  PDF_MAX_BYTES, PDF_MAX_COUNT, MEDIA_LIMITS,
  E1_MIN_TOTAL_PHOTOS, E1_MIN_EXTERIOR,
} from './contract.js';

const UPLOAD_TIMEOUT_MS = { image: 120000, pdf: 300000 };
const UPLOAD_RETRIES = 3;

/** Sorted, filtered file list for one subfolder (deterministic order). */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Scan a card's media folder into a typed manifest, collecting per-file errors
 * (bad extension, oversize) and structural errors (missing folder, over-limit).
 *
 * @param {string} mediaRoot
 * @param {string} stableId
 * @returns {{ items: Array, errors: string[], counts: object }}
 *   items: [{ relpath, abspath, type, file_type, bytes }]
 */
export function scanMedia(mediaRoot, stableId) {
  const errors = [];
  const items = [];
  const base = join(mediaRoot, stableId);
  const counts = { exterior: 0, interior: 0, dishes: 0, menu: 0, menu_pdf: 0 };

  if (!existsSync(base)) {
    errors.push(`${stableId}: media folder not found (${base})`);
    return { items, errors, counts };
  }

  for (const type of MEDIA_TYPES) {
    for (const abspath of listFiles(join(base, type))) {
      const ext = extname(abspath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) {
        errors.push(`${stableId}/${type}: "${abspath}" not an accepted image (${[...IMAGE_EXTENSIONS].join(',')})`);
        continue;
      }
      const bytes = statSync(abspath).size;
      if (bytes > IMAGE_MAX_BYTES) {
        errors.push(`${stableId}/${type}: "${abspath}" ${(bytes / 1048576).toFixed(1)}MB > 10MB`);
        continue;
      }
      counts[type]++;
      items.push({ relpath: `${type}/${abspath.split(/[\\/]/).pop()}`, abspath, type, file_type: 'image', bytes });
    }
  }

  // PDF menus.
  for (const abspath of listFiles(join(base, PDF_SUBFOLDER))) {
    const ext = extname(abspath).toLowerCase();
    if (ext !== '.pdf') {
      errors.push(`${stableId}/${PDF_SUBFOLDER}: "${abspath}" is not a .pdf`);
      continue;
    }
    const bytes = statSync(abspath).size;
    if (bytes > PDF_MAX_BYTES) {
      errors.push(`${stableId}/${PDF_SUBFOLDER}: "${abspath}" ${(bytes / 1048576).toFixed(1)}MB > 60MB`);
      continue;
    }
    counts.menu_pdf++;
    items.push({ relpath: `${PDF_SUBFOLDER}/${abspath.split(/[\\/]/).pop()}`, abspath, type: 'menu', file_type: 'pdf', bytes });
  }

  // Bucket limits.
  if (counts.interior > MEDIA_LIMITS.interior) errors.push(`${stableId}: ${counts.interior} interior photos > ${MEDIA_LIMITS.interior}`);
  if (counts.menu > MEDIA_LIMITS.menu) errors.push(`${stableId}: ${counts.menu} menu photos > ${MEDIA_LIMITS.menu}`);
  if (counts.menu_pdf > PDF_MAX_COUNT) errors.push(`${stableId}: ${counts.menu_pdf} menu PDFs > ${PDF_MAX_COUNT}`);

  return { items, errors, counts };
}

/**
 * CAT-E-2.3 publication minimum for a scanned card. Returns an array of unmet
 * requirements (empty = passes). Media-side only; description length is checked
 * in sheet normalization.
 */
export function checkE1(counts) {
  const unmet = [];
  const totalPhotos = counts.exterior + counts.interior + counts.dishes + counts.menu;
  const menuSources = counts.menu + counts.menu_pdf;
  if (totalPhotos < E1_MIN_TOTAL_PHOTOS) unmet.push(`${totalPhotos} photos < ${E1_MIN_TOTAL_PHOTOS}`);
  if (counts.exterior < E1_MIN_EXTERIOR) unmet.push(`${counts.exterior} exterior < ${E1_MIN_EXTERIOR}`);
  if (menuSources < 1) unmet.push('no menu source (photo or PDF)');
  return unmet;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Promise.race timeout wrapper — the SDK's own timeout is not always honoured. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`upload timeout after ${ms}ms: ${label}`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Upload one media item, returning the establishment_media-ready shape.
 * Retries transient failures with exponential backoff.
 *
 * @param {object} item - from scanMedia
 * @param {string} establishmentId
 * @param {'real'|'stub'} mode
 * @returns {Promise<{ public_id, type, file_type, url, preview_url, thumbnail_url }>}
 */
export async function uploadMedia(item, establishmentId, mode) {
  if (mode === 'stub') return stubUpload(item, establishmentId);

  const isPdf = item.file_type === 'pdf';
  const timeoutMs = isPdf ? UPLOAD_TIMEOUT_MS.pdf : UPLOAD_TIMEOUT_MS.image;
  let lastErr;
  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
    try {
      if (isPdf) {
        const res = await withTimeout(uploadPdf(item.abspath, establishmentId), timeoutMs, item.relpath);
        return {
          public_id: res.public_id, type: 'menu', file_type: 'pdf',
          url: res.secure_url,
          preview_url: generatePdfPreviewUrl(res.public_id),
          thumbnail_url: generatePdfThumbnailUrl(res.public_id),
        };
      }
      const res = await withTimeout(uploadImage(item.abspath, establishmentId, item.type), timeoutMs, item.relpath);
      const urls = generateAllResolutions(res.public_id);
      return { public_id: res.public_id, type: item.type, file_type: 'image', ...urls };
    } catch (e) {
      lastErr = e;
      if (attempt < UPLOAD_RETRIES) await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s
    }
  }
  throw new Error(`upload failed after ${UPLOAD_RETRIES} attempts (${item.relpath}): ${lastErr.message}`);
}

/** Deterministic fake upload result — no network. public_id encodes the source. */
function stubUpload(item, establishmentId) {
  const safe = item.relpath.replace(/[^a-z0-9]+/gi, '_');
  const publicId = `dryrun/establishments/${establishmentId}/${safe}`;
  const base = `https://res.cloudinary.com/dryrun/image/upload/${publicId}`;
  return {
    public_id: publicId, type: item.type, file_type: item.file_type,
    url: `${base}.${item.file_type === 'pdf' ? 'pdf' : 'jpg'}`,
    preview_url: `${base}_preview.jpg`,
    thumbnail_url: `${base}_thumb.jpg`,
  };
}
