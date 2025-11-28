/// Establishment model representing a restaurant/cafe
/// Matches backend API response format
class Establishment {
  final int id;
  final String name;
  final String? description;
  final String category;
  final String? cuisine;
  final String? priceRange;
  final double? rating;
  final String address;
  final String city;
  final double? latitude;
  final double? longitude;
  final Map<String, dynamic>? workingHours;
  final Map<String, dynamic>? attributes;
  final String status;
  final List<EstablishmentMedia>? media;
  final String? thumbnailUrl;
  final DateTime createdAt;
  final DateTime updatedAt;

  Establishment({
    required this.id,
    required this.name,
    this.description,
    required this.category,
    this.cuisine,
    this.priceRange,
    this.rating,
    required this.address,
    required this.city,
    this.latitude,
    this.longitude,
    this.workingHours,
    this.attributes,
    required this.status,
    this.media,
    this.thumbnailUrl,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Create from JSON
  factory Establishment.fromJson(Map<String, dynamic> json) {
    return Establishment(
      id: json['id'] as int,
      name: json['name'] as String,
      description: json['description'] as String?,
      category: json['category'] as String,
      cuisine: json['cuisine'] as String?,
      priceRange: json['price_range'] as String?,
      rating: json['rating'] != null
          ? (json['rating'] as num).toDouble()
          : null,
      address: json['address'] as String,
      city: json['city'] as String,
      latitude: json['latitude'] != null
          ? (json['latitude'] as num).toDouble()
          : null,
      longitude: json['longitude'] != null
          ? (json['longitude'] as num).toDouble()
          : null,
      workingHours: json['working_hours'] as Map<String, dynamic>?,
      attributes: json['attributes'] as Map<String, dynamic>?,
      status: json['status'] as String,
      media: json['media'] != null
          ? (json['media'] as List)
              .map((m) => EstablishmentMedia.fromJson(m as Map<String, dynamic>))
              .toList()
          : null,
      thumbnailUrl: json['thumbnail_url'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: DateTime.parse(json['updated_at'] as String),
    );
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
      'attributes': attributes,
      'status': status,
      'media': media?.map((m) => m.toJson()).toList(),
      'thumbnail_url': thumbnailUrl,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  /// Copy with modifications
  Establishment copyWith({
    int? id,
    String? name,
    String? description,
    String? category,
    String? cuisine,
    String? priceRange,
    double? rating,
    String? address,
    String? city,
    double? latitude,
    double? longitude,
    Map<String, dynamic>? workingHours,
    Map<String, dynamic>? attributes,
    String? status,
    List<EstablishmentMedia>? media,
    String? thumbnailUrl,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Establishment(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      category: category ?? this.category,
      cuisine: cuisine ?? this.cuisine,
      priceRange: priceRange ?? this.priceRange,
      rating: rating ?? this.rating,
      address: address ?? this.address,
      city: city ?? this.city,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      workingHours: workingHours ?? this.workingHours,
      attributes: attributes ?? this.attributes,
      status: status ?? this.status,
      media: media ?? this.media,
      thumbnailUrl: thumbnailUrl ?? this.thumbnailUrl,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

/// Media associated with an establishment
class EstablishmentMedia {
  final int id;
  final int establishmentId;
  final String type;
  final String? thumbnailUrl;
  final String? previewUrl;
  final String? url;
  final int position;
  final DateTime createdAt;

  EstablishmentMedia({
    required this.id,
    required this.establishmentId,
    required this.type,
    this.thumbnailUrl,
    this.previewUrl,
    this.url,
    required this.position,
    required this.createdAt,
  });

  factory EstablishmentMedia.fromJson(Map<String, dynamic> json) {
    return EstablishmentMedia(
      id: json['id'] as int,
      establishmentId: json['establishment_id'] as int,
      type: json['type'] as String,
      thumbnailUrl: json['thumbnail_url'] as String?,
      previewUrl: json['preview_url'] as String?,
      url: json['url'] as String?,
      position: json['position'] as int,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'establishment_id': establishmentId,
      'type': type,
      'thumbnail_url': thumbnailUrl,
      'preview_url': previewUrl,
      'url': url,
      'position': position,
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
