import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Outcome of a retry-OCR request. Captures both success and rate-limit
/// cases without throwing, so the UI can render a friendly message using
/// the backend-provided retry-after value.
class RetryOcrResult {
  final bool success;
  final int enqueuedJobs;
  final int totalPdfs;

  /// Seconds to wait before next retry, surfaced from backend on 429.
  final int? retryAfterSeconds;

  /// Error code from backend when not rate-limited (e.g. NO_PDF_MENUS).
  final String? errorCode;
  final String? errorMessage;

  RetryOcrResult.success({
    required this.enqueuedJobs,
    required this.totalPdfs,
  })  : success = true,
        retryAfterSeconds = null,
        errorCode = null,
        errorMessage = null;

  RetryOcrResult.rateLimited({
    required int retryAfter,
    required String message,
  })  : success = false,
        enqueuedJobs = 0,
        totalPdfs = 0,
        retryAfterSeconds = retryAfter,
        errorCode = 'RATE_LIMITED',
        errorMessage = message;

  RetryOcrResult.failure({
    required String code,
    required String message,
  })  : success = false,
        enqueuedJobs = 0,
        totalPdfs = 0,
        retryAfterSeconds = null,
        errorCode = code,
        errorMessage = message;
}

/// API service for partner-scoped menu item operations.
///   GET   /api/v1/partner/establishments/:id/menu-items
///   PATCH /api/v1/partner/menu-items/:id
///   POST  /api/v1/partner/establishments/:id/retry-ocr
class PartnerMenuService {
  final ApiClient _apiClient;

  static final PartnerMenuService _instance = PartnerMenuService._internal();
  factory PartnerMenuService() => _instance;

  PartnerMenuService._internal() : _apiClient = ApiClient();

  Future<List<PartnerMenuItem>> fetchMenuItems(String establishmentId) async {
    final response = await _apiClient
        .get('/api/v1/partner/establishments/$establishmentId/menu-items');

    if (response.statusCode != 200 || response.data is! Map<String, dynamic>) {
      throw Exception('Не удалось загрузить позиции меню');
    }

    final data = response.data as Map<String, dynamic>;
    final list = data['data'] as List? ?? [];
    return list
        .map((e) => PartnerMenuItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Inline edit a single menu item. Returns updated item on success.
  /// Throws on failure; provider handles optimistic rollback.
  Future<PartnerMenuItem> updateMenuItem(
    String menuItemId, {
    String? itemName,
    double? priceByn,
    String? categoryRaw,
  }) async {
    final payload = <String, dynamic>{};
    if (itemName != null) payload['item_name'] = itemName;
    if (priceByn != null) payload['price_byn'] = priceByn;
    if (categoryRaw != null) payload['category_raw'] = categoryRaw;

    final response = await _apiClient.patch(
      '/api/v1/partner/menu-items/$menuItemId',
      data: payload,
    );

    if (response.statusCode != 200 || response.data is! Map<String, dynamic>) {
      throw Exception('Не удалось сохранить изменения');
    }
    final data = response.data as Map<String, dynamic>;
    return PartnerMenuItem.fromJson(data['data'] as Map<String, dynamic>);
  }

  /// Retry OCR for all PDF menus. Handles 429 and domain-level 400 without
  /// throwing, returning a structured RetryOcrResult for the UI.
  Future<RetryOcrResult> retryOcr(String establishmentId) async {
    try {
      final response = await _apiClient
          .post('/api/v1/partner/establishments/$establishmentId/retry-ocr');

      if (response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final result = data['data'] as Map<String, dynamic>? ?? {};
        return RetryOcrResult.success(
          enqueuedJobs: (result['enqueuedJobs'] as num?)?.toInt() ?? 0,
          totalPdfs: (result['totalPdfs'] as num?)?.toInt() ?? 0,
        );
      }
      return RetryOcrResult.failure(
        code: 'UNKNOWN',
        message: 'Неожиданный ответ сервера',
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 429) {
        // Prefer backend Retry-After header (seconds); fallback to 60s
        final retryAfterHeader = e.response?.headers.value('retry-after');
        final retryAfter = int.tryParse(retryAfterHeader ?? '') ?? 60;
        return RetryOcrResult.rateLimited(
          retryAfter: retryAfter,
          message: 'Лимит перезапусков исчерпан',
        );
      }
      if (status == 400 && e.response?.data is Map<String, dynamic>) {
        final data = e.response!.data as Map<String, dynamic>;
        final err = data['error'];
        if (err is Map<String, dynamic>) {
          return RetryOcrResult.failure(
            code: err['code']?.toString() ?? 'BAD_REQUEST',
            message: err['message']?.toString() ?? 'Запрос отклонён',
          );
        }
      }
      return RetryOcrResult.failure(
        code: 'NETWORK',
        message: e.message ?? 'Ошибка сети',
      );
    }
  }
}
