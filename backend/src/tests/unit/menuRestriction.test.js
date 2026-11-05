/* eslint-env jest */
/**
 * What the guest must not see as a menu line, and what must stay.
 *
 * The expected values come from the brief of 05.11.2026 (its own examples) and
 * from production's menus as read on 05.11.2026 (the before/after list,
 * docs/handoffs/alcohol_menu_filter_20261105): every row here is [name, section]
 * as a menu has it. A mistake found later goes here first.
 */
import { restrictionOf } from '../../utils/menuRestriction.js';

const row = ([item_name, category_raw = null]) => ({ item_name, category_raw });

describe('alcohol: the guest does not see it', () => {
  test.each([
    // The brief: beer, wine, sparkling, spirits, liqueurs, cocktails, sangria.
    ['Пиво светлое'],
    ['Вино красное'],
    ['вино белое/розовое/красное/просекко', 'алкоголь'],
    ['игристое вино'],
    ['Игристое Италия', 'КОКТЕЙЛИ'],
    ['ликер limoncello luxardo', 'крепкое'],
    ['Сангрия бокал'],
    ['Сангрия / Sangria, 1000', 'Летние напитки / Summer drinks'],
    ['джин-тоник'],
    ['МАЛИНОВЫЙ ДЖИН-ТОНИК', 'КОКТЕЙЛИ'],
    ['Бокал вина', 'Напитки'],
    ['Глинтвейн на красном вине 320 мл', 'Глинтвейн'],
    ['глинтвейн'],
    // A section of the bar: the name says nothing by itself.
    ['Hoegaarden 440ml', 'ПИВО'],
    ['Мейсон Арни Бланш 300 / 500 мл', 'Пиво'],
    ['Schmidt', 'VODKA 40 ml'],
    ['Havana 3', 'RUM 40 ml'],
    ['Martell VS', 'COGNAC 40 ml'],
    ['Four Roses', 'WHISKEY / AMERICAN'],
    ['Rooster Rojo Blanco', 'TEQUILA 40 ml'],
    ['Skinos', 'APERITIVE&LIQUOR'],
    ['Nieport Tawny', 'SHERRY&PORTO'],
    ['КИЦУНЭ', 'КОКТЕЙЛИ'],
    ['СЛИВА', 'COCKTAILS'],
    ['Margarita', 'CLASSIC COCKTAILS'],
    ['Маргарита', 'Коктейли'],
    ['Mimosa', 'КОКТЕЙЛИ'],
    ['Edition Abtei Himmerod', 'БЕЛОЕ'],
    ['Eduardo Bermejo Tinto', 'КРАСНОЕ'],
    ['ДОМОДО', 'КРАСНОЕ ПОЛУСУХОЕ'],
    ['Игристое', 'БОКАЛ ВИНА 18'],
    ['nikka days', 'ДИЖЕСТИВЫ 40ML'],
    ['"la Folie des Loups" Brut Rose', 'ИГРИСТОЕ И КОКТЕЙЛИ'],
    ['belarussian | ваниль + кофе', 'коктейли'],
    // No section read, or one of no use.
    ['Kir Royal'],
    ['Mango Bellini'],
    ['Aperol spritz'],
    ['aperol spritz', 'НАПИТКИ'],
    ['sparkling special', 'НАПИТКИ'],
    ['jasmine highball', 'НАПИТКИ'],
    ['local negroni', 'НАПИТКИ'],
    ['Мохито', 'Напитки'],
    ['Carlsberg 0,430'],
    ['Шардоне'],
    ['Travaglini, Gattinara, Piemonte 2020', 'Шеф-ужин "МИР НА ВКУС"'],
    ['Godet Antarctica', 'Шеф-ужин "МИР НА ВКУС"'],
    ['LA TAUPE, PINOT NOIR, DOMAINE CHAVY-CHOUET, BOURGOGNE, 2022', 'МОРСКОЙ'],
    ['Винное сопровождение', 'СЕТ - МЕНЮ'],
    ['Коктейльное сопровождение', 'СЕТ - МЕНЮ'],
    // In a food section, the name itself is the drink.
    ['ИГРИСТОЕ к завтраку 125мл', 'ЗАВТРАК из 4 блюд'],
    ['VEUVE CLICQUOT-PONSARDIN, BRUT', 'Завтрак НЕ студента'],
    ['BULBASH №1 RESERVE..', 'Завтрак НЕ студента'],
    ["ca' di rajo - mito extra dry", 'БРАНЧ'],
    // Coffee and cocoa with alcohol.
    ['Какао с ореховым ликёром / Cacao with nut liqueur', 'Какао / Cacao'],
    ['Кофе по-Ирландски / Irish Coffee', 'Кофе / Coffee'],
    ['Кофе с коньяком', 'Кофе'],
    ['Кофе по-ирландски', 'алкоголь'],
    ['АЙРИШ (180 МЛ)', 'СОГРЕВАЮЩИЕ НАПИТКИ'],
    ['Кофе с коньяком', 'Алкоголь'],
    ['Кола с ромом', 'Коктейли'],
    ['Кола с ромом'],
    // Phase 3.5: the drink at the head of a line under a section of food.
    ['bellini | персик', 'БРАНЧ'],
    ['Бокал просекко', 'Завтрак'],
    ['Шардоне', 'Бранч'],
    ['Hennessy VS', 'Завтрак'],
    // Phase 3.5: a beer's volume is not «zero», «no alcohol» beside the bar.
    ['Балтика 0,5', 'ПИВО'],
    ['Балтика 0,5'],
    ['Хугарден', 'Пиво и безалкогольные напитки'],
    ['Сет вина'],
    ['Сет шотов'],
    // Word of the Coordinator 05.11: liqueurs by name. «Амаро» first, with a coffee
    // word in the name: a liqueur does not yield to it, a syrup would.
    ['Амаро Эспрессо - Тоник 300мл', 'СЕЗОННЫЕ НАПИТКИ'],
    ['Amaro Montenegro'],
    ['Фернет Бранка'],
    ['Fernet-Branca'],
    ['Шартрез'],
    ['Chartreuse Verte'],
    ['Ягермейстер'],
    ['Калуа'],
    ['Triple Sec'],
    ['Трипл сек'],
    ['Драмбуи'],
    ['Drambuie'],
    ['Бенедиктин'],
    ['Benedictine'],
    ['Гальяно'],
    ['Galliano'],
    // Mutation check: words no dish holds, and a vintage with no region named.
    ['Astoria Brut'],
    ['Veuve Clicquot'],
    ['Travaglini, Gattinara 2020'],
    ['Хаус', 'Коктейли из рома'],
    // A wine's sweetness is no food section.
    ['Хаус', 'КРАСНОЕ СЛАДКОЕ'],
    ['Хаус', 'Вино сладкое'],
    // Belarusian and marked letters are read like their neighbours.
    ['Віно белае'],
    ['Гарэлка', 'Шоты'],
    ['Гарэлка'],
    ['Каньяк'],
    ['Хаус', 'АЛКАГОЛЬ'],
    ['Хаус', 'КАКТЭЙЛІ'],
    ['Хаус', 'ДЖЫН'],
    ['Loimer, Grüner Veltliner Langenlois'],
  ])('%s', (...args) => {
    expect(restrictionOf(row(args))).toBe('alcohol');
  });
});

