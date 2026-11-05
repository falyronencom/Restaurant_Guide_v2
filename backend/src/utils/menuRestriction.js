/**
 * Is a menu line alcohol or tobacco? The guest does not see such a line
 * (название и цена): the operational default of the legal pass, July 2026,
 * item 2h, until the lawyer answers. The rows stay in the database; the partner
 * sees them with a mark, the moderator as before, and search finds the
 * establishment by them.
 *
 * What is hidden is a drink or a tobacco product, not a dish with such a word:
 * «Стейк с соусом из коньяка» and «Пенне алла водка» stay, «Цыплёнок табака»
 * stays, «безалкогольное пиво» stays. Both mistakes count — alcohol in view and
 * a dish gone — and the whole of production was read against this file before
 * it shipped (docs/handoffs/alcohol_menu_filter_20261105, the before/after
 * list). Correcting a mistake is one word here plus a line in the test.
 *
 * Read from the name and the section the rows already have, every time a menu
 * is shown: nothing is stored, so a partner's edit of a name or a section
 * decides at once, and a change of this file reaches every row without a
 * migration. A name no list here knows stays in view: this is a list, not a
 * judgement, and the partner's own wine under a heading of no use is its limit.
 *
 * The order of the checks:
 *   1. tobacco — by word, with «цыплёнок табака» and «сигары из лаваша» out;
 *   2. a section or a name that says «no alcohol» — stays (Mocktails, «Б/А»);
 *   3. a section of food — its rows stay: such a section is a stronger signal
 *      than a word in a dish's name («Маргарита», «Ром-баба») or a drink beside
 *      it in the heading («Десерты и вино»). Only a name that begins with a
 *      drink («ИГРИСТОЕ к завтраку» in a set breakfast) or holds a word no dish
 *      holds («…, Brut») goes;
 *   4. a section of the bar — every row in it, except a soft drink or a snack
 *      read into it;
 *   5. the name — a drink's word as the thing itself, not as what the dish is
 *      cooked with: «Вино красное», but not «Мидии в вине» or «соус Виски».
 *
 * JS `\b` is blind to Cyrillic (a boundary is never found beside a Russian
 * letter), so words are bounded by lookaround over letters and digits.
 */

import { dishKey } from './menuItemName.js';

const LETTER = '[\\p{L}\\p{N}]';

/** The pattern of whole words: each alternative bounded on both sides. */
const words = (...alternatives) => new RegExp(
  `(?<!${LETTER})(?:${alternatives.join('|')})(?!${LETTER})`,
  'u',
);

/**
 * Text as this file compares it: dishKey (case, spaces, ё, quotes, dashes),
 * Belarusian letters as their Russian neighbours and Latin letters without
 * their marks («rosé», «González», «Schöfferhofer»).
 *
 * @param {string|null|undefined} text
 * @returns {string}
 */
export const readForRestriction = (text) => dishKey(text)
  .replace(/і/g, 'и')
  .replace(/ў/g, 'у')
  .replace(/[À-ɏ]/g, ch => ch.normalize('NFD')[0]);

// ---- Says «no alcohol» ------------------------------------------------------

const NO_ALCOHOL_NAME = words(
  'безалк\\p{L}*',
  'безалка\\p{L}*',
  'без алкоголя',
  'б/а',
  'n/a',
  'non[- ]?alco\\p{L}*',
  'alcohol[- ]free',
  'alkoholfrei',
  'zero',
  'зеро',
  'балтика 0(?![.,]\\d)',
  '0[.,]0(?:\\s?%)?',
);

const NO_ALCOHOL_SECTION_WORDS = [
  'безалк\\p{L}*(?: \\p{L}+)?',
  'безалка\\p{L}*(?: \\p{L}+)?',
  'mocktails?',
  'моктейл\\p{L}*',
  'молочн\\p{L}* коктейл\\p{L}*',
  'детск\\p{L}* коктейл\\p{L}*',
  'кофейн\\p{L}* коктейл\\p{L}*',
  'милкшейк\\p{L}*',
  'milkshakes?',
  'soft drinks?',
  '^soft$',
];
const NO_ALCOHOL_SECTION = words(...NO_ALCOHOL_SECTION_WORDS);
const NO_ALCOHOL_SECTION_ALL = new RegExp(NO_ALCOHOL_SECTION.source, 'gu');

