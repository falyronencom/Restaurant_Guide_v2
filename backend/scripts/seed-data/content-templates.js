/**
 * Content Generation Templates for Seed Data
 *
 * This module provides structured templates for generating realistic varied
 * Russian text content for establishment descriptions, names, addresses.
 *
 * Design principle: Simple template-based variation without AI complexity.
 * Templates use variable substitution creating grammatically correct natural text.
 */

/**
 * Establishment Names - Predefined Realistic List
 *
 * Mix of Cyrillic, Russian, Western patterns, historical references.
 * Length variation from short (4 chars) to long (50+ chars) for UI testing.
 */
export const ESTABLISHMENT_NAMES = [
  // Historical & Traditional (10)
  'Старый Город',
  'Троицкое Предместье',
  'Кухмістр',
  'Корчма',
  'Замковая',
  'Губернаторъ',
  'Лида',
  'Золотой Лев',
  'Беларусь',
  'Раковский Бровар',

  // Western/Modern Style (15)
  'Coffee Room',
  'Urban Kitchen',
  'The Loft',
  'Green Box',
  'Fresh Point',
  'Burger Club',
  'Pizza Mania',
  'Sushi Bar',
  'Wine Gallery',
  'Craft House',
  'Food Market',
  'Street Food',
  'Coffee Bean',
  'Brooklyn',
  'Manhattan',

  // Russian Descriptive (15)
  'Веранда',
  'Крыша',
  'Гастропаб',
  'Кондитерская',
  'Пекарня',
  'Столовая №1',
  'Домашняя кухня',
  'Семейное кафе',
  'Уютный дворик',
  'Летняя терраса',
  'Золотая рыбка',
  'Белый аист',
  'Красный мак',
  'Синяя птица',
  'Зеленый попугай',

  // Ethnic/Cuisine-Specific (15)
  'Мамма Миа',
  'Трattoria Italiana',
  'Грузинский дворик',
  'Тбилиси',
  'Баку',
  'Пекин',
  'Шанхай',
  'Токио',
  'Osaka Sushi',
  'Delhi Palace',
  'Istanbul',
  'Beirut',
  'Samarkand',
  'Казан',
  'Дастархан',

  // Branded/Chain Style (10)
  'Лидо',
  'Васильки',
  'Талака',
  'Камяніца',
  'Сябры',
  'Драники',
  'Бульбашъ',
  'Крамбамбуля',
  'Зубровка',
  'Беловежская пуща',

  // Short Names (4-6 chars) for UI testing (5)
  'Café',
  'Бар',
  'Pub',
  'Гриль',
  'Чай',

  // Very Long Names (50+ chars) for Edge Case 3 (5)
  'Ресторан традиционной белорусской кухни "Бабушкины рецепты"',
  'Кофейня-кондитерская премиум класса "Сладкая жизнь"',
  'Пиццерия с дровяной печью и панорамным видом на город',
  'Семейный ресторан европейской и азиатской кухни "Вкусы мира"',
  'Круглосуточная столовая домашней еды "Как у мамы дома"',
];

/**
 * Description Templates - Variable Substitution System
 *
 * Templates use {variable} placeholders replaced with random values
 * from corresponding arrays. Generates grammatically correct Russian text.
 */

// Adjectives for establishment character
const ADJECTIVES = [
  'уютное',
  'современное',
  'стильное',
  'семейное',
  'демократичное',
  'элегантное',
  'атмосферное',
  'просторное',
  'камерное',
  'модное',
  'классическое',
  'оригинальное',
  'популярное',
  'известное',
  'любимое',
];

// Location descriptions
const LOCATIONS = [
  'в центре города',
  'в историческом районе',
  'на набережной',
  'в тихом дворике',
  'в деловом квартале',
  'в спальном районе',
  'рядом с парком',
  'на главной улице',
  'в торговом центре',
  'у метро',
  'в центре Минска',
  'в старом городе',
  'на площади',
  'возле вокзала',
  'в живописном месте',
];

// Cuisine descriptions
const CUISINE_DESCRIPTIONS = [
  'разнообразное меню европейской кухни',
  'авторские блюда от шеф-повара',
  'традиционные белорусские блюда',
  'свежие морепродукты и рыба',
  'мясные деликатесы и стейки',
  'вегетарианские и веганские блюда',
  'домашняя выпечка и десерты',
  'итальянская паста и пицца',
  'азиатская кухня и суши',
  'блюда на гриле и барбекю',
  'фермерские продукты',
  'сезонное меню',
  'блюда грузинской кухни',
  'восточные специалитеты',
  'средиземноморская кухня',
];

