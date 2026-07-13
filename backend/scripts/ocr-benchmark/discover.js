/**
 * Photo discovery — two input modes, combinable (the harness must run both
 * before the final CSV/folder assembly exists and after):
 *
 *   --media-root=<dir>  seed-import media contract: <root>/<stable_id>/menu/*
 *                       (exactly the files the importer enqueues for OCR)
 *   --photos=<dir>      flat folder of images — pre-contract mode for early
 *                       smoke runs on loose menu photos
 *
 * One photo = one benchmark unit. This mirrors production granularity: the
 * pipeline enqueues one ocr_job per menu media (seed-import pipeline.js
 * ensureOcr / mediaService), so a multi-photo menu is processed photo-by-photo
 * in production too. PDF menus are out of scope — the benchmark targets the
 * vision-OCR path, not the pdf-parse text layer.
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { join, extname, basename } from 'path';
import { IMAGE_EXTENSIONS, IMAGE_MAX_BYTES } from '../seed-import/contract.js';

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Sorted, dot-filtered file list (deterministic order, matches seed-import). */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .sort()
    .map((f) => join(dir, f));
}

/** Classify one file; push to units or warnings. */
function collectFile(abspath, unitId, units, warnings) {
  const ext = extname(abspath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    warnings.push(`skipped (not an accepted image): ${unitId}`);
    return;
  }
  const bytes = statSync(abspath).size;
  if (bytes > IMAGE_MAX_BYTES) {
    warnings.push(`skipped (>10MB — would not pass import either): ${unitId}`);
    return;
  }
  units.push({ id: unitId, abspath, bytes, mime: MIME_BY_EXT[ext] });
}

/**
 * Discover benchmark units from the given roots.
 *
 * @param {{ mediaRoot?: string, photosDir?: string }} opts
 * @returns {{ units: Array<{id, abspath, bytes, mime}>, warnings: string[] }}
 *   id: "<stable_id>/<filename>" (media-root mode) or "<filename>" (flat mode)
 */
export function discoverPhotos({ mediaRoot, photosDir }) {
  const units = [];
  const warnings = [];

  if (mediaRoot) {
    const stableIds = readdirSync(mediaRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const stableId of stableIds) {
      const menuDir = join(mediaRoot, stableId, 'menu');
      const files = listFiles(menuDir);
      if (files.length === 0) {
        warnings.push(`${stableId}: no menu/ photos — nothing to benchmark for this card`);
        continue;
      }
      for (const abspath of files) {
        collectFile(abspath, `${stableId}/${basename(abspath)}`, units, warnings);
      }
    }
  }

  if (photosDir) {
    for (const abspath of listFiles(photosDir)) {
      collectFile(abspath, basename(abspath), units, warnings);
    }
  }

  return { units, warnings };
}
