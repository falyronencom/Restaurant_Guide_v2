/// Partner Establishment data model
/// Contains establishment data with partner-specific fields (status, stats)
/// Phase 5.2 - Partner Dashboard
library partner_establishment;

import 'package:restaurant_guide_mobile/models/partner_registration.dart';

// =============================================================================
// Safe JSON parsing helpers (handle both String and num types from backend)
// =============================================================================

/// Safely parse int from dynamic value (handles String and num)
int _parseIntSafe(dynamic value) {
  if (value == null) return 0;
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? 0;
  return 0;
}

/// Safely parse nullable int from dynamic value
int? _parseIntNullable(dynamic value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

/// Parse street part from address string (everything before last comma)
String? _parseStreet(String? address) {
  if (address == null || address.isEmpty) return null;
  final lastComma = address.lastIndexOf(',');
  if (lastComma == -1) return address;
  return address.substring(0, lastComma).trim();
}

/// Parse building part from address string (everything after last comma)
String? _parseBuilding(String? address) {
  if (address == null || address.isEmpty) return null;
  final lastComma = address.lastIndexOf(',');
  if (lastComma == -1) return null;
  final building = address.substring(lastComma + 1).trim();
  return building.isNotEmpty ? building : null;
}

/// Parse attributes from backend — handles both List and Map formats
/// Backend returns JSONB object {"wifi": true}, frontend uses List<String> of keys
List<String> _parseAttributes(dynamic value) {
  if (value == null) return [];
  if (value is List) {
    return value.map((e) => e.toString()).toList();
  }
  if (value is Map) {
    // Backend returns {"wifi": true, "delivery": true} — extract keys where value is truthy
    return value.entries
        .where((e) => e.value == true)
        .map((e) => e.key.toString())
        .toList();
  }
  return [];
}

/// Safely parse double from dynamic value (handles String and num)
double? _parseDoubleSafe(dynamic value) {
  if (value == null) return null;
  if (value is double) return value;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

/// Establishment moderation status
enum EstablishmentStatus {
  draft,     // Черновик (только создано)
  pending,   // На модерации
  approved,  // Одобрено (активно)
  rejected,  // Отклонено
  suspended, // Приостановлено
}

/// Extension for status display
extension EstablishmentStatusExtension on EstablishmentStatus {
  /// Get Russian label for status
  String get label {
    switch (this) {
      case EstablishmentStatus.draft:
        return 'Черновик';
      case EstablishmentStatus.pending:
        return 'На модерации';
      case EstablishmentStatus.approved:
        return 'Одобрено';
      case EstablishmentStatus.rejected:
        return 'Отклонено';
      case EstablishmentStatus.suspended:
        return 'Приостановлено';
    }
  }

  /// Check if establishment can be edited
  bool get canEdit {
    switch (this) {
      case EstablishmentStatus.draft:
      case EstablishmentStatus.pending:
      case EstablishmentStatus.approved:
      case EstablishmentStatus.rejected:
        return true;
      case EstablishmentStatus.suspended:
        return false;
    }
  }

  /// Check if establishment is visible to users
  bool get isActive {
    return this == EstablishmentStatus.approved;
  }
}

/// Statistics for partner establishment
class EstablishmentStats {
  final int views;
  final int? viewsTrend;      // Percentage change
  final int shares;
  final int? sharesTrend;
  final int favorites;
  final int? favoritesTrend;
  final int reviews;
  final double? averageRating;

  const EstablishmentStats({
    this.views = 0,
    this.viewsTrend,
    this.shares = 0,
    this.sharesTrend,
    this.favorites = 0,
    this.favoritesTrend,
    this.reviews = 0,
    this.averageRating,
  });

  factory EstablishmentStats.fromJson(Map<String, dynamic> json) {
    return EstablishmentStats(
      views: _parseIntSafe(json['views']),
      viewsTrend: _parseIntNullable(json['views_trend']),
      shares: _parseIntSafe(json['shares']),
      sharesTrend: _parseIntNullable(json['shares_trend']),
      favorites: _parseIntSafe(json['favorites']),
      favoritesTrend: _parseIntNullable(json['favorites_trend']),
      reviews: _parseIntSafe(json['reviews']),
      averageRating: _parseDoubleSafe(json['average_rating']),
    );
  }

  Map<String, dynamic> toJson() => {
    'views': views,
    if (viewsTrend != null) 'views_trend': viewsTrend,
    'shares': shares,
    if (sharesTrend != null) 'shares_trend': sharesTrend,
    'favorites': favorites,
    if (favoritesTrend != null) 'favorites_trend': favoritesTrend,
    'reviews': reviews,
    if (averageRating != null) 'average_rating': averageRating,
  };

  /// Create empty stats
  static const EstablishmentStats empty = EstablishmentStats();
}

/// Partner establishment model
/// Contains all data for a partner's establishment including status and stats
class PartnerEstablishment {
  final String id;
  final String name;
  final EstablishmentStatus status;
  final String? statusMessage;       // Rejection reason if rejected
  final String? primaryImageUrl;
  final List<String> categories;
  final List<String> cuisineTypes;
  final DateTime createdAt;
  final DateTime updatedAt;
  final EstablishmentStats stats;

  // Full details (may be loaded separately)
  final String? description;
  final String? phone;
  final String? email;
  final String? instagram;
  final WeeklyWorkingHours? workingHours;
  final List<String> attributes;
  final String? city;
  final String? street;
  final String? building;
  final double? latitude;
  final double? longitude;
  final List<String> interiorPhotos;
  final List<String> menuPhotos;
  final String? priceRange;

  // Subscription tier (from Figma: Бесплатный, Базовый, Стандарт, Премиум)
  final String subscriptionTier;

  const PartnerEstablishment({
    required this.id,
    required this.name,
    required this.status,
    this.statusMessage,
    this.primaryImageUrl,
    this.categories = const [],
    this.cuisineTypes = const [],
    required this.createdAt,
    required this.updatedAt,
    this.stats = const EstablishmentStats(),
    this.description,
    this.phone,
    this.email,
    this.instagram,
    this.workingHours,
    this.attributes = const [],
    this.city,
    this.street,
    this.building,
    this.latitude,
    this.longitude,
    this.interiorPhotos = const [],
    this.menuPhotos = const [],
    this.priceRange,
    this.subscriptionTier = 'Бесплатный',
  });

  /// Get formatted address
  String get fullAddress {
    final parts = <String>[];
    if (street != null && street!.isNotEmpty) parts.add(street!);
    if (building != null && building!.isNotEmpty) parts.add(building!);
    return parts.join(', ');
  }

  /// Get short address for card display
  String get shortAddress {
    if (street != null && building != null) {
      return '$street, $building';
    }
    return city ?? '';
  }

  /// Get category display name (all categories, comma-separated)
  String get categoryDisplayName {
    if (categories.isEmpty) return '';
    return categories.map((c) => _getCategoryName(c)).join(', ');
  }

  /// Get cuisine display name (all cuisines in braces, comma-separated)
  String get cuisineDisplayName {
    if (cuisineTypes.isEmpty) return '';
    return '{${cuisineTypes.map((c) => _getCuisineName(c)).join(', ')}}';
  }

  /// Helper to get category name from ID
  static String _getCategoryName(String id) {
    final category = CategoryOptions.items.where((c) => c.id == id).firstOrNull;
    return category?.name.toLowerCase() ?? id;
  }

  /// Helper to get cuisine name from ID
  static String _getCuisineName(String id) {
    final cuisine = CuisineOptions.items.where((c) => c.id == id).firstOrNull;
    return cuisine?.name.toLowerCase() ?? id;
  }

  /// Check if this is a premium tier (dark card background)
  bool get isPremium => subscriptionTier == 'Премиум';

  factory PartnerEstablishment.fromJson(Map<String, dynamic> json) {
    // Extract primary image URL from different possible formats
    String? primaryImage;
    if (json['primary_photo'] is Map) {
      primaryImage = json['primary_photo']['url'] as String?
          ?? json['primary_photo']['thumbnail_url'] as String?;
    } else {
      primaryImage = json['primary_image_url'] as String?;
    }

    // Build stats from flat fields or nested stats object
    EstablishmentStats stats;
    if (json['stats'] != null) {
      stats = EstablishmentStats.fromJson(json['stats'] as Map<String, dynamic>);
    } else {
      stats = EstablishmentStats(
        views: _parseIntSafe(json['view_count']),
        favorites: _parseIntSafe(json['favorite_count']),
        reviews: _parseIntSafe(json['review_count']),
        averageRating: _parseDoubleSafe(json['average_rating']),
      );
    }

    return PartnerEstablishment(
      id: json['id'].toString(),
      name: json['name'] as String? ?? '',
      status: _parseStatus(json['status'] as String?),
      statusMessage: json['status_message'] as String?,
      primaryImageUrl: primaryImage,
      // Backend uses 'categories' (array), not 'category'
      categories: (json['categories'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList() ??
          (json['category'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList() ?? [],
      // Backend uses 'cuisines' (array), not 'cuisine_type'
      cuisineTypes: (json['cuisines'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList() ??
          (json['cuisine_type'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList() ?? [],
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : DateTime.now(),
      updatedAt: json['updated_at'] != null
          ? DateTime.parse(json['updated_at'] as String)
          : DateTime.now(),
      stats: stats,
      description: json['description'] as String?,
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      instagram: json['instagram'] as String?,
      workingHours: json['weekly_working_hours'] != null
          ? WeeklyWorkingHours.fromJson(json['weekly_working_hours'] as Map<String, dynamic>)
          : json['working_hours'] != null && json['working_hours'] is Map
              ? WeeklyWorkingHours.fromJson(json['working_hours'] as Map<String, dynamic>)
              : null,
      attributes: _parseAttributes(json['attributes']),
      // Backend returns 'city' as separate field, 'address' as single string
      // Split "street, building" into separate fields by last comma
      city: json['city'] as String?,
      street: _parseStreet(json['address'] as String?),
      building: _parseBuilding(json['address'] as String?),
      latitude: _parseDoubleSafe(json['latitude']),
      longitude: _parseDoubleSafe(json['longitude']),
      interiorPhotos: (json['interior_photos'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList() ?? [],
      menuPhotos: (json['menu_photos'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList() ?? [],
      priceRange: json['price_range'] as String?,
      subscriptionTier: json['subscription_tier'] as String? ?? 'Бесплатный',
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'status': status.name,
    if (statusMessage != null) 'status_message': statusMessage,
    if (primaryImageUrl != null) 'primary_image_url': primaryImageUrl,
    'category': categories,
    'cuisine_type': cuisineTypes,
    'created_at': createdAt.toIso8601String(),
    'updated_at': updatedAt.toIso8601String(),
    'stats': stats.toJson(),
    if (description != null) 'description': description,
    if (phone != null) 'phone': phone,
    if (email != null) 'email': email,
    if (instagram != null) 'instagram': instagram,
    if (workingHours != null) 'weekly_working_hours': workingHours!.toJson(),
    'attributes': attributes,
    'address': {
      'city': city,
      'street': street,
      'building': building,
    },
    if (latitude != null) 'latitude': latitude,
    if (longitude != null) 'longitude': longitude,
    'interior_photos': interiorPhotos,
    'menu_photos': menuPhotos,
    if (priceRange != null) 'price_range': priceRange,
    'subscription_tier': subscriptionTier,
  };

  PartnerEstablishment copyWith({
    String? id,
    String? name,
    EstablishmentStatus? status,
    String? statusMessage,
    String? primaryImageUrl,
    List<String>? categories,
    List<String>? cuisineTypes,
    DateTime? createdAt,
    DateTime? updatedAt,
    EstablishmentStats? stats,
    String? description,
    String? phone,
    String? email,
    String? instagram,
    WeeklyWorkingHours? workingHours,
    List<String>? attributes,
    String? city,
    String? street,
    String? building,
    double? latitude,
    double? longitude,
    List<String>? interiorPhotos,
    List<String>? menuPhotos,
    String? priceRange,
    String? subscriptionTier,
  }) {
    return PartnerEstablishment(
      id: id ?? this.id,
      name: name ?? this.name,
      status: status ?? this.status,
      statusMessage: statusMessage ?? this.statusMessage,
      primaryImageUrl: primaryImageUrl ?? this.primaryImageUrl,
      categories: categories ?? this.categories,
      cuisineTypes: cuisineTypes ?? this.cuisineTypes,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      stats: stats ?? this.stats,
      description: description ?? this.description,
      phone: phone ?? this.phone,
      email: email ?? this.email,
      instagram: instagram ?? this.instagram,
      workingHours: workingHours ?? this.workingHours,
      attributes: attributes ?? this.attributes,
      city: city ?? this.city,
      street: street ?? this.street,
      building: building ?? this.building,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      interiorPhotos: interiorPhotos ?? this.interiorPhotos,
      menuPhotos: menuPhotos ?? this.menuPhotos,
      priceRange: priceRange ?? this.priceRange,
      subscriptionTier: subscriptionTier ?? this.subscriptionTier,
    );
  }

  /// Parse status string to enum
  static EstablishmentStatus _parseStatus(String? status) {
    switch (status) {
      case 'draft':
        return EstablishmentStatus.draft;
      case 'pending':
        return EstablishmentStatus.pending;
      case 'approved':
      case 'active':  // Backend uses 'active' for approved establishments
        return EstablishmentStatus.approved;
      case 'rejected':
        return EstablishmentStatus.rejected;
      case 'suspended':
        return EstablishmentStatus.suspended;
      default:
        return EstablishmentStatus.draft;  // New establishments start as draft
    }
  }
}
