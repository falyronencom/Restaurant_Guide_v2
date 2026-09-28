/**
 * Unit — OCR benchmark ground-truth scorer (scripts/ocr-benchmark/scorer.js).
 *
 * DIRECTIVE_gt_scorer (CLI Trunk 2026-07-28): the scorer stitches a new run
 * to the human-verified rows BY NAME within a photo, not by idx, and must not
 * reward a run for dropping items — a lost human row stays in the denominator
 * as a miss on every field. Normalizers are the July rules (score-gt.py,
 * 2026-07-28) that reproduce the baseline 474 / 409 / 363 / 332 of 480.
 *
 * Expected values are literals from the directive and from the July data, not
 * recomputed with the scorer's own helpers.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  normName,
  normPrice,
  normCat,
  pairKey,
  keySimilarity,
  LENIENT_MIN,
  stitchPhoto,
  scoreModel,
  describeGroundTruth,
  buildScoreMarkdown,
  EXCLUSIONS,
} from '../../../scripts/ocr-benchmark/scorer.js';

// ── fixtures ────────────────────────────────────────────────────────────────

/** A ground-truth row: model = frozen reading, human = the verified truth. */
const row = (idx, name, price = '5', cat = 'Кофе', human = {}) => ({
  idx,
  model: { name, price, cat },
  human: { name, price, cat, ...human },
  not_on_photo: false,
});

const item = (item_name, price_byn = 5, category_raw = 'Кофе') => ({
  item_name, price_byn, category_raw, confidence: 0.9, sanity_flag: null,
});

const result = (unitId, items, extra = {}) => ({
  unitId,
  model: 'm',
  vision: { usage: null },
  structurer: { parseOk: true, zodOk: true, usage: null },
  items,
  metrics: { costUsd: 0.001 },
  error: null,
  ...extra,
});

/** Ten verified rows on one photo, and a run that read all ten correctly. */
const TEN = ['Эспрессо', 'Американо', 'Капучино', 'Латте', 'Раф', 'Какао', 'Чай черный', 'Чай зеленый', 'Лимонад', 'Морс'];
const tenGt = () => ({ run: 'test-gt', model: 'm', photos: { 'A.jpg': { rows: TEN.map((n, i) => row(i, n, String(i + 1))) } } });
const tenItems = () => TEN.map((n, i) => item(n, i + 1));

// ── July normalizers ────────────────────────────────────────────────────────

describe('normName — правило июля', () => {
  test('срезает хвостовые размеры S/M/L', () => {
    expect(normName('эспрессо S')).toBe('эспрессо');
    expect(normName('какао S/M/L')).toBe('какао');
    expect(normName('латте M / L')).toBe('латте');
  });

  test('регистр и пробелы, включая переносы строк', () => {
    expect(normName('  Флэт   уайт\nS/L ')).toBe('флэт уайт');
  });

  test('пунктуацию НЕ снимает — иначе база уедет с 474 на 476', () => {
    // Два из шести промахов базы — ровно такие пары (IMG_2063, IMG_2089).
    expect(normName('облепиховый напиток.')).not.toBe(normName('облепиховый напиток M/L'));
    expect(normName('газированная газированная')).not.toBe(normName('газированная, газированная'));
  });

  test('размер в скобках «(S)» правило июля не считает размером', () => {
    expect(normName('эспрессо (S)')).toBe('эспрессо (s)');
  });
});

describe('normPrice — правило июля', () => {
  test('мульти-размерная цена — первое число', () => {
    expect(normPrice('5.5 / 8.5 / 9')).toBe(5.5);
    expect(normPrice('9 / 11.5 /')).toBe(9);
  });

  test('«+2» — это 2; «4.10» равно 4.1; запятая — десятичный знак', () => {
    expect(normPrice('+2')).toBe(2);
    // score-gt.py: lstrip('+') снимал все плюсы, float() терпел пробел.
    expect(normPrice('++2')).toBe(2);
    expect(normPrice('+ 2')).toBe(2);
    expect(normPrice('4.10')).toBe(4.1);
    expect(normPrice(4.1)).toBe(4.1);
    expect(normPrice('5,5')).toBe(5.5);
  });

  test('«—», «-», «» и null — одна пустая цена', () => {
    expect(normPrice('—')).toBeNull();
    expect(normPrice('-')).toBeNull();
    expect(normPrice('')).toBeNull();
    expect(normPrice(null)).toBeNull();
  });

  test('потеря десятичной точки — промах: 410 ≠ «4.10»', () => {
    expect(normPrice(410)).not.toBe(normPrice('4.10'));
  });

  test('не-число остаётся сырым токеном и равно только себе', () => {
    expect(normPrice('по сезону')).toBe('RAW:по сезону');
    expect(normPrice('по сезону')).not.toBe(normPrice(null));
    // Number('') === 0 в JS; Python float('') бросал — пустой первый токен не ноль.
    expect(normPrice('/5')).toBe('RAW:');
  });
});

