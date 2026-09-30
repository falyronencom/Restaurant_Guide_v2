/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: establishmentNameMatch — совпадение фразы с названием заведения
 * (решение Координатора 29.09.2026).
 *
 * Каталог — 26 названий прода на 29.09.2026 (публичный список, материалы
 * docs/handoffs/name_search_20260929/). Ожидания — из прогона по проду того же
 * дня: какой запрос какую карточку обязан найти. Слова-блюда внизу — запросы
 * стенда полноты умного поиска (docs/handoffs/smart_search_recall_20260924/):
 * ни одно не должно задевать названий, иначе поиск блюд начнёт поднимать
 * случайные заведения.
 */

import {
  NAME_TYPO_THRESHOLD,
  nameSkeleton,
  nameWords,
  pickNameMatches,
  scoreNameMatch,
  skeletonSimilarity,
  wordSkeleton,
} from '../../utils/establishmentNameMatch.js';

const PROD_NAMES = [
  'Сорренто', 'FLOW', 'GAIJIN', 'MARKS', 'Paragraph', 'Bull&Roo', 'Charlie', 'Le Pigeon', 'MARBL',
  'Martinque Brasserie', 'OXY', 'Pinky Bandinsky', 'SFB Minsk', 'SORSO', 'urban dzen cafe', 'Zalkind Kitchen',
  'ZIZÚ', 'Имена', 'ЛАМПА', 'МАЛЕВИЧ', 'МАРЫ', 'МонеМане', 'Осмоловка', 'Let It Be', 'TIDEN', 'underdog',
];

const CATALOG = PROD_NAMES.map((name, i) => ({ id: `id-${i}`, name }));

/** Что нашлось: уровень и названия — или null. */
function found(query) {
  const picked = pickNameMatches(query, CATALOG);
  return picked ? { level: picked.level, names: picked.matches.map((m) => m.name) } : null;
}

describe('скелет слова', () => {
  test('регистр, диакритика, ё/і/ў: «ZIZÚ» = «zizu», «Ёлка» = «елка», «Дранікі» = «драники»', () => {
    expect(nameSkeleton('ZIZÚ')).toBe(nameSkeleton('zizu'));
    expect(nameSkeleton('Ёлка')).toBe(nameSkeleton('елка'));
    expect(nameSkeleton('Дранікі')).toBe(nameSkeleton('драники'));
  });

  test('кириллица и латиница сходятся транслитом: «Тиден» = «TIDEN», «Маркс» = «MARKS», «окси» = «OXY»', () => {
    expect(nameSkeleton('Тиден')).toBe('tiden');
    expect(nameSkeleton('TIDEN')).toBe('tiden');
    expect(nameSkeleton('Маркс')).toBe(nameSkeleton('MARKS'));
    expect(nameSkeleton('окси')).toBe(nameSkeleton('OXY'));
  });

  test('латинские сочетания: ph → f, c → k (s перед e/i/y), ch остаётся, двойные буквы схлопнуты', () => {
    expect(wordSkeleton('paragraph')).toBe('paragraf');
    expect(wordSkeleton('coffee')).toBe(wordSkeleton('кофе'));
    expect(wordSkeleton('cinema')).toBe('sinema');
    expect(wordSkeleton('charlie')).toBe('charlie');
    expect(wordSkeleton('сорренто')).toBe(wordSkeleton('соренто'));
  });

  test('знаки и связки не считаются: «Bull&Roo» = «Bull and Roo», «МонеМане» = «Моне Мане»', () => {
    expect(nameWords('Bull and Roo')).toEqual(['bull', 'roo']);
    expect(nameSkeleton('Bull&Roo')).toBe(nameSkeleton('Bull and Roo'));
    expect(nameSkeleton('МонеМане')).toBe(nameSkeleton('Моне Мане'));
  });

  test('похожесть — доля общих триграмм, как у pg_trgm', () => {
    expect(skeletonSimilarity('tiden', 'tiden')).toBe(1);
    expect(skeletonSimilarity('anderdog', 'underdog')).toBe(0.5);
    expect(skeletonSimilarity('tidem', 'tiden')).toBe(0.5);
    expect(skeletonSimilarity('', 'tiden')).toBe(0);
  });
});

describe('каждое название прода находит свою карточку, и только её', () => {
  test.each(PROD_NAMES)('%s', (name) => {
    expect(found(name)).toEqual({ level: 3, names: [name] });
  });
});

describe('название целиком в другом регистре, письме, без диакритики и знаков', () => {
  test.each([
    ['Tiden', 'TIDEN'], ['tiden', 'TIDEN'], ['Тиден', 'TIDEN'],
    ['лампа', 'ЛАМПА'], ['Lampa', 'ЛАМПА'], ['малевич', 'МАЛЕВИЧ'], ['Malevich', 'МАЛЕВИЧ'], ['Малевичь', 'МАЛЕВИЧ'],
    ['Маркс', 'MARKS'], ['сорсо', 'SORSO'], ['окси', 'OXY'], ['Sorrento', 'Сорренто'], ['соренто', 'Сорренто'],
    ['zizu', 'ZIZÚ'], ['Bull and Roo', 'Bull&Roo'], ['Моне Мане', 'МонеМане'], ['Paragraf', 'Paragraph'],
    ['urban dzen кафе', 'urban dzen cafe'],
  ])('«%s» → %s', (query, name) => {
    expect(found(query)).toEqual({ level: 3, names: [name] });
  });
});

