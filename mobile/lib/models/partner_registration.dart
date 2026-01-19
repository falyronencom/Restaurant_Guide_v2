/// Partner Registration data model
/// Contains all data collected during the 6-step registration wizard
/// Phase 5.1 - Partner Registration Flow
library partner_registration;

/// Working hours for a single period (weekdays or weekends)
class WorkingHoursPeriod {
  final String open;
  final String close;

  const WorkingHoursPeriod({
    required this.open,
    required this.close,
  });

  Map<String, dynamic> toJson() => {
        'open': open,
        'close': close,
      };

  factory WorkingHoursPeriod.fromJson(Map<String, dynamic> json) {
    return WorkingHoursPeriod(
      open: json['open'] as String,
      close: json['close'] as String,
    );
  }

  WorkingHoursPeriod copyWith({
    String? open,
    String? close,
  }) {
    return WorkingHoursPeriod(
      open: open ?? this.open,
      close: close ?? this.close,
    );
  }
}

/// Working hours container for weekdays and weekends
class WorkingHours {
  final WorkingHoursPeriod? weekdays;
  final WorkingHoursPeriod? weekends;

  const WorkingHours({
    this.weekdays,
    this.weekends,
  });

  Map<String, dynamic> toJson() => {
        if (weekdays != null) 'weekdays': weekdays!.toJson(),
        if (weekends != null) 'weekends': weekends!.toJson(),
      };

  factory WorkingHours.fromJson(Map<String, dynamic> json) {
    return WorkingHours(
      weekdays: json['weekdays'] != null
          ? WorkingHoursPeriod.fromJson(json['weekdays'])
          : null,
      weekends: json['weekends'] != null
          ? WorkingHoursPeriod.fromJson(json['weekends'])
          : null,
    );
  }

  WorkingHours copyWith({
    WorkingHoursPeriod? weekdays,
    WorkingHoursPeriod? weekends,
  }) {
    return WorkingHours(
      weekdays: weekdays ?? this.weekdays,
      weekends: weekends ?? this.weekends,
    );
  }
}

/// Address information for establishment
class EstablishmentAddress {
  final String city;
  final String street;
  final String building;

  const EstablishmentAddress({
    required this.city,
    required this.street,
    required this.building,
  });

  Map<String, dynamic> toJson() => {
        'city': city,
        'street': street,
        'building': building,
      };

  factory EstablishmentAddress.fromJson(Map<String, dynamic> json) {
    return EstablishmentAddress(
      city: json['city'] as String,
      street: json['street'] as String,
      building: json['building'] as String,
    );
  }
}

/// Partner Registration data model
/// Collects data across 6 wizard steps
class PartnerRegistration {
  // Step 1: Categories (max 2)
  final List<String> categories;

  // Step 2: Cuisine types (max 3)
  final List<String> cuisineTypes;

  // Step 3: Basic Information
  final String? name;
  final String? description;
  final String? phone;
  final String? email;
  final String? instagram;
  final WorkingHours? workingHours;
  final String? priceRange;
  final List<String> attributes;

  // Step 4: Media
  final List<String> interiorPhotos;
  final List<String> menuPhotos;
  final String? primaryPhotoUrl;

  // Step 5: Address
  final String? city;
  final String? street;
  final String? building;
  final double? latitude;
  final double? longitude;

  // Step 6: Legal Information
  final String? legalName;
  final String? unp;
  final String? contactPerson;
  final String? contactEmail;
  final String? registrationDocumentUrl;

  const PartnerRegistration({
    this.categories = const [],
    this.cuisineTypes = const [],
    this.name,
    this.description,
    this.phone,
    this.email,
    this.instagram,
    this.workingHours,
    this.priceRange,
    this.attributes = const [],
    this.interiorPhotos = const [],
    this.menuPhotos = const [],
    this.primaryPhotoUrl,
    this.city,
    this.street,
    this.building,
    this.latitude,
    this.longitude,
    this.legalName,
    this.unp,
    this.contactPerson,
    this.contactEmail,
    this.registrationDocumentUrl,
  });