describe('normCat — правило июля', () => {
  test('регистр и переносы строк не различаются', () => {
    expect(normCat('Наши\nфирменные\nнапитки')).toBe('наши фирменные напитки');
    expect(normCat('НАШИ ФИРМЕННЫЕ НАПИТКИ')).toBe('наши фирменные напитки');
  });

  test('«—», «» и null — одна пустая категория', () => {
    expect(normCat('—')).toBe('');
    expect(normCat('')).toBe('');
    expect(normCat(null)).toBe('');
  });
});

// ── stitching key ───────────────────────────────────────────────────────────

describe('pairKey — ключ сшивки', () => {
  test('греческие двойники букв: «ΛΑΤΤΕ» из эталона = «ЛАТТЕ» кириллицей', () => {
    expect(pairKey('ΛΑΤΤΕ')).toBe('латте');
    expect(pairKey('ЛАТТЕ')).toBe('латте');
  });

  test('латинские двойники: «BBQ» латиницей = «ВВQ» с кириллической В', () => {
    expect(pairKey('ДРАНИКИ BBQ')).toBe(pairKey('драники ВВQ'));
  });

  test('пунктуация и разделители не различаются', () => {
    expect(pairKey('альт. молоко (150|200|250 г)')).toBe('альт молоко 150 200 250 г');
    expect(pairKey('альт, молоко (150/200/250 г)')).toBe('альт молоко 150 200 250 г');
  });

  test('размер — и «S/M/L», и «(S)»', () => {
    expect(pairKey('американо (S)')).toBe('американо');
    expect(pairKey('американо S/M/L')).toBe('американо');
    expect(pairKey('латте (M/L)')).toBe('латте');
  });

  test('«ё» = «е»', () => {
    expect(pairKey('Цыплёнок')).toBe('цыпленок');
  });

  test('разные напитки остаются разными', () => {
    expect(pairKey('эспрессо')).not.toBe(pairKey('эспрессо-тоник'));
  });

  test('без объёма: хвост «объём/вес/штуки» срезается только по запросу', () => {
    // IMG_6435: в эталоне «ЭСПРЕСCO 40 ΜΛ» (латинские C/O, греческое ΜΛ).
    expect(pairKey('ЭСПРЕСCO 40 ΜΛ', { dropQuantity: true })).toBe('эспрессо');
    expect(pairKey('ЭСПРЕСCO 40 ΜΛ')).toBe('эспрессо 40 мл');
    expect(pairKey('альт, молоко (150/200/250 г)', { dropQuantity: true })).toBe('альт молоко');
    expect(pairKey('Пирожки с капустой 1шт / 3шт', { dropQuantity: true })).toBe('пирожки с капустой');
    expect(pairKey('ИГРИСТОЕ к завтраку 125мл', { dropQuantity: true })).toBe('игристое к завтраку');
    expect(pairKey('СЕТ НАСТОЕК 9 штук', { dropQuantity: true })).toBe('сет настоек');
    // Число без единицы — не объём.
    expect(pairKey('Квас Аливарский 0.5/0.33', { dropQuantity: true })).toBe('квас аливарский 0 5 0 33');
  });
});

describe('keySimilarity — порог сшивки по сходству', () => {
  test('опечатка распознавания проходит порог', () => {
    expect(keySimilarity('гвазели с курицей и грибами', 'гвезели с курицей и грибами')).toBeGreaterThanOrEqual(LENIENT_MIN);
  });

  test('имя без хвоста-описания (от двух слов) проходит порог', () => {
    expect(keySimilarity('батат фри', 'батат фри с фирменным соусом')).toBeGreaterThanOrEqual(LENIENT_MIN);
  });

  test('однословное начало — другой напиток, порог не проходит', () => {
    expect(keySimilarity('американо', 'американо лайт')).toBeLessThan(LENIENT_MIN);
    expect(keySimilarity('эспрессо', 'эспрессо тоник')).toBeLessThan(LENIENT_MIN);
  });

  test('пустой ключ ни с чем не схож', () => {
    expect(keySimilarity('', '')).toBe(0);
  });

  test('порог 0,8 — калибровка на июльских выходах пяти моделей; смена = новая калибровка', () => {
    // 98 пар по сходству в июльском прогоне — все верные опознания строк
    // (опечатки чтения, хвост-описание, дописанный объём). Другой порог —
    // перепроверить список «Сшито по сходству» на тех же выходах.
    expect(LENIENT_MIN).toBe(0.8);
  });
});

