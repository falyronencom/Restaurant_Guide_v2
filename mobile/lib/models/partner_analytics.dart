// Partner Analytics data models
// Maps to backend endpoints from Segment A:
//   GET /partner/analytics/overview
//   GET /partner/analytics/trends
//   GET /partner/analytics/ratings

/// Single metric with total, period value, and change percentage
class AnalyticsMetric {
  final int total;
  final int inPeriod;
  final double? changePercent;

  const AnalyticsMetric({
    this.total = 0,
    this.inPeriod = 0,
    this.changePercent,
  });

  factory AnalyticsMetric.fromJson(Map<String, dynamic> json) {
    return AnalyticsMetric(
      total: (json['total'] as num?)?.toInt() ?? 0,
      inPeriod: (json['in_period'] as num?)?.toInt() ?? 0,
      changePercent: (json['change_percent'] as num?)?.toDouble(),
    );
  }

  static const AnalyticsMetric empty = AnalyticsMetric();
}

/// Overview data for a single establishment
class EstablishmentOverview {
  final String establishmentId;
  final String establishmentName;
  final AnalyticsMetric views;
  final AnalyticsMetric favorites;
  final AnalyticsMetric calls;
  final AnalyticsMetric reviews;
  final double averageRating;
  final String aggregation;

  const EstablishmentOverview({
    required this.establishmentId,
    required this.establishmentName,
    this.views = const AnalyticsMetric(),
    this.favorites = const AnalyticsMetric(),
    this.calls = const AnalyticsMetric(),
    this.reviews = const AnalyticsMetric(),
    this.averageRating = 0,
    this.aggregation = 'day',
  });

  factory EstablishmentOverview.fromJson(Map<String, dynamic> json) {
    return EstablishmentOverview(
      establishmentId: json['establishment_id'] as String,
      establishmentName: json['establishment_name'] as String,
      views: AnalyticsMetric.fromJson(json['views'] as Map<String, dynamic>),
      favorites: AnalyticsMetric.fromJson(json['favorites'] as Map<String, dynamic>),
      calls: AnalyticsMetric.fromJson(json['calls'] as Map<String, dynamic>),
      reviews: AnalyticsMetric.fromJson(json['reviews'] as Map<String, dynamic>),
      averageRating: (json['reviews']?['average_rating'] as num?)?.toDouble() ?? 0,
      aggregation: (json['period']?['aggregation'] as String?) ?? 'day',
    );
  }
}

/// Single data point in a time-series trend
class TrendPoint {
  final DateTime date;
  final int count;
  final double? avgRating;

  const TrendPoint({
    required this.date,
    this.count = 0,
    this.avgRating,
  });

  factory TrendPoint.fromJson(Map<String, dynamic> json) {
    return TrendPoint(
      date: DateTime.parse(json['date'] as String),
      count: (json['count'] as num?)?.toInt() ?? 0,
      avgRating: (json['avg_rating'] as num?)?.toDouble(),
    );
  }
}

/// Trends response containing all time-series
class AnalyticsTrends {
  final List<TrendPoint> viewsTrend;
  final List<TrendPoint> favoritesTrend;
  final List<TrendPoint> callsTrend;
  final List<TrendPoint> reviewsTrend;
  final String aggregation;

  const AnalyticsTrends({
    this.viewsTrend = const [],
    this.favoritesTrend = const [],
    this.callsTrend = const [],
    this.reviewsTrend = const [],
    this.aggregation = 'day',
  });

  factory AnalyticsTrends.fromJson(Map<String, dynamic> json) {
    return AnalyticsTrends(
      viewsTrend: _parseTrendList(json['views_trend']),
      favoritesTrend: _parseTrendList(json['favorites_trend']),
      callsTrend: _parseTrendList(json['calls_trend']),
      reviewsTrend: _parseTrendList(json['reviews_trend']),
      aggregation: json['aggregation'] as String? ?? 'day',
    );
  }

  static List<TrendPoint> _parseTrendList(dynamic list) {
    if (list is! List) return [];
    return list
        .map((e) => TrendPoint.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static const AnalyticsTrends empty = AnalyticsTrends();
}

/// Rating distribution entry
class RatingEntry {
  final int rating;
  final int count;
  final double percentage;

  const RatingEntry({
    required this.rating,
    this.count = 0,
    this.percentage = 0,
  });

  factory RatingEntry.fromJson(Map<String, dynamic> json) {
    return RatingEntry(
      rating: (json['rating'] as num).toInt(),
      count: (json['count'] as num?)?.toInt() ?? 0,
      percentage: (json['percentage'] as num?)?.toDouble() ?? 0,
    );
  }
}

/// Full ratings response
class AnalyticsRatings {
  final List<RatingEntry> distribution;
  final double average;
  final int totalReviews;

  const AnalyticsRatings({
    this.distribution = const [],
    this.average = 0,
    this.totalReviews = 0,
  });

  factory AnalyticsRatings.fromJson(Map<String, dynamic> json) {
    return AnalyticsRatings(
      distribution: (json['distribution'] as List?)
              ?.map((e) => RatingEntry.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      average: (json['average'] as num?)?.toDouble() ?? 0,
      totalReviews: (json['total_reviews'] as num?)?.toInt() ?? 0,
    );
  }

  static const AnalyticsRatings empty = AnalyticsRatings();
}
