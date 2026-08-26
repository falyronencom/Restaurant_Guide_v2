/// Data models for analytics API responses (Segment D)
library;

// ============================================================================
// Shared
// ============================================================================

class TimelinePoint {
  final String date;
  final int count;
  final double? averageRating;

  const TimelinePoint({
    required this.date,
    required this.count,
    this.averageRating,
  });

  factory TimelinePoint.fromJson(Map<String, dynamic> json) {
    return TimelinePoint(
      date: json['date'] as String,
      count: json['count'] as int? ?? 0,
      averageRating: json['average_rating'] != null
          ? (json['average_rating'] as num).toDouble()
          : null,
    );
  }
}

/// Окно, по которому посчитан ответ.
///
/// Приходит с бэкенда, а не считается на клиенте, по двум причинам. Первая:
/// клиенту пришлось бы угадывать, какое «сегодня» у сервера. Вторая: вкладка
/// админки живёт открытой сутками, и посчитанное однажды окно к утру означало
/// бы «30 дней по состоянию на позавчера» — тот же дефект, что чинили на
/// кадре 06, только подпись там врала о фильтре, а здесь врала бы о числах.
class AnalyticsPeriod {
  /// Начало окна, включительно.
  final DateTime start;

  /// Конец окна, ИСКЛЮЧИТЕЛЬНО — ровно та граница, что стоит в SQL.
  final DateTime endExclusive;

  const AnalyticsPeriod({required this.start, required this.endExclusive});

  static AnalyticsPeriod? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    final start = DateTime.tryParse(json['start'] as String? ?? '');
    final end = DateTime.tryParse(json['end'] as String? ?? '');
    if (start == null || end == null) return null;
    return AnalyticsPeriod(start: start, endExclusive: end);
  }

  /// Последние сутки окна — то, что показывают человеку. Граница исключающая,
  /// поэтому «по 10 августа» — это `end` минус день.
  DateTime get lastDay => endExclusive.subtract(const Duration(days: 1));
}

class DistributionItem {
  final String label;
  final int count;
  final double? percentage;

  const DistributionItem({
    required this.label,
    required this.count,
    this.percentage,
  });

  factory DistributionItem.fromJson(
    Map<String, dynamic> json, {
    String labelKey = 'role',
  }) {
    return DistributionItem(
      label: json[labelKey] as String? ?? '',
      count: json['count'] as int? ?? 0,
      percentage: json['percentage'] != null
          ? (json['percentage'] as num).toDouble()
          : null,
    );
  }
}

// ============================================================================
// Overview (Dashboard)
// ============================================================================

class OverviewData {
  final OverviewUsers users;
  final OverviewEstablishments establishments;
  final OverviewReviews reviews;
  final OverviewModeration moderation;
  final AnalyticsPeriod? period;

  const OverviewData({
    required this.users,
    required this.establishments,
    required this.reviews,
    required this.moderation,
    this.period,
  });

  factory OverviewData.fromJson(Map<String, dynamic> json) {
    return OverviewData(
      users: OverviewUsers.fromJson(json['users'] as Map<String, dynamic>),
      establishments: OverviewEstablishments.fromJson(
          json['establishments'] as Map<String, dynamic>),
      reviews:
          OverviewReviews.fromJson(json['reviews'] as Map<String, dynamic>),
      moderation: OverviewModeration.fromJson(
          json['moderation'] as Map<String, dynamic>),
      period: AnalyticsPeriod.fromJson(
          json['period'] as Map<String, dynamic>?),
    );
  }
}

class OverviewUsers {
  final int total;
  final int newInPeriod;
  final double? changePercent;

  const OverviewUsers({
    required this.total,
    required this.newInPeriod,
    this.changePercent,
  });

  factory OverviewUsers.fromJson(Map<String, dynamic> json) {
    return OverviewUsers(
      total: json['total'] as int? ?? 0,
      newInPeriod: json['new_in_period'] as int? ?? 0,
      changePercent: json['change_percent'] != null
          ? (json['change_percent'] as num).toDouble()
          : null,
    );
  }
}

class OverviewEstablishments {
  final int total;
  final int active;
  final int pending;
  final int suspended;
  final int newInPeriod;
  final double? changePercent;

  const OverviewEstablishments({
    required this.total,
    required this.active,
    required this.pending,
    required this.suspended,
    required this.newInPeriod,
    this.changePercent,
  });

  factory OverviewEstablishments.fromJson(Map<String, dynamic> json) {
    return OverviewEstablishments(
      total: json['total'] as int? ?? 0,
      active: json['active'] as int? ?? 0,
      pending: json['pending'] as int? ?? 0,
      suspended: json['suspended'] as int? ?? 0,
      newInPeriod: json['new_in_period'] as int? ?? 0,
      changePercent: json['change_percent'] != null
          ? (json['change_percent'] as num).toDouble()
          : null,
    );
  }
}