/**
 * A section of soft drinks: «Мохито» under «Фирменные лимонады» is a lemonade.
 * Only a mixed drink's name yields to it; wine under «Напитки» is wine.
 */
const SOFT_SECTION = words(
  'лимонад\\p{L}*',
  'лиманад\\p{L}*',
  'lemonades?',
  'чай\\p{L}*',
  'чаи',
  'кофе',
  'какао',
  'морс\\p{L}*',
  'смузи',
  'сок\\p{L}*',
  'фреш\\p{L}*',
);

/** The same in the name: «Раф амаретто», «Лимонад Мохито», «Сироп Амаретто». */
const SOFT_NAME = words(
  'раф',
  'латте',
  'капучино',
  'кофе',
  'эспрессо',
  'какао',
  'чай',
  'лимонад\\p{L}*',
  'морс',
  'смузи',
  'сироп\\p{L}*',
  'syrup',
  'latte',
);

// ---- Tobacco ----------------------------------------------------------------

const TOBACCO_SECTION = words(
  'кальян\\p{L}*',
  'hookahs?',
  'shisha',
  'табак',
  'табаки',
  'tobacco',
  'сигарет\\p{L}*',
  'вейп\\p{L}*',
  'vapes?',
);

const TOBACCO_NAME = words(
  'кальян\\p{L}*',
  'hookahs?',
  'shisha',
  'табак',
  'табаки',
  'табаком',
  'табаке',
  'чаш\\p{L}* табака',
  'tobacco',
  'сигарет\\p{L}*(?! (?:из|с|со) )',
  'cigarettes?',
  'cigars?',
  'сигар\\p{L}{0,2}(?! (?:из|с|со|на) )',
  'сигарилл\\p{L}*',
  'cigarillos?',
  'вейп\\p{L}*',
  'vapes?',
  'hqd',
  'elf ?bar',
  'iqos',
  'айкос',
  'стик\\p{L}* (?:heets|iqos|terea|fiit)',
  'heets',
  'terea',
  'снюс\\p{L}*',
  'жидкост\\p{L}* (?:для|к) (?:вейп\\p{L}*|электронн\\p{L}*)',
  'cohiba',
  'montecristo',
  'parliament',
  'marlboro',
  'winston',
);

/**
 * «Цыплёнок табака» is a dish. The genitive «табака» is no tobacco word at all
 * (TOBACCO_NAME does not list it, but for «чаша табака»); this is for the
 * spellings «цыплёнок табак», «курица - табак».
 */
const TOBACCO_DISH = words('(?:цыпл|куриц|курочк)\\p{L}*[- ]+табак\\p{L}*');

// ---- Sections ---------------------------------------------------------------

/**
 * Food served for the drink, under a heading that names the drink: «ЗАКУСКИ К
 * ПИВУ», «К ВИНУ», «СТАРТЕРЫ К ВИНУ», «Закуски под пиво», «Wine Snacks».
 */
const FOOD_FOR_THE_DRINK = words(
  '(?:к|под|для) (?:\\p{L}+ )?(?:вин\\p{L}*|пив\\p{L}*|шампан\\p{L}*|игрист\\p{L}*|коньяк\\p{L}*|виски|коктейл\\p{L}*)',
  'wine snacks?',
  'beer snacks?',
);

/** Heads of a section of the bar. */
const BAR_SECTION = words(
  'алкогол\\p{L}*',
  'алкагол\\p{L}*',
  'alcohol',
  'вино',
  'вина',
  'вин',
  'винная',
  'винные',
  'wines?',
  'игрист\\p{L}*',
  'шампан\\p{L}*',
  'champagne',
  'пиво',
  'пива',
  'beers?',
  'крепкое',
  'крепкие(?: напитки)?',
  'крепкий алкоголь',
  'кактэйл\\p{L}*',
  'кактейл\\p{L}*',
  'коктейл\\p{L}*',
  'cocktails?',
  'дижестив\\p{L}*',
  'digestifs?',
  'aperitive?s?',
  'liquors?',
  'liqueurs?',
  'ликер\\p{L}*',
  'настойк\\p{L}*',
  'наливк\\p{L}*',
  'шоты',
  'shots',
  'водка',
  'гарэлк\\p{L}*',
  'vodka',
  'виски',
  'whiske?y',
  'джин',
  'джын',
  'gin',
  'ром',
  'rum',
  'текила',
  'tequila',
  'коньяк\\p{L}*',
  'каньяк\\p{L}*',
  'cognac',
  'бренди',
  'brandy',
  'sherry',
  'porto',
  'херес',
  'портвейн',
  'глинтвейн\\p{L}*',
  'сангрия',
  'сидр\\p{L}*',
  'барная карта',
  'бар(?:ное)? меню',
  'bar menu',
  // One word of a wine list: «БЕЛОЕ», «КРАСНОЕ ПОЛУСУХОЕ», «ОРАНЖЕВОЕ».
  '^(?:белое|красное|розовое|оранжевое)(?: (?:сухое|полусухое|полусладкое|сладкое|брют))?$',
);