describe('tobacco: the guest does not see it', () => {
  test.each([
    ['Кальян на чаше грейпфрута'],
    ['Кальян классический', 'Кальяны'],
    ['Чаша на ананасе', 'Кальян'],
    ['Любая строка', 'КАЛЬЯННАЯ КАРТА'],
    ['Табак Darkside'],
    ['Сигареты Winston'],
    ['Сигарета'],
    ['Сигара кубинская'],
    ['Cohiba Siglo'],
    ['Вейп HQD Cuvie'],
    ['Жидкость для вейпа 30 мл'],
    ['Стики HEETS'],
    ['IQOS'],
    ['Кальян без табака'],
    ['Кальян Zero'],
    ['Безалкогольный кальян'],
    ['Сигары'],
    ['Сигариллы'],
    ['Чаша табака'],
  ])('%s', (...args) => {
    expect(restrictionOf(row(args))).toBe('tobacco');
  });
});

describe('a dish with such a word stays', () => {
  test.each([
    // The brief.
    ['Стейк с соусом из коньяка'],
    ['Пенне алла водка'],
    ['пенне алла водка с цыплёнком', 'горячие блюда'],
    ['Бифштекс с красным вином'],
    ['Бифштекс из говядины с соусом демигляс, красным вином, зеленым перцем', 'ГОРЯЧЕЕ'],
    ['Тартар из лосося'],
    ['Глазунья с тартаром из говядины', 'ЯЙЦА'],
    ['Десерт с ромом'],
    ['Винегрет'],
    ['Винегрет из-под топора с муссом из сельди', 'САЛАТЫ'],
    ['Лосось слабого посола с кленовым винегретом'],
    // Cooked with, named after.
    ['Стейк шатобриан с соусом из голубого сыра и коньяка', 'МЯСО • VIANDE'],
    ['ФУА-ГРА С ТОМЛЕНОЙ ГРУШЕЙ В ПОРТВЕЙНЕ', 'ОСНОВНЫЕ БЛЮДА'],
    ['Мидии в белом вине'],
    ['Канадский запечённый лобстер с соусе саке / с соусом ким чи', 'АКВАРИУМ'],
    ['Домашняя паста со сливочно-винным соусом и Пармезаном', 'ОБЕД из 4 блюд'],
    ['Рёбра в соусе виски'],
    ['Соус Виски'],
    ['Чизкейк шоколадный с соусом Бейлиз', 'На десерт'],
    ['РАВИОЛИ С КРАБОМ, северной креветкой и настойкой из раков', 'ГОРЯЧИЕ ЗАКУСКИ'],
    ['Креветки в пивном кляре'],
    ['Гренки к пиву'],
    ['ЧТО-ТО К ПИВУ', 'ЗАКУСКИ'],
    ['Винная тарелка', 'ЗАКУСКИ • ENTRÉES'],
    ['Ром-баба'],
    ['Ромовая баба', 'Десерты'],
    ['Виски-соус', 'Соусы'],
    ['Сет без сопровождения вина', 'Шеф-ужин "МИР НА ВКУС"'],
    // The words that look like a drink's.
    ['Цыплёнок табака'],
    ['Цыпленок-табака', 'Горячее'],
    ['Цыплёнок табак'],
    ['Сигары из лаваша с сыром'],
    ['Кальмар на гриле'],
    ['Кальмар патагонский', 'МОРЕПРОДУКТЫ'],
    ['Чай с ромашкой'],
    ['РОМАШКА', 'Чай'],
    ['Лосось с ромеско и пеной Морне'],
    ['Романо с цыпленком', 'Салаты'],
    ['Эспрессо-Романо', 'Напитки'],
    ['Яйцо пашот'],
    ['шот (эспрессо, матча, шоколад) (40 г)', 'Добавить'],
    ['Лимон'],
    // A section names the drink, the rows are food.
    ['Чесночные гренки', 'ЗАКУСКИ К ПИВУ'],
    ['Утиный хамон', 'К ВИНУ'],
    ['Вяленый окорок', 'СТАРТЕРЫ К ВИНУ'],
    ['Сет к вину / Wine set', 'Закуски к вину / Wine Snacks'],
    ['Фин де Бретань', 'УСТРИЧНЫЙ БАР'],
    ['Сет сашими', 'RAW BAR'],
    ['ЗЕЛЕНЫЕ ОЛИВКИ С РОЗМАРИНОМ', 'АПЕРИТИВЫ'],
    ['Коктейль из креветок', 'Закуски'],
    ['Гриль-меню', 'Коктейли из морепродуктов'],
    // Phase 3.5: cooked with, in any list and with no section read.
    ['Груша в глинтвейне'],
    ['Груша в мерло'],
    ['Устрицы с шампанским'],
    ['Соус Бурбон'],
    ['Тирамису с амаретто'],
    ['Соус Шардоне'],
    ['Рёбра в соусе Jack Daniels'],
    ['Стейк с соусом из коньяка / Steak with cognac sauce'],
    ['Виски соус', 'Соусы'],
    ['Виски-соус'],
    ['Скотч Эгг'],
    ['Портер-хаус'],
    // Phase 3.5: «Саке» in sushi is salmon.
    ['Ролл Саке'],
    ['Саке нигири', 'Закуски'],
    ['Нигири саке', 'НИГИРИ'],
    ['Суши саке', 'Роллы'],
    // Phase 3.5: a heading that names the drink, with food in it.
    ['Сырная тарелка', 'Закуски под пиво'],
    ['Сырная тарелка', 'Закуски к шампанскому'],
    ['Сырная тарелка', 'Винные закуски'],
    ['Тирамису', 'Десерты и вино'],
    ['Классический бургер', 'Бургеры и пиво'],
    ['Орешки', 'Бар меню'],
    // Mutation check: a heading of food for the drink with no word of food in it.
    ['Сырная тарелка', 'К игристому'],
    ['Оливки', 'К шампанскому'],
    ['Классический', 'Коктейли из креветок'],
    // Mutation check: a word compounded from a drink's name.
    ['Мартини-тарт', 'Десерты'],
    // Phase 3.5: other words that look like a drink's.
    ['Драники Бульбаш', 'Горячие блюда'],
    ['Драники Бульбаш'],
    ['Чизкейк Бейлис', 'Десерты'],
    ['Амаретто печенье', 'Десерты'],
    ['Pizza Pepperoni 2024'],
    ['Family set 2000'],
    ['Sangria sauce, 1000'],
    ['Сигары из лаваша'],
    ['Сигареты из лаваша'],
    ['Курица табак'],
    ['Цыпленок - табак'],
    // «Амаро» as what a dish is made with, and in other words.
    ['Тирамису с амаро', 'Десерты'],
    ['Панна-котта с соусом амаро'],
    ['Сироп амаро', 'Добавки'],
    ['Амарант с овощами'],
    ['Печенье амаретти', 'Десерты'],
    // «Маргарита» is a pizza under a food section.
    ['Маргарита', 'Пицца'],
    ['МАРГАРИТА', 'ПИЦЦА ИЗ ДРОВЯНОЙ ПЕЧИ'],
    ['Маргарита', 'СМАЖЕНКИ'],
    // A word of food that begins a name under a section of food.
    ['Бурбон-соус к стейку', 'ОСНОВНЫЕ БЛЮДА'],
  ])('%s', (...args) => {
    expect(restrictionOf(row(args))).toBeNull();
  });
});