// Ambiance sentences
const AMBIANCE_SENTENCES = [
  'Интерьер выполнен в современном стиле с элементами классики.',
  'Панорамные окна создают ощущение простора и света.',
  'Живая музыка по выходным создает особую атмосферу.',
  'Терраса открыта в теплое время года.',
  'Камин добавляет уютности в холодные вечера.',
  'Дизайнерская мебель и авторские светильники.',
  'Открытая кухня позволяет наблюдать за работой поваров.',
  'Винная карта насчитывает более 100 позиций.',
  'Детская комната с аниматором по выходным.',
  'Бизнес-ланчи в будние дни по специальным ценам.',
  'Банкетный зал вмещает до 50 гостей.',
  'Летняя веранда с видом на парк.',
  'Караоке-система и танцпол.',
  'Тихая атмосфера для деловых встреч.',
  'Фоновая музыка и приглушенный свет.',
];

// Special features
const SPECIAL_FEATURES = [
  'Принимаем заказы на доставку.',
  'Возможна организация банкетов и фуршетов.',
  'Wi-Fi и розетки для работы с ноутбуком.',
  'Парковка для посетителей.',
  'Детское меню и высокие стульчики.',
  'Вегетарианское меню по запросу.',
  'Безналичный расчет и оплата картами.',
  'Система лояльности для постоянных гостей.',
  'Бронирование столиков онлайн.',
  'Кальянное меню.',
  'Спортивные трансляции на больших экранах.',
  'Живая музыка в пятницу и субботу.',
  'Завтраки с 7 утра.',
  'Работаем круглосуточно.',
  'Услуги кейтеринга.',
];

/**
 * Generate description of specified length category
 *
 * @param {string} lengthCategory - 'short' (50-100 words), 'medium' (100-200 words), 'long' (200-300 words)
 * @returns {string} Generated description in Russian
 */
export const generateDescription = (lengthCategory = 'medium') => {
  const templates = {
    // Short: 1-2 sentences (50-100 words)
    short: [
      `{adjective} заведение {location} предлагает {cuisine}. {ambiance}`,
      `{cuisine} {location}. {adjective} интерьер и внимательный персонал. {feature}`,
      `{location} расположено {adjective} заведение. {cuisine}. {feature}`,
    ],

    // Medium: 3-4 sentences (100-200 words)
    medium: [
      `{adjective} заведение {location} предлагает {cuisine}. {ambiance} {feature} Ждем вас каждый день!`,
      `{cuisine} {location}. {adjective} интерьер создает комфортную атмосферу для встреч с друзьями и семьей. {ambiance} {feature}`,
      `{location} открылось {adjective} заведение с акцентом на качество и сервис. {cuisine} {ambiance} {feature} Приходите и убедитесь сами!`,
      `Наше {adjective} заведение {location} работает для вас уже много лет. {cuisine} {ambiance} {feature} Будем рады видеть вас среди наших гостей.`,
    ],

    // Long: 5-7 sentences (200-300 words)
    long: [
      `{adjective} заведение {location} приглашает гостей насладиться {cuisine}. {ambiance} Наша команда профессиональных поваров готовит блюда из свежих качественных продуктов. {feature} Мы работаем для вас ежедневно, создавая атмосферу гостеприимства и комфорта. Каждый гость для нас особенный, и мы делаем все, чтобы ваш визит запомнился надолго. {feature2} Ждем вас!`,
      `{location} расположено наше {adjective} заведение, где каждая деталь продумана для вашего комфорта. {cuisine} {ambiance} Мы гордимся своей кухней и постоянно работаем над расширением меню. {feature} Наши цены приятно удивят вас при высоком качестве блюд и обслуживания. {feature2} Приходите сами и приводите друзей - у нас всегда рады гостям!`,
      `Добро пожаловать в наше {adjective} заведение {location}! Мы предлагаем {cuisine} в уютной и приятной обстановке. {ambiance} Наш персонал всегда готов помочь с выбором блюд и напитков. {feature} {feature2} Мы ценим каждого гостя и делаем все возможное для того, чтобы вы чувствовали себя как дома. Будем рады видеть вас снова и снова!`,
    ],
  };

  const templateList = templates[lengthCategory] || templates.medium;
  const template = randomChoice(templateList);

  // Replace variables with random values
  let description = template
    .replace(/{adjective}/g, randomChoice(ADJECTIVES).charAt(0).toUpperCase() + randomChoice(ADJECTIVES).slice(1))
    .replace(/{location}/g, randomChoice(LOCATIONS))
    .replace(/{cuisine}/g, randomChoice(CUISINE_DESCRIPTIONS))
    .replace(/{ambiance}/g, randomChoice(AMBIANCE_SENTENCES))
    .replace(/{feature}/g, randomChoice(SPECIAL_FEATURES))
    .replace(/{feature2}/g, randomChoice(SPECIAL_FEATURES));

  return description;
};

