/**
 * The «Меню» section's pure parts (part 1 of «Кабинет партнёра на сайте»):
 * the wire's row as the cabinet reads it, the sections, the price as on the
 * public page (В3), the reasons of «Требует внимания» in words with their
 * numbers (T7 — never the raw code), the editor's checks (the server checks
 * none of the fields) and what an edit sends.
 */
import {
  groupBySection,
  menuItemOf,
  partnerMenuOf,
  priceOf,
  recognitionOf,
  replaceItem,
  sectionsOf,
  type PartnerMenuItem,
} from '@/lib/partner/menu';
import {
  changesOf,
  checkName,
  checkPrice,
  checkSection,
  confirmChangesOf,
  flagReasonText,
  formatMenuPrice,
  formatTimes,
  priceInputOf,
} from '@/lib/partner/menu-format';

const item = (over: Partial<PartnerMenuItem> = {}): PartnerMenuItem => ({
  id: 'i1',
  establishment_id: 'e1',
  media_id: 'm1',
  item_name: 'Драники',
  price_byn: 12.5,
  category_raw: 'Горячее',
  sanity_flag: null,
  position: 0,
  guest_hidden_reason: null,
  ...over,
});

describe('the wire, as the cabinet reads it', () => {
  it('a price comes as a string (node-pg NUMERIC) → a number; nothing → null', () => {
    expect(priceOf('12.50')).toBe(12.5);
    expect(priceOf(7)).toBe(7);
    expect(priceOf(null)).toBeNull();
    expect(priceOf('')).toBeNull();
    expect(priceOf('abc')).toBeNull();
  });

  it('a row without an id or a name is dropped, not shown broken', () => {
    expect(menuItemOf({ item_name: 'Без id' })).toBeNull();
    expect(menuItemOf({ id: 'x' })).toBeNull();
    expect(partnerMenuOf({ data: [{ id: 'x' }, { id: 'y', item_name: 'Суп' }] }).items.map((i) => i.id)).toEqual(['y']);
  });

  it('an unknown guest-hidden reason reads as none', () => {
    expect(menuItemOf({ id: 'x', item_name: 'Квас', guest_hidden_reason: 'something' })?.guest_hidden_reason).toBeNull();
  });

  it('a state this site does not know reads as no state; reason and cause only when failed', () => {
    expect(recognitionOf({ status: 'queued' })).toBeNull();
    expect(recognitionOf(null)).toBeNull();
    expect(recognitionOf({ status: 'done', reason: 'x', cause: 'unreadable' })).toEqual({ status: 'done', reason: null, cause: null });
    expect(recognitionOf({ status: 'failed', reason: 'Сбой', cause: 'nope' })).toEqual({ status: 'failed', reason: 'Сбой', cause: null });
  });

  it('a body without the fields: an empty list and «not read»', () => {
    expect(partnerMenuOf({ success: true })).toEqual({ items: [], recognition: null, hasHiddenItems: null });
  });
});

describe('sections', () => {
  const rows = [
    item({ id: 'a', category_raw: 'Супы' }),
    item({ id: 'b', category_raw: null }),
    item({ id: 'c', category_raw: 'Горячее' }),
    item({ id: 'd', category_raw: 'Супы' }),
    item({ id: 'e', category_raw: '' }),
  ];

  it('in the order a section first appears, the server\'s order inside; \'\' and null are one «no section»', () => {
    expect(groupBySection(rows).map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ['Супы', ['a', 'd']],
      ['', ['b', 'e']],
      ['Горячее', ['c']],
    ]);
  });

  it('the suggestions: distinct, non-empty sections', () => {
    expect(sectionsOf(rows)).toEqual(['Супы', 'Горячее']);
  });

  it('the server\'s line takes its place by id, the others stay', () => {
    const next = replaceItem(rows, item({ id: 'c', price_byn: 20 }));
    expect(next.map((i) => [i.id, i.price_byn])).toEqual([
      ['a', 12.5], ['b', 12.5], ['c', 20], ['d', 12.5], ['e', 12.5],
    ]);
  });
});

describe('the price as on the card\'s public page', () => {
  it.each([
    [14, '14 BYN'],
    [14.5, '14,50 BYN'],
    [0.3, '0,30 BYN'],
    [1200, '1200 BYN'],
    [null, '—'],
  ])('%p → %s', (price, text) => {
    expect(formatMenuPrice(price)).toBe(text);
  });

  it('the editor starts from the same form, without the currency', () => {
    expect(priceInputOf(6.5)).toBe('6,50');
    expect(priceInputOf(14)).toBe('14');
    expect(priceInputOf(null)).toBe('');
  });
});

