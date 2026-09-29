/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: searchService.js
 *
 * Tests geospatial search logic in isolation using mocked database.
 * These tests verify:
 * - Coordinate validation
 * - Radius validation
 * - Query building with dynamic filters
 * - PostGIS integration
 * - Pagination
 */

import { jest } from '@jest/globals';

// Mock database
jest.unstable_mockModule('../../config/database.js', () => ({
  default: {
    query: jest.fn(),
  },
}));

// Import after mocking
const pool = (await import('../../config/database.js')).default;

const {
  searchByRadius,
  searchWithoutLocation,
  searchByBounds,
  checkSearchHealth,
} = await import('../../services/searchService.js');

import { createMockEstablishment } from '../mocks/helpers.js';

describe('searchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('searchByRadius', () => {
    const validParams = {
      latitude: 53.9,
      longitude: 27.5,
      radius: 10,
    };

    test('should search establishments with valid parameters', async () => {
      const mockEstablishments = [
        { ...createMockEstablishment(), distance_km: 1.5 },
        { ...createMockEstablishment(), distance_km: 3.2 },
      ];

      // Mock main query
      pool.query.mockResolvedValueOnce({
        rows: mockEstablishments,
        rowCount: 2,
      });

      // Mock count query
      pool.query.mockResolvedValueOnce({
        rows: [{ total: '2' }],
        rowCount: 1,
      });

      const result = await searchByRadius(validParams);

      expect(result.establishments.length).toBe(2);
      expect(result.establishments[0]).toMatchObject({
        distance_km: 1.5,
        distance: 1.5,
      });
      expect(result.establishments[1]).toMatchObject({
        distance_km: 3.2,
        distance: 3.2,
      });
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });

      // Verify search + count queries were called (+ promotion enrichment queries)
      expect(pool.query).toHaveBeenCalled();
      expect(pool.query.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    test('should throw error for missing coordinates', async () => {
      await expect(
        searchByRadius({ latitude: 53.9, radius: 10 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      await expect(
        searchByRadius({ longitude: 27.5, radius: 10 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should validate latitude range', async () => {
      // Too low
      await expect(
        searchByRadius({ ...validParams, latitude: -91 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Too high
      await expect(
        searchByRadius({ ...validParams, latitude: 91 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Valid extremes
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await expect(searchByRadius({ ...validParams, latitude: -90 })).resolves.toBeDefined();
      await expect(searchByRadius({ ...validParams, latitude: 90 })).resolves.toBeDefined();
    });

    test('should validate longitude range', async () => {
      // Too low
      await expect(
        searchByRadius({ ...validParams, longitude: -181 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Too high
      await expect(
        searchByRadius({ ...validParams, longitude: 181 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should validate radius range', async () => {
      // Zero radius
      await expect(
        searchByRadius({ ...validParams, radius: 0 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Negative radius
      await expect(
        searchByRadius({ ...validParams, radius: -5 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Too large radius
      await expect(
        searchByRadius({ ...validParams, radius: 1001 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should validate limit range', async () => {
      // Too small
      await expect(
        searchByRadius({ ...validParams, limit: 0 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Too large
      await expect(
        searchByRadius({ ...validParams, limit: 101 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should validate offset range', async () => {
      await expect(
        searchByRadius({ ...validParams, offset: -1 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should filter by categories', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        categories: ['Ресторан', 'Кофейня'],
      });

      // Verify query includes category filter
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.categories && ');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContainEqual(['Ресторан', 'Кофейня']);
    });

    test('should filter by cuisines', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        cuisines: ['Народная', 'Европейская'],
      });

      // Verify query includes cuisine filter
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.cuisines && ');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContainEqual(['Народная', 'Европейская']);
    });

    test('should filter by price range', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        priceRange: '$$',
      });

      // Verify query includes price range filter
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.price_range = ');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContain('$$');
    });

    test('should filter by minimum rating', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        minRating: 4.0,
      });

      // Verify query includes rating filter
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.average_rating >= ');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContain(4.0);
    });

    test('should combine multiple filters', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        categories: ['Ресторан'],
        cuisines: ['Европейская'],
        priceRange: '$$$',
        minRating: 4.5,
      });

      const query = pool.query.mock.calls[0][0];
      const params = pool.query.mock.calls[0][1];

      // Verify all filters in query
      expect(query).toContain('e.categories && ');
      expect(query).toContain('e.cuisines && ');
      expect(query).toContain('e.price_range = ');
      expect(query).toContain('e.average_rating >= ');

      // Verify all filter params
      expect(params).toContainEqual(['Ресторан']);
      expect(params).toContainEqual(['Европейская']);
      expect(params).toContain('$$$');
      expect(params).toContain(4.5);
    });

    test('should handle pagination correctly', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '50' }], rowCount: 1 });

      const result = await searchByRadius({
        ...validParams,
        limit: 10,
        offset: 20,
      });

      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 50,
        totalPages: 5,
        hasNext: true,
        hasPrevious: false,
      });

      const params = pool.query.mock.calls[0][1];
      expect(params).toContain(10); // limit
      expect(params).toContain(20); // offset
    });

    test('should calculate hasNext/hasPrevious correctly', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '25' }], rowCount: 1 });

      // Last page (page=3)
      let result = await searchByRadius({
        ...validParams,
        limit: 10,
        offset: 20,
        page: 3,
      });
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrevious).toBe(true);

      // First page (page=1)
      result = await searchByRadius({
        ...validParams,
        limit: 10,
        offset: 0,
        page: 1,
      });
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrevious).toBe(false);
    });

    test('should include distance in results', async () => {
      const mockEstablishment = {
        ...createMockEstablishment(),
        distance_km: 2.5,
      };

      pool.query.mockResolvedValueOnce({ rows: [mockEstablishment], rowCount: 1 });
      pool.query.mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 });

      const result = await searchByRadius(validParams);

      expect(result.establishments[0]).toHaveProperty('distance_km');
      expect(result.establishments[0].distance_km).toBe(2.5);
    });

    test('should order results with Bayesian weighted rating', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius(validParams);

      const query = pool.query.mock.calls[0][0];
      // Default sort is 'rating' with hasDistance=true (searchByRadius)
      // Bayesian formula: (review_count * average_rating + 5 * 3.5) / (review_count + 5)
      expect(query).toContain('ne.review_count * ne.average_rating');
      expect(query).toContain('5 * 3.5');
      expect(query).toContain('ne.review_count DESC');
      expect(query).toContain('distance_km ASC');
      expect(query).toContain('ne.name ASC');
    });

    test('should only search active establishments', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius(validParams);

      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.status = $1');

      const params = pool.query.mock.calls[0][1];
      expect(params[0]).toBe('active');
    });
  });

  describe('dish filter via menu_items — category_raw + OR-alternative (prod defect 07.09.2026)', () => {
    const validParams = {
      latitude: 53.9,
      longitude: 27.5,
      radius: 10,
    };

    beforeEach(() => {
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });
    });

    test('searchByRadius: dish matches the menu section (category_raw), not only item_name', async () => {
      await searchByRadius({ ...validParams, dish: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain("mi.item_name ILIKE '%' || $");
      expect(query).toContain("mi.category_raw ILIKE '%' || $");
      expect(params).toContain('пицца');
    });

    test('searchWithoutLocation: dish matches the menu section (category_raw), not only item_name', async () => {
      await searchWithoutLocation({ dish: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain("mi.item_name ILIKE '%' || $");
      expect(query).toContain("mi.category_raw ILIKE '%' || $");
      expect(params).toContain('пицца');
    });

    test('dish alone stays strict: no establishment-level ILIKE, no synonym expansion', async () => {
      await searchWithoutLocation({ dish: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).not.toContain('e.name ILIKE');
      expect(params).not.toContainEqual(['Итальянская']);
    });

    // С А2 (27.09.2026) синонимы карточки — альтернатива меню только для
    // заведения без видимого меню: у 26 карточек прода меню распознано у всех,
    // и ветка «для всех» давала «пиво» → любой бар, «паста» → любой итальянский
    // ресторан. Форма: (EXISTS меню) OR (NOT EXISTS видимой позиции AND карточка).
    const CARD_ONLY_WITHOUT_MENU = new RegExp(
      '\\)\\s*OR\\s*\\(NOT EXISTS \\( SELECT 1 FROM menu_items vm WHERE vm\\.establishment_id = e\\.id '
      + 'AND vm\\.is_hidden_by_admin = FALSE \\) AND \\(e\\.name ILIKE'
    );

    test('dishOrSearch: menu match OR establishment ILIKE + SEARCH_SYNONYMS for establishments without a visible menu, in main and count queries', async () => {
      await searchWithoutLocation({ dish: 'пицца', dishOrSearch: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      const [countQuery, countParams] = pool.query.mock.calls[1];

      for (const q of [query, countQuery]) {
        const flat = q.replace(/\s+/g, ' ');
        // The alternative is OR-ed to the menu EXISTS — it widens, never
        // narrows — and only where no visible menu item exists.
        expect(flat).toMatch(CARD_ONLY_WITHOUT_MENU);
        expect(q).toContain('e.categories && $');
        expect(q).toContain('e.cuisines && $');
      }
      expect(params).toContain('пицца');
      expect(params).toContain('%пицца%');
      expect(params).toContainEqual(['Пиццерия']);
      expect(params).toContainEqual(['Итальянская']);
      // count query reuses the same WHERE params minus LIMIT/OFFSET
      expect(countParams).toEqual(params.slice(0, -2));
    });

    test('searchByRadius honours dishOrSearch the same way', async () => {
      await searchByRadius({ ...validParams, dish: 'пицца', dishOrSearch: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      expect(query.replace(/\s+/g, ' ')).toMatch(CARD_ONLY_WITHOUT_MENU);
      expect(params).toContainEqual(['Итальянская']);
    });
  });

  // --- А2 (27.09.2026): сопоставление блюда с меню по словам -----------------
  //
  // Умный поиск передаёт dishMatch: 'lenient'. Здесь — форма SQL и параметров;
  // что эта форма находит на настоящей базе, держит integration/smart-search.test.js
  // (блок «сопоставление с меню по словам (А2)»).
  describe('dish matched by words on the smart path (dishMatch: lenient, А2)', () => {
    beforeEach(() => {
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });
    });

    /** Строковые параметры после $1 (статус 'active') — слова, которые ушли в сопоставление. */
    const textParams = (params) => params.slice(1).filter((p) => typeof p === 'string');

    test('без dishMatch сопоставление прежнее: подстрока ILIKE, варианты не читаются', async () => {
      await searchWithoutLocation({ dish: 'суши', dishVariants: ['ролл'] });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain("mi.item_name ILIKE '%' || $");
      expect(query).not.toContain('ts_lexize');
      expect(query).not.toContain('word_similarity');
      expect(params).toContain('суши');
      expect(params).not.toContain('ролл');
    });

    test('lenient: начало слова по основе в тексте позиции (название + раздел, нижний регистр, ё/і/ў → е/и/у), без ILIKE', async () => {
      await searchWithoutLocation({ dish: 'Креветка', dishMatch: 'lenient' });

      const [query, params] = pool.query.mock.calls[0];
      const flat = query.replace(/\s+/g, ' ');
      expect(flat).toContain(
        "CROSS JOIN LATERAL (SELECT translate(lower(mi.item_name || ' ' || coalesce(mi.category_raw, '')), 'ёіў', 'еиу') AS folded OFFSET 0) item_text"
      );
      expect(flat).toContain("item_text.folded ~ ('(^|[^а-яa-z0-9])' || left($");
      expect(flat).toContain("ts_lexize('russian_stem', $");
      expect(query).not.toContain('ILIKE');
      expect(textParams(params)).toEqual(['креветка']);
    });

    test('lenient: основа не короче четырёх букв слова, у слова из четырёх — трёх; слово до трёх букв — целиком', async () => {
      await searchWithoutLocation({ dish: 'лосось', dishVariants: ['утка', 'суп'], dishMatch: 'lenient' });

      const flat = pool.query.mock.calls[0][0].replace(/\s+/g, ' ');
      const params = pool.query.mock.calls[0][1];
      const at = (word) => `$${params.indexOf(word) + 1}::text`;
      // «лосось»: стеммер отдаёт «лос», начало берётся не короче 4 букв → «лосо».
      expect(flat).toContain(`greatest(length(coalesce((ts_lexize('russian_stem', ${at('лосось')}))[1], ${at('лосось')})), 4)`);
      // «утка»: основа «утк» (3) допустима — иначе «утки», «уткой» не найти.
      expect(flat).toContain(`greatest(length(coalesce((ts_lexize('russian_stem', ${at('утка')}))[1], ${at('утка')})), 3)`);
      // «суп»: целиком, без стеммера.
      expect(flat).toContain(`item_text.folded ~ ('(^|[^а-яa-z0-9])' || ${at('суп')})`);
      expect(flat).not.toContain(`ts_lexize('russian_stem', ${at('суп')})`);
    });

    test('lenient: нечёткое совпадение только у кириллических слов от пяти букв, порог 0.65', async () => {
      await searchWithoutLocation({ dish: 'тирамису', dishVariants: ['tiramisu', 'торт'], dishMatch: 'lenient' });

      const [query, params] = pool.query.mock.calls[0];
      const similarity = query.match(/word_similarity\(\$(\d+)::text, item_text\.folded\) >= ([\d.]+)/g) || [];
      expect(similarity).toHaveLength(1);
      expect(similarity[0]).toBe(`word_similarity($${params.indexOf('тирамису') + 1}::text, item_text.folded) >= 0.65`);
    });

    test('lenient: регистр и ё/і/ў свёрнуты, предлоги и однобуквенные слова отброшены', async () => {
      await searchWithoutLocation({ dish: 'Сырнікі со сметаной', dishVariants: ['Зелёный чай с мёдом', 'Ўзвар'], dishMatch: 'lenient' });

      const params = pool.query.mock.calls[0][1];
      expect(textParams(params)).toEqual(['сырники', 'сметаной', 'зеленый', 'чай', 'медом', 'узвар']);
    });

    test('lenient: не больше шести названий и четырёх слов в названии, повторы одного названия не множат SQL', async () => {
      await searchWithoutLocation({
        dish: 'пицца четыре сыра с грушей и мёдом',
        dishVariants: ['Пицца четыре сыра с грушей и медом', 'один', 'два', 'три', 'четыре', 'пять', 'шесть'],
        dishMatch: 'lenient',
      });

      const params = pool.query.mock.calls[0][1];
      // Шесть названий: блюдо (4 слова), его повтор (пропущен) и четыре варианта;
      // «пять» и «шесть» — седьмое и восьмое название — отрезаны.
      expect(textParams(params)).toEqual(['пицца', 'четыре', 'сыра', 'грушей', 'один', 'два', 'три', 'четыре']);
    });

    test('lenient: символы регулярного выражения до шаблона не доходят — слова только из букв и цифр', async () => {
      await searchWithoutLocation({ dish: 'пицца.*', dishVariants: ['(кофе|чай)', '7up+'], dishMatch: 'lenient' });

      const params = pool.query.mock.calls[0][1];
      expect(textParams(params)).toEqual(['пицца', 'кофе', 'чай', '7up']);
      for (const p of textParams(params)) expect(p).toMatch(/^[a-zа-я0-9]+$/);
    });

    test('lenient: без единого слова для поиска меню не отвечает ничем (FALSE), а не всем', async () => {
      await searchWithoutLocation({ dish: 'с', dishMatch: 'lenient' });

      const [query, params] = pool.query.mock.calls[0];
      expect(query.replace(/\s+/g, ' ')).toContain('AND mi.is_hidden_by_admin = FALSE AND FALSE AND');
      expect(textParams(params)).toEqual([]);
    });

    test('lenient: скрытые модератором позиции и бюджет — как у строгого сопоставления; счёт идёт с теми же параметрами', async () => {
      await searchWithoutLocation({ dish: 'стейк', priceMaxByn: 50, dishMatch: 'lenient' });

      const [query, params] = pool.query.mock.calls[0];
      const [countQuery, countParams] = pool.query.mock.calls[1];
      for (const q of [query, countQuery]) {
        const flat = q.replace(/\s+/g, ' ');
        expect(flat).toContain('AND mi.is_hidden_by_admin = FALSE AND');
        expect(flat).toContain('OR mi.price_byn <= $');
        expect(flat).toContain('AND p.discount_price_byn <= $');
      }
      expect(params).toContain(50);
      expect(countParams).toEqual(params.slice(0, -2));
    });

    test('searchByRadius передаёт dishMatch и dishVariants так же', async () => {
      await searchByRadius({ latitude: 53.9, longitude: 27.5, radius: 10, dish: 'суши', dishVariants: ['ролл'], dishMatch: 'lenient' });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain("ts_lexize('russian_stem', $");
      expect(textParams(params)).toEqual(expect.arrayContaining(['суши', 'ролл']));
    });
  });

  // --- Поиск по названию (29.09.2026): «только эти» / «кроме этих» ----------
  //
  // Умный поиск выбирает совпавшие по названию заведения запросом с
  // includeIds, а основную выдачу — с excludeIds, чтобы не показать дважды.
  describe('includeIds / excludeIds — совпадения по названию', () => {
    beforeEach(() => {
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });
    });

    test('includeIds: только эти заведения — в основном запросе и в счёте', async () => {
      await searchWithoutLocation({ includeIds: ['id-1', 'id-2'] });

      const [query, params] = pool.query.mock.calls[0];
      const [countQuery, countParams] = pool.query.mock.calls[1];
      const at = `$${params.findIndex((p) => Array.isArray(p) && p[0] === 'id-1') + 1}`;
      for (const q of [query, countQuery]) {
        expect(q).toContain(`e.id = ANY(${at}::uuid[])`);
        expect(q).not.toContain('NOT (e.id');
      }
      expect(params).toContainEqual(['id-1', 'id-2']);
      expect(countParams).toEqual(params.slice(0, -2));
    });

    test('excludeIds: кроме этих — в основном запросе и в счёте', async () => {
      await searchWithoutLocation({ excludeIds: ['id-3'] });

      const [query, params] = pool.query.mock.calls[0];
      const [countQuery] = pool.query.mock.calls[1];
      const at = `$${params.findIndex((p) => Array.isArray(p) && p[0] === 'id-3') + 1}`;
      for (const q of [query, countQuery]) {
        expect(q).toContain(`NOT (e.id = ANY(${at}::uuid[]))`);
      }
    });

    test('пустой includeIds — ноль строк, а не все; пустой excludeIds условия не добавляет', async () => {
      await searchWithoutLocation({ includeIds: [], excludeIds: [] });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain('e.id = ANY($');
      expect(query).not.toContain('NOT (e.id');
      expect(params).toContainEqual([]);
    });

    test('без параметров условий по id нет — прежний SQL', async () => {
      await searchWithoutLocation({});

      const [query] = pool.query.mock.calls[0];
      expect(query).not.toContain('e.id = ANY');
    });

    test('searchByRadius принимает оба параметра так же', async () => {
      await searchByRadius({ latitude: 53.9, longitude: 27.5, radius: 10, includeIds: ['id-1'], excludeIds: ['id-2'] });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain('e.id = ANY($');
      expect(query).toContain('NOT (e.id = ANY($');
      expect(params).toContainEqual(['id-1']);
      expect(params).toContainEqual(['id-2']);
    });
  });

  describe('searchByBounds', () => {
    test('should search establishments within map bounds', async () => {
      const mockEstablishments = [createMockEstablishment()];

      pool.query.mockResolvedValue({
        rows: mockEstablishments,
        rowCount: 1,
      });

      const result = await searchByBounds({
        minLat: 53.85,
        maxLat: 53.95,
        minLon: 27.45,
        maxLon: 27.55,
      });

      // Each establishment is now passed through toPublicEstablishmentListing
      // (Brief 1 fix-in-place). Verify identity + public fields preserved; full
      // sensitivity exclusion is asserted in projections.test.js + search.test.js.
      expect(result.establishments.length).toBe(mockEstablishments.length);
      expect(result.establishments[0].id).toBe(mockEstablishments[0].id);
      expect(result.establishments[0].name).toBe(mockEstablishments[0].name);
      expect(result.establishments[0].city).toBe(mockEstablishments[0].city);
      expect(result.establishments[0].categories).toEqual(mockEstablishments[0].categories);
      expect(result.establishments[0]).toHaveProperty('has_promotion');
      expect(result.establishments[0]).toHaveProperty('promotion_count');

      // Verify query uses bounding box
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.latitude BETWEEN');
      expect(query).toContain('e.longitude BETWEEN');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContain(53.85); // minLat
      expect(params).toContain(53.95); // maxLat
      expect(params).toContain(27.45); // minLon
      expect(params).toContain(27.55); // maxLon
    });

    test('should validate bounds parameters', async () => {
      await expect(
        searchByBounds({ minLat: 53.9, maxLat: 53.8, minLon: 27.4, maxLon: 27.6 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      await expect(
        searchByBounds({ minLat: 53.8, maxLat: 53.9, minLon: 27.6, maxLon: 27.4 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('checkSearchHealth', () => {
    test('should return healthy when PostGIS available', async () => {
      pool.query.mockResolvedValue({
        rows: [{ version: '3.1.1' }],
        rowCount: 1,
      });

      const result = await checkSearchHealth();

      expect(result.healthy).toBe(true);
      expect(result.postgis).toBe('3.1.1');

      expect(pool.query).toHaveBeenCalledWith(`
      SELECT PostGIS_version() as version
    `);
    });

    test('should return unhealthy when PostGIS not available', async () => {
      pool.query.mockRejectedValue(new Error('function postgis_version does not exist'));

      const result = await checkSearchHealth();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