/**
 * Street names for each city
 */
const STREET_NAMES = {
  'Минск': [
    'пр-т Независимости',
    'ул. Ленина',
    'ул. Немига',
    'ул. Зыбицкая',
    'ул. Революционная',
    'ул. Комсомольская',
    'пр-т Победителей',
    'ул. Интернациональная',
    'ул. Притыцкого',
    'ул. Тимирязева',
    'ул. Богдановича',
    'ул. Янки Купалы',
  ],
  'Гродно': [
    'ул. Советская',
    'ул. Ожешко',
    'ул. Замковая',
    'ул. Социалистическая',
    'ул. Карла Маркса',
    'ул. Горького',
  ],
  'Брест': [
    'ул. Советская',
    'бул. Космонавтов',
    'ул. Ленина',
    'ул. Московская',
    'пр-т Машерова',
    'ул. Гоголя',
  ],
  'Гомель': [
    'пр-т Ленина',
    'ул. Советская',
    'ул. Кирова',
    'ул. Победы',
    'ул. Речицкое шоссе',
    'ул. Барыкина',
  ],
  'Витебск': [
    'пр-т Фрунзе',
    'ул. Ленина',
    'ул. Смоленская',
    'ул. Правды',
    'ул. Калинина',
    'ул. Замковая',
  ],
  'Могилев': [
    'пр-т Мира',
    'ул. Ленинская',
    'ул. Первомайская',
    'ул. Космонавтов',
    'пр-т Пушкинский',
    'ул. Лазаренко',
  ],
  'Бобруйск': [
    'ул. Социалистическая',
    'ул. Ленина',
    'ул. Минская',
    'ул. Гоголя',
    'ул. Пушкина',
    'бул. Победы',
  ],
};

/**
 * Generate realistic address for given city
 *
 * @param {string} city - City name
 * @returns {string} Address in format "ул. Name, XX"
 */
export const generateAddress = (city) => {
  const streets = STREET_NAMES[city] || STREET_NAMES['Минск'];
  const street = randomChoice(streets);
  const buildingNumber = Math.floor(Math.random() * 150) + 1;
  const hasCorpus = Math.random() < 0.2; // 20% chance of corpus
  const corpus = hasCorpus ? `, корп. ${Math.floor(Math.random() * 5) + 1}` : '';

  return `${street}, ${buildingNumber}${corpus}`;
};

/**
 * Approximate city center coordinates for Belarus cities
 */
export const CITY_COORDINATES = {
  'Минск': { latitude: 53.9006, longitude: 27.5590 },
  'Гродно': { latitude: 53.6693, longitude: 23.8131 },
  'Брест': { latitude: 52.0976, longitude: 23.7340 },
  'Гомель': { latitude: 52.4418, longitude: 30.9883 },
  'Витебск': { latitude: 55.1904, longitude: 30.2049 },
  'Могилев': { latitude: 53.9007, longitude: 30.3313 },
  'Бобруйск': { latitude: 53.1384, longitude: 29.2214 },
};

/**
 * Generate random coordinates near city center
 * Adds small random offset to city center (±0.05 degrees ~ 5km radius)
 *
 * @param {string} city - City name
 * @returns {object} {latitude, longitude}
 */
export const generateCoordinates = (city) => {
  const center = CITY_COORDINATES[city] || CITY_COORDINATES['Минск'];
  const latOffset = (Math.random() - 0.5) * 0.1; // ±0.05 degrees
  const lonOffset = (Math.random() - 0.5) * 0.1;

  return {
    latitude: parseFloat((center.latitude + latOffset).toFixed(6)),
    longitude: parseFloat((center.longitude + lonOffset).toFixed(6)),
  };
};

/**
 * Random choice from array utility
 */
function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate random phone number in Belarus format
 *
 * @returns {string} Phone in format +375 (XX) XXX-XX-XX
 */
export const generatePhone = () => {
  const codes = ['29', '33', '44', '25']; // Mobile operators
  const code = randomChoice(codes);
  const part1 = Math.floor(Math.random() * 900) + 100; // 100-999
  const part2 = Math.floor(Math.random() * 90) + 10; // 10-99
  const part3 = Math.floor(Math.random() * 90) + 10; // 10-99

  return `+375 (${code}) ${part1}-${part2}-${part3}`;
};
