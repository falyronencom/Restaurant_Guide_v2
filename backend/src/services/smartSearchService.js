/**
 * Smart Search Service
 *
 * AI-powered intent parsing for natural language restaurant search queries.
 * Uses OpenRouter (model from AI_MODEL, default Gemini 3.5 Flash-Lite — SDL
 * CAT-C-2.2, amended 24.09.2026) to parse user intent, then delegates to the
 * existing searchService for SQL execution.
 *
 * Pipeline: parseIntent → normalizeIntent (Zod) → buildFilters → searchByRadius/searchWithoutLocation
 * Fallback: raw query → existing ILIKE + SEARCH_SYNONYMS (transparent to user)
 */

import { z } from 'zod';
import crypto from 'crypto';
import { getConfig, isAvailable } from '../config/openrouter.js';
import { setWithExpiry } from '../config/redis.js';
import redisClient from '../config/redis.js';
import * as searchService from './searchService.js';
import logger from '../utils/logger.js';
// Canon shared with the write-path + DB CHECK (CAT-C-2.9). DB stores Cyrillic
// directly; these drive the AI prompt and the intent normalization.
import {
  VALID_CATEGORIES,
  VALID_CUISINES,
  isValidCategory,
  isValidCuisine,
} from '../constants/establishmentVocab.js';

/**
 * Города, которые разбор вправе вернуть в `location`. Написание и порядок —
 * как в промпте, на котором мерили модели 24.09.2026. Сравнение
 * (canonicalCity) не различает регистр и ё/е: «могилев» → «Могилёв»; обе
 * формы Могилёва searchService разворачивает сам (expandCityForQuery).
 */
const PROMPT_CITIES = Object.freeze(['Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилёв', 'Бобруйск']);

/** Сортировки, которые умеет разбор (у экрана их больше — там свой парсер). */
const INTENT_SORTS = new Set(['distance', 'rating', 'price_asc']);

/**
 * «Рядом» — не город, а просьба сортировать по расстоянию. Прод 24.09.2026:
 * фраза «Рядом со мной» уходила в `location`, становилась фильтром города и
 * давала 0 заведений из 26.
 */
const NEARBY_RE = /рядом|поблизости|недалеко|около меня|возле меня|near/i;

/**
 * Приём пищи, который меню называют разделом. На проде 24.09.2026 раздел
 * «ЗАВТРАКИ» есть у 12 заведений из 26 (в том числе у обоих, где есть
 * «БРАНЧ»), «ланч» — у двух. Ужина отдельным разделом в меню нет — его не
 * ищем. `variants` уходят дальше как dishVariants: их прочтёт сопоставление с
 * меню после сессии А2, сегодня searchService их не видит.
 */
const MEAL_MENU_TERMS = new Map([
  ['breakfast', { term: 'завтрак', variants: ['бранч'] }],
  ['lunch', { term: 'ланч', variants: [] }],
]);

/** Потолок вариантов названия блюда — столько же просит промпт. */
const MAX_DISH_VARIANTS = 5;

/** Ключ сравнения: регистр и ё/е не различаются. */
const foldKey = (s) => s.toLowerCase().replace(/ё/g, 'е');

/** Пустая строка у моделей значит «нет значения». */
const trimToNull = (v) => (v == null || v.trim() === '' ? null : v.trim());

const CITY_BY_KEY = new Map(PROMPT_CITIES.map((city) => [foldKey(city), city]));

/**
 * Город из списка в каноническом написании — или null для всего остального
 * («рядом со мной», улица, район, пустая строка).
 * @param {unknown} value
 * @returns {string|null}
 */
function canonicalCity(value) {
  if (typeof value !== 'string') return null;
  return CITY_BY_KEY.get(foldKey(value.trim())) ?? null;
}

/**
 * Варианты названия блюда: только строки, без пустых, без повторов и без
 * самого блюда, не больше MAX_DISH_VARIANTS. Без блюда варианты ничего не
 * значат. Негодная форма поля (не массив) — пустой список, а не отказ разбора:
 * поле добавочное, из-за него запрос не должен уходить на запасной путь.
 * @param {unknown} value
 * @param {string|null} dish
 * @returns {string[]}
 */
