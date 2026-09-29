/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: smartSearchService.buildSmartSearchFilters
 *
 * Segment B introduces `dish` and routes `price_max` based on its presence:
 *   - With dish:    price_max → priceMaxByn (literal BYN on menu_items.price_byn)
 *   - Without dish: price_max → priceRange (legacy subjective tier mapping)
 */

import { buildSmartSearchFilters, tagsToAttributes } from '../../services/smartSearchService.js';
import { ATTRIBUTE_CANON } from '../../constants/establishmentVocab.js';

describe('buildSmartSearchFilters — dish routing', () => {
  test('sets filters.dish when intent.dish is non-empty', () => {
    const intent = {
      dish: 'кофе',
      category: null,
      cuisine: null,
      price_max: null,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.dish).toBe('кофе');
    expect(filters.priceRange).toBeUndefined();
    expect(filters.priceMaxByn).toBeUndefined();
  });

  test('does NOT set filters.dish when intent.dish is null', () => {
    const intent = {
      dish: null,
      category: 'Кофейня',
      cuisine: null,
      price_max: null,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.dish).toBeUndefined();
    expect(filters.categories).toEqual(['Кофейня']);
  });
});

describe('buildSmartSearchFilters — price routing with/without dish', () => {
  test('price_max routes to priceMaxByn when dish is set', () => {
    const intent = {
      dish: 'бургер',
      category: null,
      cuisine: null,
      price_max: 10,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.priceMaxByn).toBe(10);
    expect(filters.priceRange).toBeUndefined();
  });

  test('price_max routes to priceRange when dish is NOT set (legacy)', () => {
    const intent = {
      dish: null,
      category: 'Кофейня',
      cuisine: null,
      price_max: 12,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.priceMaxByn).toBeUndefined();
    expect(filters.priceRange).toEqual(['$']);
  });

  test('price_max=25 maps to ["$", "$$"] without dish', () => {
    const intent = {
      dish: null,
      category: null,
      cuisine: null,
      price_max: 25,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    expect(buildSmartSearchFilters(intent).priceRange).toEqual(['$', '$$']);
  });

  test('price_max=100 maps to ["$", "$$", "$$$"] without dish', () => {
    const intent = {
      dish: null,
      category: null,
      cuisine: null,
      price_max: 100,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    expect(buildSmartSearchFilters(intent).priceRange).toEqual(['$', '$$', '$$$']);
  });

  test('dish + price_max together: both filters set correctly', () => {
    const intent = {
      dish: 'кофе',
      category: null,
      cuisine: null,
      price_max: 5,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.dish).toBe('кофе');
    expect(filters.priceMaxByn).toBe(5);
    expect(filters.priceRange).toBeUndefined();
  });
});

describe('buildSmartSearchFilters — tags alongside dish (prod defect 07.09.2026)', () => {
  // The parser restates the dish word in tags ("пицца" → dish="пицца",
  // tags=["пицца"]). Until the fix, tags became `filters.search` — an
  // establishment-level ILIKE AND-ed with the menu_items EXISTS — so any dish
  // outside SEARCH_SYNONYMS ("капучино") returned zero rows.
  const base = {
    category: null,
    cuisine: null,
    price_max: null,
    meal_type: null,
    location: null,
    sort: null,
    error: null,
  };

  test('with dish, tags are NOT applied as establishment-level search (no AND filter)', () => {
    const filters = buildSmartSearchFilters({ ...base, dish: 'капучино', tags: ['капучино'] });

    expect(filters.dish).toBe('капучино');
    expect(filters.search).toBeUndefined();
  });

  test('with dish and no budget, the dish term rides as an OR-alternative (dishOrSearch)', () => {
    const filters = buildSmartSearchFilters({ ...base, dish: 'пицца', tags: ['пицца'] });

    expect(filters.dish).toBe('пицца');
    expect(filters.dishOrSearch).toBe('пицца');
    expect(filters.search).toBeUndefined();
  });

  test('with dish and price_max, no OR-alternative: a stated budget needs a menu-verified match', () => {
    const filters = buildSmartSearchFilters({ ...base, dish: 'пицца', tags: ['пицца'], price_max: 20 });

    expect(filters.dish).toBe('пицца');
    expect(filters.priceMaxByn).toBe(20);
    expect(filters.dishOrSearch).toBeUndefined();
    expect(filters.search).toBeUndefined();
  });

  test('without dish, amenity tags become the amenity filter — never card text search (29.09.2026)', () => {
    // Until 29.09 this asserted search = 'терраса wifi': an ILIKE over the card
    // text that no prod card could satisfy (no descriptions; amenities live in
    // attributes) — every tag phrase returned zero rows.
    const filters = buildSmartSearchFilters({ ...base, dish: null, tags: ['терраса', 'wifi'] });

    expect(filters.features).toEqual(['wifi', 'terrace']);
    expect(filters.search).toBeUndefined();
    expect(filters.dish).toBeUndefined();
    expect(filters.dishOrSearch).toBeUndefined();
  });
});
// ─── Явные фильтры экрана против догадок разбора ─────────────────────────────
//
// Решение 07.09.2026: строка поиска на mobile всегда ходит в умный эндпоинт,
// значит фильтры экрана (цена, часы, удобства, сортировка) должны работать и
// там. Спор возникает там, где разбор фразы подставил значение в ТОЙ ЖЕ
// размерности: «недорого» → ярус цены против снятой пользователем карточки
// «$$». Правило — контрол сильнее догадки; разные размерности складываются.

function intentOf(extra = {}) {
  return {
    dish: null, category: null, cuisine: null, price_max: null,
    meal_type: null, location: null, sort: null, tags: [], error: null, ...extra,
  };
}

describe('buildSmartSearchFilters — явное сильнее выведенного', () => {
  test('явный ярус цены заменяет ярусную подстановку из price_max', () => {
    // «до 10 рублей» без блюда подставляет ['$']; пользователь при этом
    // держит включённой карточку '$$$'. Побеждает карточка.
    const filters = buildSmartSearchFilters(
      intentOf({ price_max: 10 }),
      {},
      { priceRange: ['$$$'] },
    );

    expect(filters.priceRange).toEqual(['$$$']);
  });

  test('без явного яруса ярусная подстановка работает как раньше', () => {
    // Сохранённое поведение: если этот тест позеленеет при вырезанной
    // подстановке, он ничего не сторожит.
    const filters = buildSmartSearchFilters(intentOf({ price_max: 10 }), {});

    expect(filters.priceRange).toEqual(['$']);
  });

  test('бюджет блюда и явный ярус цены сосуществуют — размерности разные', () => {
    // priceMaxByn — цена позиции меню, priceRange — ценовой класс заведения.
    // «пицца за 20 рублей» с карточкой '$$' = позиция дешевле 20 BYN в
    // заведении класса '$$', а не выбор одного из двух.
    const filters = buildSmartSearchFilters(
      intentOf({ dish: 'пицца', price_max: 20 }),
      {},
      { priceRange: ['$$'] },
    );

    expect(filters.priceMaxByn).toBe(20);
    expect(filters.priceRange).toEqual(['$$']);
  });

  test('без явного яруса бюджет блюда по-прежнему НЕ подставляет ярус', () => {
    const filters = buildSmartSearchFilters(intentOf({ dish: 'пицца', price_max: 20 }), {});

    expect(filters.priceMaxByn).toBe(20);
    expect(filters.priceRange).toBeUndefined();
  });

  test('явная сортировка сильнее intent.sort', () => {
    const filters = buildSmartSearchFilters(
      intentOf({ sort: 'rating' }),
      {},
      { sortBy: 'price_asc' },
    );

    expect(filters.sortBy).toBe('price_asc');
  });

  test('явная сортировка сильнее умолчания по координатам', () => {
    const filters = buildSmartSearchFilters(
      intentOf(),
      { latitude: 53.9, longitude: 27.5 },
      { sortBy: 'rating' },
    );

    expect(filters.sortBy).toBe('rating');
  });

  test('без явной сортировки умолчание по координатам прежнее', () => {
    expect(buildSmartSearchFilters(intentOf(), { latitude: 53.9, longitude: 27.5 }).sortBy)
      .toBe('distance');
    expect(buildSmartSearchFilters(intentOf(), {}).sortBy).toBe('rating');
  });

  test('явные категории и кухни заменяют выведенные из фразы', () => {
    const filters = buildSmartSearchFilters(
      intentOf({ category: 'Кофейня', cuisine: ['Итальянская'] }),
      {},
      { categories: ['Бар'], cuisines: ['Японская'] },
    );

    expect(filters.categories).toEqual(['Бар']);
    expect(filters.cuisines).toEqual(['Японская']);
  });

  test('размерности, которых разбор не касается, пробрасываются как есть', () => {
    const filters = buildSmartSearchFilters(intentOf(), {}, {
      hoursFilter: 'until_22',
      features: ['wifi', 'terrace'],
      minRating: 4,
      maxDistance: 3,
      radius: 5,
    });

    expect(filters.hoursFilter).toBe('until_22');
    expect(filters.features).toEqual(['wifi', 'terrace']);
    expect(filters.minRating).toBe(4);
    expect(filters.maxDistance).toBe(3);
    expect(filters.radius).toBe(5);
  });

  test('город из фразы по-прежнему сильнее города контекста', () => {
    // Намеренно не тронуто: город, названный вслух, тоже явный.
    const filters = buildSmartSearchFilters(
      intentOf({ location: 'Гомель' }),
      { city: 'Минск' },
      { categories: ['Бар'] },
    );

    expect(filters.city).toBe('Гомель');
  });

  test('пустые явные фильтры не добавляют ключей вовсе', () => {
    // Ключ со значением null затёр бы умолчание searchService; ключ с пустым
    // массивом обнулил бы выдачу в SQL.
    const withEmpty = buildSmartSearchFilters(intentOf({ category: 'Кофейня' }), {}, {});
    const withNothing = buildSmartSearchFilters(intentOf({ category: 'Кофейня' }), {});

    expect(withEmpty).toEqual(withNothing);
    expect(withEmpty.categories).toEqual(['Кофейня']);
    expect('hoursFilter' in withEmpty).toBe(false);
    expect('features' in withEmpty).toBe(false);
  });
});

// ─── Разводка полей разбора (А1, 24.09.2026) ─────────────────────────────────
//
// Прод 24.09: из 995 ожидаемых пар «запрос × заведение» найдено 58 %. Слой
// разводки терял запросы целиком: «Рядом со мной» становилось фильтром города,
// meal_type выбрасывался («Завтрак» = 0 при разделе «ЗАВТРАКИ» у 12 заведений),
// кухня, додуманная к блюду, резала выдачу по И («Суши» → «Японская»: 1 из 5).

describe('buildSmartSearchFilters — разводка полей разбора (А1)', () => {
  const minsk = { city: 'Минск', latitude: 53.9, longitude: 27.56 };

  test('«Рядом со мной» в location не становится городом — город берётся из контекста', () => {
    const filters = buildSmartSearchFilters(intentOf({ location: 'Рядом со мной' }), minsk);

    expect(filters.city).toBe('Минск');
  });

  test('не-город без города в контексте — фильтра города нет вовсе', () => {
    const filters = buildSmartSearchFilters(intentOf({ location: 'на Немиге' }), {});

    expect('city' in filters).toBe(false);
  });

  test('город из списка — в каноническом написании, регистр и «е» вместо «ё» не мешают', () => {
    const filters = buildSmartSearchFilters(intentOf({ location: 'МОГИЛЕВ' }), minsk);

    expect(filters.city).toBe('Могилёв');
  });

  test('breakfast без блюда — поиск по меню словом «завтрак», вариант «бранч», без dishOrSearch', () => {
    // Прежний промпт клал приём пищи ещё и в теги — как фильтр карточки тег
    // обнулил бы выдачу, поэтому при слове для меню теги отброшены.
    const filters = buildSmartSearchFilters(
      intentOf({ meal_type: 'breakfast', tags: ['завтрак'] }),
      minsk,
    );

    expect(filters.dish).toBe('завтрак');
    expect(filters.dishVariants).toEqual(['бранч']);
    expect(filters.dishOrSearch).toBeUndefined();
    expect(filters.search).toBeUndefined();
  });

  test('lunch без блюда — слово «ланч», вариантов нет', () => {
    const filters = buildSmartSearchFilters(intentOf({ meal_type: 'lunch' }), minsk);

    expect(filters.dish).toBe('ланч');
    expect('dishVariants' in filters).toBe(false);
    expect(filters.dishOrSearch).toBeUndefined();
  });

  test('ужина разделом в меню нет — меню по нему не ищется', () => {
    const filters = buildSmartSearchFilters(intentOf({ meal_type: 'dinner' }), minsk);

    expect(filters.dish).toBeUndefined();
    expect('dishVariants' in filters).toBe(false);
  });

  test('блюдо сильнее приёма пищи: «сырники на завтрак» ищут сырники', () => {
    const filters = buildSmartSearchFilters(
      intentOf({ dish: 'сырники', meal_type: 'breakfast' }),
      minsk,
    );

    expect(filters.dish).toBe('сырники');
    expect(filters.dishOrSearch).toBe('сырники');
    expect('dishVariants' in filters).toBe(false);
  });

  test('бюджет при приёме пищи — цена позиции меню, а не ярус заведения', () => {
    // «бизнес-ланч до 20 рублей» — ланч дешевле 20 BYN.
    const filters = buildSmartSearchFilters(intentOf({ meal_type: 'lunch', price_max: 20 }), minsk);

    expect(filters.priceMaxByn).toBe(20);
    expect(filters.priceRange).toBeUndefined();
  });

  test('при блюде тип и кухня из фразы не применяются', () => {
    const filters = buildSmartSearchFilters(
      intentOf({ dish: 'суши', cuisine: ['Японская'], category: 'Ресторан' }),
      minsk,
    );

    expect(filters.dish).toBe('суши');
    expect(filters.cuisines).toBeUndefined();
    expect(filters.categories).toBeUndefined();
  });

  test('при приёме пищи тип и кухня из фразы тоже не применяются', () => {
    const filters = buildSmartSearchFilters(
      intentOf({ meal_type: 'breakfast', category: 'Кафе', cuisine: ['Европейская'] }),
      minsk,
    );

    expect(filters.categories).toBeUndefined();
    expect(filters.cuisines).toBeUndefined();
  });

  test('явные тип и кухня экрана при блюде применяются, как раньше', () => {
    const filters = buildSmartSearchFilters(
      intentOf({ dish: 'суши', cuisine: ['Японская'] }),
      minsk,
      { categories: ['Бар'], cuisines: ['Азиатская'] },
    );

    expect(filters.categories).toEqual(['Бар']);
    expect(filters.cuisines).toEqual(['Азиатская']);
  });

  test('варианты блюда уходят дальше как dishVariants', () => {
    const filters = buildSmartSearchFilters(
      intentOf({ dish: 'суши', dish_variants: ['ролл', 'сашими'] }),
      minsk,
    );

    expect(filters.dishVariants).toEqual(['ролл', 'сашими']);
  });

  test('пустые варианты не добавляют ключа dishVariants', () => {
    const filters = buildSmartSearchFilters(intentOf({ dish: 'кофе', dish_variants: [] }), minsk);

    expect('dishVariants' in filters).toBe(false);
  });

  test('варианты приёма пищи — копия: правка выдачи одного запроса не протекает в следующий', () => {
    // Список «бранч» живёт в модуле; отдай его ссылкой — и любой, кто
    // допишет в filters.dishVariants, изменит его для всех последующих запросов.
    const first = buildSmartSearchFilters(intentOf({ meal_type: 'breakfast' }), minsk);
    first.dishVariants.push('чужое');

    const second = buildSmartSearchFilters(intentOf({ meal_type: 'breakfast' }), minsk);
    expect(second.dishVariants).toEqual(['бранч']);
  });
});

// --- А2 (27.09.2026): сопоставление с меню по словам ------------------------
//
// Слово для меню умный поиск сопоставляет по словам (основа, опечатка, ё/і/ў,
// варианты) — searchService включает это только по явному dishMatch: 'lenient'.
// Одиночный dish там строгий: его зовут и помимо умного поиска.

describe('buildSmartSearchFilters — сопоставление с меню по словам (А2)', () => {
  const minsk = { city: 'Минск', latitude: 53.9, longitude: 27.56 };

  test('при блюде сопоставление по словам включено — и с бюджетом тоже', () => {
    const plain = buildSmartSearchFilters(intentOf({ dish: 'лосось' }), minsk);
    const budget = buildSmartSearchFilters(intentOf({ dish: 'лосось', price_max: 30 }), minsk);

    expect(plain.dishMatch).toBe('lenient');
    expect(budget.dishMatch).toBe('lenient');
    expect(budget.priceMaxByn).toBe(30);
  });

  test('при приёме пищи — тоже: «завтрак» находит раздел «ЗАВТРАКИ» основой слова', () => {
    const filters = buildSmartSearchFilters(intentOf({ meal_type: 'breakfast' }), minsk);

    expect(filters.dish).toBe('завтрак');
    expect(filters.dishMatch).toBe('lenient');
  });

  test('без слова для меню ключа dishMatch нет', () => {
    const filters = buildSmartSearchFilters(intentOf({ category: 'Кофейня', tags: ['терраса'] }), minsk);

    expect('dish' in filters).toBe(false);
    expect('dishMatch' in filters).toBe(false);
  });
});

// --- Теги: удобства → фильтр, прочие слова не режут (29.09.2026) -------------
//
// Прод 29.09: 28 фраз из 28, где разбор положил слово в tags, дали ноль
// заведений. Теги искались текстом карточки (название, описание, тип, кухня) по
// И, а описаний нет ни у одной из 26 карточек, удобства же лежат в attributes:
// «с террасой» — ноль при террасе у 19. Решение Координатора 29.09: удобство из
// фразы — фильтр удобств, как кнопка экрана, и при блюде тоже; прочие слова
// («уютное», «с видом») выдачу не режут.

describe('buildSmartSearchFilters — теги: удобства → фильтр, прочее не режет', () => {
  const minsk = { city: 'Минск', latitude: 53.9, longitude: 27.56 };

  test('«с террасой» — фильтр удобства terrace, а не поиск по тексту карточки', () => {
    const filters = buildSmartSearchFilters(intentOf({ tags: ['терраса'] }), minsk);

    expect(filters.features).toEqual(['terrace']);
    expect('search' in filters).toBe(false);
  });

  test('слово обстановки не фильтрует: «уютное место» — те же фильтры, что у пустого разбора', () => {
    // До 29.09 — ILIKE '%уютное%' по И: ноль заведений на проде.
    const cozy = buildSmartSearchFilters(intentOf({ tags: ['уютное'] }), minsk);

    expect(cozy).toEqual(buildSmartSearchFilters(intentOf(), minsk));
    expect('search' in cozy).toBe(false);
    expect('features' in cozy).toBe(false);
  });

  test('обстановка рядом с удобством — фильтр только по удобству', () => {
    const filters = buildSmartSearchFilters(intentOf({ tags: ['уютное', 'живая музыка'] }), minsk);

    expect(filters.features).toEqual(['live_music']);
    expect('search' in filters).toBe(false);
  });

  test('тип из фразы и удобство складываются: «кофейня с wifi»', () => {
    const filters = buildSmartSearchFilters(intentOf({ category: 'Кофейня', tags: ['wifi'] }), minsk);

    expect(filters.categories).toEqual(['Кофейня']);
    expect(filters.features).toEqual(['wifi']);
  });

  test('удобство из фразы складывается с кнопками экрана, повтор схлопывается', () => {
    // Не «явное сильнее выведенного»: удобства — требования по И, а не выбор
    // одного из вариантов. Фраза просит террасу, кнопка — Wi-Fi: нужны оба.
    const both = buildSmartSearchFilters(intentOf({ tags: ['терраса'] }), minsk, { features: ['wifi'] });
    const same = buildSmartSearchFilters(intentOf({ tags: ['летняя веранда'] }), minsk, { features: ['terrace'] });

    expect(both.features).toEqual(['wifi', 'terrace']);
    expect(same.features).toEqual(['terrace']);
  });

  test('кнопки экрана без удобства во фразе — прежний проброс', () => {
    const filters = buildSmartSearchFilters(intentOf({ tags: ['уютное'] }), minsk, { features: ['parking'] });

    expect(filters.features).toEqual(['parking']);
  });

  test('массив кнопок экрана не меняется и не отдаётся по ссылке', () => {
    const explicit = { features: ['wifi'] };
    const filters = buildSmartSearchFilters(intentOf({ tags: ['доставка'] }), minsk, explicit);
    filters.features.push('чужое');

    expect(explicit.features).toEqual(['wifi']);
  });

  test('удобство действует и при блюде: «пицца с доставкой» — пиццерии с доставкой', () => {
    // До 29.09 теги при блюде отбрасывались целиком — «доставка» молча терялась.
    const filters = buildSmartSearchFilters(intentOf({ dish: 'пицца', tags: ['доставка'] }), minsk);

    expect(filters.dish).toBe('пицца');
    expect(filters.dishOrSearch).toBe('пицца');
    expect(filters.dishMatch).toBe('lenient');
    expect(filters.features).toEqual(['delivery']);
    expect('search' in filters).toBe(false);
  });

  test('и при приёме пищи: «завтрак на террасе»', () => {
    const filters = buildSmartSearchFilters(intentOf({ meal_type: 'breakfast', tags: ['терраса'] }), minsk);

    expect(filters.dish).toBe('завтрак');
    expect(filters.features).toEqual(['terrace']);
  });

  test('слово блюда, повторённое в тегах, фильтром не становится (класс дефекта 07.09)', () => {
    // Весь класс держат ловушки словаря ниже (курица, курёнок, хот-дог…) и
    // сверка словаря с меню прода: ни одна из 2 350 позиций и 326 разделов не
    // отображается на удобство (docs/handoffs/smart_search_tags_20260929/).
    for (const [dish, tags] of [['пицца', ['пицца']], ['курёнок', ['курёнок гриль']], ['хот-дог', ['hot dog']]]) {
      const filters = buildSmartSearchFilters(intentOf({ dish, tags }), minsk);

      expect('features' in filters).toBe(false);
      expect('search' in filters).toBe(false);
    }
  });

  test('«ресторан без курения» — не фильтр курения, выдача по типу', () => {
    const filters = buildSmartSearchFilters(intentOf({ category: 'Ресторан', tags: ['без курения'] }), minsk);

    expect(filters.categories).toEqual(['Ресторан']);
    expect('features' in filters).toBe(false);
  });
});

describe('tagsToAttributes — слово тега → ключ канона удобств', () => {
  // Фраза — как её кладёт разбор (прод 29.09: «с террасой» и «летняя веранда»
  // → "терраса", «где можно покурить» → "курить"), ключ — канон AF1 (SDL
  // CAT-C-3.15). Словоформы — причина, по которой правила состоят из основ.
  // У каждой альтернативы каждого правила — своя строка с настоящим словом:
  // опечатка в основе иначе прошла бы молча.
  const CASES = [
    ['доставка', 'delivery'], ['с доставкой', 'delivery'], ['доставляют домой', 'delivery'], ['delivery', 'delivery'],
    ['wifi', 'wifi'], ['Wi‑Fi', 'wifi'], ['wi fi', 'wifi'], ['вай-фай', 'wifi'], ['с вайфаем', 'wifi'], ['с интернетом', 'wifi'],
    ['терраса', 'terrace'], ['с террасой', 'terrace'], ['терасса', 'terrace'], ['летняя веранда', 'terrace'],
    ['летник', 'terrace'], ['летняя площадка', 'terrace'], ['на свежем воздухе', 'terrace'], ['terrace', 'terrace'],
    ['парковка', 'parking'], ['с парковкой', 'parking'], ['парковочное место', 'parking'], ['паркинг', 'parking'],
    ['где припарковаться', 'parking'], ['parking', 'parking'],
    ['живая музыка', 'live_music'], ['с живой музыкой', 'live_music'], ['живой звук', 'live_music'], ['live music', 'live_music'],
    ['детская комната', 'kids_zone'], ['детская зона', 'kids_zone'], ['детская площадка', 'kids_zone'],
    ['детский уголок', 'kids_zone'], ['игровая комната', 'kids_zone'], ['игровая зона', 'kids_zone'],
    ['kids room', 'kids_zone'], ['kids zone', 'kids_zone'], ['playroom', 'kids_zone'],
    ['банкетный зал', 'banquet'], ['banquet hall', 'banquet'],
    ['можно с собакой', 'pets_allowed'], ['с собачкой', 'pets_allowed'], ['домашние животные', 'pets_allowed'],
    ['для животных', 'pets_allowed'], ['с животными', 'pets_allowed'], ['с питомцем', 'pets_allowed'],
    ['pet-friendly', 'pets_allowed'], ['dog friendly', 'pets_allowed'], ['petfriendly', 'pets_allowed'],
    ['dogfriendly', 'pets_allowed'],
    ['курить', 'smoking'], ['зал для курения', 'smoking'], ['для курящих', 'smoking'], ['где покурить', 'smoking'],
    ['курилка', 'smoking'], ['smoking area', 'smoking'],
    ['доступная среда', 'accessible_environment'], ['доступность среды', 'accessible_environment'],
    ['в доступной среде', 'accessible_environment'], ['доступную среду', 'accessible_environment'],
    ['с доступной средой', 'accessible_environment'], ['для колясочников', 'accessible_environment'],
    ['пандус', 'accessible_environment'], ['безбарьерный вход', 'accessible_environment'],
    ['для инвалидов', 'accessible_environment'],
  ];

  test.each(CASES)('«%s» → %s', (tag, key) => {
    expect(tagsToAttributes([tag])).toEqual([key]);
  });

  test('словарь покрывает весь канон удобств и не выходит за него', () => {
    // Новый ключ канона без слов или опечатка в ключе правила — красный здесь,
    // а не фильтр по несуществующему ключу, обнуляющий выдачу на проде.
    const produced = new Set(CASES.flatMap(([tag]) => tagsToAttributes([tag])));

    expect([...produced].sort()).toEqual([...ATTRIBUTE_CANON].sort());
  });

  test.each([
    ['детское меню'], ['kids menu'], ['курица'], ['куриный суп'], ['курёнок'], ['курёнок гриль'],
    ['у парка'], ['парковая зона'], ['доступные цены'], ['доступный средний чек'], ['доступно по средам'],
    ['животный белок'], ['хот-дог'], ['hot dog'], ['smoked salmon'], ['живое пиво'],
  ])('ловушка «%s» — не удобство', (tag) => {
    expect(tagsToAttributes([tag])).toEqual([]);
  });

  test.each([
    ['без курения'], ['не курить'], ['нельзя курить'], ['курение запрещено'], ['non-smoking'], ['no smoking'],
    ['без собак'], ['без животных'], ['без живой музыки'], ['без детской комнаты'], ['некурящий зал'],
  ])('отрицание «%s» — не удобство: иначе фильтр выбрал бы ровно противоположное', (tag) => {
    // Ревью 29.09: «без курения» становилось фильтром smoking — единственное
    // место прода, где курить можно. Исключающего фильтра нет: отсутствие
    // удобства в карточке значит «не отмечено», а не «нет».
    expect(tagsToAttributes([tag])).toEqual([]);
  });

  test('отрицание гасит только свой тег: «без курения» + «терраса» — терраса', () => {
    expect(tagsToAttributes(['без курения', 'терраса'])).toEqual(['terrace']);
  });

  test.each([['уютное'], ['с видом'], ['романтический'], ['тихое место'], ['для большой компании']])(
    'слово обстановки «%s» — не удобство',
    (tag) => {
      expect(tagsToAttributes([tag])).toEqual([]);
    },
  );

  test('ключи — в порядке канона и без повторов, как бы ни шли слова', () => {
    expect(tagsToAttributes(['живая музыка', 'уютное', 'терраса', 'доставка', 'с террасой']))
      .toEqual(['delivery', 'terrace', 'live_music']);
  });

  test('основы одного правила ищутся в одном теге, а не по всей фразе', () => {
    // «детское» из одного тега и «зона» из другого — не детская зона.
    expect(tagsToAttributes(['детское меню', 'зона барбекю'])).toEqual([]);
  });

  test('негодная форма тегов — пустой список, а не исключение', () => {
    expect(tagsToAttributes(null)).toEqual([]);
    expect(tagsToAttributes(undefined)).toEqual([]);
    expect(tagsToAttributes('терраса')).toEqual([]);
    expect(tagsToAttributes([null, 5, 'wifi'])).toEqual(['wifi']);
  });
});
