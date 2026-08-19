/// Счётчики очередей для бейджей рейла и панели «Требует внимания».
///
/// Приходят одним запросом GET /api/v1/admin/badges: рейл живёт в шелле и
/// нужен на каждом экране, поэтому дозапрашивать три списка ради meta.total
/// было бы три лишних обращения на каждый переход между разделами.
class AdminBadges {
  final int establishmentsPending;
  final int establishmentsSuspended;
  final int menuFlags;
  final int menuFlagsAgedOver7d;

  const AdminBadges({
    this.establishmentsPending = 0,
    this.establishmentsSuspended = 0,
    this.menuFlags = 0,
    this.menuFlagsAgedOver7d = 0,
  });

  factory AdminBadges.fromJson(Map<String, dynamic> json) {
    return AdminBadges(
      establishmentsPending: json['establishments_pending'] as int? ?? 0,
      establishmentsSuspended: json['establishments_suspended'] as int? ?? 0,
      menuFlags: json['menu_flags'] as int? ?? 0,
      menuFlagsAgedOver7d: json['menu_flags_aged_over_7d'] as int? ?? 0,
    );
  }
}
