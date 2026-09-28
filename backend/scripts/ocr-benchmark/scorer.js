/**
 * Ground-truth scorer for the OCR benchmark (DIRECTIVE_gt_scorer, CLI Trunk
 * 2026-07-28; built 2026-09-28 for the OCR model swap).
 *
 * Stitches ANY harness run (results.json) to the human-verified rows of the
 * ground truth (runs/2026-07-27_163128/ground-truth.json: 509 rows, 480 of
 * them scored) and reports name / price / category accuracy together with
 * the quality of the stitching itself.
 *
 * Why stitching by name and not by idx: idx is a position in the frozen
 * 2026-07-27 run of google/gemini-2.5-flash. It stops meaning anything
 * exactly when something changes — another model splits «американо S/M/L»
 * into three items, reads a two-column menu column-wise, drops a line.
 * Names are the most stable field (98.8 % in the baseline).
 *
 * Anti-Goodhart: a human row the run did not produce is LOST and counts as a
 * miss on every field — it never silently leaves the denominator, so a run
 * that drops half the menu reads as worse, not as «95 % on the survivors».
 * An item the run produced without a human row is ADDED: shown, never
 * scored — the ground truth cannot tell a legit extra line from an invented
 * one; that is the Coordinator's visual pass over the dumps.
 *
 * Pure functions only — file I/O and the CLI live in score.js.
 */

// ── The July rules (score-gt.py, 2026-07-28), ported verbatim ────────────────
// They define the baseline the scorer must reproduce exactly (474 / 409 / 363
// / 332 of 480 on the frozen run). Do not soften them: two of the six baseline
// name misses differ from the human name only by a comma or a trailing period,
// so a punctuation-blind name rule moves the anchor to 476.

const WS_RE = /\s+/g;
const SIZE_RE = /\s+[SML](?:\s*\/\s*[SML])*\s*$/i;
// What Python's float() accepted in score-gt.py, minus exotica (inf, nan, _,
// fullwidth digits). Known divergences, none present in the July truth
// (checked on all 757 names / 109 prices / 137 categories): Python rounds
// half-to-even on the binary value (round(5.125, 2) = 5.12, here 5.13);
// BOM (U+FEFF) and NEL (U+0085) count as whitespace on different sides.
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

const round2 = (x) => Math.round(x * 100) / 100;

/** Human name may carry size suffixes («эспрессо S», «какао S/M/L»). */
export function normName(s) {
  return String(s ?? '').trim().toLowerCase().replace(WS_RE, ' ').replace(SIZE_RE, '').trim();
}

/**
 * Human price is a string («5.5 / 8.5 / 9», «+2», «4.10», «—», «»); the run
 * gives a number or null. Multi-size price → first token; «+2» → 2;
 * «7.10» == 7.1; «—», «-» and «» are empty (null). A non-number stays a raw
 * token, equal only to the same raw token.
 */
export function normPrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : `RAW:${v}`;
  const s = String(v).trim().replace(/,/g, '.');
  if (s === '' || s === '—' || s === '-') return null;
  // lstrip('+') then float(), which tolerated surrounding spaces: «++2», «+ 2» → 2.
  const first = s.split('/')[0].trim().replace(/^\++/, '').trim();
  return NUMBER_RE.test(first) ? round2(Number(first)) : `RAW:${first}`;
}

/** Case-insensitive, whitespace and line breaks collapsed; «—» and «» are one empty category. */
export function normCat(s) {
  const t = String(s ?? '').trim().toLowerCase().replace(WS_RE, ' ');
  return t === '—' || t === '-' ? '' : t;
}

// ── Stitching key (not a scoring rule) ──────────────────────────────────────
// Looser than normName on purpose: it decides WHICH human row an item is, not
// whether the item is right. Observed differences between models on the same
// photo (July run, 5 models): «Капучино (M)» vs «капучино S/M/L», «альт.
// молоко (150|200|250 г)» vs «альт, молоко (150/200/250 г)», and look-alike
// letters — the human row «ΛΑΤΤΕ» is Greek (so gemini-2.5-flash read the
// stylised font, and the eye cannot tell), gemini-3.1-flash-lite reads
// Cyrillic «ЛАТТЕ».

