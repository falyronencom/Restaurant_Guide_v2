/// Снимки провода — то, что бэкенд РЕАЛЬНО кладёт в ответ.
///
/// Значения здесь литеральные и списаны с проекций бэкенда поимённо. Это
/// сделано намеренно: помощник, который вычислял бы входные данные той же
/// арифметикой, что и проверяемый код, соглашался бы с кодом по построению —
/// включая места, где код неправ (форма 2 брифа аудита). Здесь ожидание
/// приходит из спецификации провода, а не из прогона.
///
/// Источники, с которыми эти карты обязаны совпадать:
///   `backend/src/projections/establishmentProjections.js` — список и деталь
///   `backend/src/controllers/searchController.js`         — конверт поиска
///   `backend/src/services/searchService.js`               — блок pagination
///   `backend/src/services/reviewService.js`               — блок отзывов
///   `backend/src/models/notificationModel.js`             — строка ленты
///   `backend/src/controllers/notificationController.js`   — конверт ленты
///   `backend/src/services/notificationService.js`         — блок ленты
///   `backend/src/projections/menuItemProjections.js`      — позиция меню
///   `backend/src/services/publicService.js`               — конверт меню
library;

/// Строка списка заведений — полный набор ключей публичной проекции.
///
/// Разошлась проекция — этот снимок обязан разойтись вместе с ней, иначе
/// тесты будут проверять контракт, которого больше нет.
Map<String, dynamic> establishmentRow({
  String id = '11111111-1111-4111-8111-111111111111',
  String name = 'Васильки',
  String city = 'Минск',
  String address = 'пр. Независимости, 43',
  String status = 'active',
  List<String> categories = const ['Ресторан'],
  List<String> cuisines = const ['Народная'],
  Map<String, dynamic>? workingHours,
  Map<String, dynamic>? attributes,
  List<dynamic> media = const [],
  List<dynamic> promotions = const [],
}) =>
    <String, dynamic>{
      'id': id,
      'slug': 'vasilki-minsk',
      'name': name,
      'description': 'Белорусская кухня в центре',
      'city': city,
      'city_slug': 'minsk',
      'address': address,
      // Проекция прогоняет широту и долготу через parseFloat — на проводе
      // это числа, а не строки NUMERIC. Модель кастует их как `as num`, и
      // возврат строки её уронит.
      'latitude': 53.9023,
      'longitude': 27.5619,
      'phone': '+375291234567',
      'email': 'hello@vasilki.by',
      'website': 'https://vasilki.by',
      'categories': categories,
      'category_slug': 'restoran',
      'cuisines': cuisines,
      'price_range': '\$\$',
      'working_hours': workingHours,
      'special_hours': null,
      'attributes': attributes,
      'status': status,
      'primary_image_url': 'https://cdn.example/vasilki',
      'review_count': 12,
      'average_rating': 4.5,
      'favorite_count': 3,
      'view_count': 140,
      'booking_enabled': true,
      'has_promotion': false,
      'promotion_count': 0,
      'published_at': '2026-05-01T10:00:00.000Z',
      'created_at': '2026-04-01T09:00:00.000Z',
      'updated_at': '2026-06-01T09:00:00.000Z',
      'media': media,
      'promotions': promotions,
    };

/// Строка медиа заведения — `MediaModel.getEstablishmentMedia` (бэкенд),
/// проекция детали передаёт её как есть, включая `is_primary`.
Map<String, dynamic> mediaRow({
  String id = '22222222-2222-4222-8222-222222222222',
  String type = 'photo',
  String? fileType,
  int position = 0,
  bool isPrimary = false,
  String url = 'https://cdn.example/full',
  String previewUrl = 'https://cdn.example/preview',
  String thumbnailUrl = 'https://cdn.example/thumb',
}) =>
    <String, dynamic>{
      'id': id,
      'establishment_id': '11111111-1111-4111-8111-111111111111',
      'type': type,
      if (fileType != null) 'file_type': fileType,
      'thumbnail_url': thumbnailUrl,
      'preview_url': previewUrl,
      'url': url,
      'caption': null,
      'position': position,
      'is_primary': isPrimary,
      'created_at': '2026-04-01T09:00:00.000Z',
    };

/// Конверт `/api/v1/search/establishments`.
///
/// Форма — `{ success, data: { establishments, pagination } }`, а внутри
/// `pagination` ключи `page` / `limit` / `total` / `totalPages`
/// (`searchService.js`, обе ветки поиска). Именно эти четыре имени сервис
/// mobile перекладывает в `per_page` / `total_pages`, и именно они молча
/// подменяются значениями по умолчанию, если разойдутся.
Map<String, dynamic> searchEnvelope({
  List<Map<String, dynamic>>? establishments,
  int page = 1,
  int limit = 20,
  int total = 45,
  int totalPages = 3,
}) =>
    <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'establishments': establishments ?? [establishmentRow()],
        'pagination': <String, dynamic>{
          'page': page,
          'limit': limit,
          'total': total,
          'totalPages': totalPages,
        },
      },
    };

