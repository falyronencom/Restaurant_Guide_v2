/// Data models for admin review management
library;

/// Single review in admin list view
class AdminReviewItem {
  final String id;
  final int rating;
  final String? content;
  final String? authorName;
  final String? authorEmail;
  final String? establishmentName;
  final String? establishmentCity;
  final String? establishmentId;
  final bool isDeleted;
  final bool isVisible;
  final bool isEdited;
  final bool hasPartnerResponse;
  final String? partnerResponse;
  final DateTime createdAt;

  const AdminReviewItem({
    required this.id,
    required this.rating,
    this.content,
    this.authorName,
    this.authorEmail,
    this.establishmentName,
    this.establishmentCity,
    this.establishmentId,
    this.isDeleted = false,
    this.isVisible = true,
    this.isEdited = false,
    this.hasPartnerResponse = false,
    this.partnerResponse,
    required this.createdAt,
  });

  factory AdminReviewItem.fromJson(Map<String, dynamic> json) {
    return AdminReviewItem(
      id: json['id'] as String,
      rating: json['rating'] as int? ?? 0,
      content: json['content'] as String?,
      authorName: json['author_name'] as String?,
      authorEmail: json['author_email'] as String?,
      establishmentName: json['establishment_name'] as String?,
      establishmentCity: json['establishment_city'] as String?,
      establishmentId: json['establishment_id'] as String?,
      isDeleted: json['is_deleted'] as bool? ?? false,
      isVisible: json['is_visible'] as bool? ?? true,
      isEdited: json['is_edited'] as bool? ?? false,
      hasPartnerResponse: json['has_partner_response'] as bool? ?? false,
      partnerResponse: json['partner_response'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  /// Human-readable status label
  String get statusLabel {
    if (isDeleted) return 'Удалён';
    if (!isVisible) return 'Скрыт';
    return 'Активен';
  }

  /// Copy with updated visibility (for optimistic updates)
  AdminReviewItem copyWith({bool? isVisible, bool? isDeleted}) {
    return AdminReviewItem(
      id: id,
      rating: rating,
      content: content,
      authorName: authorName,
      authorEmail: authorEmail,
      establishmentName: establishmentName,
      establishmentCity: establishmentCity,
      establishmentId: establishmentId,
      isDeleted: isDeleted ?? this.isDeleted,
      isVisible: isVisible ?? this.isVisible,
      isEdited: isEdited,
      hasPartnerResponse: hasPartnerResponse,
      partnerResponse: partnerResponse,
      createdAt: createdAt,
    );
  }
}

/// Paginated response wrapper
class AdminReviewListResponse {
  final List<AdminReviewItem> reviews;
  final int total;
  final int page;
  final int pages;

  const AdminReviewListResponse({
    required this.reviews,
    required this.total,
    required this.page,
    required this.pages,
  });
}
