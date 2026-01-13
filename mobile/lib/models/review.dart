/// Review model representing a user review for an establishment
/// Matches backend API response format
class Review {
  final int id;
  final int establishmentId;
  final int userId;
  final String userName;
  final String? userAvatar;
  final int rating;
  final String? text;
  final DateTime createdAt;
  final DateTime updatedAt;

  Review({
    required this.id,
    required this.establishmentId,
    required this.userId,
    required this.userName,
    this.userAvatar,
    required this.rating,
    this.text,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Create from JSON
  factory Review.fromJson(Map<String, dynamic> json) {
    return Review(
      id: json['id'] as int,
      establishmentId: json['establishment_id'] as int,
      userId: json['user_id'] as int,
      userName: json['user_name'] as String? ?? 'Аноним',
      userAvatar: json['user_avatar'] as String?,
      rating: json['rating'] as int,
      text: json['text'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: DateTime.parse(json['updated_at'] as String),
    );
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'establishment_id': establishmentId,
      'user_id': userId,
      'user_name': userName,
      'user_avatar': userAvatar,
      'rating': rating,
      'text': text,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }
}

/// Paginated response for review lists
class PaginatedReviews {
  final List<Review> data;
  final ReviewsPaginationMeta meta;

  PaginatedReviews({
    required this.data,
    required this.meta,
  });

  factory PaginatedReviews.fromJson(Map<String, dynamic> json) {
    return PaginatedReviews(
      data: (json['data'] as List)
          .map((e) => Review.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: ReviewsPaginationMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );
  }
}

/// Pagination metadata for reviews
class ReviewsPaginationMeta {
  final int total;
  final int page;
  final int perPage;
  final int totalPages;
  final double? averageRating;
  final int? reviewCount;

  ReviewsPaginationMeta({
    required this.total,
    required this.page,
    required this.perPage,
    required this.totalPages,
    this.averageRating,
    this.reviewCount,
  });

  factory ReviewsPaginationMeta.fromJson(Map<String, dynamic> json) {
    return ReviewsPaginationMeta(
      total: json['total'] as int,
      page: json['page'] as int,
      perPage: json['per_page'] as int,
      totalPages: json['total_pages'] as int,
      averageRating: json['average_rating'] != null
          ? (json['average_rating'] as num).toDouble()
          : null,
      reviewCount: json['review_count'] as int?,
    );
  }
}
