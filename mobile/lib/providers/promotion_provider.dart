import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/models/promotion.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Promotion state provider for partner's promotion management
/// Follows PartnerDashboardProvider patterns
class PromotionProvider with ChangeNotifier {
  final ApiClient _apiClient = ApiClient();

  // State
  List<Promotion> _promotions = [];
  bool _isLoading = false;
  String? _error;

  // Getters
  List<Promotion> get promotions => _promotions;
  List<Promotion> get activePromotions =>
      _promotions.where((p) => p.status == 'active').toList();
  List<Promotion> get expiredPromotions =>
      _promotions.where((p) => p.status != 'active').toList();
  int get activeCount => activePromotions.length;
  bool get isLoading => _isLoading;
  String? get error => _error;

  /// Fetch all promotions for an establishment (partner view — includes inactive)
  Future<void> fetchPromotions(String establishmentId) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _apiClient
          .get('/api/v1/partner/promotions/establishment/$establishmentId');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final list = data['data'] as List? ?? [];
        _promotions = list
            .map((p) => Promotion.fromJson(p as Map<String, dynamic>))
            .toList();
      }
    } catch (e) {
      _error = 'Ошибка загрузки акций';
    } finally {
      _isLoading = false;
      notifyListeners();
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
    _isLoading = true;
    _error = null;
    notifyListeners();

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
      _error = 'Не удалось создать акцию';
      return false;
    } catch (e) {
      _error = 'Ошибка создания акции';
      notifyListeners();
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
    _isLoading = true;
    _error = null;
    notifyListeners();

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
      _error = 'Ошибка обновления акции';
      notifyListeners();
      return false;
    }
  }

  /// Deactivate (soft delete) a promotion
  Future<bool> deactivatePromotion({
    required String promotionId,
    required String establishmentId,
  }) async {
    try {
      await _apiClient.delete('/api/v1/partner/promotions/$promotionId');
      await fetchPromotions(establishmentId);
      return true;
    } catch (e) {
      _error = 'Ошибка деактивации акции';
      notifyListeners();
      return false;
    }
  }
}
