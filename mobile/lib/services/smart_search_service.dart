import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Response model for POST /api/v1/search/smart
class SmartSearchResult {
  final SmartSearchIntent? intent;
  final List<Establishment> results;
  final int total;
  final bool fallback;

  SmartSearchResult({
    this.intent,
    required this.results,
    required this.total,
    required this.fallback,
  });

  factory SmartSearchResult.fromJson(Map<String, dynamic> json) {
    final data = json['data'] ?? json;
    return SmartSearchResult(
      intent: data['intent'] != null
          ? SmartSearchIntent.fromJson(data['intent'] as Map<String, dynamic>)
          : null,
      results: (data['establishments'] as List? ?? [])
          .map((e) => Establishment.fromJson(e as Map<String, dynamic>))
          .toList(),
      total: data['pagination']?['total'] as int? ?? 0,
      fallback: data['fallback'] as bool? ?? true,
    );
  }
}

/// Parsed AI intent from smart search
class SmartSearchIntent {
  final String? category;
  final List<String>? cuisine;
  final String? mealType;
  final double? priceMax;
  final String? location;
  final String? sort;
  final List<String> tags;

  SmartSearchIntent({
    this.category,
    this.cuisine,
    this.mealType,
    this.priceMax,
    this.location,
    this.sort,
    this.tags = const [],
  });

  factory SmartSearchIntent.fromJson(Map<String, dynamic> json) {
    return SmartSearchIntent(
      category: json['category'] as String?,
      cuisine: (json['cuisine'] as List?)?.map((e) => e.toString()).toList(),
      mealType: json['meal_type'] as String?,
      priceMax: json['price_max'] != null
          ? (json['price_max'] as num).toDouble()
          : null,
      location: json['location'] as String?,
      sort: json['sort'] as String?,
      tags: (json['tags'] as List?)?.map((e) => e.toString()).toList() ?? [],
    );
  }

  /// Build human-readable description of the parsed intent
  String toDisplayString() {
    final parts = <String>[];
    if (category != null) parts.add(category!);
    if (cuisine != null && cuisine!.isNotEmpty) parts.add(cuisine!.join(', '));
    if (priceMax != null) parts.add('до $priceMax BYN');
    if (location != null) parts.add(location!);
    if (sort == 'distance') parts.add('рядом с вами');
    if (sort == 'rating') parts.add('лучшие');
    if (sort == 'price_asc') parts.add('недорого');
    return parts.join(' \u00b7 ');
  }
}

/// Service for smart search API calls
class SmartSearchService {
  final ApiClient _apiClient;

  static final SmartSearchService _instance = SmartSearchService._internal();
  factory SmartSearchService() => _instance;
  SmartSearchService._internal() : _apiClient = ApiClient();

  /// Execute smart search via POST /api/v1/search/smart
  Future<SmartSearchResult> searchSmart({
    required String query,
    double? latitude,
    double? longitude,
    String? city,
    int limit = 3,
    int page = 1,
  }) async {
    final body = <String, dynamic>{
      'query': query,
      'limit': limit,
      'page': page,
    };

    if (latitude != null) body['latitude'] = latitude;
    if (longitude != null) body['longitude'] = longitude;
    if (city != null) body['city'] = city;

    final response = await _apiClient.post(
      '/api/v1/search/smart',
      data: body,
    );

    return SmartSearchResult.fromJson(response.data as Map<String, dynamic>);
  }
}
