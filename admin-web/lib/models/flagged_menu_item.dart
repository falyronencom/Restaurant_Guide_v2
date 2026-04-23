/// Flagged menu item model for admin moderation dashboard.
/// Backend: menuItemModel.getFlaggedItems (JOIN establishments).
class FlaggedMenuItem {
  final String id;
  final String establishmentId;
  final String mediaId;
  final String itemName;
  final double? priceByn;
  final String? categoryRaw;
  final double? confidence;
  final Map<String, dynamic>? sanityFlag;
  final bool isHiddenByAdmin;
  final String? hiddenReason;
  final DateTime createdAt;

  // Establishment context (from JOIN)
  final String establishmentName;
  final String? establishmentCity;
  final String? establishmentStatus;

  FlaggedMenuItem({
    required this.id,
    required this.establishmentId,
    required this.mediaId,
    required this.itemName,
    required this.priceByn,
    required this.categoryRaw,
    required this.confidence,
    required this.sanityFlag,
    required this.isHiddenByAdmin,
    required this.hiddenReason,
    required this.createdAt,
    required this.establishmentName,
    required this.establishmentCity,
    required this.establishmentStatus,
  });

  factory FlaggedMenuItem.fromJson(Map<String, dynamic> json) {
    return FlaggedMenuItem(
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
      isHiddenByAdmin: json['is_hidden_by_admin'] as bool? ?? false,
      hiddenReason: json['hidden_reason'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      establishmentName:
          json['establishment_name'] as String? ?? '—',
      establishmentCity: json['establishment_city'] as String?,
      establishmentStatus: json['establishment_status'] as String?,
    );
  }

  /// Short human-readable summary of the sanity_flag for list previews.
  String get flagSnippet {
    if (sanityFlag == null || sanityFlag!.isEmpty) return '';
    final reason = sanityFlag!['reason'];
    if (reason is String) return reason;
    return sanityFlag!.entries.take(1).map((e) => e.key).join(', ');
  }

  FlaggedMenuItem copyWithAdminUpdate(Map<String, dynamic> updated) {
    return FlaggedMenuItem(
      id: id,
      establishmentId: establishmentId,
      mediaId: mediaId,
      itemName: (updated['item_name'] as String?) ?? itemName,
      priceByn: updated.containsKey('price_byn')
          ? _parseDouble(updated['price_byn'])
          : priceByn,
      categoryRaw: updated.containsKey('category_raw')
          ? updated['category_raw'] as String?
          : categoryRaw,
      confidence: confidence,
      sanityFlag: updated.containsKey('sanity_flag')
          ? updated['sanity_flag'] as Map<String, dynamic>?
          : sanityFlag,
      isHiddenByAdmin: updated['is_hidden_by_admin'] as bool? ?? isHiddenByAdmin,
      hiddenReason: updated.containsKey('hidden_reason')
          ? updated['hidden_reason'] as String?
          : hiddenReason,
      createdAt: createdAt,
      establishmentName: establishmentName,
      establishmentCity: establishmentCity,
      establishmentStatus: establishmentStatus,
    );
  }

  static double? _parseDouble(dynamic v) {
    if (v == null) return null;
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString());
  }
}

class FlaggedMenuItemsResponse {
  final List<FlaggedMenuItem> items;
  final int total;
  final int page;
  final int pages;

  FlaggedMenuItemsResponse({
    required this.items,
    required this.total,
    required this.page,
    required this.pages,
  });
}