/** «Коктейли из морепродуктов» is food; «Коктейли из рома» is not. */
const SEAFOOD_COCKTAIL = words('коктейл\\p{L}* из (?:кревет|морепродукт|лосос|краб|мид|кальмар)\\p{L}*');

/**
 * A soft drink, water or a snack read into a section of the bar: the whole of
 * the bar goes with its heading, the cola and the nuts stay. Only as the first
 * word of the name: «Малиновый джин-тоник» and «belarussian | ваниль + кофе» are
 * the bar's own.
 */
const SOFT_OR_SNACK_HEAD = new RegExp(
  `^(?:кола|кока-кола|coca-cola|cola|pepsi|пепси|sprite|спрайт|fanta|фанта|schweppes|швепс\\p{L}*|тоник|вода|water|минеральн\\p{L}*|сок|соки|juice|лимонад\\p{L}*|морс|чай|кофе|американо|эспрессо|капучино|латте|молочн\\p{L}*|милкшейк\\p{L}*|смузи|орешки|орехи|арахис|фисташк\\p{L}*|чипсы|гренки|сухарики|оливки|маслины|начос|снеки)(?!${LETTER})`,
  'u',
);

/** Irish coffee is coffee with whisky, in the bar and under «Кофе». */
const IRISH_COFFEE = words('по-ирландски', 'ирландск\\p{L}* (?:кофе|какао)', 'irish coffee', 'айриш');

/**
 * Coffee, tea, cocoa or a soft drink with a measure of alcohol is an alcoholic
 * drink: «Какао с ореховым ликёром», «Кофе с коньяком», «Кола с ромом». The forms
 * are listed: «чай с ромашкой» must not match «ром…».
 */
const SOFT_DRINK_WITH_ALCOHOL = new RegExp(
  `(?<!${LETTER})(?:кофе|какао|чай|капучино|латте|раф|американо|эспрессо|шоколад|кола|тоник|сок|лимонад)(?!${LETTER})`
  + '.*'
  + `(?<!${LETTER})(?:с|со|на) (?:[\\p{L}-]+ )?(?:ликером|ромом|коньяком|виски|вином|бейлисом|амаретто|бренди|джином|водкой|текилой|самбукой|шампанским|просекко|вермутом)(?!${LETTER})`,
  'u',
);

/**
 * Sections of food. A name in them is a dish, whatever word it holds:
 * «Маргарита» under «Пицца», «Ромовая баба» under «Десерты». «Сладкое» only
 * first: a wine list has «КРАСНОЕ СЛАДКОЕ».
 */
const FOOD_SECTION = words(
  'суп\\p{L}*',
  'soups?',
  'салат\\p{L}*',
  'salads?',
  'закуск\\p{L}*',
  'стартер\\p{L}*',
  'горячее',
  'горяч\\p{L}* (?:блюд\\p{L}*|закуск\\p{L}*)',
  'холодн\\p{L}* закуск\\p{L}*',
  'основн\\p{L}*',
  'гарнир\\p{L}*',
  'десерт\\p{L}*',
  'дэсерт\\p{L}*',
  '^сладк\\p{L}*',
  'выпечк\\p{L}*',
  'паст\\p{L}*',
  'pasta',
  'ризотто',
  'пицц\\p{L}*',
  'пинс\\p{L}*',
  'смажен\\p{L}*',
  'бургер\\p{L}*',
  'мясо',
  'рыба',
  'морепродукт\\p{L}*',
  'гриль',
  'завтрак\\p{L}*',
  'бранч',
  'блюд\\p{L}*',
  'соус\\p{L}*',
  'антипасти',
  'устриц\\p{L}*',
  'тартар\\p{L}*',
  'ролл\\p{L}*',
  'суши',
  'нигири',
  'сашими',
  'поке',
  'темпур\\p{L}*',
  'рамен',
  'лапш\\p{L}*',
  'вок',
  'стейк\\p{L}*',
  'драник\\p{L}*',
  'блин\\p{L}*',
  'каш\\p{L}*',
  'яйц\\p{L}*',
  'хлеб',
  'сыр\\p{L}*',
  'детское меню',
);