const PAREN_SIZE_RE = /\s*\(\s*[smlм](?:\s*[/|,]\s*[smlм])*\s*\)\s*$/; // «(s)», «(m/l)»
const BARE_SIZE_RE = /\s+[smlм](?:\s*[/|,]\s*[smlм])*\s*$/; // « s», « m/l»

// Latin and Greek letters that look like Cyrillic ones, folded AFTER
// lowercasing — hence b→в (B/В), h→н (H/Н), t→т (T/Т): the capitals are the
// look-alikes. Applied to both sides, so equal strings stay equal.
const LOOKALIKE = new Map(Object.entries({
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', i: 'и', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
  α: 'а', β: 'в', γ: 'г', ε: 'е', η: 'н', ι: 'и', κ: 'к', λ: 'л', μ: 'м', ο: 'о', π: 'п', ρ: 'р',
  τ: 'т', υ: 'у', φ: 'ф', χ: 'х',
  ё: 'е', і: 'и', ў: 'у',
}));

// A volume / weight / count tail: «40 мл», «250 МЛ» in Greek «ΜΛ», «0,5 л»,
// «(150/200/250 г)», «1шт / 3шт», «125мл». The frozen model often kept it in
// the name and the human kept that; another model may drop it (IMG_6435:
// «ЭСПРЕСCO 40 ΜΛ» vs «ЭСПРЕССО», same line, same price).
const QTY = String.raw`\d+(?:[.,]\d+)?(?:\s*[/|]\s*\d+(?:[.,]\d+)?)*\s*(?:мл|ml|μλ|л|l|гр|г|g|кг|kg|штук|шт|см|cm|cl)\.?`;
const QTY_TAIL_RE = new RegExp(String.raw`(?:[\s/|,(]*${QTY}\s*\)?)+\s*$`, 'u');

/**
 * Stitching key: case, ё, punctuation, size suffixes and look-alike letters
 * do not count. `dropQuantity` also cuts a volume/weight/count tail — used
 * only after the exact passes failed, because a volume is what tells
 * «Пиво 0,5 л» from «Пиво 0,3 л».
 */
