/* eslint comma-dangle: 0 */
/**
 * Review Test Fixtures
 *
 * Sample review data for testing the reviews system.
 * Uses realistic Russian/Belarusian text.
 */

/**
 * Valid review data with various ratings and content
 */
export const testReviews = [
  {
    rating: 5,
    content: 'Отличный ресторан! Драники просто восхитительные, очень сытные и вкусные. Обслуживание на высшем уровне, официанты вежливые и внимательные. Атмосфера уютная, идеально для семейного ужина. Обязательно вернемся!'
  },
  {
    rating: 4,
    content: 'Хорошее место, но есть недочеты. Еда вкусная, особенно понравилась мачанка. Порции большие, наелись вдвоем. Минус - долго ждали заказ, почти 40 минут. В остальном все отлично, рекомендую.'
  },
  {
    rating: 3,
    content: 'Среднее кафе. Ничего особенного, но и не плохо. Цены адекватные, порции нормальные. Кофе обычный, выпечка свежая. Для быстрого перекуса сойдет, но специально ехать не буду.'
  },
  {
    rating: 2,
    content: 'Разочарование. Ожидали большего после хороших отзывов. Еда была холодной, пришлось просить разогреть. Официант забыл про нас на 20 минут. Цены завышены для такого качества. Не советую.'
  },
  {
    rating: 1,
    content: 'Ужасно! Самый плохой опыт за последнее время. Еда несвежая, салат явно вчерашний. В супе плавал волос. Обслуживание отвратительное, официант был грубым. Больше ни ногой сюда!'
  },
  {
    rating: 5,
    content: 'Лучшая пицца в Минске! Тесто тонкое и хрустящее, ингредиенты свежайшие. Видно что готовят с любовью. Винная карта отличная, посоветовали идеальное вино к пицце. Цены разумные, порции огромные. 10 из 10!'
  },
  {
    rating: 4,
    content: 'Очень атмосферное место. Интерьер красивый, музыка приятная. Суши свежие, роллы большие. Немного дороговато, но качество того стоит. Единственный минус - шумно по вечерам, сложно разговаривать.'
  },
  {
    rating: 5,
    content: 'Прекрасная грузинская кухня! Хачапури по-аджарски просто божественные, хинкали сочные. Вино грузинское настоящее, не подделка. Персонал очень гостеприимный, чувствуешь себя как дома. Цены честные.'
  },
  {
    rating: 3,
    content: 'Обычный фаст-фуд. Бургеры неплохие, но ничего выдающегося. Быстро приготовили, это плюс. Цены средние по рынку. Для перекуса на бегу сойдет, но за изысками не сюда.'
  },
  {
    rating: 4,
    content: 'Хорошее соотношение цена-качество. Завтраки отличные, порции большие. Кофе ароматный, круассаны свежие. По выходным много народу, лучше бронировать столик. В целом рекомендую!'
  }
];

/**
 * Partner responses to reviews
 */
export const partnerResponses = [
  'Спасибо за теплые слова! Рады, что вам понравилось. Ждем вас снова!',
  'Благодарим за отзыв! Мы учли ваши замечания и уже работаем над улучшением сервиса.',
  'Примите наши извинения за неудобства. Это недопустимо. Хотели бы пригласить вас снова и исправить впечатление.',
  'Рады, что вы оценили нашу кухню! Наш шеф-повар будет рад услышать ваши комплименты.',
  'Спасибо за честный отзыв. Мы обязательно рассмотрим все ваши пожелания.'
];

/**
 * Invalid review data for validation testing
 */
export const invalidReviews = {
  // Rating too low
  ratingTooLow: {
    rating: 0,
    content: 'Valid content'
  },

  // Rating too high
  ratingTooHigh: {
    rating: 6,
    content: 'Valid content'
  },

  // Non-integer rating
  nonIntegerRating: {
    rating: 3.5,
    content: 'Valid content'
  },

  // Missing rating
  missingRating: {
    content: 'Valid content'
  },

  // Content too short (if minimum length enforced)
  tooShort: {
    rating: 5,
    content: 'Ok'
  },

  // Missing both (the rating is what is required)
  missingBoth: {}
};

/**
 * Reviews of a rating alone — valid since 22.11.2026 (thread «Отзыв без
 * текста»); until then the first two were invalidReviews.missingContent and
 * .emptyContent. The server stores each without text as NULL.
 */
export const ratingOnlyReviews = {
  // No content key — what the app sends when the field is empty
  missingContent: {
    rating: 5
  },

  // Empty content — what the site's form sends for an empty field
  emptyContent: {
    rating: 5,
    content: ''
  },

  // Nothing but spaces — trimmed to no text
  spacesOnly: {
    rating: 4,
    content: '   '
  }
};

/**
 * Edge case reviews
 */
export const edgeCaseReviews = {
  // Very long content (test length limits)
  veryLong: {
    rating: 5,
    content: 'А'.repeat(5000) // 5000 characters
  },

  // Content with special characters
  specialChars: {
    rating: 5,
    content: 'Отличный ресторан! 🍽️ 👍 ⭐⭐⭐⭐⭐ Цены: 20-30 руб. Email: test@test.com, Телефон: +375-29-123-45-67'
  },

  // Content with HTML (should be escaped)
  htmlContent: {
    rating: 5,
    content: '<script>alert("XSS")</script> Попытка XSS атаки <b>bold text</b>'
  },

  // Content with SQL injection attempt (should be safe with parameterized queries)
  sqlInjection: {
    rating: 5,
    content: "'; DROP TABLE reviews; -- SQL injection attempt"
  },

  // Minimal valid review
  minimal: {
    rating: 3,
    content: 'Нормально'
  },

  // Maximum valid rating with minimal content
  maxRating: {
    rating: 5,
    content: 'Супер!'
  },

  // Minimum valid rating
  minRating: {
    rating: 1,
    content: 'Плохо'
  }
};

/**
 * Bulk review data for quota testing
 * Generate multiple reviews to test daily limit (10 per day)
 */
export function generateBulkReviews(count) {
  const reviews = [];
  const ratings = [1, 2, 3, 4, 5];
  const contents = [
    'Отлично',
    'Хорошо',
    'Нормально',
    'Плохо',
    'Ужасно',
    'Понравилось',
    'Не понравилось',
    'Рекомендую',
    'Не рекомендую',
    'Средне'
  ];

  for (let i = 0; i < count; i++) {
    reviews.push({
      rating: ratings[i % ratings.length],
      content: `${contents[i % contents.length]} - отзыв номер ${i + 1}`
    });
  }

  return reviews;
}

export default {
  testReviews,
  partnerResponses,
  invalidReviews,
  edgeCaseReviews,
  generateBulkReviews
};