// ---- The name ---------------------------------------------------------------

/** No dish holds these: in a set breakfast too. */
const NO_DISH_HOLDS = words('brut', 'брют', 'extra dry', 'cremant', 'veuve clicquot', 'bulbash');

/** Paid pairing: «Винное сопровождение», «Коктейльное сопровождение». */
const PAIRING = words('(?:винн|коктейльн|алкогольн)\\p{L}* сопровождени\\p{L}*', 'wine pairing');

/** «Бокал вина», «Красное полусухое», «Сет шотов» — the drink by its measure. */
const DRINK_BY_ITS_MEASURE = words(
  '(?:белое|красное|розовое|оранжевое) (?:сухое|полусухое|полусладкое|сладкое)',
  '(?:бокал|бутылка|графин|кувшин) (?:\\p{L}+ )?(?:вина|игристого|шампанского|просекко|пива|сидра)',
  'сет (?:\\p{L}+ )?(?:вина|вин|шотов|настоек|пива)',
);

/**
 * Names that hold a drink's word and are not that drink: «Ром-баба», a set «без
 * сопровождения вина», «Виски соус», «Ролл Саке» (лосось), «Портер-хаус», «Скотч
 * Эгг», the soft «Ginger ale».
 */
const NOT_THE_DRINK = words(
  'ром[- ]баб\\p{L}*',
  'сет',
  'сеты',
  'set',
  'соус\\p{L}*',
  'sauce',
  'ролл\\p{L}*',
  'маки',
  'суши',
  'нигири',
  'сашими',
  'гункан\\p{L}*',
  'поке',
  'портер[- ]?хаус',
  'скотч[- ]эгг',
  'scotch egg',
  'ginger ale',
);

/** Words that are this drink. A dish may be cooked with them: COOKED_WITH decides. */
const SPIRITS_AND_WINE = [
  'сангри\\p{L}*',
  'глинтвейн\\p{L}*',
  'sangria',
  'gluhwein',
  'просекко',
  'prosecco',
  'игрист\\p{L}*',
  'шампанск\\p{L}*',
  'champagne',
  'крюшон',
  'джин[- ]?тоник',
  'gin ?& ?tonic',
  'gin[- ]tonic',
  'вино',
  'вина',
  'wines?',
  'vinho',
  'пиво',
  'пива',
  'beer',
  'bier',
  'ale',
  'lager',
  'лагер',
  'stout',
  'стаут',
  'porter',
  'портер',
  'pils(?:ner)?',
  'пилснер',
  'ipa',
  'weizen',
  'hefeweizen',
  'радлер',
  'radler',
  'сидр',
  'cider',
  'водка',
  'водки',
  'гарэлк\\p{L}*',
  'vodka',
  'виски',
  'whiske?y',
  'scotch',
  'скотч',
  'джин',
  'джын',
  'gin',
  'ром',
  'rum',
  'текила',
  'текилы',
  'tequila',
  'мескаль',
  'mezcal',
  'коньяк',
  'каньяк',
  'cognac',
  'бренди',
  'brandy',
  'арманьяк',
  'кальвадос',
  'calvados',
  'граппа',
  'grappa',
  'ликер',
  'liqueur',
  'liquor',
  'настойк\\p{L}*',
  'наливк\\p{L}*',
  'хреновух\\p{L}*',
  'медовух\\p{L}*',
  'самогон\\p{L}*',
  'абсент',
  'absinthe',
  'самбука',
  'sambuca',
  'вермут',
  'vermouth',
  'мартини',
  'martini',
  'портвейн',
  'porto',
  'херес',
  'sherry',
  'xepec',
  'кагор',
  'саке',
  'сакэ',
  'sake',
  'соджу',
  'soju',
  'шоты',
  'апероль',
  'aperol',
  'кампари',
  'campari',
  'лимончелло',
  'limoncello',
  'егермейстер',
  'ягермейстер',
  'jagermeister',
  'cointreau',
  'куантро',
  'амаро',
  'amaro',
  'фернет',
  'fernet',
  'шартрез',
  'chartreuse',
  'калуа',
  'трипл сек',
  'triple sec',
  'драмбуи',
  'drambuie',
  'бенедиктин',
  'benedictine',
  'гальяно',
  'galliano',
];

