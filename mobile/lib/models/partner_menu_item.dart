/// Parsed menu item model matching backend API response.
/// Table: menu_items (Component 8, Segment A).
///
/// Phase 1: partner sees only non-hidden items (filter applied in partnerMenuItemService).
class PartnerMenuItem {
  final String id;
  final String establishmentId;
  final String mediaId;
  final String itemName;
  final double? priceByn;
  final String? categoryRaw;
  final double? confidence;
  final Map<String, dynamic>? sanityFlag;
  final int position;

  PartnerMenuItem({
    required this.id,
    required this.establishmentId,
    required this.mediaId,
    required this.itemName,
    required this.priceByn,
    required this.categoryRaw,
    required this.confidence,
    required this.sanityFlag,
    required this.position,
  });

  bool get hasSanityFlag =>
      sanityFlag != null && sanityFlag!.isNotEmpty;

  factory PartnerMenuItem.fromJson(Map<String, dynamic> json) {
    return PartnerMenuItem(
      id: json['id'] as String,
      establishmentId: json['establishment_id'] as String,
      mediaId: json['media_id'] as String,
      itemName: json['item_name'] as String,
      priceByn: _parseDouble(json['price_byn']),
      categoryRaw: json['category_raw'] as String?,
      confidence: _parseDouble(json['confidence']),
      sanityFlag: json['sanity_flag'] is Map<String, dynamic>
          ? json['sanity_flag'] as Map<String, dynamic>
          : null,
      position: (json['position'] as num?)?.toInt() ?? 0,
    );
  }

  PartnerMenuItem copyWith({
    String? itemName,
    double? priceByn,
    String? categoryRaw,
    Map<String, dynamic>? sanityFlag,
  }) {
    return PartnerMenuItem(
      id: id,
      establishmentId: establishmentId,
      mediaId: mediaId,
      itemName: itemName ?? this.itemName,
      priceByn: priceByn ?? this.priceByn,
      categoryRaw: categoryRaw ?? this.categoryRaw,
      confidence: confidence,
      sanityFlag: sanityFlag,
      position: position,
    );
  }

  static double? _parseDouble(dynamic v) {
    if (v == null) return null;
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString());
  }
}