describe('the reasons of «Требует внимания» (T7)', () => {
  it.each([
    [{ reason: 'price_below_threshold', details: { price: 0.3, threshold: 0.5 } },
      'Цена ниже порога: 0,30 BYN при пороге 0,50 BYN. Проверьте, верно ли распознано.'],
    [{ reason: 'price_above_threshold', details: { price: 1200, threshold: 1000 } },
      'Цена выше порога: 1200 BYN при пороге 1000 BYN. Проверьте, верно ли распознано.'],
    [{ reason: 'low_confidence', details: { confidence: 0.62, threshold: 0.7 } },
      'Низкая уверенность распознавания: 62% при пороге 70%. Проверьте название и цену.'],
    [{ reason: 'price_delta_anomaly', details: { previousPrice: 10, currentPrice: 40, ratio: 4, threshold: 3 } },
      'Резкое изменение цены: выросла с 10 до 40 BYN — в 4 раза. Проверьте, верно ли распознано.'],
    [{ reason: 'price_delta_anomaly', details: { previousPrice: 50, currentPrice: 10, ratio: 5 } },
      'Резкое изменение цены: упала с 50 до 10 BYN — в 5 раз. Проверьте, верно ли распознано.'],
    [{ reason: 'price_delta_anomaly', details: { previousPrice: 10, currentPrice: 35 } },
      'Резкое изменение цены: выросла с 10 до 35 BYN. Проверьте, верно ли распознано.'],
  ])('%j', (flag, text) => {
    expect(flagReasonText(flag)).toBe(text);
  });

  it.each([
    [{ reason: 'suspicious_name', details: {} }],
    [{ reason: null, details: {} }],
    [{ reason: 'price_below_threshold', details: { price: 0.3 } }],
    [{ reason: 'low_confidence', details: {} }],
  ])('unknown, or without its numbers → the general sentence, no code: %j', (flag) => {
    expect(flagReasonText(flag)).toBe('Проверьте название и цену.');
  });

  it.each([
    [1, 'в 1 раз'], [2, 'в 2 раза'], [4, 'в 4 раза'], [5, 'в 5 раз'], [11, 'в 11 раз'],
    [12, 'в 12 раз'], [21, 'в 21 раз'], [22, 'в 22 раза'], [3.5, 'в 3,5 раза'],
  ])('ratio %p → «%s» (the panel\'s plural)', (ratio, text) => {
    expect(formatTimes(ratio)).toBe(text);
  });
});

describe('the editor\'s checks', () => {
  it('the name: required, without edge spaces, at most 255 characters as the database counts them', () => {
    expect(checkName('  Суп  ')).toEqual({ ok: true, value: 'Суп' });
    expect(checkName('   ')).toEqual({ ok: false, error: 'Укажите название' });
    expect(checkName('я'.repeat(255)).ok).toBe(true);
    expect(checkName('я'.repeat(256))).toEqual({ ok: false, error: 'Название — не длиннее 255 знаков' });
    // An emoji is one character for the database, two UTF-16 units for JS.
    expect(checkName('🍲'.repeat(255)).ok).toBe(true);
  });

  it.each([
    ['', null], ['6,50', 6.5], ['6.5', 6.5], ['0', 0], ['99999999,99', 99_999_999.99], [' 1 200 ', 1200],
  ])('the price «%s» → %p', (text, value) => {
    expect(checkPrice(text)).toEqual({ ok: true, value });
  });

  it.each([['-1'], ['6,505'], ['100000000'], ['abc'], ['1.200,50'], ['6,']])('the price «%s» is refused', (text) => {
    expect(checkPrice(text).ok).toBe(false);
  });

  it('the section: free text, at most 100 characters; empty — no section', () => {
    expect(checkSection(' Десерты ')).toEqual({ ok: true, value: 'Десерты' });
    expect(checkSection('')).toEqual({ ok: true, value: '' });
    expect(checkSection('р'.repeat(101)).ok).toBe(false);
  });
});

describe('what an edit sends', () => {
  it('only the changed fields', () => {
    expect(changesOf(item(), { name: 'Драники', price: '14', section: 'Горячее' })).toEqual({
      ok: true,
      changes: { price_byn: 14 },
    });
  });

  it('the same price written otherwise is no change', () => {
    expect(changesOf(item(), { name: 'Драники', price: '12,50', section: 'Горячее' })).toEqual({ ok: true, changes: {} });
  });

  it('a cleared price → null («без цены»); a cleared section → \'\'', () => {
    expect(changesOf(item(), { name: 'Драники', price: '', section: '' })).toEqual({
      ok: true,
      changes: { price_byn: null, category_raw: '' },
    });
  });

  it('a section never set is no change when left empty', () => {
    expect(changesOf(item({ category_raw: null }), { name: 'Драники', price: '12,50', section: '' })).toEqual({ ok: true, changes: {} });
  });

  it('a refused field stops the edit, each with its text', () => {
    expect(changesOf(item(), { name: '', price: 'x', section: 'ок' })).toEqual({
      ok: false,
      errors: {
        name: 'Укажите название',
        price: 'Цена — число от 0 до 99 999 999,99, не больше двух знаков после запятой',
      },
    });
  });

  it('«Всё верно» sends the line back as it is: the price, or the name when there is no price', () => {
    expect(confirmChangesOf(item())).toEqual({ price_byn: 12.5 });
    expect(confirmChangesOf(item({ price_byn: null }))).toEqual({ item_name: 'Драники' });
  });
});