/// Конверт умного поиска — `POST /api/v1/search/smart`.
///
/// Отличается от классического наличием `intent` и `fallback`; блок
/// `pagination` тот же самый, и это существенно: экран результатов листает обе
/// выдачи одним кодом.
///
/// Источник: `backend/src/controllers/smartSearchController.js`.
Map<String, dynamic> smartSearchEnvelope({
  List<Map<String, dynamic>>? establishments,
  Map<String, dynamic>? intent,
  bool fallback = false,
  int page = 1,
  int limit = 20,
  int total = 45,
  int totalPages = 3,
  bool hasNext = true,
  bool hasPrevious = false,
  /// Добавочное поле сервера с 18.10.2026 (В3); null — поля нет, как у
  /// сервера до него.
  int? matchedTotal,
}) =>
    <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'intent': intent,
        'establishments': establishments ?? [establishmentRow()],
        'pagination': <String, dynamic>{
          'page': page,
          'limit': limit,
          'total': total,
          'totalPages': totalPages,
          'hasNext': hasNext,
          'hasPrevious': hasPrevious,
        },
        'fallback': fallback,
        if (matchedTotal != null) 'matched': matchedTotal > 0,
        if (matchedTotal != null) 'matchedTotal': matchedTotal,
      },
    };

/// Разбор фразы — то, что кладёт в ответ `parseIntent` после Zod-проверки.
///
/// Источник: `backend/src/services/smartSearchService.js` (схема intent).
Map<String, dynamic> smartIntent({
  String? dish,
  String? category,
  List<String>? cuisine,
  double? priceMax,
  String? location,
  String? sort,
  List<String> tags = const [],
}) =>
    <String, dynamic>{
      'dish': dish,
      'category': category,
      'cuisine': cuisine,
      'meal_type': null,
      'price_max': priceMax,
      'location': location,
      'sort': sort,
      'tags': tags,
      'error': null,
    };

/// Позиция распознанного меню — `toPublicMenuItem`: ровно семь ключей.
/// `price_byn` — число (`parseFloat`) или `null`; `quality_tier` — `clean`
/// или `needs_caution`; `confidence`, `sanity_flag`, `media_id`,
/// `is_hidden_by_admin` в публичный ответ не попадают.
Map<String, dynamic> menuItemRow({
  required String id,
  required String name,
  double? price,
  String? category,
  int position = 0,
  String tier = 'clean',
}) =>
    <String, dynamic>{
      'id': id,
      'establishment_id': '11111111-1111-4111-8111-111111111111',
      'item_name': name,
      'price_byn': price,
      'category_raw': category,
      'position': position,
      'quality_tier': tier,
    };

/// Конверт меню: `{ success, data: { menu_items } }` (`getPublicMenuItems`).
Map<String, dynamic> menuItemsEnvelope(List<Map<String, dynamic>> items) =>
    <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{'menu_items': items},
    };

/// Строка отзыва во вложенной форме `author` — так отдаёт публичный список.
Map<String, dynamic> reviewRow({
  String id = '33333333-3333-4333-8333-333333333333',
  String authorName = 'Ирина',
  int rating = 5,
  String? content = 'Драники как у бабушки',
  String? partnerResponse,
}) =>
    <String, dynamic>{
      'id': id,
      'establishment_id': '11111111-1111-4111-8111-111111111111',
      'author': <String, dynamic>{
        'id': '44444444-4444-4444-8444-444444444444',
        'name': authorName,
        'avatar_url': '/uploads/avatars/irina.jpg',
      },
      'rating': rating,
      'content': content,
      'created_at': '2026-06-10T18:30:00.000Z',
      'updated_at': '2026-06-10T18:30:00.000Z',
      if (partnerResponse != null) 'partner_response': partnerResponse,
      if (partnerResponse != null)
        'partner_response_at': '2026-06-11T09:00:00.000Z',
      if (partnerResponse != null)
        'partner_responder_id': '55555555-5555-4555-8555-555555555555',
    };

/// Конверт списка отзывов: `{ success, data: { reviews, pagination } }`,
/// внутри `pagination` — `page` / `limit` / `total` / `pages`.
/// Обратите внимание: здесь `pages`, а в поиске `totalPages`. Два разных
/// имени на одном бэкенде — причина, по которой обе модели читают их с
/// запасными вариантами, и причина проверять оба пути отдельно.
Map<String, dynamic> reviewsEnvelope({
  List<Map<String, dynamic>>? reviews,
  int page = 1,
  int limit = 25,
  int total = 24,
  int pages = 3,
}) =>
    <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'reviews': reviews ?? [reviewRow()],
        'pagination': <String, dynamic>{
          'page': page,
          'limit': limit,
          'total': total,
          'pages': pages,
        },
      },
    };