function cleanDishVariants(value, dish) {
  if (!dish || !Array.isArray(value)) return [];
  const seen = new Set([foldKey(dish)]);
  const variants = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const variant = item.trim();
    if (!variant || seen.has(foldKey(variant))) continue;
    seen.add(foldKey(variant));
    variants.push(variant);
    if (variants.length === MAX_DISH_VARIANTS) break;
  }
  return variants;
}

/**
 * Схема ответа модели — она же нормализатор разбора.
 *
 * Значения вне словаря отбрасываются ПОШТУЧНО: кухня, тип, сортировка.
 * Раньше enum в схеме ронял весь разбор — одна кухня вне списка уводила запрос
 * на запасной путь без меню. Форма ответа (ключи, типы) по-прежнему
 * обязательна: пустой или чужой объект — это отказ, а не «ничего не просили»,
 * иначе мусор от модели превращался бы в выдачу всего города.
 *
 * `dish` (Segment B) — блюдо или напиток, отдельно от `category` (тип
 * заведения); пустая строка = null. `dish_variants` — добавочное поле промпта
 * P1 и потому необязательное: разборы прежнего промпта в кэше его не несут.
 * `location` на выходе — город из списка или null; «рядом» вместо города
 * становится сортировкой по расстоянию, если сортировку не назвали.
 */
const intentSchema = z.object({
  cuisine: z.union([z.array(z.string()), z.string()]).nullable()
    .transform((value) => {
      const kept = [...new Set([value ?? []].flat().filter((c) => isValidCuisine(c)))];
      return kept.length > 0 ? kept : null;
    }),
  category: z.string().nullable().transform((v) => (isValidCategory(v) ? v : null)),
  dish: z.string().nullable().transform(trimToNull),
  dish_variants: z.unknown().optional(),
  meal_type: z.string().nullable().transform((v) => trimToNull(v)?.toLowerCase() ?? null),
  price_max: z.number().positive().nullable(),
  location: z.string().nullable(),
  sort: z.string().nullable().transform((v) => (INTENT_SORTS.has(v) ? v : null)),
  tags: z.array(z.string()).nullable().transform((v) => v ?? []),
  error: z.string().nullable(),
}).transform((intent) => {
  const city = canonicalCity(intent.location);
  const nearby = city == null
    && typeof intent.location === 'string'
    && NEARBY_RE.test(intent.location);
  return {
    ...intent,
    dish_variants: cleanDishVariants(intent.dish_variants, intent.dish),
    location: city,
    sort: intent.sort ?? (nearby ? 'distance' : null),
  };
});

/**
 * Разбор → нормализованный intent, или null, если форма не та.
 * Применяется и к ответу модели, и к разбору из кэша: разборы прежнего промпта
 * живут в Redis до часа после выкатки и обязаны пройти те же правила
 * («Рядом со мной» в `location`, кухня вне списка). Идемпотентна.
 * @param {unknown} raw
 * @returns {object|null}
 */
