import 'package:restaurant_guide_mobile/models/promotion.dart';
import 'package:restaurant_guide_mobile/utils/open_status.dart';

/// English→Russian mapping for cuisine values (legacy/test data compatibility)
const _cuisineToRussian = {
  'belarusian': 'Народная',
  'national': 'Народная',
  'author': 'Авторская',
  'fusion': 'Авторская',
  'asian': 'Азиатская',
  'american': 'Американская',
  'vegetarian': 'Вегетарианская',
  'japanese': 'Японская',
  'georgian': 'Грузинская',
  'italian': 'Итальянская',
  'mixed': 'Смешанная',
  'international': 'Смешанная',
  'continental': 'Европейская',
  'european': 'Европейская',
  'chinese': 'Китайская',
  'eastern': 'Восточная',
};

/// English→Russian mapping for category values (legacy/test data compatibility)
const _categoryToRussian = {
  'restaurant': 'Ресторан',
  'cafe': 'Кофейня',
  'cafe_dining': 'Кафе',
  'fast_food': 'Фаст-фуд',
  'pizzeria': 'Пиццерия',
  'bar': 'Бар',
  'pub': 'Паб',
  'bakery': 'Пекарня',
  'confectionery': 'Кондитерская',
  'karaoke': 'Караоке',
  'canteen': 'Столовая',
  'hookah_bar': 'Кальянная',
  'hookah_lounge': 'Кальянная',
  'bowling': 'Боулинг',
  'billiards': 'Бильярд',
  'nightclub': 'Клуб',
};

/// Normalize a value to Russian — if already Russian, returns as-is
String _toRussian(String value, Map<String, String> mapping) {
  return mapping[value.toLowerCase()] ?? value;
}

/// Establishment model representing a restaurant/cafe
/// Matches backend API response format
class Establishment {
  final String id;  // UUID from backend (String for new API, kept for compatibility)
  /// Адрес карточки на сайте: slug и slug города и категории из публичной
  /// проекции. Любое из них может не прийти (старые ответы, карточка вне
  /// словаря адресов) — тогда ссылку на сайт не строим.
  final String? slug;
  final String? citySlug;
  final String? categorySlug;
  final String name;
  final String? description;
  final String category;  // Primary category (first from categories array)
  final List<String>? categories;  // All categories
  final String? cuisine;  // Primary cuisine (first from cuisines array)
  final List<String>? cuisines;  // All cuisines
  final String? priceRange;
  final double? rating;
  final String address;
  final String city;
  final double? latitude;
  final double? longitude;
  final Map<String, dynamic>? workingHours;
  final String? phone;
  final String? website;
  final Map<String, dynamic>? attributes;
  final String status;
  final List<EstablishmentMedia>? media;
  final String? thumbnailUrl;
  final double? distance; // Distance from user in km (from API or calculated)
  final bool hasPromotion; // From search enrichment
  final int promotionCount; // From search enrichment
  final bool bookingEnabled; // From establishments.booking_enabled
  final List<Promotion>? promotions; // From detail endpoint
  final DateTime createdAt;
  final DateTime updatedAt;

