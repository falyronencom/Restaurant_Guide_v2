/// Data models for establishment moderation workflow

/// Lightweight model for the pending list card
class EstablishmentListItem {
  final String id;
  final String name;
  final String? city;
  final List<String> categories;
  final List<String> cuisines;
  final String? phone;
  final String? email;
  final String? thumbnailUrl;
  final DateTime? updatedAt;
  final DateTime? createdAt;

  const EstablishmentListItem({
    required this.id,
    required this.name,
    this.city,
    this.categories = const [],
    this.cuisines = const [],
    this.phone,
    this.email,
    this.thumbnailUrl,
    this.updatedAt,
    this.createdAt,
  });

  factory EstablishmentListItem.fromJson(Map<String, dynamic> json) {
    final photo = json['primary_photo'];
    String? thumbnail;
    if (photo is Map<String, dynamic>) {
      thumbnail =
          photo['thumbnail_url'] as String? ?? photo['url'] as String?;
    }

    return EstablishmentListItem(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      city: json['city'] as String?,
      categories: _parseStringList(json['categories']),
      cuisines: _parseStringList(json['cuisines']),
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      thumbnailUrl: thumbnail,
      updatedAt: _parseDate(json['updated_at']),
      createdAt: _parseDate(json['created_at']),
    );
  }
}

/// Full model for the moderation detail panel
class EstablishmentDetail {
  // Core
  final String id;
  final String partnerId;
  final String name;
  final String? description;
  final String status;

  // Address tab
  final String? city;
  final String? address;
  final double? latitude;
  final double? longitude;

  // About tab
  final String? phone;
  final String? email;
  final String? website;
  final List<String> categories;
  final List<String> cuisines;
  final String? priceRange;
  final Map<String, dynamic>? workingHours;
  final Map<String, dynamic>? specialHours;
  final Map<String, dynamic>? attributes;

  // Data tab (legal / partner info)
  final String? legalName;
  final String? unp;
  final String? registrationDocUrl;
  final String? contactPerson;
  final String? contactEmail;

  // Media tab
  final List<MediaItem> interiorPhotos;
  final List<MediaItem> menuMedia;

  // Moderation metadata
  final Map<String, dynamic>? moderationNotes;

  // Timestamps
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const EstablishmentDetail({
    required this.id,
    required this.partnerId,
    required this.name,
    this.description,
    required this.status,
    this.city,
    this.address,
    this.latitude,
    this.longitude,
    this.phone,
    this.email,
    this.website,
    this.categories = const [],
    this.cuisines = const [],
    this.priceRange,
    this.workingHours,
    this.specialHours,
    this.attributes,
    this.legalName,
    this.unp,
    this.registrationDocUrl,
    this.contactPerson,
    this.contactEmail,
    this.interiorPhotos = const [],
    this.menuMedia = const [],
    this.moderationNotes,
    this.createdAt,
    this.updatedAt,
  });

  factory EstablishmentDetail.fromJson(Map<String, dynamic> json) {
    return EstablishmentDetail(
      id: json['id'] as String,
      partnerId: json['partner_id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      status: json['status'] as String? ?? 'pending',
      city: json['city'] as String?,
      address: json['address'] as String?,
      latitude: _parseDouble(json['latitude']),
      longitude: _parseDouble(json['longitude']),
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      website: json['website'] as String?,
      categories: _parseStringList(json['categories']),
      cuisines: _parseStringList(json['cuisines']),
      priceRange: json['price_range'] as String?,
      workingHours: json['working_hours'] as Map<String, dynamic>?,
      specialHours: json['special_hours'] as Map<String, dynamic>?,
      attributes: json['attributes'] as Map<String, dynamic>?,
      legalName: json['legal_name'] as String?,
      unp: json['unp'] as String?,
      registrationDocUrl: json['registration_doc_url'] as String?,
      contactPerson: json['contact_person'] as String?,
      contactEmail: json['contact_email'] as String?,
      interiorPhotos: _parseMediaList(json['interior_photos']),
      menuMedia: _parseMediaList(json['menu_media']),
      moderationNotes: json['moderation_notes'] as Map<String, dynamic>?,
      createdAt: _parseDate(json['created_at']),
      updatedAt: _parseDate(json['updated_at']),
    );
  }
}

/// Media item (photo or document)
class MediaItem {
  final String? id;
  final String url;
  final String? thumbnailUrl;
  final bool isPrimary;

  const MediaItem({
    this.id,
    required this.url,
    this.thumbnailUrl,
    this.isPrimary = false,
  });

  factory MediaItem.fromJson(Map<String, dynamic> json) {
    return MediaItem(
      id: json['id'] as String?,
      url: json['url'] as String? ?? '',
      thumbnailUrl: json['thumbnail_url'] as String?,
      isPrimary: json['is_primary'] as bool? ?? false,
    );
  }
}

// Shared helpers

List<String> _parseStringList(dynamic value) {
  if (value is List) {
    return value.map((e) => e.toString()).toList();
  }
  return [];
}

List<MediaItem> _parseMediaList(dynamic value) {
  if (value is List) {
    return value
        .map((e) =>
            e is Map<String, dynamic> ? MediaItem.fromJson(e) : null)
        .whereType<MediaItem>()
        .toList();
  }
  return [];
}

DateTime? _parseDate(dynamic value) {
  if (value is String) return DateTime.tryParse(value);
  return null;
}

double? _parseDouble(dynamic value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}
