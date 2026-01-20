/// Partner Establishment data model
/// Contains establishment data with partner-specific fields (status, stats)
/// Phase 5.2 - Partner Dashboard
library partner_establishment;

import 'package:restaurant_guide_mobile/models/partner_registration.dart';

/// Establishment moderation status
enum EstablishmentStatus {
  pending,   // На модерации
  approved,  // Одобрено
  rejected,  // Отклонено
  suspended, // Приостановлено
}

/// Extension for status display
extension EstablishmentStatusExtension on EstablishmentStatus {
  /// Get Russian label for status
  String get label {
    switch (this) {
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
      views: json['views'] as int? ?? 0,
      viewsTrend: json['views_trend'] as int?,
      shares: json['shares'] as int? ?? 0,
      sharesTrend: json['shares_trend'] as int?,
      favorites: json['favorites'] as int? ?? 0,
      favoritesTrend: json['favorites_trend'] as int?,
      reviews: json['reviews'] as int? ?? 0,
      averageRating: (json['average_rating'] as num?)?.toDouble(),
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

  /// Get category display name (first category)
  String get categoryDisplayName {
    if (categories.isEmpty) return '';
    return _getCategoryName(categories.first);
  }

  /// Get cuisine display name (first cuisine in braces)
  String get cuisineDisplayName {
    if (cuisineTypes.isEmpty) return '';
    return '{${_getCuisineName(cuisineTypes.first)}}';
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
    return PartnerEstablishment(
      id: json['id'].toString(),
      name: json['name'] as String,
      status: _parseStatus(json['status'] as String?),
      statusMessage: json['status_message'] as String?,
      primaryImageUrl: json['primary_image_url'] as String?,
      categories: (json['category'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList() ?? [],
      cuisineTypes: (json['cuisine_type'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList() ?? [],
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: DateTime.parse(json['updated_at'] as String),
      stats: json['stats'] != null
          ? EstablishmentStats.fromJson(json['stats'] as Map<String, dynamic>)
          : const EstablishmentStats(),
      description: json['description'] as String?,
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      instagram: json['instagram'] as String?,
      workingHours: json['weekly_working_hours'] != null
          ? WeeklyWorkingHours.fromJson(json['weekly_working_hours'] as Map<String, dynamic>)
          : null,
      attributes: (json['attributes'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList() ?? [],
      city: json['address']?['city'] as String?,
      street: json['address']?['street'] as String?,
      building: json['address']?['building'] as String?,
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      interiorPhotos: (json['interior_photos'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList() ?? [],
      menuPhotos: (json['menu_photos'] as List<dynamic>?)
          ?.map((e) => e as String)
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
      case 'pending':
        return EstablishmentStatus.pending;
      case 'approved':
        return EstablishmentStatus.approved;
      case 'rejected':
        return EstablishmentStatus.rejected;
      case 'suspended':
        return EstablishmentStatus.suspended;
      default:
        return EstablishmentStatus.pending;
    }
  }
}