// ── stitchPhoto ─────────────────────────────────────────────────────────────

describe('stitchPhoto', () => {
  test('замороженный прогон: каждая позиция сшита со своей строкой, дубликаты — по порядку', () => {
    const rows = [row(0, 'Семга'), row(1, 'Борщ'), row(2, 'Семга'), row(3, 'Семга')];
    const { rowMatch } = stitchPhoto(rows, [item('Семга'), item('Борщ'), item('Семга'), item('Семга')]);
    expect(rowMatch.map((m) => m.item)).toEqual([0, 1, 2, 3]);
    expect(rowMatch.map((m) => m.via)).toEqual(['exact-model', 'exact-model', 'exact-model', 'exact-model']);
    // Кто из одноимённых кто — не знает никто: такие пары помечены для глаза.
    expect(rowMatch.map((m) => m.ambiguous)).toEqual([true, false, true, true]);
  });

  test('двойники при равном числе сшиваются по порядку', () => {
    const rows = [row(0, 'Семга'), row(1, 'Борщ'), row(2, 'Семга')];
    const { rowMatch, itemMatch } = stitchPhoto(rows, [item('Семга'), item('Семга')]);
    expect(itemMatch).toEqual([0, 2]);
    expect(rowMatch[1]).toBeNull();
  });

  test('позиция ровно посередине между двойниками — к более ранней строке', () => {
    // Строки на 0,25 и 0,75, позиция на 0,5 — расстояния равны точно.
    const { rowMatch } = stitchPhoto([row(0, 'Семга'), row(1, 'Семга')], [item('Семга')]);
    expect(rowMatch[0]).toMatchObject({ item: 0, ambiguous: true });
    expect(rowMatch[1]).toBeNull();
  });

  test('выбросили одного из двойников — оставшийся идёт к ближайшей по месту строке, а не к первой', () => {
    // «С говядиной» по 4 (строка 0) и по 4.4 (строка 2); прогон выбросил первую.
    const rows = [row(0, 'С говядиной', '4'), row(1, 'Борщ', '5'), row(2, 'С говядиной', '4.4')];
    const { rowMatch } = stitchPhoto(rows, [item('Борщ', 5), item('С говядиной', 4.4)]);
    expect(rowMatch[2]).toMatchObject({ item: 1, ambiguous: true });
    expect(rowMatch[0]).toBeNull();
  });

  test('другой порядок чтения (по колонкам) сшивается верно', () => {
    const rows = [row(0, 'Чай'), row(1, 'Кофе'), row(2, 'Какао')];
    const { itemMatch } = stitchPhoto(rows, [item('Какао'), item('Чай'), item('Кофе')]);
    expect(itemMatch).toEqual([2, 0, 1]);
  });

  test('модель, прочитавшая лучше эталонной, сшивается по имени человека', () => {
    // Эталонная модель прочла «Кекао», человек исправил на «Какао».
    const rows = [row(0, 'Кекао', '5', 'Кофе', { name: 'Какао' }), row(1, 'Раф')];
    const { rowMatch } = stitchPhoto(rows, [item('какао')]);
    expect(rowMatch[0]).toMatchObject({ item: 0, via: 'exact-human' });
  });

  test('чтение эталонной модели сшивается раньше имени человека — иначе замороженный прогон разъедется', () => {
    // Строка 0: модель прочла «Кекао», человек исправил на «Какао».
    // Строка 1: модель прочла «Какао», человек дописал «Какао бин».
    // Позиция «Какао» замороженного прогона — это строка 1.
    const rows = [row(0, 'Кекао', '5', 'Кофе', { name: 'Какао' }), row(1, 'Какао', '5', 'Кофе', { name: 'Какао бин' })];
    const { rowMatch } = stitchPhoto(rows, [item('Какао')]);
    expect(rowMatch[1]).toMatchObject({ item: 0, via: 'exact-model' });
    expect(rowMatch[0]).toBeNull();
  });

  test('по сходству выигрывает лучшая пара, а не первая по порядку строк', () => {
    const rows = [row(0, 'Хачапури по-мегрельски'), row(1, 'Хачапури по-мегрельски с сулугуни')];
    // Опечатка в последней букве: к строке 1 — 0,97, к строке 0 (начало имени) — 0,85.
    const { rowMatch } = stitchPhoto(rows, [item('Хачапури по-мегрельски с сулугунн')]);
    expect(rowMatch[1]).toMatchObject({ item: 0, via: 'lenient' });
    expect(rowMatch[0]).toBeNull();
  });

  test('точное совпадение не уступает строку сшивке по сходству', () => {
    const rows = [row(0, 'Батат фри с соусом'), row(1, 'Батат фри')];
    const { rowMatch } = stitchPhoto(rows, [item('Батат фри')]);
    expect(rowMatch[0]).toBeNull();
    expect(rowMatch[1]).toMatchObject({ item: 0, via: 'exact-model' });
  });

  test('объём различает строки в точных проходах: «Пиво 0,5 л» и «Пиво 0,3 л» не двойники', () => {
    const rows = [row(0, 'Пиво 0,5 л', '7'), row(1, 'Пиво 0,3 л', '5')];
    const { rowMatch } = stitchPhoto(rows, [item('Пиво 0,3 л', 5), item('Пиво 0,5 л', 7)]);
    expect(rowMatch[0]).toMatchObject({ item: 1, via: 'exact-model', ambiguous: false });
    expect(rowMatch[1]).toMatchObject({ item: 0, via: 'exact-model', ambiguous: false });
  });

  test('модель опустила объём — сшито проходом «без объёма», с пометкой для глаза', () => {
    const rows = [row(0, 'ЭСПРЕСCO 40 ΜΛ', '5'), row(1, 'РАФ 300 ΜΛ', '9')];
    const { rowMatch } = stitchPhoto(rows, [item('ЭСПРЕССО', 5), item('РАФ', 9)]);
    expect(rowMatch[0]).toMatchObject({ item: 0, via: 'lenient', score: 0.95, quantity: true });
    expect(rowMatch[1]).toMatchObject({ item: 1, via: 'lenient', score: 0.95, quantity: true });
  });

  test('по сходству — с пометкой lenient и оценкой', () => {
    const rows = [row(0, 'Гвезели с курицей и грибами')];
    const { rowMatch } = stitchPhoto(rows, [item('Гвазели с курицей и грибами')]);
    expect(rowMatch[0].via).toBe('lenient');
    expect(rowMatch[0].score).toBeGreaterThanOrEqual(LENIENT_MIN);
  });

  test('непохожая позиция не сшивается', () => {
    const { rowMatch, itemMatch } = stitchPhoto([row(0, 'Борщ')], [item('Лимонад')]);
    expect(rowMatch).toEqual([null]);
    expect(itemMatch).toEqual([-1]);
  });
});