describe('название целиком внутри фразы', () => {
  test.each([
    ['кофейня TIDEN', 'TIDEN'], ['Tiden завтрак', 'TIDEN'], ['underdog пицца', 'underdog'],
    ['ресторан Сорренто', 'Сорренто'], ['моне мане завтрак', 'МонеМане'],
  ])('«%s» → %s', (query, name) => {
    expect(found(query)).toEqual({ level: 3, names: [name] });
    expect(scoreNameMatch(query, name).kind).toBe('contained');
  });

  test('совсем короткое название внутри длинной фразы — не сигнал', () => {
    expect(scoreNameMatch('кафе с видом на ок', 'ОК')).toEqual({ level: 0, kind: null });
  });
});

describe('начало названия или слова названия — от трёх букв', () => {
  test.each([
    ['tid', 'TIDEN'], ['under', 'underdog'], ['мале', 'МАЛЕВИЧ'], ['Чарли', 'Charlie'], ['Pige', 'Le Pigeon'],
    ['urbandz', 'urban dzen cafe'],
  ])('«%s» → %s', (query, name) => {
    expect(found(query)).toEqual({ level: 2, names: [name] });
    expect(scoreNameMatch(query, name).kind).toBe('prefix');
  });

  test('две буквы — ещё не начало', () => {
    expect(found('ti')).toBeNull();
  });

  test('одно начало — несколько названий', () => {
    expect(found('мар')).toEqual({ level: 2, names: ['MARKS', 'MARBL', 'Martinque Brasserie', 'МАРЫ'] });
  });
});

describe('целое слово названия — тот же уровень, вид «слово» (решение Координатора 30.09.2026)', () => {
  // Вид решает режим поиска: целое слово поднимается первым при любом разборе,
  // начало лишь спасает от пустой выдачи (unit/smartSearchNameMode.test.js).
  // Слова — все целые слова многословных названий прода, которые модель 30.09
  // читала то пусто, то как блюдо, тип или город (Pigeon, Zalkind, Brasserie,
  // Bull), и соседние.
  test.each([
    ['Pigeon', 'Le Pigeon'], ['pigeon', 'Le Pigeon'], ['Pinky', 'Pinky Bandinsky'], ['Пинки', 'Pinky Bandinsky'],
    ['Bandinsky', 'Pinky Bandinsky'], ['Zalkind', 'Zalkind Kitchen'], ['Kitchen', 'Zalkind Kitchen'],
    ['Martinque', 'Martinque Brasserie'], ['Brasserie', 'Martinque Brasserie'], ['Bull', 'Bull&Roo'],
    ['SFB', 'SFB Minsk'], ['urban dzen', 'urban dzen cafe'], ['dzen cafe', 'urban dzen cafe'], ['Let', 'Let It Be'],
  ])('«%s» → %s', (query, name) => {
    expect(found(query)).toEqual({ level: 2, names: [name] });
    expect(scoreNameMatch(query, name)).toEqual({ level: 2, kind: 'word' });
  });

  test('всё название — не «слово», а уровень 3', () => {
    expect(scoreNameMatch('Le Pigeon', 'Le Pigeon')).toEqual({ level: 3, kind: 'full' });
    expect(scoreNameMatch('Pinky Bandinsky', 'Pinky Bandinsky')).toEqual({ level: 3, kind: 'full' });
  });

  test('слово из двух букв — не слово: «Le» ничего не находит', () => {
    expect(found('Le')).toBeNull();
  });

  test('целое слово и начало на одном уровне — в выдаче сверки оба, каждый со своим видом', () => {
    const catalog = [{ id: 'a', name: 'Le Pigeon' }, { id: 'b', name: 'Pigeonnier' }];
    expect(pickNameMatches('Pigeon', catalog)).toEqual({
      level: 2,
      matches: [{ id: 'a', name: 'Le Pigeon', kind: 'word' }, { id: 'b', name: 'Pigeonnier', kind: 'prefix' }],
    });
  });
});

describe('опечатка — от четырёх букв, похожесть не ниже порога', () => {
  test('порог 0,5', () => {
    expect(NAME_TYPO_THRESHOLD).toBe(0.5);
  });

  test.each([
    ['tidem', 'TIDEN'], ['undrdog', 'underdog'], ['андердог', 'underdog'], ['Лет ит би', 'Let It Be'],
  ])('«%s» → %s', (query, name) => {
    expect(found(query)).toEqual({ level: 1, names: [name] });
  });

  test('лучший уровень вытесняет слабые: есть название целиком — опечатки не считаются', () => {
    const catalog = [{ id: 'a', name: 'TIDEN' }, { id: 'b', name: 'TIDEM' }];
    expect(pickNameMatches('Tiden', catalog)).toEqual({
      level: 3,
      matches: [{ id: 'a', name: 'TIDEN', kind: 'full' }],
    });
  });
});