class OverviewReviews {
  final int total;
  final int newInPeriod;
  final double? changePercent;
  final double averageRating;

  const OverviewReviews({
    required this.total,
    required this.newInPeriod,
    this.changePercent,
    required this.averageRating,
  });

  factory OverviewReviews.fromJson(Map<String, dynamic> json) {
    return OverviewReviews(
      total: json['total'] as int? ?? 0,
      newInPeriod: json['new_in_period'] as int? ?? 0,
      changePercent: json['change_percent'] != null
          ? (json['change_percent'] as num).toDouble()
          : null,
      averageRating: (json['average_rating'] as num?)?.toDouble() ?? 0,
    );
  }
}

class OverviewModeration {
  final int pendingCount;
  final int actionsInPeriod;

  /// Когда была подана старейшая заявка в очереди. null — очередь пуста.
  ///
  /// Возраст считается на клиенте, а не приходит числом: так подпись
  /// «старейшая ждёт N дней» не устаревает между запросами.
  final DateTime? oldestPendingAt;

  const OverviewModeration({
    required this.pendingCount,
    required this.actionsInPeriod,
    this.oldestPendingAt,
  });

  factory OverviewModeration.fromJson(Map<String, dynamic> json) {
    final oldest = json['oldest_pending_at'] as String?;
    return OverviewModeration(
      pendingCount: json['pending_count'] as int? ?? 0,
      actionsInPeriod: json['actions_in_period'] as int? ?? 0,
      oldestPendingAt: oldest == null ? null : DateTime.tryParse(oldest),
    );
  }

  /// Сколько полных суток ждёт старейшая заявка. null — очереди нет.
  int? get oldestPendingDays {
    final since = oldestPendingAt;
    if (since == null) return null;
    return DateTime.now().difference(since.toLocal()).inDays;
  }
}

// ============================================================================
// Users Analytics
// ============================================================================

class UsersAnalyticsData {
  final List<TimelinePoint> registrationTimeline;
  final List<DistributionItem> roleDistribution;
  final int total;
  final int newInPeriod;
  final double? changePercent;
  final String aggregation;
  final AnalyticsPeriod? period;

  const UsersAnalyticsData({
    required this.registrationTimeline,
    required this.roleDistribution,
    required this.total,
    required this.newInPeriod,
    this.changePercent,
    required this.aggregation,
    this.period,
  });

  /// Сколько пользователей в роли. Отсутствующая роль — это ноль, а не пробел:
  /// «Администраторов —» читалось бы как «неизвестно».
  int roleCount(String role) => roleDistribution
      .where((item) => item.label == role)
      .fold<int>(0, (sum, item) => sum + item.count);

  factory UsersAnalyticsData.fromJson(Map<String, dynamic> json) {
    return UsersAnalyticsData(
      registrationTimeline:
          (json['registration_timeline'] as List<dynamic>? ?? [])
              .map((e) => TimelinePoint.fromJson(e as Map<String, dynamic>))
              .toList(),
      roleDistribution: (json['role_distribution'] as List<dynamic>? ?? [])
          .map((e) => DistributionItem.fromJson(e as Map<String, dynamic>,
              labelKey: 'role'))
          .toList(),
      total: json['total'] as int? ?? 0,
      newInPeriod: json['new_in_period'] as int? ?? 0,
      changePercent: json['change_percent'] != null
          ? (json['change_percent'] as num).toDouble()
          : null,
      aggregation: json['aggregation'] as String? ?? 'day',
      period: AnalyticsPeriod.fromJson(
          json['period'] as Map<String, dynamic>?),
    );
  }
}

// ============================================================================
// Establishments Analytics
// ============================================================================

class EstablishmentsAnalyticsData {
  final List<TimelinePoint> creationTimeline;
  final List<DistributionItem> statusDistribution;
  final List<DistributionItem> cityDistribution;
  final List<DistributionItem> categoryDistribution;
  final int total;
  final int active;

  /// Размер очереди модерации — снимок, а не величина за период.
  final int pending;
  final int newInPeriod;
  final double? changePercent;
  final String aggregation;
  final AnalyticsPeriod? period;

  const EstablishmentsAnalyticsData({
    required this.creationTimeline,
    required this.statusDistribution,
    required this.cityDistribution,
    required this.categoryDistribution,
    required this.total,
    required this.active,
    required this.pending,
    required this.newInPeriod,
    this.changePercent,
    required this.aggregation,
    this.period,
  });