  Establishment({
    required this.id,
    this.slug,
    this.citySlug,
    this.categorySlug,
    required this.name,
    this.description,
    required this.category,
    this.categories,
    this.cuisine,
    this.cuisines,
    this.priceRange,
    this.rating,
    required this.address,
    required this.city,
    this.latitude,
    this.longitude,
    this.workingHours,
    this.phone,
    this.website,
    this.attributes,
    required this.status,
    this.media,
    this.thumbnailUrl,
    this.distance,
    this.hasPromotion = false,
    this.promotionCount = 0,
    this.bookingEnabled = false,
    this.promotions,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Create from JSON
  factory Establishment.fromJson(Map<String, dynamic> json) {
    // Parse categories array and normalize to Russian
    final categoriesList = json['categories'] != null
        ? (json['categories'] as List)
            .map((e) => _toRussian(e.toString(), _categoryToRussian))
            .toList()
        : <String>[];

    // Parse cuisines array and normalize to Russian
    final cuisinesList = json['cuisines'] != null
        ? (json['cuisines'] as List)
            .map((e) => _toRussian(e.toString(), _cuisineToRussian))
            .toList()
        : <String>[];

    return Establishment(
      id: json['id'].toString(),  // UUID as String
      slug: json['slug'] as String?,
      citySlug: json['city_slug'] as String?,
      categorySlug: json['category_slug'] as String?,
      name: json['name'] as String,
      description: json['description'] as String?,
      category: categoriesList.isNotEmpty ? categoriesList.first : 'Ресторан',
      categories: categoriesList,
      cuisine: cuisinesList.isNotEmpty ? cuisinesList.first : null,
      cuisines: cuisinesList,
      priceRange: json['price_range'] as String?,
      rating: json['average_rating'] != null
          ? double.tryParse(json['average_rating'].toString())
          : (json['rating'] != null ? (json['rating'] as num).toDouble() : null),
      address: json['address'] as String,
      city: json['city'] as String,
      latitude: json['latitude'] != null
          ? (json['latitude'] as num).toDouble()
          : null,
      longitude: json['longitude'] != null
          ? (json['longitude'] as num).toDouble()
          : null,
      // Не объект — часов просто нет: из-за такой карточки не должен падать
      // разбор всей выдачи.
      workingHours: json['working_hours'] is Map
          ? Map<String, dynamic>.from(json['working_hours'] as Map)
          : null,
      phone: json['phone'] as String?,
      website: json['website'] as String?,
      attributes: json['attributes'] as Map<String, dynamic>?,
      status: json['status'] as String,
      media: json['media'] != null
          ? (json['media'] as List)
              .map((m) => EstablishmentMedia.fromJson(m as Map<String, dynamic>))
              .toList()
          : null,
      thumbnailUrl: json['thumbnail_url'] ?? json['primary_image_url'] as String?,
      distance: _parseDoubleSafe(json['distance']),
      hasPromotion: json['has_promotion'] == true,
      bookingEnabled: json['booking_enabled'] == true,
      promotionCount: json['promotion_count'] as int? ?? 0,
      promotions: json['promotions'] != null
          ? (json['promotions'] as List)
              .map((p) => Promotion.fromJson(p as Map<String, dynamic>))
              .toList()
          : null,
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: DateTime.parse(json['updated_at'] as String),
    );
  }

  /// Safe double parsing for API values
  static double? _parseDoubleSafe(dynamic value) {
    if (value == null) return null;
    if (value is double) return value;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'category': category,
      'cuisine': cuisine,
      'price_range': priceRange,
      'rating': rating,
      'address': address,
      'city': city,
      'latitude': latitude,
      'longitude': longitude,
      'working_hours': workingHours,
      'phone': phone,
      'website': website,
      'attributes': attributes,
      'status': status,
      'media': media?.map((m) => m.toJson()).toList(),
      'thumbnail_url': thumbnailUrl,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  // Day key constants for working hours lookup
  static const _dayKeys = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  ];

  /// Запись одного дня: `{'open', 'close', 'is_open': true}`, выходной
  /// `{'is_open': false}` или `null`, если дня нет или запись не читается.
  ///
  /// Форматы: строка «10:00-22:00» (так пишет импорт), объект
  /// `{"open": "10:00", "close": "22:00"}` с необязательным `is_open`. Время
  /// приводится к «ЧЧ:ММ». Объект рабочего дня без правильного времени остаётся
  /// рабочим днём, но с `null` вместо времени: кабинет сайта присылал
  /// `{is_open: true, open: '', close: ''}`, и партнёр должен видеть такой день
  /// незаполненным, а не выходным. Падать не на чем: на входе бывает что угодно.
  static Map<String, dynamic>? parseDayHours(dynamic dayHours) {
    if (dayHours is String) {
      final parts = dayHours.split('-');
      if (parts.length != 2) return null;
      final open = clockMinutes(parts[0]);
      final close = clockMinutes(parts[1]);
      if (open == null || close == null) return null;
      return {
        'open': clockLabel(open),
        'close': clockLabel(close),
        'is_open': true,
      };
    }
    if (dayHours is Map) {
      if (dayHours['is_open'] == false) return {'is_open': false};
      final open = clockMinutes(dayHours['open']);
      final close = clockMinutes(dayHours['close']);
      return {
        'open': open == null ? null : clockLabel(open),
        'close': close == null ? null : clockLabel(close),
        'is_open': true,
      };
    }
    return null;
  }

  /// Открыто, закрыто или неизвестно в КОНКРЕТНЫЙ момент — чистая функция от
  /// [moment], поэтому «через полночь» и смена суток проверяются тестом, а не
  /// подгонкой под часы машины. Момент один на весь расчёт.
  ///
  /// Снятое с показа заведение (приостановлено, на модерации, черновик,
  /// отклонено, в архиве) — «Закрыто» при любых часах: избранное продолжает его
  /// показывать (Координатор, 08.11.2026, «Да на 1–4»). По тому же ответу
  /// [isOpenAt] его нет в «Прогулке» с «Открыто сейчас».
  ///
  /// Смена дня D идёт от его открытия до закрытия; закрытие в момент открытия
  /// или раньше — уже следующие сутки (18:00–02:00, а 12:00–12:00 и
  /// 00:00–00:00 — ровно сутки от часа открытия). Поэтому сначала смотрим хвост
  /// вчерашней смены, потом сегодняшнюю: ночь пятницы принадлежит четвергу.
  /// Если вчера нет данных, решает сегодняшняя запись: у места с часами на
  /// сегодня писать ночью «Часы не указаны» было бы странно.
  OpenStatus openStatusAt(DateTime moment) {
    if (status != 'active') return const OpenStatus.closed();

    final now = moment.hour * 60 + moment.minute;
    final today = moment.weekday - 1;

    final yesterday =
        parseDayHours(workingHours?[_dayKeys[(today + 6) % 7]]);
    final yesterdayOpens = clockMinutes(yesterday?['open']);
    final yesterdayCloses = clockMinutes(yesterday?['close']);
    if (yesterdayOpens != null &&
        yesterdayCloses != null &&
        yesterdayCloses <= yesterdayOpens &&
        now < yesterdayCloses) {
      return OpenStatus.open(clockLabel(yesterdayCloses));
    }

    final hours = parseDayHours(workingHours?[_dayKeys[today]]);
    if (hours?['is_open'] == false) return const OpenStatus.closed();
    final opens = clockMinutes(hours?['open']);
    final closes = clockMinutes(hours?['close']);
    if (opens == null || closes == null) return const OpenStatus.unknown();

    final inShift = closes <= opens ? now >= opens : now >= opens && now < closes;
    return inShift
        ? OpenStatus.open(clockLabel(closes))
        : const OpenStatus.closed();
  }

  /// Статус на эту минуту.
  OpenStatus get currentOpenStatus => openStatusAt(DateTime.now());

  /// Открыто ли заведение точно: неизвестные часы — не «открыто». По этому
  /// признаку красится метка на карте и работает отбор «Открыто сейчас».
  bool isOpenAt(DateTime moment) => openStatusAt(moment).isOpen;

  /// Check if establishment is currently open based on working hours
  bool get isCurrentlyOpen => isOpenAt(DateTime.now());

  /// Copy with modifications
  Establishment copyWith({
    String? id,
    String? slug,
    String? citySlug,
    String? categorySlug,
    String? name,
    String? description,
    String? category,
    List<String>? categories,
    String? cuisine,
    List<String>? cuisines,
    String? priceRange,
    double? rating,
    String? address,
    String? city,
    double? latitude,
    double? longitude,
    Map<String, dynamic>? workingHours,
    String? phone,
    String? website,
    Map<String, dynamic>? attributes,
    String? status,
    List<EstablishmentMedia>? media,
    String? thumbnailUrl,
    double? distance,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Establishment(
      id: id ?? this.id,
      slug: slug ?? this.slug,
      citySlug: citySlug ?? this.citySlug,
      categorySlug: categorySlug ?? this.categorySlug,
      name: name ?? this.name,
      description: description ?? this.description,
      category: category ?? this.category,
      categories: categories ?? this.categories,
      cuisine: cuisine ?? this.cuisine,
      cuisines: cuisines ?? this.cuisines,
      priceRange: priceRange ?? this.priceRange,
      rating: rating ?? this.rating,
      address: address ?? this.address,
      city: city ?? this.city,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      workingHours: workingHours ?? this.workingHours,
      phone: phone ?? this.phone,
      website: website ?? this.website,
      attributes: attributes ?? this.attributes,
      status: status ?? this.status,
      media: media ?? this.media,
      thumbnailUrl: thumbnailUrl ?? this.thumbnailUrl,
      distance: distance ?? this.distance,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

/// Media associated with an establishment
class EstablishmentMedia {
  final String id;  // UUID from backend
  final String establishmentId;
  final String type;
  final String fileType; // 'image' | 'pdf' — defaults to 'image' for legacy rows
  final String? thumbnailUrl;
  final String? previewUrl;
  final String? url;
  final String? caption;
  final int position;
  // Обложка карточки (её же показывает превью в выдаче). Ответ без флага —
  // не обложка: старые строки так и приходят.
  final bool isPrimary;
  final DateTime createdAt;

  EstablishmentMedia({
    required this.id,
    required this.establishmentId,
    required this.type,
    this.fileType = 'image',
    this.thumbnailUrl,
    this.previewUrl,
    this.url,
    this.caption,
    required this.position,
    this.isPrimary = false,
    required this.createdAt,
  });

  bool get isPdf => fileType == 'pdf';

  factory EstablishmentMedia.fromJson(Map<String, dynamic> json) {
    return EstablishmentMedia(
      id: json['id'].toString(),  // UUID as String
      establishmentId: json['establishment_id'].toString(),
      type: json['type'] as String,
      fileType: json['file_type'] as String? ?? 'image',
      thumbnailUrl: json['thumbnail_url'] as String?,
      previewUrl: json['preview_url'] as String?,
      url: json['url'] as String?,
      caption: json['caption'] as String?,
      position: json['position'] as int,
      isPrimary: json['is_primary'] == true,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'establishment_id': establishmentId,
      'type': type,
      'file_type': fileType,
      'thumbnail_url': thumbnailUrl,
      'preview_url': previewUrl,
      'url': url,
      'caption': caption,
      'position': position,
      'is_primary': isPrimary,
      'created_at': createdAt.toIso8601String(),
    };
  }
}

/// Paginated response for establishment lists
class PaginatedEstablishments {
  final List<Establishment> data;
  final PaginationMeta meta;

  PaginatedEstablishments({
    required this.data,
    required this.meta,
  });

  factory PaginatedEstablishments.fromJson(Map<String, dynamic> json) {
    return PaginatedEstablishments(
      data: (json['data'] as List)
          .map((e) => Establishment.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: PaginationMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );
  }
}

/// Pagination metadata
class PaginationMeta {
  final int total;
  final int page;
  final int perPage;
  final int totalPages;

  PaginationMeta({
    required this.total,
    required this.page,
    required this.perPage,
    required this.totalPages,
  });

  factory PaginationMeta.fromJson(Map<String, dynamic> json) {
    return PaginationMeta(
      total: json['total'] as int,
      page: json['page'] as int,
      perPage: json['per_page'] as int,
      totalPages: json['total_pages'] as int,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'total': total,
      'page': page,
      'per_page': perPage,
      'total_pages': totalPages,
    };
  }
}
