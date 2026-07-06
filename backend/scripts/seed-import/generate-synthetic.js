/**
 * Synthetic sheet + media generator for the dry-run (NOT part of a real import).
 *
 * Emits a master CSV + stable-ID media folders of placeholder files under an
 * output directory, with a realistic distribution (Minsk-weighted, all 15
 * categories / 12 cuisines, hours patterns incl. a 24h class and overnight,
 * canon-10 attributes, photo counts around the E1 border) and an optional broken
 * subset for the brick-1 class→catcher matrix.
 *
 * Every synthetic card name carries a [DRYRUN] marker for guaranteed cleanup.
 * Media files are content-agnostic placeholders — the scan checks extension +
 * size only, and the dry-run uploads in stub mode (no bytes read).
 *
 * Usage: node scripts/seed-import/generate-synthetic.js --count=500 --out=<dir> [--broken-pct=5]
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  VALID_CATEGORIES, VALID_CUISINES, ATTRIBUTE_CANON, ATTRIBUTE_COLUMNS,
  VALID_CITIES, HOURS_COLUMNS, ALL_COLUMNS,
} from './contract.js';

const CITY_WEIGHTS = [ // Minsk-heavy
  ['Минск', 0.55], ['Гомель', 0.09], ['Гродно', 0.08], ['Брест', 0.08],
  ['Витебск', 0.08], ['Могилёв', 0.07], ['Бобруйск', 0.05],
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function weightedCity() {
  let r = Math.random();
  for (const [c, w] of CITY_WEIGHTS) { if ((r -= w) <= 0) return c; }
  return 'Минск';
}
function citySlug(city) {
  const map = { 'Минск': 'minsk', 'Гомель': 'gomel', 'Гродно': 'grodno', 'Брест': 'brest', 'Витебск': 'vitebsk', 'Могилёв': 'mogilev', 'Бобруйск': 'bobruisk' };
  return map[city] || 'x';
}

const HOURS_PATTERNS = [
  '10:00-22:00', '09:00-21:00', '11:00-23:00', '08:00-20:00',
  '00:00-23:59', // 24h class
  '18:00-02:00', // overnight
];

function genHours() {
  const base = pick(HOURS_PATTERNS);
  const row = {};
  for (let d = 0; d < HOURS_COLUMNS.length; d++) {
    row[HOURS_COLUMNS[d]] = (d === 6 && Math.random() < 0.3) ? 'выходной' : base;
  }
  return row;
}

function genAttributes() {
  const row = {};
  const n = 2 + Math.floor(Math.random() * 5); // 2-6 attributes
  const shuffled = [...ATTRIBUTE_CANON].sort(() => Math.random() - 0.5).slice(0, n);
  for (const col of ATTRIBUTE_COLUMNS) row[col] = shuffled.includes(col.slice(5)) ? '1' : '';
  return row;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function writePlaceholders(baseDir, subdir, count) {
  if (count <= 0) return;
  const dir = join(baseDir, subdir);
  mkdirSync(dir, { recursive: true });
  const ext = subdir === 'menu_pdf' ? 'pdf' : 'jpg';
  for (let i = 1; i <= count; i++) writeFileSync(join(dir, `${String(i).padStart(2, '0')}.${ext}`), 'placeholder');
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
  }));
  const count = parseInt(args.count || '500', 10);
  const outDir = args.out;
  const brokenPct = parseFloat(args['broken-pct'] || '5');
  if (!outDir) { console.error('--out=<dir> required'); process.exit(1); }

  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  const mediaRoot = join(outDir, 'media');
  mkdirSync(mediaRoot, { recursive: true });

  const rows = [];
  const brokenEvery = brokenPct > 0 ? Math.round(100 / brokenPct) : Infinity;
  let brokenCount = 0;

  for (let i = 1; i <= count; i++) {
    const city = weightedCity();
    const stableId = `${citySlug(city)}-${String(i).padStart(4, '0')}`;
    const isBroken = i % brokenEvery === 0;
    if (isBroken) brokenCount++;

    const cats = [pick(VALID_CATEGORIES)];
    if (Math.random() < 0.3) cats.push(pick(VALID_CATEGORIES.filter((c) => c !== cats[0])));
    const cuis = [pick(VALID_CUISINES)];
    if (Math.random() < 0.4) cuis.push(pick(VALID_CUISINES.filter((c) => c !== cuis[0])));

    const row = {
      stable_id: stableId,
      name: `[DRYRUN] ${city} заведение ${i}`,
      city,
      address: `ул. Тестовая ${i}`,
      latitude: '', longitude: '', // force geocode path? no — dry-run disables geocode; provide coords
      categories: cats.join('|'),
      cuisines: cuis.join('|'),
      price_range: pick(['$', '$$', '$$$', '']),
      description: 'Синтетическое описание для dry-run. '.repeat(6).slice(0, 140 + (i % 40)),
      phone: Math.random() < 0.8 ? `+37529${String(1000000 + i).slice(-7)}` : '',
      email: '', website: '',
      ...genHours(),
      ...genAttributes(),
    };
    // Provide in-bounds coords so geocode stays dormant (dry-run).
    const centers = { 'Минск': [53.90, 27.55], 'Гомель': [52.44, 30.98], 'Гродно': [53.66, 23.81], 'Брест': [52.09, 23.73], 'Витебск': [55.19, 30.20], 'Могилёв': [53.90, 30.30], 'Бобруйск': [53.13, 29.22] };
    const [clat, clon] = centers[city];
    row.latitude = (clat + (Math.random() - 0.5) * 0.02).toFixed(6);
    row.longitude = (clon + (Math.random() - 0.5) * 0.02).toFixed(6);

    // Media: healthy = 5-9 photos incl. exterior + menu; broken = missing menu / empty.
    if (isBroken) {
      const brokenKind = brokenCount % 2;
      if (brokenKind === 0) {
        // empty media folder (create the stable-id dir only)
        mkdirSync(join(mediaRoot, stableId), { recursive: true });
      } else {
        // no menu source: exterior + interior, but no menu/menu_pdf
        writePlaceholders(join(mediaRoot, stableId), 'exterior', 1);
        writePlaceholders(join(mediaRoot, stableId), 'interior', 4);
      }
      // Also blank the price on some broken rows (valid but null-price class).
      row.price_range = '';
    } else {
      writePlaceholders(join(mediaRoot, stableId), 'exterior', 1 + (i % 2));
      writePlaceholders(join(mediaRoot, stableId), 'interior', 2 + (i % 3));
      writePlaceholders(join(mediaRoot, stableId), 'menu', 1 + (i % 2));
      if (i % 5 === 0) writePlaceholders(join(mediaRoot, stableId), 'dishes', 2);
      if (i % 7 === 0) writePlaceholders(join(mediaRoot, stableId), 'menu_pdf', 1);
    }
    rows.push(row);
  }

  // Emit CSV with the exact contract header order.
  const header = ALL_COLUMNS.join(',');
  const body = rows.map((r) => ALL_COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\n');
  const sheetPath = join(outDir, 'sheet.csv');
  writeFileSync(sheetPath, `${header}\n${body}\n`, 'utf8');

  console.log(JSON.stringify({ count, broken: brokenCount, sheet: sheetPath, mediaRoot }, null, 2));
}

main();