  factory EstablishmentsAnalyticsData.fromJson(Map<String, dynamic> json) {
    return EstablishmentsAnalyticsData(
      creationTimeline: (json['creation_timeline'] as List<dynamic>? ?? [])
          .map((e) => TimelinePoint.fromJson(e as Map<String, dynamic>))
          .toList(),
      statusDistribution: (json['status_distribution'] as List<dynamic>? ?? [])
          .map((e) => DistributionItem.fromJson(e as Map<String, dynamic>,
              labelKey: 'status'))
          .toList(),
      cityDistribution: (json['city_distribution'] as List<dynamic>? ?? [])
          .map((e) => DistributionItem.fromJson(e as Map<String, dynamic>,
              labelKey: 'city'))
          .toList(),
      categoryDistribution:
          (json['category_distribution'] as List<dynamic>? ?? [])
              .map((e) => DistributionItem.fromJson(e as Map<String, dynamic>,
                  labelKey: 'category'))
              .toList(),
      total: json['total'] as int? ?? 0,
      active: json['active'] as int? ?? 0,
      pending: json['pending'] as int? ?? 0,
      newInPeriod: json['new_in_period'] as int? ?? 0,
      changePercent: json['change_percent'] != null
          ? (json['change_percent'] as num).toDouble()
          : null,
      aggregation: json['aggregation'] as String? ?? 'day',
      period: AnalyticsPeriod.fromJson(
          json['period'] as Map<String, dynamic>?),
    );
  }
}

// ============================================================================
// Reviews Analytics
// ============================================================================

class RatingDistributionItem {
  final int rating;
  final int count;
  final double percentage;

  const RatingDistributionItem({
    required this.rating,
    required this.count,
    required this.percentage,
  });

  factory RatingDistributionItem.fromJson(Map<String, dynamic> json) {
    return RatingDistributionItem(
      rating: json['rating'] as int? ?? 0,
      count: json['count'] as int? ?? 0,
      percentage: (json['percentage'] as num?)?.toDouble() ?? 0,
    );
  }
}

class ResponseStats {
  /// Знаменатель доли — приходит из того же запроса, что и числитель.
  /// Считать его из другого поля ответа нельзя: три числа карточки сложились
  /// бы из ответов на разные вопросы.
  final int totalReviews;
  final int totalWithResponse;
  final double responseRate;
  final double avgResponseTimeHours;

  const ResponseStats({
    required this.totalReviews,
    required this.totalWithResponse,
    required this.responseRate,
    required this.avgResponseTimeHours,
  });

  /// Отзывы, оставшиеся без ответа.
  int get totalWithoutResponse => totalReviews - totalWithResponse;

  factory ResponseStats.fromJson(Map<String, dynamic> json) {
    return ResponseStats(
      totalReviews: json['total_reviews'] as int? ?? 0,
      totalWithResponse: json['total_with_response'] as int? ?? 0,
      responseRate: (json['response_rate'] as num?)?.toDouble() ?? 0,
      avgResponseTimeHours:
          (json['avg_response_time_hours'] as num?)?.toDouble() ?? 0,
    );
  }
}

class ReviewsAnalyticsData {
  final List<TimelinePoint> reviewTimeline;
  final List<RatingDistributionItem> ratingDistribution;
  final ResponseStats responseStats;
  final int total;
  final int newInPeriod;
  final double? changePercent;

  /// Средняя оценка по всем видимым отзывам — снимок, не величина за период.
  final double averageRating;
  final String aggregation;
  final AnalyticsPeriod? period;

  const ReviewsAnalyticsData({
    required this.reviewTimeline,
    required this.ratingDistribution,
    required this.responseStats,
    required this.total,
    required this.newInPeriod,
    this.changePercent,
    required this.averageRating,
    required this.aggregation,
    this.period,
  });

  factory ReviewsAnalyticsData.fromJson(Map<String, dynamic> json) {
    return ReviewsAnalyticsData(
      reviewTimeline: (json['review_timeline'] as List<dynamic>? ?? [])
          .map((e) => TimelinePoint.fromJson(e as Map<String, dynamic>))
          .toList(),
      ratingDistribution: (json['rating_distribution'] as List<dynamic>? ?? [])
          .map(
              (e) => RatingDistributionItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      responseStats: ResponseStats.fromJson(
          json['response_stats'] as Map<String, dynamic>? ?? {}),
      total: json['total'] as int? ?? 0,
      newInPeriod: json['new_in_period'] as int? ?? 0,
      changePercent: json['change_percent'] != null
          ? (json['change_percent'] as num).toDouble()
          : null,
      averageRating: (json['average_rating'] as num?)?.toDouble() ?? 0,
      aggregation: json['aggregation'] as String? ?? 'day',
      period: AnalyticsPeriod.fromJson(
          json['period'] as Map<String, dynamic>?),
    );
  }
}
