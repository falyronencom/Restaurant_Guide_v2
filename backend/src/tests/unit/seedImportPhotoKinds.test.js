/* eslint-env jest */
/**
 * Минимум карточки команды E1 (CAT-E-2.3) после поправки 09.11.2026: «≥ 1 фото
 * фасада» — совет, не требование; фасад, зал и блюда делят предел фото
 * заведения (нитка «Фото людей», PR 2).
 */

import { adviseE1, checkE1 } from '../../../scripts/seed-import/media.js';

const counts = (over = {}) => ({ exterior: 0, interior: 5, dishes: 0, menu: 1, menu_pdf: 0, ...over });

test('без фасада минимум выполнен — остаётся совет', () => {
  expect(checkE1(counts())).toEqual([]);
  expect(adviseE1(counts())).toEqual(['0 exterior < 1: a facade photo is advised for the cover']);
});

test('с фасадом совета нет; меньше 5 фото и без меню — по-прежнему требования', () => {
  expect(adviseE1(counts({ exterior: 1 }))).toEqual([]);
  expect(checkE1({ exterior: 1, interior: 1, dishes: 0, menu: 0, menu_pdf: 0 }))
    .toEqual(['2 photos < 5', 'no menu source (photo or PDF)']);
});