/** Sorts of grape and wine regions: a name holding one is a wine, wherever it was read. */
const GRAPE_OR_REGION = [
  'каберне',
  'мерло',
  'шардоне',
  'совиньон',
  'рислинг',
  'пино (?:гриджио|гри|нуар|блан)',
  'мальбек',
  'темпранильо',
  'зинфандель',
  'гевюрцтраминер',
  'санджовезе',
  'кьянти',
  'риоха',
  'шабли',
  'ламбруско',
  'cabernet',
  'merlot',
  'chardonnay',
  'sauvignon',
  'riesling',
  'pinot (?:grigio|gris|noir|blanc)',
  'malbec',
  'tempranillo',
  'zinfandel',
  'zweigelt',
  'syrah',
  'shiraz',
  'sangiovese',
  'chianti',
  'rioja',
  'chablis',
  'lambrusco',
  'verdejo',
  'albarino',
  'vinho verde',
  'gruner veltliner',
  'cava',
  'franciacorta',
  'domaine',
  'bourgogne',
  'burgundy',
  'piemonte',
  'cuvee',
];

/** Brands that are alcohol and nothing else; for rows with no section read. */
const BRAND = [
  // beer
  'corona extra',
  'hoegaarden',
  'stella artois',
  'стелла артуа',
  'стела артуа',
  'carlsberg',
  'карлсберг',
  'heineken',
  'хайнекен',
  'budweiser',
  'guinness',
  'гиннес',
  'grimbergen',
  'estrella damm',
  'paulaner',
  'erdinger',
  'лидское',
  'аливария',
  'крыница',
  'балтика',
  'жигулевское',
  'крушовице',
  'staropramen',
  'kozel',
  // spirits
  'jack daniels?',
  'jim beam',
  'four roses',
  'jameson',
  'bushmills',
  'tullamore',
  'chivas',
  'johnnie walker',
  'ballantines?',
  'clan campbell',
  'glen ?morangie',
  'macallan',
  'aberlour',
  'nikka',
  'havana club',
  'bacardi',
  'бакарди',
  'captain morgan',
  'matusalem',
  'beefeater',
  'gordons',
  'bombay sapphire',
  'hendricks',
  'tanqueray',
  'finlandia',
  'absolut',
  'smirnoff',
  'хортица',
  'martell',
  'hennessy',
  'remy martin',
  'courvoisier',
  'godet',
  'becherovka',
  'бехеровка',
  'disaronno',
  'kahlua',
];

/**
 * Names of mixed drinks: a word of the bar unless a section or the name says
 * soft drinks.
 */
const MIXED_DRINK = [
  'сприт[цз]',
  'шприц',
  'spritz',
  'highball',
  'хайбол',
  'sparkling(?! water)',
  'cuba libre',
  'куба либре',
  'mimosa',
  'негрони',
  'negroni',
  'мохито',
  'mojito',
  'дайкири',
  'daiquiri',
  'пина[- ]колада',
  'pina colada',
  'космополитен',
  'cosmopolitan',
  'лонг[- ]айленд',
  'long island',
  'кровав\\p{L}* мэри',
  'блади мэри',
  'bloody mary',
  'олд фэшн\\p{L}*',
  'old fashioned',
  'white russian',
  'белый русский',
  'tom collins',
  'french 75',
  'clover club',
  'kir royal',
  'кир рояль',
  'беллини',
  'bellini',
  'garibaldi',
  'гарибальди',
  'хьюго',
  'hugo',
  'грог',
  'grog',
  'b-52',
  'б-52',
];

/**
 * Words that under «Кофе» or in a dessert are a syrup or a sort: «Раф амаретто»,
 * «Латте Бейлис», «Чизкейк Бейлис», a filter coffee of the Bourbon variety. They
 * go only as a name of their own outside a food section.
 */
const SYRUP_OR_SORT = ['амаретто', 'amaretto', 'бейлис', 'baileys', 'бурбон', 'bourbon'];