// ── scoreModel ──────────────────────────────────────────────────────────────

describe('scoreModel', () => {
  test('все десять прочитаны верно — 10/10 по всем полям, потерь нет', () => {
    const s = scoreModel({ gt: tenGt(), results: [result('A.jpg', tenItems())], model: 'm' });
    expect(s.scoredRows).toBe(10);
    expect(s.accuracy.name).toMatchObject({ ok: 10, total: 10 });
    expect(s.accuracy.price).toMatchObject({ ok: 10, total: 10 });
    expect(s.accuracy.category).toMatchObject({ ok: 10, total: 10 });
    expect(s.stitching).toMatchObject({ stitched: 10, lost: 0, added: 0 });
  });

  test('анти-Goodhart: выбросили 4 позиции — ровно 4 потерянных, знаменатель прежний, проценты не растут', () => {
    const items = tenItems();
    items[4].price_byn = 99; // одна неверная цена у позиции, которую потом выбросим
    const full = scoreModel({ gt: tenGt(), results: [result('A.jpg', items)], model: 'm' });
    const dropped = scoreModel({ gt: tenGt(), results: [result('A.jpg', items.filter((_, i) => ![1, 4, 6, 8].includes(i)))], model: 'm' });
    expect(full.accuracy.price).toMatchObject({ ok: 9, total: 10 });
    expect(dropped.stitching.lost).toBe(4);
    expect(dropped.scoredRows).toBe(10);
    // На выживших цены верны 6 из 6 — «100 %», но отчёт обязан показать 6/10.
    expect(dropped.accuracy.price).toMatchObject({ ok: 6, total: 10 });
    expect(dropped.accuracy.name).toMatchObject({ ok: 6, total: 10 });
    for (const k of ['name', 'nameLenient', 'price', 'category', 'allThree']) {
      expect(dropped.accuracy[k].pct).toBeLessThanOrEqual(full.accuracy[k].pct);
    }
    expect(dropped.lists.lostRows.map((r) => r.name)).toEqual(['Американо', 'Раф', 'Чай черный', 'Лимонад']);
  });

  test('анти-Goodhart у двойников: выброс одного не повышает цены (сценарий ревью 28.09)', () => {
    // Прогон прочёл обе «С говядиной» верно, но перечислил 4.4 первой.
    const gt = {
      run: 'x', model: 'm',
      photos: { 'A.jpg': { rows: [row(0, 'С говядиной', '4'), row(1, 'Борщ', '5'), row(2, 'С говядиной', '4.4')] } },
    };
    const reversed = [item('С говядиной', 4.4), item('Борщ', 5), item('С говядиной', 4)];
    const full = scoreModel({ gt, results: [result('A.jpg', reversed)], model: 'm' });
    const dropped = scoreModel({ gt, results: [result('A.jpg', reversed.filter((it) => it.price_byn !== 4.4))], model: 'm' });
    expect(full.accuracy.price).toMatchObject({ ok: 1, total: 3 });
    expect(dropped.accuracy.price).toMatchObject({ ok: 1, total: 3 });
    expect(dropped.stitching.lost).toBe(1);
    expect(full.stitching.ambiguous).toBe(2);
    expect(full.lists.ambiguousPairs).toEqual([
      { unit: 'A.jpg', run: 'С говядиной', runPrice: '4.4', runCat: 'Кофе', human: 'С говядиной', humanPrice: '4', humanCat: 'Кофе' },
      { unit: 'A.jpg', run: 'С говядиной', runPrice: '4', runCat: 'Кофе', human: 'С говядиной', humanPrice: '4.4', humanCat: 'Кофе' },
    ]);
  });

  test('модель дробит размеры — строке достаётся первая позиция (S): правило июля сверяет первую цену', () => {
    // Так читала gemini-3.5-flash в июле: «американо (S)/(M)/(L)» на одну строку эталона.
    const gt = {
      run: 'x', model: 'm',
      photos: { 'A.jpg': { rows: [row(0, 'американо', '5.5', 'КОФЕ', { name: 'американо S/M/L', price: '5.5 / 8.5 / 9' })] } },
    };
    const items = [item('американо (S)', 5.5, 'КОФЕ'), item('американо (M)', 8.5, 'КОФЕ'), item('американо (L)', 9, 'КОФЕ')];
    const s = scoreModel({ gt, results: [result('A.jpg', items)], model: 'm' });
    expect(s.accuracy.price).toMatchObject({ ok: 1, total: 1 });
    expect(s.stitching).toMatchObject({ stitched: 1, added: 2, ambiguous: 1 });
    expect(s.lists.addedItems.map((x) => x.name)).toEqual(['американо (M)', 'американо (L)']);
  });

  test('фото прогона не из эталона — видно отдельно, а не только как «всё потеряно»', () => {
    const s = scoreModel({ gt: tenGt(), results: [result('stable-1/A.jpg', tenItems())], model: 'm' });
    expect(s.run.photosMatched).toBe(0);
    expect(s.run.photosOutsideGroundTruth).toEqual(['stable-1/A.jpg']);
    const md = buildScoreMarkdown({ generatedAt: 't', gtPath: 'gt.json', gt: describeGroundTruth(tenGt(), {}), runs: [{ dir: 'r' }] }, [{ ...s, label: 'm' }]);
    expect(md).toContain('ни одно фото прогона не совпало с эталоном');
  });

  test('добавленная позиция показывается, но не оценивается и знаменатель не меняет', () => {
    const s = scoreModel({ gt: tenGt(), results: [result('A.jpg', [...tenItems(), item('Выдуманный десерт', 12)])], model: 'm' });
    expect(s.stitching.added).toBe(1);
    expect(s.lists.addedItems).toEqual([{ unit: 'A.jpg', name: 'Выдуманный десерт', price: '12', cat: 'Кофе' }]);
    expect(s.scoredRows).toBe(10);
    expect(s.accuracy.name).toMatchObject({ ok: 10, total: 10 });
  });

  test('имя без объёма: строгое правило июля — промах, мягкое — совпадение; цена засчитана', () => {
    const gt = { run: 'x', model: 'm', photos: { 'A.jpg': { rows: [row(0, 'ЭСПРЕСCO 40 ΜΛ', '5')] } } };
    const s = scoreModel({ gt, results: [result('A.jpg', [item('ЭСПРЕССО', 5)])], model: 'm' });
    expect(s.accuracy.name.ok).toBe(0);
    expect(s.accuracy.nameLenient.ok).toBe(1);
    expect(s.accuracy.price.ok).toBe(1);
    expect(s.stitching).toMatchObject({ lenient: 1, lost: 0, added: 0 });
    expect(s.lists.lenientPairs).toEqual([{ unit: 'A.jpg', run: 'ЭСПРЕССО', human: 'ЭСПРЕСCO 40 ΜΛ', score: 0.95, quantity: true }]);
  });

  test('цена и категория сверяются с человеком, не с эталонной моделью', () => {
    const gt = { run: 'x', model: 'm', photos: { 'A.jpg': { rows: [row(0, 'Латте', '580', 'Горячие', { price: '5.80', cat: 'Кофе' })] } } };
    const right = scoreModel({ gt, results: [result('A.jpg', [item('Латте', 5.8, 'КОФЕ')])], model: 'm' });
    const frozenError = scoreModel({ gt, results: [result('A.jpg', [item('Латте', 580, 'Горячие')])], model: 'm' });
    expect(right.accuracy.price.ok).toBe(1);
    expect(right.accuracy.category.ok).toBe(1);
    expect(frozenError.accuracy.price.ok).toBe(0);
    expect(frozenError.accuracy.category.ok).toBe(0);
    expect(frozenError.lists.priceMismatches).toEqual([{ unit: 'A.jpg', name: 'Латте', run: '580', human: '5.80' }]);
  });

  test('сшивки между фото нет: позиция чужого фото — добавленная, строка — потерянная', () => {
    const gt = { run: 'x', model: 'm', photos: { 'A.jpg': { rows: [row(0, 'Борщ')] }, 'B.jpg': { rows: [row(0, 'Лимонад')] } } };
    const s = scoreModel({ gt, results: [result('A.jpg', [item('Лимонад')]), result('B.jpg', [])], model: 'm' });
    expect(s.stitching).toMatchObject({ stitched: 0, lost: 2, added: 1 });
  });

  test('фото с ошибкой вызова и фото вне прогона — все их строки потеряны', () => {
    const gt = { run: 'x', model: 'm', photos: { 'A.jpg': { rows: [row(0, 'Борщ'), row(1, 'Суп')] }, 'B.jpg': { rows: [row(0, 'Чай')] } } };
    const s = scoreModel({ gt, results: [result('A.jpg', [item('Борщ')], { error: 'OpenRouter call timed out after 60000ms' })], model: 'm' });
    expect(s.stitching.lost).toBe(3);
    expect(s.accuracy.name).toMatchObject({ ok: 0, total: 3 });
    expect(s.run.errors).toEqual([{ unit: 'A.jpg', error: 'OpenRouter call timed out after 60000ms' }]);
  });

  test('исключённые строки поглощают свои позиции и в знаменатель не входят', () => {
    const gt = { run: 'x', model: 'm', photos: { 'A.jpg': { rows: [row(0, 'Пицца'), row(1, 'Обрезок завтрака')] } } };
    const exclusions = { 'A.jpg': { reason: 'обрезок', names: ['Обрезок завтрака'] } };
    const s = scoreModel({ gt, results: [result('A.jpg', [item('Пицца'), item('Обрезок завтрака')])], model: 'm', exclusions });
    expect(s.scoredRows).toBe(1);
    expect(s.excludedRows).toBe(1);
    expect(s.stitching).toMatchObject({ absorbedByExclusion: 1, added: 0, lost: 0 });
  });

  test('сшитая строка «нет на фото» — подтверждённая галлюцинация вне знаменателя', () => {
    const gt = { run: 'x', model: 'm', photos: { 'A.jpg': { rows: [row(0, 'Борщ'), { ...row(1, 'Фантом'), not_on_photo: true }] } } };
    const s = scoreModel({ gt, results: [result('A.jpg', [item('Борщ'), item('Фантом')])], model: 'm' });
    expect(s.hallucinationsConfirmed).toBe(1);
    expect(s.scoredRows).toBe(1);
  });

  test('исключения июля привязаны к своему эталону по полю run', () => {
    expect(EXCLUSIONS['2026-07-27_163128']['IMG_6308.jpg'].names).toHaveLength(29);
    const gt = { run: 'другой эталон', model: 'm', photos: { 'IMG_6308.jpg': { rows: [row(0, 'ИГРИСТОЕ к завтраку')] } } };
    const s = scoreModel({ gt, results: [result('IMG_6308.jpg', [])], model: 'm' });
    expect(s.excludedRows).toBe(0);
    expect(s.stitching.lost).toBe(1);
  });

  test('повторы вызовов: у старых прогонов неизвестны (null), у новых — сумма лишних попыток', () => {
    const old = scoreModel({ gt: tenGt(), results: [result('A.jpg', tenItems())], model: 'm' });
    const fresh = scoreModel({
      gt: tenGt(),
      results: [result('A.jpg', tenItems(), { vision: { attempts: 2, usage: null }, structurer: { attempts: 1, parseOk: true, zodOk: true, usage: null } })],
      model: 'm',
    });
    expect(old.run.retries).toBeNull();
    expect(fresh.run.retries).toBe(1);
  });
});