/// Строка избранного — НЕ карточка заведения.
///
/// `/api/v1/favorites` отдаёт плоскую запись с префиксом `establishment_`,
/// и сервис сам пересобирает её в форму карточки. Снимок повторяет именно
/// эту форму: подставь сюда обычную строку заведения — и список выйдет
/// пустым, а тест зелёным, потому что разбор молча не найдёт своих ключей.
Map<String, dynamic> favoriteRow({
  String id = '11111111-1111-4111-8111-111111111111',
  String name = 'Васильки',
}) =>
    <String, dynamic>{
      'establishment_id': id,
      'establishment_name': name,
      'establishment_description': 'Белорусская кухня в центре',
      'establishment_city': 'Минск',
      'establishment_address': 'пр. Независимости, 43',
      'establishment_latitude': 53.9023,
      'establishment_longitude': 27.5619,
      'establishment_categories': <String>['Ресторан'],
      'establishment_cuisines': <String>['Народная'],
      'establishment_price_range': r'$$',
      'establishment_average_rating': 4.5,
      'establishment_status': 'active',
      'establishment_working_hours': null,
      'establishment_primary_image': 'https://cdn.example/vasilki',
      'created_at': '2026-04-01T09:00:00.000Z',
    };

/// Конверт `/api/v1/favorites`: `{ data: { favorites, pagination } }`.
///
/// Блок `pagination` повторяет `favoriteService.getUserFavorites` буквально:
/// `page`, `limit`, `total`, `pages`, `hasNext`, `hasPrevious`. Клиент
/// листает страницы по `hasNext` — переименуй поле здесь, и тест на
/// «все страницы» покажет одну.
Map<String, dynamic> favoritesEnvelope({
  List<Map<String, dynamic>>? favorites,
  int page = 1,
  int limit = 50,
  int? total,
  bool hasNext = false,
}) {
  final rows = favorites ?? [favoriteRow()];
  final count = total ?? rows.length;
  return <String, dynamic>{
    'success': true,
    'data': <String, dynamic>{
      'favorites': rows,
      'pagination': <String, dynamic>{
        'page': page,
        'limit': limit,
        'total': count,
        'pages': (count / limit).ceil(),
        'hasNext': hasNext,
        'hasPrevious': page > 1,
      },
    },
  };
}

/// Строка ленты уведомлений — ровно столбцы выборки
/// `NotificationModel.getByUserId`: `id`, `type`, `title`, `message`,
/// `establishment_id`, `review_id`, `is_read`, `created_at`. `user_id` в
/// выборку ленты не входит.
Map<String, dynamic> notificationRow({
  String id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  String type = 'booking_received',
  String title = 'Новая бронь',
  String? message = 'Новая бронь на «Васильки» — 2 гост., 7 октября 19:00',
  bool isRead = false,
  String createdAt = '2026-10-07T16:00:00.000Z',
}) =>
    <String, dynamic>{
      'id': id,
      'type': type,
      'title': title,
      'message': message,
      'establishment_id': '11111111-1111-4111-8111-111111111111',
      'review_id': null,
      'is_read': isRead,
      'created_at': createdAt,
    };

/// Конверт `GET /api/v1/notifications`: `{ success, data: { items,
/// pagination } }` — контроллер кладёт ответ
/// `notificationService.getUserNotifications` под `data` как есть.
///
/// Внутри `pagination` — `page` / `limit` / `total` / `pages` и `totalPages`
/// с тем же числом, что `pages`. Второе имя сервер шлёт с 16.10.2026:
/// приложение с марта 2026 читает число страниц ленты как `totalPages`, а
/// сервер называл его только `pages`. `withTotalPages: false` — ответ сервера
/// до правки; его встречает любая сборка, пока правка не выкачена.
Map<String, dynamic> notificationsEnvelope({
  required List<Map<String, dynamic>> items,
  int page = 1,
  int limit = 20,
  required int total,
  required int pages,
  bool withTotalPages = true,
}) =>
    <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'items': items,
        'pagination': <String, dynamic>{
          'page': page,
          'limit': limit,
          'total': total,
          'pages': pages,
          if (withTotalPages) 'totalPages': pages,
        },
      },
    };

/// Копия карты без указанного ключа — «поле пропало из проекции».
Map<String, dynamic> without(Map<String, dynamic> row, String key) {
  final copy = Map<String, dynamic>.from(row);
  copy.remove(key);
  return copy;
}

/// Копия карты, где ключ переименован — «поле переехало в проекции».
/// Отличается от [without] тем, что значение остаётся в ответе: это ловит
/// код, который смотрит на наличие данных вообще, а не на конкретное имя.
Map<String, dynamic> renamed(
  Map<String, dynamic> row,
  String from,
  String to,
) {
  final copy = Map<String, dynamic>.from(row);
  copy[to] = copy.remove(from);
  return copy;
}