const THE_DRINK_ITSELF = new RegExp(words(...SPIRITS_AND_WINE, ...GRAPE_OR_REGION, ...BRAND).source, 'gu');
const MIXED_OR_SYRUP = new RegExp(words(...MIXED_DRINK, ...SYRUP_OR_SORT).source, 'gu');
const BEGINS_A_DRINK = new RegExp(`^(?:${[...SPIRITS_AND_WINE, ...GRAPE_OR_REGION, ...BRAND, ...MIXED_DRINK].join('|')})(?!${LETTER}|-)`, 'u');

/**
 * What the drink's word is cooked with or named after: the text before it ends
 * in a preposition or a dish's word, with at most three words between.
 */
const COOKED_WITH = new RegExp(
  `(?<!${LETTER})(?:с|со|в|во|на|из|под|по|к|для|алла|alla|al|with|in|соус\\p{L}*|sauce|маринад\\p{L}*|кляр\\p{L}*|сироп\\p{L}*|syrup|без)`
  + '(?: [\\p{L}\\p{N}-]+){0,3}$',
  'u',
);

/**
 * A Latin name with a comma that ends in its vintage: «Travaglini, Gattinara,
 * Piemonte 2020». «Pizza Pepperoni 2024» and «Sangria, 1000» are not.
 */
const isVintage = (name) => name.includes(',')
  && !/[а-я]/.test(name)
  && /(?<!\d)(?:19[5-9]\d|20[0-2]\d)$/.test(name);

/**
 * Whether a word of the list stands for the thing itself. Each occurrence is
 * checked by what stands before it.
 *
 * @param {string} name
 * @param {RegExp} pattern - A global pattern of words
 * @returns {boolean}
 */
const standsForItself = (name, pattern) => {
  for (const match of name.matchAll(pattern)) {
    const before = name.slice(0, match.index).trimEnd();
    if (!COOKED_WITH.test(before)) return true;
  }
  return false;
};

/** A section that says «no alcohol» and names nothing of the bar besides. */
const sectionSaysNoAlcohol = (section) => NO_ALCOHOL_SECTION.test(section)
  && !BAR_SECTION.test(section.replace(NO_ALCOHOL_SECTION_ALL, ' ').trim());

/**
 * @param {{item_name?: (string|null), category_raw?: (string|null)}} item
 * @returns {('alcohol'|'tobacco'|null)} What the guest must not see the line for
 */
export const restrictionOf = (item) => {
  const name = readForRestriction(item?.item_name);
  const section = readForRestriction(item?.category_raw);

  // 1. Tobacco. Before «no alcohol»: «Кальян Zero» is still a hookah.
  if (TOBACCO_SECTION.test(section)) return 'tobacco';
  if (TOBACCO_NAME.test(name) && !TOBACCO_DISH.test(name)) return 'tobacco';

  // 2. Says «no alcohol».
  if (NO_ALCOHOL_NAME.test(name) || sectionSaysNoAlcohol(section)) return null;

  // 3. A section of food: the name is a dish.
  if (FOOD_FOR_THE_DRINK.test(section) || FOOD_SECTION.test(section)) {
    if (NO_DISH_HOLDS.test(name) || DRINK_BY_ITS_MEASURE.test(name)) return 'alcohol';
    return BEGINS_A_DRINK.test(name) && !NOT_THE_DRINK.test(name) ? 'alcohol' : null;
  }

  // 4. A section of the bar.
  if (!SEAFOOD_COCKTAIL.test(section) && BAR_SECTION.test(section)) {
    const softOrSnack = SOFT_OR_SNACK_HEAD.test(name)
      && !IRISH_COFFEE.test(name)
      && !SOFT_DRINK_WITH_ALCOHOL.test(name);
    return softOrSnack ? null : 'alcohol';
  }

  // 5. The name.
  if (NO_DISH_HOLDS.test(name) || PAIRING.test(name) || DRINK_BY_ITS_MEASURE.test(name)) return 'alcohol';
  if (SOFT_DRINK_WITH_ALCOHOL.test(name) || IRISH_COFFEE.test(name)) return 'alcohol';
  if (NOT_THE_DRINK.test(name)) return null;
  if (isVintage(name) || standsForItself(name, THE_DRINK_ITSELF)) return 'alcohol';
  if (!SOFT_SECTION.test(section) && !SOFT_NAME.test(name) && standsForItself(name, MIXED_OR_SYRUP)) return 'alcohol';

  return null;
};