describe('describeGroundTruth и отчёт', () => {
  const gt = {
    run: 'x', model: 'm', exported_at: '2026-07-28',
    photos: {
      'A.jpg': { rows: [row(0, 'Борщ')], missed_items: [{ name: '* с безлактозным молоком +0.80', price: '', cat: '' }], note: 'Цена указана с сотой' },
    },
  };

  test('пропуски и заметки эталона — как есть, без разбора', () => {
    const d = describeGroundTruth(gt, {});
    expect(d.missedItems).toEqual([{ unit: 'A.jpg', name: '* с безлактозным молоком +0.80', price: '', cat: '' }]);
    expect(d.notes).toEqual([{ unit: 'A.jpg', note: 'Цена указана с сотой' }]);
  });

  test('в сводке потерянные стоят рядом с точностью', () => {
    const s = { ...scoreModel({ gt, results: [result('A.jpg', [])], model: 'm' }), label: 'm' };
    const md = buildScoreMarkdown({ generatedAt: 't', gtPath: 'gt.json', gt: describeGroundTruth(gt, {}), runs: [{ dir: 'r' }] }, [s]);
    expect(md).toContain('| `m` | 0 | 0 / 0 | 1 | 0 | 0/1 = 0,0 % |');
    expect(md).toContain('**потеряно 1**');
  });
});

