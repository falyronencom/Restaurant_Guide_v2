/**
 * Совпадение фразы поиска с названием заведения / matching a search phrase
 * against establishment names.
 *
 * Решение Координатора 29.09.2026 (вариант «а»): название ищется в базе, а не
 * угадывается моделью. С промпта P1 (24.09) название не доходило до поиска ни
 * одним каналом — 25 из 26 названий прода давали весь город, одно — чужую
 * карточку (docs/handoffs/name_search_20260929/). Модель не знает каталога и
 * разбирает одно и то же название по-разному от вызова к вызову; здесь ответ
 * одинаков каждый раз.
 *
 * Сравнение идёт по «скелету» слова: нижний регистр, диакритика снята
 * (ZIZÚ → zizu), ё/і/ў/є → е/и/у/е, кириллица транслитом в латиницу, у
 * латиницы — ph → f, x → ks, w → v, q → k, c → k (или s перед e/i/y), y → i,
 * двойные буквы схлопнуты. Поэтому «Тиден» = TIDEN, «окси» = OXY,
 * «соренто» = «Сорренто», «Моне Мане» = «МонеМане», «Bull and Roo» = «Bull&Roo».
 * Фонетические написания (гайдзин ≠ GAIJIN, флоу ≠ FLOW) не покрыты — так и
 * договорено.
 *
 * Уровни совпадения, лучший побеждает:
 *  3 — название целиком: фраза равна названию или содержит его целиком
 *      («кофейня TIDEN», «underdog пицца»);
 *  2 — начало: фраза от 3 букв — начало названия или одного из его слов
 *      («tid», «Pinky», «Pigeon»);
 *  1 — опечатка: фраза от 4 букв похожа на название или его слово
 *      (триграммы, как pg_trgm similarity, ≥ NAME_TYPO_THRESHOLD: «tidem»).
 *
 * Что делать с совпадениями — решает smartSearchService (nameMatchMode): этот
 * модуль только измеряет. Функции чистые, базы не касаются.
 */

/** Кириллица → латиница. й, ё, ў уже сведены снятием диакритики. */
const CYRILLIC_TO_LATIN = Object.freeze({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'i', ь: '',
  э: 'e', ю: 'iu', я: 'ia',
});

