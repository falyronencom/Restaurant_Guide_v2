/// Promotion model matching backend API response
/// Table: promotions (Component 4, Segment A)
class Promotion {
  final String id;
  final String establishmentId;
  final String title;
  final String? description;
  final String? termsAndConditions;
  final String? imageUrl;
  final String? thumbnailUrl;
  final String? previewUrl;
  final DateTime? validFrom;
  final DateTime? validUntil;
  final String status; // 'active', 'expired', 'hidden_by_admin'
  final int position;
  final DateTime createdAt;
  final DateTime? updatedAt;

  Promotion({
    required this.id,
    required this.establishmentId,
    required this.title,
    this.description,
    this.termsAndConditions,
    this.imageUrl,
    this.thumbnailUrl,
    this.previewUrl,
    this.validFrom,
    this.validUntil,
    required this.status,
    this.position = 0,
    required this.createdAt,
    this.updatedAt,
  });

  factory Promotion.fromJson(Map<String, dynamic> json) {
    return Promotion(
      id: json['id'] as String,
      establishmentId: json['establishment_id'] as String,
      title: json['title'] as String,
      description: json['description'] as String?,
      termsAndConditions: json['terms_and_conditions'] as String?,
      imageUrl: json['image_url'] as String?,
      thumbnailUrl: json['thumbnail_url'] as String?,
      previewUrl: json['preview_url'] as String?,
      validFrom: json['valid_from'] != null
          ? DateTime.tryParse(json['valid_from'].toString())
          : null,
      validUntil: json['valid_until'] != null
          ? DateTime.tryParse(json['valid_until'].toString())
          : null,
      status: json['status'] as String? ?? 'active',
      position: json['position'] as int? ?? 0,
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: json['updated_at'] != null
          ? DateTime.tryParse(json['updated_at'].toString())
          : null,
    );
  }

  bool get isExpired =>
      validUntil != null && validUntil!.isBefore(DateTime.now());

  bool get hasImage => imageUrl != null;

  bool get isActive => status == 'active' && !isExpired;
}