// ── Anchor on the real July data (runs/ is gitignored: runs locally, skipped where absent) ──

const RUN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/ocr-benchmark/runs/2026-07-27_163128');
const haveJulyData = existsSync(join(RUN_DIR, 'ground-truth.json')) && existsSync(join(RUN_DIR, 'results.json'));

(haveJulyData ? describe : describe.skip)('якорь: замороженный прогон 27.07 (локальные данные; в CI их нет)', () => {
  test('google/gemini-2.5-flash воспроизводит базу директивы точно', () => {
    const gt = JSON.parse(readFileSync(join(RUN_DIR, 'ground-truth.json'), 'utf8'));
    const results = JSON.parse(readFileSync(join(RUN_DIR, 'results.json'), 'utf8'));
    const s = scoreModel({ gt, results, model: 'google/gemini-2.5-flash' });
    expect(s.scoredRows).toBe(480);
    expect(s.accuracy.name.ok).toBe(474);
    expect(s.accuracy.price.ok).toBe(409);
    expect(s.accuracy.category.ok).toBe(363);
    expect(s.accuracy.allThree.ok).toBe(332);
    expect(s.hallucinationsConfirmed).toBe(0);
    expect(s.stitching).toMatchObject({ exactModel: 480, lost: 0, added: 0, absorbedByExclusion: 29 });
    // Двойники эталона: «Дополнительное блюдо» ×2 и «Семга собственного посола» ×3
    // (IMG_6309), «С говядиной» ×2 (IMG_6316), «Финляндия» ×2 (IMG_6433).
    expect(s.stitching.ambiguous).toBe(9);
    expect(describeGroundTruth(gt).missedItems).toHaveLength(2);
  });
});
