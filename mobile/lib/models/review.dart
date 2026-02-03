/// Review model representing a user review for an establishment
/// Matches backend API response format
class Review {
  final String id;  // UUID from backend
  final String establishmentId;
  final String userId;  // UUID from backend
  final String userName;
  final String? userAvatar;
  final int rating;
  final String? text;
  final DateTime createdAt;
  final DateTime updatedAt;
  // Partner response fields
  final String? partnerResponse;
  final DateTime? partnerResponseAt;
  final String? partnerResponderId;

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
    this.partnerResponse,
    this.partnerResponseAt,
    this.partnerResponderId,
  });

  /// Create from JSON
  factory Review.fromJson(Map<String, dynamic> json) {
    // Handle author info - backend returns nested 'author' object OR flat fields
    String userName = 'Аноним';
    String? userAvatar;
    String? userId;

    if (json['author'] is Map<String, dynamic>) {
      // Nested author object format: { author: { id, name, avatar_url } }
      final author = json['author'] as Map<String, dynamic>;
      userName = author['name'] as String? ?? 'Аноним';
      userAvatar = author['avatar_url'] as String?;
      userId = author['id']?.toString();
    } else {
      // Flat format: { author_name, author_avatar, user_id }
      userName = json['author_name'] as String? ?? json['user_name'] as String? ?? 'Аноним';
      userAvatar = json['author_avatar'] as String? ?? json['user_avatar'] as String?;
    }

    return Review(
      id: json['id'].toString(),
      establishmentId: json['establishment_id'].toString(),
      userId: userId ?? json['user_id']?.toString() ?? '',
      userName: userName,
      userAvatar: userAvatar,
      rating: json['rating'] as int,
      // Backend returns 'content', but also support 'text' for backwards compatibility
      text: json['content'] as String? ?? json['text'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: DateTime.parse(json['updated_at'] as String),
      // Partner response fields
      partnerResponse: json['partner_response'] as String?,
      partnerResponseAt: json['partner_response_at'] != null
          ? DateTime.parse(json['partner_response_at'] as String)
          : null,
      partnerResponderId: json['partner_responder_id']?.toString(),
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
      'content': text,  // Backend expects 'content'
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
      if (partnerResponse != null) 'partner_response': partnerResponse,
      if (partnerResponseAt != null) 'partner_response_at': partnerResponseAt!.toIso8601String(),
      if (partnerResponderId != null) 'partner_responder_id': partnerResponderId,
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
    // Backend wraps response in { success: true, data: { reviews, pagination } }
    // Unwrap 'data' if present
    final innerData = json['data'] is Map<String, dynamic>
        ? json['data'] as Map<String, dynamic>
        : json;

    // Backend returns 'reviews' array
    final reviewsList = innerData['reviews'] ?? [];

    // Backend returns 'pagination' object, support 'meta' for backwards compatibility
    final paginationData = innerData['pagination'] ?? innerData['meta'];

    return PaginatedReviews(
      data: (reviewsList as List)
          .map((e) => Review.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: paginationData != null
          ? ReviewsPaginationMeta.fromJson(paginationData as Map<String, dynamic>)
          : ReviewsPaginationMeta(total: 0, page: 1, perPage: 10, totalPages: 0),
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
      total: json['total'] as int? ?? 0,
      page: json['page'] as int? ?? 1,
      // Backend returns 'limit', support 'per_page' for backwards compatibility
      perPage: json['limit'] as int? ?? json['per_page'] as int? ?? 10,
      // Backend returns 'pages', support 'total_pages' for backwards compatibility
      totalPages: json['pages'] as int? ?? json['total_pages'] as int? ?? 0,
      averageRating: json['average_rating'] != null
          ? (json['average_rating'] as num).toDouble()
          : null,
      reviewCount: json['review_count'] as int?,
    );
  }
}

/// User review with establishment information
/// Used in profile screen to show user's reviews with establishment context
class UserReview {
  final String id;  // UUID from backend
  final String establishmentId;
  final String establishmentName;
  final String? establishmentImage;
  final String? establishmentType;
  final String? establishmentCuisine;
  final int rating;
  final String? text;
  final DateTime createdAt;

  UserReview({
    required this.id,
    required this.establishmentId,
    required this.establishmentName,
    this.establishmentImage,
    this.establishmentType,
    this.establishmentCuisine,
    required this.rating,
    this.text,
    required this.createdAt,
  });

  factory UserReview.fromJson(Map<String, dynamic> json) {
    return UserReview(
      id: json['id'].toString(),
      establishmentId: json['establishment_id'].toString(),
      establishmentName: json['establishment_name'] as String? ?? 'Заведение',
      establishmentImage: json['establishment_image'] as String?,
      establishmentType: json['establishment_type'] as String?,
      establishmentCuisine: json['establishment_cuisine'] as String?,
      rating: json['rating'] as int,
      // Backend returns 'content', support 'text' for backwards compatibility
      text: json['content'] as String? ?? json['text'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }
}

/// Response for user's reviews list
class UserReviewsResponse {
  final List<UserReview> reviews;
  final int total;
  final int page;
  final int totalPages;

  UserReviewsResponse({
    required this.reviews,
    required this.total,
    required this.page,
    required this.totalPages,
  });

  factory UserReviewsResponse.fromJson(Map<String, dynamic> json) {
    final reviewsData = json['data'] ?? json['reviews'] ?? [];
    return UserReviewsResponse(
      reviews: (reviewsData as List)
          .map((e) => UserReview.fromJson(e as Map<String, dynamic>))
          .toList(),
      total: json['total'] as int? ?? 0,
      page: json['page'] as int? ?? 1,
      totalPages: json['total_pages'] as int? ?? 0,
    );
  }
}
