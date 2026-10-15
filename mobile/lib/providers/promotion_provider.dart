import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/models/promotion.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/utils/error_helpers.dart';

/// Promotion state provider for partner's promotion management
/// Follows PartnerDashboardProvider patterns
class PromotionProvider with ChangeNotifier {
  final ApiClient _apiClient = ApiClient();

  PromotionProvider() {
    AccountScope.register(resetAccountScope);
  }

  /// Bumped on every account-scope reset; a request started under the
  /// previous account captured an older value and drops its write, so a late
  /// answer can never show the previous account's data (pack 1 of the critics'
  /// findings, point 4 — Codex C2; the pattern of PartnerDashboardProvider).
  int _generation = 0;

  /// Clears the partner's promotions; registered in [AccountScope],
  /// runs on logout / account switch.
  void resetAccountScope() {
    _generation++;
    _promotions = [];
    _isLoading = false;
    _error = null;
    _actionError = null;
    notifyListeners();
  }

  // State
  List<Promotion> _promotions = [];
  bool _isLoading = false;
  String? _error;
  String? _actionError;

  // Getters
  List<Promotion> get promotions => _promotions;
  List<Promotion> get activePromotions =>
      _promotions.where((p) => p.status == 'active').toList();
  List<Promotion> get expiredPromotions =>
      _promotions.where((p) => p.status != 'active').toList();
  int get activeCount => activePromotions.length;

  /// Грузится список. Поднимает его только [fetchPromotions]: создание,
  /// правка и завершение акции ждут ответа под своим индикатором (кнопка
  /// экрана). До 13.10.2026 создание и правка поднимали и этот флаг, а при
  /// отказе не опускали — пустой список крутил индикатор бесконечно.
  bool get isLoading => _isLoading;

  /// Список не загрузился — экран списка показывает это на месте списка.
  String? get error => _error;

  /// Почему не прошло действие с акцией (создать, изменить, завершить),
  /// вернувшее `false`, — для плашки экрана, который его запускал. Читать
  /// сразу после такого вызова.
  ///
  /// Отдельно от [error]: отказ в создании — не ошибка загрузки списка.
  /// В общем поле пустой список после отказа показал бы его на месте списка
  /// с кнопкой «Повторить», которая перечитывает список, а не создаёт акцию.
  ///
  /// Текст отказа пишет сервер, и он объясняет, что не так («Одновременно
  /// может действовать не больше 3 акций…»). Свои фразы провайдера — только
  /// там, где готовой фразы нет: сбой сервера, исключение не из транспорта.
  String? get actionError => _actionError;

  /// Fetch all promotions for an establishment (partner view — includes inactive)
  Future<void> fetchPromotions(String establishmentId) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    final generation = _generation;
    try {
      final response = await _apiClient
          .get('/api/v1/partner/promotions/establishment/$establishmentId');
      if (generation != _generation) return; // account switched mid-flight

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final list = data['data'] as List? ?? [];
        _promotions = list
            .map((p) => Promotion.fromJson(p as Map<String, dynamic>))
            .toList();
      }
    } catch (e) {
      if (generation != _generation) return;
      _error = 'Ошибка загрузки акций';
    } finally {
      if (generation == _generation) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  /// Create a new promotion
  Future<bool> createPromotion({
    required String establishmentId,
    required String title,
    String? description,
    String? imagePath,
    String? validFrom,
    String? validUntil,
  }) async {
    _actionError = null;

    try {
      final formData = FormData.fromMap({
        'establishment_id': establishmentId,
        'title': title,
        if (description != null && description.isNotEmpty)
          'description': description,
        if (validFrom != null) 'valid_from': validFrom,
        if (validUntil != null) 'valid_until': validUntil,
        if (imagePath != null)
          'image': await MultipartFile.fromFile(imagePath, filename: 'promo.jpg'),
      });

      final response = await _apiClient.post(
        '/api/v1/partner/promotions',
        data: formData,
      );

      if (response.statusCode == 201) {
        // Refresh list
        await fetchPromotions(establishmentId);
        return true;
      }
      _actionError = 'Не удалось создать акцию';
      return false;
    } catch (e) {
      _actionError = userMessageOf(e, fallback: 'Ошибка создания акции');
      return false;
    }
  }

  /// Update an existing promotion
  Future<bool> updatePromotion({
    required String promotionId,
    required String establishmentId,
    String? title,
    String? description,
    String? imagePath,
    String? validFrom,
    String? validUntil,
  }) async {
    _actionError = null;

    try {
      final formData = FormData.fromMap({
        if (title != null) 'title': title,
        if (description != null) 'description': description,
        if (validFrom != null) 'valid_from': validFrom,
        if (validUntil != null) 'valid_until': validUntil,
        if (imagePath != null)
          'image': await MultipartFile.fromFile(imagePath, filename: 'promo.jpg'),
      });

      await _apiClient.patch(
        '/api/v1/partner/promotions/$promotionId',
        data: formData,
      );

      await fetchPromotions(establishmentId);
      return true;
    } catch (e) {
      _actionError = userMessageOf(e, fallback: 'Ошибка обновления акции');
      return false;
    }
  }

  /// Deactivate (soft delete) a promotion
  Future<bool> deactivatePromotion({
    required String promotionId,
    required String establishmentId,
  }) async {
    _actionError = null;

    try {
      await _apiClient.delete('/api/v1/partner/promotions/$promotionId');
      await fetchPromotions(establishmentId);
      return true;
    } catch (e) {
      _actionError = userMessageOf(e, fallback: 'Ошибка деактивации акции');
      return false;
    }
  }
}