export function pairKey(s, { dropQuantity = false } = {}) {
  let t = String(s ?? '').normalize('NFKC').toLowerCase().trim();
  t = t.replace(PAREN_SIZE_RE, '').replace(BARE_SIZE_RE, '');
  if (dropQuantity) t = t.replace(QTY_TAIL_RE, '');
  t = Array.from(t, (ch) => LOOKALIKE.get(ch) ?? ch).join('');
  return t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Levenshtein distance over code points. */
export function levenshtein(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** Lenient pass admits a pair at this similarity or above. */
export const LENIENT_MIN = 0.8;
/** One key is the word-prefix of the other («БАТАТ ФРИ» / «БАТАТ ФРИ с фирменным соусом»). */
const PREFIX_SCORE = 0.85;
/** Keys equal once a volume/weight/count tail is cut («ЭСПРЕСCO 40 ΜΛ» / «ЭСПРЕССО»). */
const QUANTITY_SCORE = 0.95;
const PREFIX_MIN_WORDS = 2;

/**
 * Similarity of two stitching keys in [0, 1]: 1 − edit distance / longer
 * length, raised to PREFIX_SCORE when the shorter key (two words or more) is
 * a word-prefix of the longer — a model that drops the description tail of a
 * dish name is still naming the same dish.
 */
export function keySimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const lev = 1 - levenshtein(a, b) / Math.max(Array.from(a).length, Array.from(b).length);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const sw = short.split(' ');
  const lw = long.split(' ');
  const prefix = sw.length >= PREFIX_MIN_WORDS && sw.every((w, k) => lw[k] === w);
  return Math.max(lev, prefix ? PREFIX_SCORE : 0);
}

/**
 * Pair the members of one same-key group — rows and items that share a
 * stitching key («Семга собственного посола» ×3 on IMG_6309, «С говядиной»
 * at 4 and at 4.4 on IMG_6316). Which one is which cannot be known from the
 * name, and must NOT be decided by price or category: those are the scored
 * fields, pairing by them would grade the run by its own answers.
 *
 * - As many items as rows, or MORE: in order. Equal sizes keep the frozen
 *   run 1:1. More items is what a model that splits sizes produces —
 *   «американо (S)», «(M)», «(L)» for the one row «американо S/M/L» — and
 *   the July rule compares the FIRST price, which the first item carries.
 * - FEWER items (the run dropped a twin): order-preserving matching by
 *   relative position in the photo (item i of n at (i+½)/n, row j of m at
 *   (j+½)/m) with the least total distance, so the remaining twin goes to
 *   the nearest row instead of «the first free one» — dropping an item
 *   cannot shift its twin onto a better-scoring row (review 2026-09-28).
 *   Ties go to the earlier row.
 *
 * @returns {Array<[number, number]>} [item, row] pairs
 */
function assignGroup(its, rs, nItems, nRows) {
  if (its.length >= rs.length) return rs.map((j, t) => [its[t], j]);
  const pos = { item: (i) => (i + 0.5) / nItems, row: (j) => (j + 0.5) / nRows };
  const [A, B] = [its, rs];
  const cost = (a, b) => Math.abs(pos.item(a) - pos.row(b));
  const dp = Array.from({ length: A.length + 1 }, (_, x) => new Array(B.length + 1).fill(x === 0 ? 0 : Infinity));
  for (let x = 1; x <= A.length; x++) {
    for (let y = x; y <= B.length; y++) {
      dp[x][y] = Math.min(dp[x][y - 1], dp[x - 1][y - 1] + cost(A[x - 1], B[y - 1]));
    }
  }
  const pairs = [];
  for (let x = A.length, y = B.length; x > 0;) {
    if (y > x && dp[x][y - 1] <= dp[x - 1][y - 1] + cost(A[x - 1], B[y - 1])) {
      y--;
      continue;
    }
    pairs.push([A[x - 1], B[y - 1]]);
    x--;
    y--;
  }
  return pairs.reverse();
}

/**
 * Stitch one photo: which run item is which human row.
 *
 * Four passes, deterministic:
 *   1. key of the row's `model` name — the frozen reading of the same photo.
 *      On the frozen run it pairs every item with its own row 1:1, which is
 *      what makes the baseline reproducible.
 *   2. key of the row's `human` name — a model that reads better than the
 *      frozen one.
 *   3. the same keys without a volume/weight/count tail (QUANTITY_SCORE,
 *      counted with the lenient pairs and listed for the eye).
 *   4. lenient: remaining items × remaining rows of the SAME photo with
 *      similarity ≥ LENIENT_MIN, best first (ties: row order, then item order).
 * Within passes 1–3 rows and items sharing one key are paired by assignGroup
 * and marked `ambiguous` — the report lists them for the eye.
 *
 * @param {Array<{idx:number, model:{name:string}, human:{name:string}}>} rows
 * @param {Array<{item_name:string}>} items
 * @returns {{ rowMatch: Array<null|{item:number, via:string, score:number, ambiguous?:boolean, quantity?:boolean}>, itemMatch: number[] }}
 *   rowMatch[j] — the item stitched to row j; itemMatch[i] — the row of item i, or −1
 */
export function stitchPhoto(rows, items) {
  const noQty = { dropQuantity: true };
  const rowKeys = rows.map((r) => ({
    model: pairKey(r.model?.name),
    human: pairKey(r.human?.name),
    modelQty: pairKey(r.model?.name, noQty),
    humanQty: pairKey(r.human?.name, noQty),
  }));
  const itemKeys = items.map((it) => pairKey(it.item_name));
  const itemQtyKeys = items.map((it) => pairKey(it.item_name, noQty));
  const rowMatch = rows.map(() => null);
  const itemMatch = items.map(() => -1);

  const exactPass = (keyOfItem, rowHas, mark) => {
    const groups = new Map();
    items.forEach((_, i) => {
      if (itemMatch[i] !== -1 || !keyOfItem[i]) return;
      if (!groups.has(keyOfItem[i])) groups.set(keyOfItem[i], []);
      groups.get(keyOfItem[i]).push(i);
    });
    for (const [key, its] of groups) {
      const rs = [];
      rowKeys.forEach((k, j) => {
        if (rowMatch[j] === null && rowHas(k, key)) rs.push(j);
      });
      if (rs.length === 0) continue;
      const ambiguous = its.length > 1 || rs.length > 1;
      for (const [i, j] of assignGroup(its, rs, items.length, rows.length)) {
        rowMatch[j] = { item: i, ...mark, ambiguous };
        itemMatch[i] = j;
      }
    }
  };
  exactPass(itemKeys, (k, key) => k.model === key, { via: 'exact-model', score: 1 });
  exactPass(itemKeys, (k, key) => k.human === key, { via: 'exact-human', score: 1 });
  exactPass(itemQtyKeys, (k, key) => k.modelQty === key || k.humanQty === key, { via: 'lenient', score: QUANTITY_SCORE, quantity: true });

  const candidates = [];
  for (let i = 0; i < items.length; i++) {
    if (itemMatch[i] !== -1 || !itemKeys[i]) continue;
    for (let j = 0; j < rows.length; j++) {
      if (rowMatch[j] !== null) continue;
      const score = Math.max(
        keySimilarity(itemKeys[i], rowKeys[j].human),
        keySimilarity(itemKeys[i], rowKeys[j].model),
      );
      if (score >= LENIENT_MIN) candidates.push({ i, j, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.j - b.j || a.i - b.i);
  for (const { i, j, score } of candidates) {
    if (itemMatch[i] !== -1 || rowMatch[j] !== null) continue;
    rowMatch[j] = { item: i, via: 'lenient', score };
    itemMatch[i] = j;
  }

  return { rowMatch, itemMatch };
}

// ── Exclusions ───────────────────────────────────────────────────────────────
// Keyed by the ground truth's own `run` field, so another ground-truth file
// never inherits them. July excluded these rows by index (IMG_6308, idx ≥ 14);
// under name stitching they are a named list. Excluded rows still take part
// in stitching — a run item that matches one is absorbed, neither scored nor
// shown as added.

export const EXCLUSIONS = {
  '2026-07-27_163128': {
    'IMG_6308.jpg': {
      reason: 'обрезок соседнего меню завтраков на фото с пиццей — Координатор не проверял (заметка эталона)',
      names: [
        'Шакшука с сыром Фета', 'Пашот под Голландским', 'Скрэмбл на сливочном м',
        'Японский омлет Тамагоя', 'Глазунья с фермерским п', 'По-турецки с говядиной',
        'По-гречески с овощной и', 'Домашние колбаски на гра', 'Бекон гриль со специями и',
        'Ростбиф с соусом Голланде', 'Домашние нагетсы из цыпл', 'Семга собственного посолс',
        'Фермерский прошутто с гри', 'Домашний террин из печени', 'Маффин с котлетой из говяди',
        'Крем гуакамоле', 'Икра из печеных овощей с сыр', 'Хумус с миксом из свежих овош',
        'Оладьи из цукини с соусом Кре', 'Салат со свежими овощами в м', 'Картофель Фри с соусом Дзадз',
        'Картофельные оладьи с соусом', 'Картофель по-деревенски с соу', 'Овсяная с беконом и сыром Пармезан',
        'Сырники со сметаной и соусом из', 'Блинчики с творожным кремом и ав',
        'Обжаренная гранола с греческим джемом', 'Мороженое с шоколадным соусом и', 'ИГРИСТОЕ к завтраку',
      ],
    },
  },
};

// ── Scoring ──────────────────────────────────────────────────────────────────

const pct = (ok, total) => (total > 0 ? (ok / total) * 100 : null);
const metric = (ok, total) => ({ ok, total, pct: pct(ok, total) });
const priceText = (v) => (v == null ? '—' : String(v));

/**
 * Score one model of one run against the ground truth.
 *
 * Denominator = human rows that are neither excluded nor flagged
 * not_on_photo (480 for the July truth). A lost row is a miss on every field.
 * `missed_items` (lines the human added because the frozen model skipped
 * them) are reported apart, outside the denominator — as in July — and are
 * not stitched: their text is the human's free prose.
 *
 * @param {object} args
 * @param {object} args.gt - parsed ground-truth.json
 * @param {object[]} args.results - parsed results.json (all models of the run)
 * @param {string} args.model - the `model` label to score (as written in results.json)
 * @param {object} [args.exclusions] - defaults to EXCLUSIONS[gt.run]
 */
export function scoreModel({ gt, results, model, exclusions = EXCLUSIONS[gt.run] || {} }) {
  const mine = results.filter((r) => r.model === model);
  const byUnit = new Map(mine.map((r) => [r.unitId, r]));

  const acc = { name: 0, nameLenient: 0, price: 0, category: 0, allThree: 0 };
  const stitching = { exactModel: 0, exactHuman: 0, lenient: 0, ambiguous: 0, lost: 0, added: 0, absorbedByExclusion: 0 };
  const lists = {
    lenientPairs: [], ambiguousPairs: [], lostRows: [], addedItems: [],
    nameMismatches: [], priceMismatches: [], categoryMismatches: [], confirmedHallucinations: [],
  };
  const perPhoto = [];
  let scored = 0;
  let excludedRows = 0;
  let notOnPhotoRows = 0;
  let hallucinationsConfirmed = 0;

  for (const [unit, photo] of Object.entries(gt.photos).sort(([a], [b]) => a.localeCompare(b))) {
    const res = byUnit.get(unit);
    const items = res && !res.error ? res.items : [];
    const excludedNames = new Set((exclusions[unit]?.names || []).map((n) => n.trim()));
    const { rowMatch, itemMatch } = stitchPhoto(photo.rows, items);
    const ph = { unit, rows: 0, stitched: 0, lost: 0, added: 0, name: 0, price: 0, category: 0, error: res?.error || (res ? null : 'нет в прогоне') };

    photo.rows.forEach((row, j) => {
      const m = rowMatch[j];
      const item = m ? items[m.item] : null;
      if (excludedNames.has(String(row.human?.name ?? '').trim())) {
        excludedRows++;
        if (m) stitching.absorbedByExclusion++;
        return;
      }
      if (row.not_on_photo) {
        notOnPhotoRows++;
        if (m) {
          hallucinationsConfirmed++;
          lists.confirmedHallucinations.push({ unit, name: item.item_name });
        }
        return;
      }
      scored++;
      ph.rows++;
      const h = row.human;
      if (!m) {
        stitching.lost++;
        ph.lost++;
        lists.lostRows.push({ unit, name: h.name, price: h.price, cat: h.cat });
        return;
      }
      ph.stitched++;
      if (m.via === 'exact-model') stitching.exactModel++;
      else if (m.via === 'exact-human') stitching.exactHuman++;
      else {
        stitching.lenient++;
        lists.lenientPairs.push({
          unit, run: item.item_name, human: h.name, score: Math.round(m.score * 1000) / 1000, ...(m.quantity && { quantity: true }),
        });
      }
      if (m.ambiguous) {
        stitching.ambiguous++;
        lists.ambiguousPairs.push({
          unit,
          run: item.item_name, runPrice: priceText(item.price_byn), runCat: item.category_raw ?? '—',
          human: h.name, humanPrice: h.price, humanCat: h.cat,
        });
      }
      const nameOk = normName(item.item_name) === normName(h.name);
      const nameLenientOk = pairKey(item.item_name, { dropQuantity: true }) === pairKey(h.name, { dropQuantity: true });
      const priceOk = normPrice(item.price_byn) === normPrice(h.price);
      const catOk = normCat(item.category_raw) === normCat(h.cat);
      acc.name += nameOk;
      acc.nameLenient += nameLenientOk;
      acc.price += priceOk;
      acc.category += catOk;
      acc.allThree += nameOk && priceOk && catOk;
      ph.name += nameOk;
      ph.price += priceOk;
      ph.category += catOk;
      if (!nameOk) lists.nameMismatches.push({ unit, run: item.item_name, human: h.name });
      if (!priceOk) lists.priceMismatches.push({ unit, name: h.name, run: priceText(item.price_byn), human: h.price });
      if (!catOk) lists.categoryMismatches.push({ unit, name: h.name, run: item.category_raw ?? '—', human: h.cat });
    });

    items.forEach((it, i) => {
      if (itemMatch[i] !== -1) return;
      stitching.added++;
      ph.added++;
      lists.addedItems.push({ unit, name: it.item_name, price: priceText(it.price_byn), cat: it.category_raw ?? '—' });
    });
    perPhoto.push(ph);
  }

  const gtUnits = new Set(Object.keys(gt.photos));
  const reasoningOf = (u) => u?.completion_tokens_details?.reasoning_tokens || 0;
  const costs = mine.map((r) => r.metrics?.costUsd).filter((c) => typeof c === 'number');
  // Runs made before 2026-09-28 did not record attempts — unknown, not zero.
  const attemptsKnown = mine.some((r) => r.vision?.attempts != null);
  const extra = (n) => Math.max(0, (n || 1) - 1);
  const run = {
    photos: mine.length,
    photosMatched: mine.filter((r) => gtUnits.has(r.unitId)).length,
    photosOutsideGroundTruth: mine.filter((r) => !gtUnits.has(r.unitId)).map((r) => r.unitId),
    items: mine.reduce((a, r) => a + (r.error ? 0 : r.items.length), 0),
    errors: mine.filter((r) => r.error).map((r) => ({ unit: r.unitId, error: r.error })),
    jsonFails: mine.filter((r) => !r.error && (r.structurer?.parseOk === false || r.structurer?.zodOk === false)).length,
    costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    reasoningTokens: mine.reduce((a, r) => a + reasoningOf(r.vision?.usage) + reasoningOf(r.structurer?.usage), 0),
    retries: attemptsKnown
      ? mine.reduce((a, r) => a + extra(r.vision?.attempts) + extra(r.structurer?.attempts), 0)
      : null,
  };

  return {
    model,
    run,
    stitching: { ...stitching, stitched: stitching.exactModel + stitching.exactHuman + stitching.lenient },
    scoredRows: scored,
    excludedRows,
    notOnPhotoRows,
    hallucinationsConfirmed,
    accuracy: {
      name: metric(acc.name, scored),
      nameLenient: metric(acc.nameLenient, scored),
      price: metric(acc.price, scored),
      category: metric(acc.category, scored),
      allThree: metric(acc.allThree, scored),
    },
    perPhoto,
    lists,
  };
}

/** Ground-truth facts shown once per report: size, exclusions, missed_items, notes (verbatim). */
export function describeGroundTruth(gt, exclusions = EXCLUSIONS[gt.run] || {}) {
  const photos = Object.entries(gt.photos);
  return {
    run: gt.run,
    model: gt.model,
    exportedAt: gt.exported_at,
    photos: photos.length,
    rows: photos.reduce((a, [, p]) => a + p.rows.length, 0),
    exclusions: Object.entries(exclusions).map(([unit, e]) => ({ unit, reason: e.reason, listed: e.names.length })),
    missedItems: photos.flatMap(([unit, p]) => (p.missed_items || []).map((m) => ({ unit, ...m }))),
    notes: photos.filter(([, p]) => p.note).map(([unit, p]) => ({ unit, note: p.note })),
  };
}

// ── Markdown (Russian: the Coordinator reads it) ─────────────────────────────

const fmtPct = (m) => (m.pct == null ? '—' : `${m.pct.toFixed(1).replace('.', ',')} %`);
const fmtMetric = (m) => `${m.ok}/${m.total} = ${fmtPct(m)}`;
const fmtUsd = (v) => (v == null ? '—' : `$${v.toFixed(4)}`);
const cell = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ⏎ ').replace(/\|/g, '\\|');
const LIST_CAP = 60;

function pushList(lines, title, arr, fmt) {
  lines.push(`**${title}** — ${arr.length}`);
  if (arr.length === 0) {
    lines.push('');
    return;
  }
  lines.push('');
  for (const x of arr.slice(0, LIST_CAP)) lines.push(`- ${fmt(x)}`);
  if (arr.length > LIST_CAP) lines.push(`- … ещё ${arr.length - LIST_CAP} — полный список в JSON`);
  lines.push('');
}

/**
 * @param {object} meta - { gtPath, gt: describeGroundTruth(...), runs: [{dir, runId}], generatedAt }
 * @param {object[]} scores - scoreModel(...) results, each with a `label`
 */
export function buildScoreMarkdown(meta, scores) {
  const L = [];
  L.push(`# Оценка по эталону — ${meta.generatedAt}`);
  L.push('');
  L.push(`Эталон: \`${meta.gtPath}\` (прогон ${meta.gt.run}, модель эталона \`${meta.gt.model}\`, выгружен ${meta.gt.exportedAt}).`);
  L.push(`Прогоны: ${meta.runs.map((r) => `\`${r.dir}\``).join(', ')}`);
  L.push('');
  const s0 = scores[0];
  if (s0) {
    L.push(`Строк эталона: ${meta.gt.rows} на ${meta.gt.photos} фото; к оценке **${s0.scoredRows}** (исключено ${s0.excludedRows}, не с фото ${s0.notOnPhotoRows}).`);
  }
  L.push('Сшивка — по имени внутри фото, не по номеру строки. **Потерянная** строка эталона — промах по всем трём полям, из знаменателя не выпадает. **Добавленная** позиция прогона не оценивается: эталон не отличает честную лишнюю строку от выдуманной — это сверка глазами.');
  L.push('');

  L.push('## Сводка');
  L.push('');
  L.push('| Модель | Позиций | Сшито: точно / по сходству | Потеряно | Добавлено | Имена | Имена (мягко) | Цены | Категории | Все три | Ошибки фото | Стоимость | Рассуждения, ток. |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of scores) {
    const st = s.stitching;
    L.push(`| \`${s.label}\` | ${s.run.items} | ${st.exactModel + st.exactHuman} / ${st.lenient} | ${st.lost} | ${st.added} | ${fmtMetric(s.accuracy.name)} | ${fmtPct(s.accuracy.nameLenient)} | ${fmtMetric(s.accuracy.price)} | ${fmtMetric(s.accuracy.category)} | ${fmtMetric(s.accuracy.allThree)} | ${s.run.errors.length} | ${fmtUsd(s.run.costUsd)} | ${s.run.reasoningTokens} |`);
  }
  L.push('');
  L.push('«Имена» — правило июля (регистр и пробелы, суффиксы размеров S/M/L). «Имена (мягко)» — вдобавок без пунктуации, «ё», «(S)», похожих латинских/греческих букв и хвоста «объём/вес/штуки»: «ΛΑΤΤΕ 250 ΜΛ» = «Латте». Все проценты — от строк к оценке.');
  L.push('');
  L.push(`Галлюцинации, подтверждённые эталоном (сшиты со строкой «нет на фото»): ${scores.map((s) => `\`${s.label}\` ${s.hallucinationsConfirmed}`).join(', ')}. Добавленные позиции эталоном не покрыты.`);
  L.push('');
  L.push(`Сшито среди одноимённых строк (кто из двойников кто — по месту в меню, не по цене; сверить глазами): ${scores.map((s) => `\`${s.label}\` ${s.stitching.ambiguous}`).join(', ')}.`);
  L.push('');
  for (const s of scores) {
    if (s.run.photosOutsideGroundTruth.length) {
      L.push(`⚠ \`${s.label}\`: ${s.run.photosOutsideGroundTruth.length} фото прогона нет в эталоне (не сверяются): ${s.run.photosOutsideGroundTruth.slice(0, 10).join(', ')}${s.run.photosOutsideGroundTruth.length > 10 ? ' …' : ''}`);
    }
    if (s.run.photos > 0 && s.run.photosMatched === 0) {
      L.push(`⚠ \`${s.label}\`: ни одно фото прогона не совпало с эталоном по имени — «потеряно всё» здесь значит «не те имена файлов» (режим --media-root даёт \`<stable_id>/файл\`).`);
    }
  }
  L.push('');

  for (const s of scores) {
    const st = s.stitching;
    L.push(`## \`${s.label}\``);
    L.push('');
    L.push(`Фото в прогоне: ${s.run.photos} · позиций: ${s.run.items} · ошибок: ${s.run.errors.length} · JSON-fail: ${s.run.jsonFails} · повторов вызова: ${s.run.retries ?? '— (прогон их не записывал)'} · стоимость ${fmtUsd(s.run.costUsd)} · токены рассуждения: ${s.run.reasoningTokens}`);
    L.push('');
    L.push(`Сшивка: точно по чтению эталонной модели ${st.exactModel}, точно по имени человека ${st.exactHuman}, по сходству ${st.lenient} (из всех — среди одноимённых ${st.ambiguous}) · **потеряно ${st.lost}** · добавлено ${st.added} · поглощено исключёнными строками ${st.absorbedByExclusion}`);
    L.push('');
    L.push(`Имена ${fmtMetric(s.accuracy.name)} (мягко ${fmtPct(s.accuracy.nameLenient)}) · цены ${fmtMetric(s.accuracy.price)} · категории ${fmtMetric(s.accuracy.category)} · все три ${fmtMetric(s.accuracy.allThree)}`);
    L.push('');
    for (const e of s.run.errors) L.push(`- ошибка: ${e.unit} — ${cell(e.error).slice(0, 200)}`);
    if (s.run.errors.length) L.push('');

    L.push('| Фото | Строк | Сшито | Потеряно | Добавлено | Имена | Цены | Категории |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const p of s.perPhoto) {
      if (p.rows === 0 && p.added === 0) continue;
      L.push(`| ${p.unit}${p.error ? ' ⚠' : ''} | ${p.rows} | ${p.stitched} | ${p.lost} | ${p.added} | ${p.name} | ${p.price} | ${p.category} |`);
    }
    L.push('');

    const q = (x) => `«${cell(x)}»`;
    pushList(L, 'Сшито по сходству — сверить глазами', s.lists.lenientPairs, (x) => `${x.unit}: ${q(x.run)} ↔ ${q(x.human)} (${x.quantity ? 'без объёма' : String(x.score).replace('.', ',')})`);
    pushList(L, 'Сшито среди одноимённых — сверить глазами', s.lists.ambiguousPairs, (x) => `${x.unit}: ${q(x.run)} [${cell(x.runPrice)} | ${cell(x.runCat)}] ↔ ${q(x.human)} [${cell(x.humanPrice)} | ${cell(x.humanCat)}]`);
    pushList(L, 'Потерянные строки эталона', s.lists.lostRows, (x) => `${x.unit}: ${q(x.name)} [${cell(x.price)} | ${cell(x.cat)}]`);
    pushList(L, 'Добавленные позиции прогона', s.lists.addedItems, (x) => `${x.unit}: ${q(x.name)} [${cell(x.price)} | ${cell(x.cat)}]`);
    pushList(L, 'Цены: прогон → эталон', s.lists.priceMismatches, (x) => `${x.unit}: ${q(x.name)}: ${cell(x.run)} → ${cell(x.human)}`);
    pushList(L, 'Категории: прогон → эталон', s.lists.categoryMismatches, (x) => `${x.unit}: ${q(x.name)}: ${q(x.run)} → ${q(x.human)}`);
    pushList(L, 'Имена (правило июля): прогон → эталон', s.lists.nameMismatches, (x) => `${x.unit}: ${q(x.run)} → ${q(x.human)}`);
  }

  L.push('## Эталон: пропуски и заметки (как есть)');
  L.push('');
  L.push(`Пропуски (missed_items) — строки, которые человек дописал, потому что эталонная модель их не выдала: **${meta.gt.missedItems.length}**. Вне знаменателя, как в июле; автоматически не сшиваются — это свободный текст человека.`);
  L.push('');
  for (const m of meta.gt.missedItems) L.push(`- ${m.unit}: «${cell(m.name)}»`);
  L.push('');
  for (const e of meta.gt.exclusions) L.push(`Исключение ${e.unit}: ${e.listed} строк по именному списку — ${e.reason}.`);
  L.push('');
  for (const n of meta.gt.notes) L.push(`- ${n.unit}: ${cell(n.note)}`);
  L.push('');
  return L.join('\n');
}