describe('what says «no alcohol» stays', () => {
  test.each([
    // The brief.
    ['Безалкогольное пиво'],
    ['безалкогольный мохито'],
    ['Амаро безалкогольное'],
    // Production.
    ['bud non-alco 330ml', 'ПИВО'],
    ['konix - moose just moose, non-alcoholic', 'пиво'],
    ['Клаусталлер Оригинал Безалкогольное 330 мл', 'Пиво'],
    ['Бад б/а 330 мл', 'Пиво'],
    ['tropical n/a', 'коктейли'],
    ['Радлер б/а (345 мл)', 'КОКТЕЙЛЬ'],
    ['Глинтвейн на Б/А красном вине 320 мл', 'Глинтвейн'],
    ['Безалкогольный глинтвейн (350 мл)', 'ГОРЯЧИЕ НАПИТКИ'],
    ['Безалкогольное сопровождение', 'СЕТ - МЕНЮ'],
    ['Хьюго Б/А 165 мл', 'Безалкогольные коктейли'],
    ['Джин Бэзил Смэш 110 мл', 'Безалкогольные коктейли'],
    ['Апероль Спритц Зеро 175 мл', 'Безалкогольные коктейли'],
    ['Clover Club', 'Mocktails'],
    ['САКУРА', 'MOCKTAILS'],
    ['Кока-кола без цукру/Кока-Кола', 'БЕЗАЛКАГОЛЬНЫЯ НАПОІ'],
    ['Corona Cero 0,0%'],
    ['Балтика 0'],
    // Soft drinks.
    ['Мохито', 'Фирменные Лимонады 500 мл'],
    ['Молочный Коктейль Шоколад', 'Молочные Коктейли 300 мл'],
    ['Милкшейк ванильный 300 мл', 'Молочные коктейли'],
    ['Coca-Cola 0,33', 'SOFT'],
    ['Сок Rich 0,25', 'SOFT'],
    ['Кола 0,33', 'Бар меню'],
    ['Вода газированная', 'Алкоголь'],
    ['Ginger ale'],
    ['Раф амаретто', 'Кофе'],
    ['Латте Бейлис', 'КОФЕ'],
    ['Фильтр Эфиопия Бурбон', 'Альтернативный кофе'],
    ['кофейно-вишневый пунш', 'авторские напитки'],
    // Phase 3.5: the soft word is in the name, the section says nothing.
    ['Раф амаретто', 'Горячие напитки'],
    ['Латте Бейлис', 'Горячие напитки'],
    ['Лимонад Мохито', 'Напитки'],
    ['Сироп Амаретто', 'Добавки'],
    // Phase 3.5: soft drinks read into the bar.
    ['Американо', 'Бар меню'],
    ['Минеральная вода', 'Бар меню'],
    ['Молочный коктейль', 'Коктейли'],
    ['Смузи', 'Коктейли'],
    ['Клубничный', 'Детские коктейли'],
    ['Айс кофе', 'Кофейные коктейли'],
    ['Морс', 'Пиво и безалкогольные напитки'],
    ['Морс'],
    ['Квас'],
    ['HOUSE KOMBUCHA', 'КОМБУЧА'],
  ])('%s', (...args) => {
    expect(restrictionOf(row(args))).toBeNull();
  });
});

describe('what the name and section may be', () => {
  test('no name, no section', () => {
    expect(restrictionOf({ item_name: null, category_raw: null })).toBeNull();
    expect(restrictionOf({})).toBeNull();
    expect(restrictionOf(null)).toBeNull();
  });

  test('a multi-line section is read as one line', () => {
    expect(restrictionOf(row(['Limoncello Spritz 150ml', 'ИГРИСТОЕ И\nКОКТЕЙЛИ']))).toBe('alcohol');
  });

  test('case does not matter', () => {
    expect(restrictionOf(row(['ВИНО КРАСНОЕ']))).toBe('alcohol');
    expect(restrictionOf(row(['цЫпЛёНоК тАбАкА']))).toBeNull();
  });
});