describe('что не обещано — фонетика', () => {
  test('«гайдзин» и «флоу» не находят GAIJIN и FLOW', () => {
    expect(found('гайдзин')).toBeNull();
    expect(found('флоу')).toBeNull();
  });
});

describe('общие слова касаются названий — что с этим делать, решает режим поиска', () => {
  // Сопоставитель только измеряет: «минск» — целое слово в «SFB Minsk», «кафе»
  // — в «urban dzen cafe». Выдачу по ним не заменяет и первыми их не поднимает
  // nameMatchMode: фраза — общее слово (город, тип) — см.
  // unit/smartSearchNameMode.test.js и блок «поиск по названию» в
  // integration/smart-search.test.js.
  test('«минск» и «кафе» — уровень 2, вид «слово»', () => {
    expect(found('минск')).toEqual({ level: 2, names: ['SFB Minsk'] });
    expect(found('кафе')).toEqual({ level: 2, names: ['urban dzen cafe'] });
    expect(scoreNameMatch('минск', 'SFB Minsk').kind).toBe('word');
    expect(scoreNameMatch('кафе', 'urban dzen cafe').kind).toBe('word');
  });
});

describe('слова-блюда и расплывчатые фразы не задевают названий прода', () => {
  // Все 111 запросов стенда полноты — замер моделей и батарея 24.09.2026
  // (docs/handoffs/smart_search_recall_20260924/: bench_prompts.cjs, truth.cjs,
  // battery_after_A2.json; стенд в gitignored docs/, поэтому список здесь целиком)
  // — и 7 расплывчатых фраз прогона по проду 29.09.
  const STAND_QUERIES = [
    'Кофе', 'Суши', 'Завтрак', 'Бизнес-ланч', 'Рядом со мной', 'где позавтракать', 'бранч', 'что-нибудь сладкое',
    'веганское', 'кофе рядом', 'капучино', 'цезарь', 'раф', 'драники', 'паста', 'пицца', 'бургер', 'пиво', 'роллы',
    'рамен', 'том ям', 'хинкали', 'десерт', 'выпечка', 'креветки', 'с лососем', 'курица', 'пиццу', 'салат цезарь',
    'паста карбонара', 'тост с авокадо', 'каппучино', 'экспрессо', 'круасан', 'тирамиссу', 'карбанара', 'дранники',
    'ризото', 'латэ', 'cappuccino', 'Цезарь до 10 рублей', 'пицца до 20 рублей', 'стейк до 50 рублей',
    'кофейня рядом', 'грузинская кухня', 'пиццерия в Гродно', 'недорогой бар с пивом', 'где вкусно поужинать',
    'завтраки', 'детское меню', 'латте', 'матча', 'эспрессо', 'американо', 'какао', 'чизкейк', 'тирамису', 'медовик',
    'сырники', 'борщ', 'холодник', 'омлет', 'шакшука', 'стейк', 'тартар', 'карпаччо', 'ризотто', 'коктейль', 'поке',
    'пельмени', 'устрицы', 'круассан', 'лимонад', 'смузи', 'мороженое', 'суп', 'салат', 'каша', 'гречка',
    'с креветками', 'лосось', 'утка', 'говядина', 'грибы', 'мидии', 'гребешок', 'трюфель', 'котлета', 'блины',
    'сырник', 'суп том ям', 'яйца бенедикт', 'сырники со сметаной', 'флэт уайт', 'зеленый чай', 'капучинно',
    'чизкеик', 'цезар', 'пица', 'лазания', 'флет уайт', 'latte', 'cheesecake', 'caesar', 'burger', 'мед', 'щечки',
    'свекла', 'салат цезарь до 10 рублей', 'салат цезарь до 25 рублей', 'капучино до 8 рублей',
  ];
  const VAGUE_QUERIES = [
    'что-нибудь вкусное', 'куда сходить с друзьями', 'уютное место', 'вкусно', 'хочу есть', 'романтический ужин',
    'с видом',
  ];
  const QUERIES = [...STAND_QUERIES, ...VAGUE_QUERIES];

  test('в наборе все 111 запросов стенда', () => {
    expect(new Set(STAND_QUERIES).size).toBe(111);
  });

  test.each(QUERIES)('%s', (query) => {
    expect(found(query)).toBeNull();
  });
});

describe('входные данные', () => {
  test('пустая фраза, фраза из знаков и пустой каталог — совпадений нет', () => {
    expect(pickNameMatches('', CATALOG)).toBeNull();
    expect(pickNameMatches('!!! ...', CATALOG)).toBeNull();
    expect(pickNameMatches('Tiden', [])).toBeNull();
    expect(pickNameMatches('Tiden', null)).toBeNull();
  });

  test('заведение с пустым названием совпадением не считается', () => {
    expect(pickNameMatches('Tiden', [{ id: 'x', name: '' }, { id: 'y', name: null }])).toBeNull();
  });
});
