/// Data models for the Quality Health admin panel (AI-ops Brick-1, Tier-0 immunity).
library;

/// One attribute key and how many active establishments carry it.
class AttributeKeyCount {
  final String key;
  final int count;

  const AttributeKeyCount({required this.key, required this.count});

  factory AttributeKeyCount.fromJson(Map<String, dynamic> json) {
    return AttributeKeyCount(
      key: json['key'] as String? ?? '',
      count: json['count'] as int? ?? 0,
    );
  }
}

/// Read-only quality-health snapshot over active establishments.
class QualityHealthData {
  final String scope;
  final String? generatedAt;

  // Canon / slug reachability
  final int unreachableCount;
  final int categoryOffCanonCount;
  final int cuisineOffCanonCount;

  // Menu completeness
  final int emptyMenusCount;
  final int ocrFailedCount;
  final int ocrStuckCount;

  // Geo bounds
  final int outOfBoundsCount;

  // Working hours
  final int hoursMalformedCount;
  final int hoursAllClosedCount;

  // Attribute census
  final List<AttributeKeyCount> attributeKeys;
  final int nonObjectAttributesCount;

  // Hanging OCR flags
  final int hangingFlagsCount;
  final int hangingAgedOver7d;

  // Price distribution (deferred stub)
  final String priceDistributionStatus;

  const QualityHealthData({
    required this.scope,
    required this.generatedAt,
    required this.unreachableCount,
    required this.categoryOffCanonCount,
    required this.cuisineOffCanonCount,
    required this.emptyMenusCount,
    required this.ocrFailedCount,
    required this.ocrStuckCount,
    required this.outOfBoundsCount,
    required this.hoursMalformedCount,
    required this.hoursAllClosedCount,
    required this.attributeKeys,
    required this.nonObjectAttributesCount,
    required this.hangingFlagsCount,
    required this.hangingAgedOver7d,
    required this.priceDistributionStatus,
  });

  factory QualityHealthData.fromJson(Map<String, dynamic> json) {
    final canon = json['canon_reachability'] as Map<String, dynamic>? ?? const {};
    final menu = json['menu_completeness'] as Map<String, dynamic>? ?? const {};
    final geo = json['geo_bounds'] as Map<String, dynamic>? ?? const {};
    final hours = json['working_hours'] as Map<String, dynamic>? ?? const {};
    final census = json['attribute_census'] as Map<String, dynamic>? ?? const {};
    final flags = json['hanging_flags'] as Map<String, dynamic>? ?? const {};
    final price = json['price_distribution'] as Map<String, dynamic>? ?? const {};
    final keysRaw = census['keys'] as List<dynamic>? ?? const [];

    return QualityHealthData(
      scope: json['scope'] as String? ?? 'active',
      generatedAt: json['generated_at'] as String?,
      unreachableCount: canon['unreachable_count'] as int? ?? 0,
      categoryOffCanonCount: canon['category_offcanon_count'] as int? ?? 0,
      cuisineOffCanonCount: canon['cuisine_offcanon_count'] as int? ?? 0,
      emptyMenusCount: menu['empty_menus_count'] as int? ?? 0,
      ocrFailedCount: menu['ocr_failed_count'] as int? ?? 0,
      ocrStuckCount: menu['ocr_stuck_count'] as int? ?? 0,
      outOfBoundsCount: geo['count'] as int? ?? 0,
      hoursMalformedCount: hours['malformed_count'] as int? ?? 0,
      hoursAllClosedCount: hours['all_closed_count'] as int? ?? 0,
      attributeKeys: keysRaw
          .map((e) => AttributeKeyCount.fromJson(e as Map<String, dynamic>))
          .toList(),
      nonObjectAttributesCount: census['non_object_count'] as int? ?? 0,
      hangingFlagsCount: flags['hanging_count'] as int? ?? 0,
      hangingAgedOver7d: flags['aged_over_7d'] as int? ?? 0,
      priceDistributionStatus: price['status'] as String? ?? 'deferred',
    );
  }
}