  /// Convert to JSON for API submission
  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'description': description,
      'category': categories,
      'cuisine_type': cuisineTypes,
      'phone': phone,
      if (email != null) 'email': email,
      if (instagram != null) 'instagram': instagram,
      if (workingHours != null) 'working_hours': workingHours!.toJson(),
      if (priceRange != null) 'price_range': priceRange,
      'attributes': attributes,
      'address': {
        'city': city,
        'street': street,
        'building': building,
      },
      if (latitude != null) 'latitude': latitude,
      if (longitude != null) 'longitude': longitude,
      'legal_name': legalName,
      'unp': unp,
      'contact_person': contactPerson,
      'contact_email': contactEmail,
      'photos': [...interiorPhotos, ...menuPhotos],
      if (primaryPhotoUrl != null) 'primary_photo': primaryPhotoUrl,
    };
  }

  /// Create a copy with updated fields
  PartnerRegistration copyWith({
    List<String>? categories,
    List<String>? cuisineTypes,
    String? name,
    String? description,
    String? phone,
    String? email,
    String? instagram,
    WorkingHours? workingHours,
    String? priceRange,
    List<String>? attributes,
    List<String>? interiorPhotos,
    List<String>? menuPhotos,
    String? primaryPhotoUrl,
    String? city,
    String? street,
    String? building,
    double? latitude,
    double? longitude,
    String? legalName,
    String? unp,
    String? contactPerson,
    String? contactEmail,
    String? registrationDocumentUrl,
  }) {
    return PartnerRegistration(
      categories: categories ?? this.categories,
      cuisineTypes: cuisineTypes ?? this.cuisineTypes,
      name: name ?? this.name,
      description: description ?? this.description,
      phone: phone ?? this.phone,
      email: email ?? this.email,
      instagram: instagram ?? this.instagram,
      workingHours: workingHours ?? this.workingHours,
      priceRange: priceRange ?? this.priceRange,
      attributes: attributes ?? this.attributes,
      interiorPhotos: interiorPhotos ?? this.interiorPhotos,
      menuPhotos: menuPhotos ?? this.menuPhotos,
      primaryPhotoUrl: primaryPhotoUrl ?? this.primaryPhotoUrl,
      city: city ?? this.city,
      street: street ?? this.street,
      building: building ?? this.building,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      legalName: legalName ?? this.legalName,
      unp: unp ?? this.unp,
      contactPerson: contactPerson ?? this.contactPerson,
      contactEmail: contactEmail ?? this.contactEmail,
      registrationDocumentUrl:
          registrationDocumentUrl ?? this.registrationDocumentUrl,
    );
  }
}

/// Category options for Step 1
/// Based on Figma design
class CategoryOptions {
  static const List<CategoryItem> items = [
    CategoryItem(id: 'restaurant', name: 'Ресторан', icon: 'restaurant'),
    CategoryItem(id: 'coffee', name: 'Кафейня', icon: 'coffee'),
    CategoryItem(id: 'fastfood', name: 'Фаст-фуд', icon: 'fastfood'),
    CategoryItem(id: 'bar', name: 'Бар', icon: 'bar'),
    CategoryItem(id: 'confectionery', name: 'Кондитерская', icon: 'cake'),
    CategoryItem(id: 'pizzeria', name: 'Пиццерия', icon: 'pizza'),
    CategoryItem(id: 'bakery', name: 'Пекарня', icon: 'bakery'),
    CategoryItem(id: 'pub', name: 'Паб', icon: 'pub'),
    CategoryItem(id: 'canteen', name: 'Столовая', icon: 'canteen'),
    CategoryItem(id: 'hookah', name: 'Кальянная', icon: 'hookah'),
    CategoryItem(id: 'bowling', name: 'Боулинг', icon: 'bowling'),
    CategoryItem(id: 'karaoke', name: 'Караоке', icon: 'karaoke'),
    CategoryItem(id: 'billiards', name: 'Бильярд', icon: 'billiards'),
  ];

  static const int maxSelection = 2;
}

/// Category item model
class CategoryItem {
  final String id;
  final String name;
  final String icon;

  const CategoryItem({
    required this.id,
    required this.name,
    required this.icon,
  });
}

/// Cuisine type options for Step 2
/// Based on Figma design
class CuisineOptions {
  static const List<CuisineItem> items = [
    CuisineItem(id: 'national', name: 'Народная', icon: 'national'),
    CuisineItem(id: 'author', name: 'Авторская', icon: 'author'),
    CuisineItem(id: 'asian', name: 'Азиатская', icon: 'asian'),
    CuisineItem(id: 'american', name: 'Американская', icon: 'american'),
    CuisineItem(id: 'italian', name: 'Итальянская', icon: 'italian'),
    CuisineItem(id: 'japanese', name: 'Японская', icon: 'japanese'),
    CuisineItem(id: 'georgian', name: 'Грузинская', icon: 'georgian'),
    CuisineItem(id: 'vegetarian', name: 'Вегетарианская', icon: 'vegetarian'),
    CuisineItem(id: 'mixed', name: 'Смешанная', icon: 'mixed'),
    CuisineItem(id: 'continental', name: 'Континентальная', icon: 'continental'),
  ];

  static const int maxSelection = 3;
}

/// Cuisine item model
class CuisineItem {
  final String id;
  final String name;
  final String icon;

  const CuisineItem({
    required this.id,
    required this.name,
    required this.icon,
  });
}

/// Establishment attributes for Step 3
class AttributeOptions {
  static const List<AttributeItem> items = [
    AttributeItem(id: 'delivery', name: 'Доставка еды'),
    AttributeItem(id: 'wifi', name: 'Wi-Fi'),
    AttributeItem(id: 'banquets', name: 'Банкеты'),
    AttributeItem(id: 'terrace', name: 'Летняя терраса'),
    AttributeItem(id: 'smoking', name: 'Залы для курящих'),
    AttributeItem(id: 'kids', name: 'Детская зона'),
    AttributeItem(id: 'pets', name: 'С животными'),
    AttributeItem(id: 'parking', name: 'Парковка'),
  ];
}

/// Attribute item model
class AttributeItem {
  final String id;
  final String name;

  const AttributeItem({
    required this.id,
    required this.name,
  });
}

/// Belarus cities for Step 5
class CityOptions {
  static const List<String> cities = [
    'Минск',
    'Гомель',
    'Могилёв',
    'Витебск',
    'Гродно',
    'Брест',
    'Бобруйск',
  ];
}
