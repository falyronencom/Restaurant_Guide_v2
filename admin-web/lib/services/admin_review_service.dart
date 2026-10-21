import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// API service for admin review management endpoints
class AdminReviewService {
  final ApiClient _apiClient;

  static final AdminReviewService _instance =
      AdminReviewService.withClient(ApiClient());
  factory AdminReviewService() => _instance;

  /// Собирает сервис поверх переданного клиента.
  ///
  /// Прод не меняется: фабрика по-прежнему отдаёт синглтон. Доступный
  /// генеративный конструктор нужен затем, что класс с одним лишь приватным
  /// конструктором нечем подменить в тесте — ни поверх, ни наследованием.
  AdminReviewService.withClient(this._apiClient);

  /// GET /api/v1/admin/reviews
  ///
  /// [rating] — одна оценка; [ratingMin] и [ratingMax] — диапазон («1–2» из
  /// аналитики). [authorId] — отзывы одного человека (`user_id`).
  Future<AdminReviewListResponse> getReviews({
    int page = 1,
    int perPage = 20,
    String? status,
    int? rating,
    int? ratingMin,
    int? ratingMax,
    String? authorId,
    String? search,
    String? sort,
    DateTime? from,
    DateTime? to,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'per_page': perPage,
    };
    if (status != null && status.isNotEmpty) queryParams['status'] = status;
    if (rating != null) queryParams['rating'] = rating;
    if (ratingMin != null) queryParams['rating_min'] = ratingMin;
    if (ratingMax != null) queryParams['rating_max'] = ratingMax;
    if (authorId != null && authorId.isNotEmpty) {
      queryParams['user_id'] = authorId;
    }
    if (search != null && search.isNotEmpty) queryParams['search'] = search;
    if (sort != null && sort.isNotEmpty) queryParams['sort'] = sort;
    if (from != null) queryParams['from'] = from.toIso8601String();
    if (to != null) queryParams['to'] = to.toIso8601String();

    final response = await _apiClient.get(
      '/api/v1/admin/reviews',
      queryParameters: queryParams,
    );

    final data = response.data as Map<String, dynamic>;
    final items = (data['data'] as List<dynamic>? ?? [])
        .map((e) => AdminReviewItem.fromJson(e as Map<String, dynamic>))
        .toList();

    final meta = data['meta'] as Map<String, dynamic>? ?? {};

    return AdminReviewListResponse(
      reviews: items,
      total: meta['total'] as int? ?? items.length,
      hidden: meta['hidden'] as int? ?? 0,
      averageRating: (meta['average_rating'] as num?)?.toDouble(),
      page: meta['page'] as int? ?? page,
      pages: meta['pages'] as int? ?? 1,
    );
  }

  /// POST /api/v1/admin/reviews/:id/visibility — `{ is_visible }`.
  ///
  /// Состояние задаётся явно, а не переключается: клиент повторяет запрос при
  /// 5xx (api_client.dart), и повтор «скрыть» обязан снова означать «скрыть» —
  /// переключение, исполненное с первого раза при потерянном ответе, повтор
  /// возвращал бы назад (пакет 1 находок критиков, пункт 2 — Codex C-10).
  ///
  /// [reason] — причина для журнала; автору она не показывается.
  Future<void> setVisibility(
    String id, {
    required bool isVisible,
    String? reason,
  }) async {
    await _apiClient.post(
      '/api/v1/admin/reviews/$id/visibility',
      data: <String, dynamic>{
        'is_visible': isVisible,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
  }

  /// POST /api/v1/admin/reviews/hide-batch — `{ review_ids, reason }`.
  ///
  /// Скрыть выбранные разом с одной причиной (отзывы одного человека —
  /// проход по панели 20.10, A2-09). Уже скрытые и удалённые сервер
  /// пропускает и говорит, сколько скрыл.
  Future<AdminReviewBatchResult> hideBatch(
    List<String> ids, {
    required String reason,
  }) async {
    final response = await _apiClient.post(
      '/api/v1/admin/reviews/hide-batch',
      data: <String, dynamic>{'review_ids': ids, 'reason': reason},
    );
    final body = response.data;
    final data = body is Map<String, dynamic> ? body['data'] : null;
    return data is Map<String, dynamic>
        ? AdminReviewBatchResult.fromJson(data)
        // Ответ 200 без тела: просили скрыть все — считаем, что скрыты.
        : AdminReviewBatchResult(
            requested: ids.length, hidden: ids.length, skipped: 0);
  }

  /// POST /api/v1/admin/reviews/:id/delete
  Future<void> deleteReview(String id, {String? reason}) async {
    final data = <String, dynamic>{};
    if (reason != null && reason.isNotEmpty) data['reason'] = reason;

    await _apiClient.post(
      '/api/v1/admin/reviews/$id/delete',
      data: data.isNotEmpty ? data : null,
    );
  }
}