/** Латинские буквы, которые снятие диакритики не раскладывает. */
const LATIN_EXTRA = Object.freeze({ ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd' });

/** Связки внутри названий: «Bull&Roo» = «Bull and Roo», «Rock'n'Roll». */
const CONNECTOR_WORDS = new Set(['and', 'n', 'и']);

/** Начало названия засчитывается с трёх букв скелета. */
const NAME_PREFIX_MIN = 3;

/** Опечатка — с четырёх букв: короткие слова похожи на что угодно. */
const NAME_TYPO_MIN = 4;

/**
 * Порог похожести для опечатки. На 63 запросах прогона по проду 29.09 при 0,5
 * нужная карточка найдена в 61 случае, при 0,55 — в 58 («андердог» ~ underdog
 * ровно 0,5, «tidem» ~ tiden 0,5). Ни один из 111 запросов стенда полноты не
 * задевает 26 названий прода — при 0,5 это держит unit-тест
 * (establishmentNameMatch.test.js), при 0,45 и 0,55 проверено прогоном прототипа.
 */
export const NAME_TYPO_THRESHOLD = 0.5;

/**
 * Слова текста: нижний регистр, без диакритики, по всему, что не буква и не
 * цифра; связки отброшены.
 * @param {string} text
 * @returns {string[]}
 */
export function nameWords(text) {
  if (typeof text !== 'string') return [];
  const folded = text.toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[øæœßłđ]/g, (c) => LATIN_EXTRA[c])
    .replace(/і/g, 'и').replace(/є/g, 'е').replace(/ґ/g, 'г');
  return folded
    .split(/[^a-zа-я0-9]+/)
    .filter((word) => word && !CONNECTOR_WORDS.has(word));
}

/**
 * Скелет одного слова (см. шапку модуля).
 * @param {string} word — слово из nameWords
 * @returns {string}
 */
export function wordSkeleton(word) {
  let s = '';
  for (const ch of word) s += CYRILLIC_TO_LATIN[ch] ?? ch;
  s = s.replace(/ph/g, 'f').replace(/x/g, 'ks').replace(/w/g, 'v').replace(/q/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/c(?!h)(?=[eiy])/g, 's')
    .replace(/c(?!h)/g, 'k')
    .replace(/y/g, 'i');
  return s.replace(/(.)\1+/g, '$1');
}

/**
 * Текст → скелеты его слов.
 * @param {string} text
 * @returns {string[]}
 */
export function textSkeletons(text) {
  return nameWords(text).map(wordSkeleton).filter(Boolean);
}

/**
 * Скелет текста целиком — слова без пробелов.
 * @param {string} text
 * @returns {string}
 */
export function nameSkeleton(text) {
  return textSkeletons(text).join('');
}

function trigrams(s) {
  const padded = `  ${s} `;
  const set = new Set();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return set;
}

/**
 * Похожесть двух скелетов — доля общих триграмм, как pg_trgm similarity().
 * @param {string} a
 * @param {string} b
 * @returns {number} 0..1
 */
export function skeletonSimilarity(a, b) {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Совпадение фразы с одним названием.
 * @param {string[]} queryWords — скелеты слов фразы
 * @param {string[]} nameWordsList — скелеты слов названия
 * @returns {{ level: number, kind: string|null }}
 */
function scoreSkeletons(queryWords, nameWordsList) {
  const none = { level: 0, kind: null };
  if (queryWords.length === 0 || nameWordsList.length === 0) return none;
  const query = queryWords.join('');
  const name = nameWordsList.join('');

  if (query === name) return { level: 3, kind: 'full' };

  // Название целиком внутри фразы: подряд идущие слова фразы, склеенные, дают
  // название («моне мане завтрак» содержит «МонеМане»). Совсем короткое
  // название внутри длинной фразы — не сигнал.
  if (name.length >= NAME_PREFIX_MIN && queryWords.length > 1) {
    for (let i = 0; i < queryWords.length; i++) {
      let run = '';
      for (let j = i; j < queryWords.length && run.length < name.length; j++) {
        run += queryWords[j];
        if (run === name) return { level: 3, kind: 'contained' };
      }
    }
  }

  if (query.length >= NAME_PREFIX_MIN
    && (name.startsWith(query) || nameWordsList.some((word) => word.startsWith(query)))) {
    return { level: 2, kind: 'prefix' };
  }

  if (query.length >= NAME_TYPO_MIN) {
    const candidates = [name, ...nameWordsList.filter((word) => word.length >= NAME_TYPO_MIN)];
    const best = Math.max(...candidates.map((candidate) => skeletonSimilarity(query, candidate)));
    if (best >= NAME_TYPO_THRESHOLD) return { level: 1, kind: 'typo' };
  }

  return none;
}

/**
 * Совпадение фразы с названием.
 * @param {string} query
 * @param {string} name
 * @returns {{ level: number, kind: 'full'|'contained'|'prefix'|'typo'|null }}
 */
export function scoreNameMatch(query, name) {
  return scoreSkeletons(textSkeletons(query), textSkeletons(name));
}

/**
 * Заведения, чьё название совпало с фразой, — только лучшего уровня: если
 * есть название целиком, начала и опечатки не считаются.
 * @param {string} query
 * @param {Array<{ id: string, name: string }>} rows — активные заведения
 * @returns {{ level: number, matches: Array<{ id: string, name: string, kind: string }> }|null}
 */
export function pickNameMatches(query, rows) {
  const queryWords = textSkeletons(query);
  if (queryWords.length === 0 || !Array.isArray(rows)) return null;

  let level = 0;
  let matches = [];
  for (const row of rows) {
    const score = scoreSkeletons(queryWords, textSkeletons(row.name));
    if (score.level === 0 || score.level < level) continue;
    if (score.level > level) {
      level = score.level;
      matches = [];
    }
    matches.push({ id: row.id, name: row.name, kind: score.kind });
  }
  return level > 0 ? { level, matches } : null;
}