export function normalizeIntent(raw) {
  const result = intentSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Cache TTL: 1 hour */
const CACHE_TTL_SECONDS = 3600;

/**
 * Бюджет времени на разбор фразы — один на обе попытки (20 с: холодный старт
 * модели через OpenRouter бывает 10–15 с). Повтор не удлиняет худшее ожидание.
 */
const API_TIMEOUT_MS = 20000;

/** Попыток на одну фразу: первая и один повтор. */
const MAX_ATTEMPTS = 2;

/**
 * Промпт разбора — P1 из замера 24.09.2026 байт в байт
 * (docs/handoffs/smart_search_recall_20260924/bench_prompts.cjs). Модель и
 * промпт выбирались и проверяются вместе (SDL CAT-C-2.2, поправка 24.09): правка
 * текста без перепрогона замера — это непроверенная связка.
 * Отличия от прежнего: тип и кухня — только названные вслух, не додуманные по
 * блюду; блюдо — в словарной форме, с исправленной опечаткой и переводом
 * латиницы; `dish_variants`; город — только из списка; «рядом» — сортировка.
 */
export const SYSTEM_PROMPT = [
  'You parse a restaurant-search query typed by a user in Belarus (Russian or Belarusian, sometimes English, sometimes with typos) into JSON. Respond with JSON only.',
  'Fields:',
  `- category: establishment TYPE, only if the user names a type. One of: ${VALID_CATEGORIES.join(', ')}. Never infer it from a dish ("пицца" is a dish, not "Пиццерия").`,
  `- cuisine: only if the user names a cuisine or a diet explicitly ("грузинская кухня", "вегетарианское"). One or more of: ${VALID_CUISINES.join(', ')}. Never infer a cuisine from a dish ("суши" → cuisine=null, "драники" → cuisine=null).`,
  '- dish: the food or drink the user wants — in Russian, dictionary form (nominative), spelling corrected, without generic words and prepositions: "каппучино" → "капучино", "дранники" → "драники", "салат цезарь" → "цезарь", "с лососем" → "лосось", "latte" → "латте", "cheesecake" → "чизкейк". null if the query names no food or drink.',
  '- dish_variants: up to 5 other names under which the SAME dish appears on menus: the English/Latin name, the Belarusian spelling, its common kinds or equivalent names ("суши" → ["ролл","сашими","нигири","sushi"]; "курица" → ["цыплёнок","chicken"]; "капучино" → ["cappuccino"]; "драники" → ["дранікі"]). Never add a different dish. [] if none.',
  '- meal_type: "breakfast", "lunch", "dinner" or null. "завтрак", "позавтракать", "бранч" → breakfast; "бизнес-ланч", "ланч", "обед" → lunch; "ужин", "поужинать" → dinner.',
  '- price_max: a number in BYN if the user states a budget ("до 20 рублей" → 20), else null.',
  `- location: a city name only, one of: ${PROMPT_CITIES.join(', ')}; otherwise null. "рядом", "рядом со мной", "поблизости", a street or a district are NOT a location → location=null.`,
  '- sort: "distance" if the user wants something near ("рядом", "поблизости", "рядом со мной"); "price_asc" for "дешевле всего"; "rating" for "лучшие"; else null.',
  '- tags: other requirements that are not a dish, type, cuisine, meal, price, place or sort ("терраса", "детская комната", "живая музыка"); [] if none. Never repeat the dish or the meal here.',
  'Output exactly this shape: {"category":null,"cuisine":null,"dish":null,"dish_variants":[],"meal_type":null,"price_max":null,"location":null,"sort":null,"tags":[],"error":null}',
].join('\n');

/**
 * Normalize query for cache key generation.
 * @param {string} query
 * @returns {string}
 */
function normalizeQuery(query) {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Generate a hash for cache key.
 * @param {string} normalizedQuery
 * @returns {string}
 */
function generateQueryHash(normalizedQuery) {
  return crypto.createHash('sha256').update(normalizedQuery).digest('hex').slice(0, 32);
}

/**
 * Get cached intent from Redis.
 * @param {string} queryHash
 * @returns {Promise<object|null>}
 */
export async function getCachedIntent(queryHash) {
  try {
    if (!redisClient.isOpen) return null;
    const cached = await redisClient.get(`smartsearch:${queryHash}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    logger.warn('Smart search cache read failed', { error: error.message });
    return null;
  }
}

/**
 * Cache parsed intent in Redis.
 * @param {string} queryHash
 * @param {object} intent
 * @param {number} ttl - TTL in seconds
 */
export async function cacheIntent(queryHash, intent, ttl = CACHE_TTL_SECONDS) {
  try {
    if (!redisClient.isOpen) return;
    await setWithExpiry(`smartsearch:${queryHash}`, JSON.stringify(intent), ttl);
  } catch (error) {
    logger.warn('Smart search cache write failed', { error: error.message });
  }
}

/**
 * Одна попытка разбора: запрос к OpenRouter и разбор ответа.
 *
 * Возвращает `{ intent, model }` или `{ retry, reason, ... }`. Повтор — только
 * когда ответ пришёл, но им нельзя воспользоваться (пусто, оборван, не JSON,
 * не по схеме): это сбой поставщика на одном ответе, замер 24.09.2026 ловил
 * `finish_reason: "error"` с JSON на полуслове у разных моделей. Ошибка HTTP,
 * таймаут и отказ сети не повторяются: повтор удвоил бы ожидание при низких
 * шансах. / Retry only an answer that arrived unusable; HTTP errors, timeouts
 * and network failures are not retried.
 *
 * @param {string} query
 * @param {{ apiKey: string, baseUrl: string, model: string }} config
 * @param {AbortSignal} signal - общий на обе попытки
 * @returns {Promise<object>}
 */
async function requestIntent(query, config, signal) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://restaurantguidev2-production.up.railway.app',
      'X-Title': 'Restaurant Guide Belarus',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
      // Ответ по замеру — до 106 токенов; запас на случай, если поставщик всё
      // же потратит часть бюджета на рассуждение, а не оборвёт JSON.
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      // gemini-3.5-flash-lite отвергает effort "none" ответом 400; с "minimal"
      // служебных токенов 0 (замер 24.09, 111 ответов из 111). Модель в
      // AI_MODEL обязана принимать этот параметр — иначе каждый вызов даст 400
      // и поиск молча уйдёт на запасной путь (текст отказа пишется в лог ниже).
      reasoning: { effort: 'minimal', exclude: true },
    }),
    signal,
  });

  if (!response.ok) {
    // Текст отказа нужен в логе: неверный AI_MODEL, неподдержанный параметр,
    // снятая с каталога модель — всё это 4xx, и без текста они неразличимы.
    // Истёкший бюджет при чтении тела — это таймаут, а не «ошибка API»:
    // пробрасывается, чтобы лог назвал его своим именем.
    const detail = await response.text().catch((error) => {
      if (error.name === 'AbortError') throw error;
      return '';
    });
    logger.error('OpenRouter API error', {
      status: response.status,
      statusText: response.statusText,
      model: config.model,
      detail: detail.slice(0, 300),
    });
    return { retry: false, reason: `http_${response.status}` };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { retry: true, reason: 'envelope_not_json' };
  }

  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason ?? null;
  let content = choice?.message?.content;

  if (!content) {
    return { retry: true, reason: 'empty_content', finishReason };
  }

  // Strip markdown code fences if model wraps JSON in ```json ... ```
  content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Extract JSON object if surrounded by extra text
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { retry: true, reason: 'no_json_object', finishReason, content: content.slice(0, 200) };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { retry: true, reason: 'invalid_json', finishReason, content: content.slice(0, 200) };
  }
  logger.debug('AI raw parsed response', { query, parsed });

  const validated = intentSchema.safeParse(parsed);
  if (!validated.success) {
    return { retry: true, reason: 'schema', finishReason, issues: validated.error.issues };
  }

  return { intent: validated.data, model: data.model || config.model };
}

/**
 * Call OpenRouter API to parse user intent: one attempt plus one retry for an
 * unusable answer, both inside one 20 s budget.
 *
 * @param {string} query - User's natural language search query
 * @returns {Promise<object|null>} Normalized intent or null on failure
 */
export async function parseIntent(query) {
  if (!isAvailable()) {
    logger.debug('OpenRouter not available, skipping AI parsing');
    return null;
  }

  const config = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outcome = await requestIntent(query, config, controller.signal);

      if (outcome.intent) {
        // Фраза и разбор отсюда убраны: их несла аналитическая строка
        // (`smart_search_query`), и на успешном пути это был второй экземпляр
        // тех же слов. Строчкой выше при `debug` уже пишется сырой разбор — для
        // локальной отладки этого достаточно. Модель оставляем: она меняется
        // независимо от запроса (маршрутизация OpenRouter). / The phrase and
        // the parsed intent are gone from here — they duplicated the analytics line.
        logger.info('AI intent parsed successfully', {
          model: outcome.model,
          attempt,
        });
        return outcome.intent;
      }

      const willRetry = outcome.retry && attempt < MAX_ATTEMPTS;
      if (outcome.retry) {
        // Отказ модели — одно из мест, где фраза в логе по делу: без неё дыру
        // не воспроизвести (см. buildSearchQueryLog).
        logger.warn('AI intent response unusable', {
          query,
          reason: outcome.reason,
          attempt,
          willRetry,
          finishReason: outcome.finishReason,
          content: outcome.content,
          issues: outcome.issues,
        });
      }
      if (!willRetry) return null;
    }
    return null;
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.warn('OpenRouter API timeout', { query, timeoutMs: API_TIMEOUT_MS });
    } else {
      logger.error('AI intent parsing failed', {
        query,
        error: error.message,
      });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert parsed AI intent into parameters for existing search functions.
 *
 * Политика слияния — «явное сильнее выведенного, по размерностям».
 * Явные фильтры пришли из видимых пользователю контролов экрана; догадки
 * разбора — из его же фразы. В одной размерности спор решает контрол: снятый
 * чип «$$» не должен переживать в выдаче потому, что фраза «недорого»
 * подставила ярус цены. Разные размерности складываются: бюджет блюда
 * («пицца за 20 рублей» → priceMaxByn, цена позиции меню) и ярус цены
 * заведения — разные величины, обе остаются в силе. /
 * Explicit filters come from visible controls, inferred ones from the phrase;
 * within one dimension the control wins, across dimensions both apply.
 *
 * Разводка полей разбора (А1, 24.09.2026): блюдо — или приём пищи, который меню
 * называют разделом, — ищется в меню, и тогда тип и кухня из фразы не режут
 * выдачу; город — только из списка; варианты блюда уходят дальше как
 * `dishVariants` (сопоставление с меню прочтёт их после А2).
 *
 * @param {object} intent - Normalized intent (normalizeIntent / parseIntent)
 * @param {{ latitude?: number, longitude?: number, city?: string }} context - User context
 * @param {object} explicitFilters - Фильтры экрана из тела запроса (уже разобраны
 *   utils/searchFilterParams.js; ключи с null отброшены). / Screen filters,
 *   already parsed, absent keys dropped.
 * @returns {object} Parameters compatible with searchByRadius/searchWithoutLocation
 */
export function buildSmartSearchFilters(intent, context = {}, explicitFilters = {}) {
  const filters = {};

  // Что искать в меню: блюдо, а без него — приём пищи, который меню называют
  // разделом («Завтрак» → «ЗАВТРАКИ»). Блюдо сильнее: «сырники на завтрак» ищут
  // сырники. До 24.09 meal_type отбрасывался, и «Завтрак», «Бизнес-ланч»,
  // «бранч» давали 0 при таких разделах в меню у 12 заведений из 26.
  const meal = intent.dish ? null : MEAL_MENU_TERMS.get(intent.meal_type) ?? null;
  const menuTerm = intent.dish || meal?.term || null;

  // Category — явные категории экрана заменяют выведенную из фразы. Тип и
  // кухня из фразы — догадки разбора, и при слове для меню они не применяются:
  // меню точнее, а догадка режет выдачу по И («Суши» → «Японская» оставляла
  // 1 заведение из 5, прод 24.09) — тот же класс, что теги при блюде 07.09.
  if (explicitFilters.categories) {
    filters.categories = explicitFilters.categories;
  } else if (intent.category && !menuTerm) {
    filters.categories = [intent.category];
  }

  // Cuisines — та же размерность, то же правило
  if (explicitFilters.cuisines) {
    filters.cuisines = explicitFilters.cuisines;
  } else if (intent.cuisine && intent.cuisine.length > 0 && !menuTerm) {
    filters.cuisines = intent.cuisine;
  }

  // Dish (Segment B): routes the query to the menu_items EXISTS in searchService
  // (item name OR menu section). Without a stated budget the dish term also
  // rides as an OR-alternative at establishment level (ILIKE + SEARCH_SYNONYMS
  // via `dishOrSearch`): a pizzeria whose menu is not parsed yet still surfaces
  // for «пицца», and for the same word — absent other intent filters
  // (location/city still AND-narrow) — the smart path never finds less than
  // the classic ?search= path. With a budget (price_max) the match must be
  // menu-verified — the user asked for a price we can only read from a menu.
  if (intent.dish) {
    filters.dish = intent.dish;
    if (intent.price_max == null) {
      filters.dishOrSearch = intent.dish;
    }
    if (Array.isArray(intent.dish_variants) && intent.dish_variants.length > 0) {
      filters.dishVariants = [...intent.dish_variants];
    }
  } else if (meal) {
    // Приём пищи — только по меню, без dishOrSearch: синонимы карточки про
    // «завтрак» ничего не знают, а ILIKE по названию и описанию дал бы шум.
    filters.dish = meal.term;
    if (meal.variants.length > 0) {
      filters.dishVariants = [...meal.variants];
    }
  }

  // Price mapping:
  //  - With a menu term (dish or meal), price_max is a literal BYN ceiling on
  //    menu_items.price_byn (routed through searchService as `priceMaxByn`):
  //    «бизнес-ланч до 20 рублей» is a lunch under 20 BYN. price_range is NOT
  //    applied, because the user stated an actual money budget for the item.
  //  - Without one, fall back to the legacy subjective tier mapping to price_range.
  //  - Явный ярус с экрана заменяет ярусную подстановку, но НЕ отменяет
  //    priceMaxByn: «пицца за 20 рублей» с включённой карточкой «$$» — это
  //    позиция дешевле 20 BYN в заведении класса «$$». / An explicit tier
  //    replaces the inferred tier but coexists with a dish budget.
  if (intent.price_max != null) {
    if (menuTerm) {
      filters.priceMaxByn = intent.price_max;
    } else if (!explicitFilters.priceRange) {
      if (intent.price_max <= 15) {
        filters.priceRange = ['$'];
      } else if (intent.price_max <= 30) {
        filters.priceRange = ['$', '$$'];
      } else {
        filters.priceRange = ['$', '$$', '$$$'];
      }
    }
  }

  if (explicitFilters.priceRange) {
    filters.priceRange = explicitFilters.priceRange;
  }

  // Sort — выбранная пользователем сортировка сильнее и догадки, и умолчания
  if (explicitFilters.sortBy) {
    filters.sortBy = explicitFilters.sortBy;
  } else if (intent.sort) {
    filters.sortBy = intent.sort;
  } else {
    filters.sortBy = (context.latitude && context.longitude) ? 'distance' : 'rating';
  }

  // Город из фразы — только город из списка, и тогда он сильнее города
  // контекста (названный вслух тоже явный). Всё прочее («Рядом со мной»,
  // улица, район) игнорируется: как фильтр города оно давало 0 (прод 24.09).
  // Разбор уже нормализован; проверка здесь — страховка для любого вызова.
  const phraseCity = canonicalCity(intent.location);
  if (phraseCity) {
    filters.city = phraseCity;
  } else if (context.city) {
    filters.city = context.city;
  }

  // Tags → search text for existing ILIKE + SEARCH_SYNONYMS — only without a
  // menu term. The parser restates the dish word in tags ("пицца" → dish="пицца",
  // tags=["пицца"]; «Завтрак» → tags=["завтрак"]); as an establishment-level
  // filter AND-ed with the menu match it returned zero rows for every dish
  // outside SEARCH_SYNONYMS («капучино») — prod, 07.09.2026. With a menu term,
  // tags are dropped rather than AND-ed — accepting the loss of the rare non-dish
  // tag («терраса») instead of keeping a filter that zeroes the common case;
  // joined multi-tag patterns («пицца терраса») matched nothing anyway.
  if (!menuTerm && intent.tags && intent.tags.length > 0) {
    filters.search = intent.tags.join(' ');
  }

  // Размерности, которых разбор фразы не касается вовсе, — прямой проброс.
  // Спорить не с чем: у intent нет ни часов работы, ни удобств, ни рейтинга,
  // ни расстояния. / Dimensions the intent parser never produces: passed
  // straight through, nothing to arbitrate.
  for (const key of ['hoursFilter', 'features', 'minRating', 'maxDistance', 'radius']) {
    if (explicitFilters[key] != null) {
      filters[key] = explicitFilters[key];
    }
  }

  // Coordinates passthrough
  if (context.latitude && context.longitude) {
    filters.latitude = context.latitude;
    filters.longitude = context.longitude;
  }

  return filters;
}

/**
 * Execute smart search: AI parse → build filters → existing search pipeline.
 *
 * @param {string} query - Natural language query
 * @param {{ latitude?: number, longitude?: number, city?: string }} context
 * @param {{ limit?: number, page?: number }} pagination
 * @param {object} explicitFilters - Фильтры экрана (см. buildSmartSearchFilters).
 *   Применяются и на ветке fallback: при отказе AI экран результатов обязан
 *   получить свою классическую выдачу С фильтрами, иначе отключение AI молча
 *   расширяет выдачу вместо того, чтобы её сузить. / Applied on the fallback
 *   branch too — otherwise an AI outage silently drops the screen's filters.
 * @returns {Promise<{ intent: object|null, results: object[], pagination: object, fallback: boolean }>}
 */
export async function executeSmartSearch(query, context = {}, pagination = {}, explicitFilters = {}) {
  const { limit = 20, page = 1 } = pagination;
  const offset = (page - 1) * limit;

  const normalized = normalizeQuery(query);
  const queryHash = generateQueryHash(normalized);

  // 1. Check Redis cache. Разбор из кэша проходит ту же нормализацию, что и
  // свежий: разборы прежнего промпта живут там до часа после выкатки. Негодная
  // форма считается промахом — фразу разберёт модель заново.
  let intent = normalizeIntent(await getCachedIntent(queryHash));
  let fromCache = false;

  if (intent) {
    fromCache = true;
    logger.debug('Smart search cache hit', { queryHash });
  } else {
    // 2. Call AI
    intent = await parseIntent(query);

    // 3. Cache on success
    if (intent) {
      await cacheIntent(queryHash, intent);
    }
  }

  // 4. Build filters or fallback
  const isFallback = !intent;

  let searchResult;

  if (intent) {
    // AI-parsed path
    const filters = buildSmartSearchFilters(intent, context, explicitFilters);

    const searchParams = {
      ...filters,
      limit,
      offset,
      page,
    };

    if (filters.latitude && filters.longitude) {
      searchResult = await searchService.searchByRadius(searchParams);
    } else {
      searchResult = await searchService.searchWithoutLocation(searchParams);
    }
  } else {
    // Fallback: raw query through existing ILIKE + SEARCH_SYNONYMS.
    // Фильтры экрана идут и здесь — иначе экран результатов при недоступном AI
    // показал бы выдачу шире выбранных фильтров.
    const fallbackParams = {
      ...explicitFilters,
      search: query,
      city: context.city || null,
      sortBy: explicitFilters.sortBy
        || ((context.latitude && context.longitude) ? 'distance' : 'rating'),
      limit,
      offset,
      page,
    };

    if (context.latitude && context.longitude) {
      fallbackParams.latitude = context.latitude;
      fallbackParams.longitude = context.longitude;
      searchResult = await searchService.searchByRadius(fallbackParams);
    } else {
      searchResult = await searchService.searchWithoutLocation(fallbackParams);
    }
  }

  // Log for analytics
  logSearchQuery({
    rawQuery: query,
    queryHash,
    intent,
    resultCount: searchResult.pagination?.total || 0,
    isFallback,
    fromCache,
    hasExplicitFilters: Object.keys(explicitFilters).length > 0,
  });

  return {
    intent: intent || null,
    results: searchResult.establishments || [],
    pagination: searchResult.pagination || { total: 0, page, limit, totalPages: 0 },
    fallback: isFallback,
  };
}

/**
 * Собрать строку аналитики поиска — ЧИСТАЯ функция, отсюда и проверяемость:
 * решение «какие поля попадают в лог» проверяется напрямую, без подмены логгера.
 *
 * **Слова пользователя пишутся только там, где по ним действуют** — когда
 * выдача пуста. Ноль результатов означает дыру: нет синонима, нет данных, или
 * разбор промахнулся; чтобы это чинить, нужна сама фраза. Удачный запрос не
 * учит почти ничему — по нему хватает формы разбора и счётчиков.
 *
 * Почему не «оставить как было и решить при запуске»: сегодня в логе лежат
 * тестовые запросы своей же команды — продуктового сигнала ноль. Сигнал
 * появляется вместе с живыми людьми, то есть одновременно с экспозицией.
 * Отсрочка не покупает ничего, поэтому состояние выбрано устойчивое, без
 * необходимости к нему возвращаться. / The user's words are logged only where
 * they are actionable — on an empty result set. A successful query teaches
 * almost nothing beyond its shape.
 *
 * `intentShape` не содержит свободного текста: категория и кухня из закрытых
 * словарей, сортировка из трёх значений, блюдо и теги сведены к признаку и
 * счётчику. Полный разбор повторяет фразу дословно (`tags: ["пицца за 20
 * рублей"]`, прод 07.09) — поэтому целиком он идёт только рядом с самой фразой.
 */
export function buildSearchQueryLog({
  rawQuery,
  queryHash,
  intent,
  resultCount,
  isFallback,
  fromCache,
  hasExplicitFilters = false,
}) {
  const foundNothing = resultCount === 0;

  return {
    queryHash,
    resultCount,
    fallback: isFallback,
    fromCache,
    explicitFilters: hasExplicitFilters,
    intentShape: intent
      ? {
        hasDish: intent.dish != null,
        category: intent.category,
        cuisine: intent.cuisine,
        priceMax: intent.price_max,
        sort: intent.sort,
        tagCount: intent.tags?.length ?? 0,
      }
      : null,
    // Слова — только на пустой выдаче, вместе с полным разбором: чинить дыру
    // без них нельзя.
    ...(foundNothing ? { query: rawQuery, intent } : {}),
    timestamp: new Date().toISOString(),
  };
}

/** Пишет то, что решил [buildSearchQueryLog]. */
function logSearchQuery(params) {
  logger.info('smart_search_query', buildSearchQueryLog(params));
}
