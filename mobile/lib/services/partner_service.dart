import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Partner-specific API service
/// Handles partner dashboard operations
/// Phase 5.2 - Partner Dashboard
class PartnerService {
  final ApiClient _apiClient;

  // Mock mode flag - set to true for development without backend
  static const bool useMock = false;

  // Singleton pattern
  static final PartnerService _instance = PartnerService._internal();
  factory PartnerService() => _instance;

  PartnerService._internal() : _apiClient = ApiClient();

  // ============================================================================
  // Get Partner's Establishments
  // ============================================================================

  /// Get list of partner's establishments
  Future<List<PartnerEstablishment>> getMyEstablishments() async {
    if (useMock) {
      // Simulate network delay
      await Future.delayed(const Duration(milliseconds: 500));
      return _getMockEstablishments();
    }

    try {
      final response = await _apiClient.get('/api/v1/partner/establishments');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final establishmentsData = data['data']?['establishments'] as List? ?? [];
        return establishmentsData
            .map((e) => PartnerEstablishment.fromJson(e as Map<String, dynamic>))
            .toList();
      } else {
        throw Exception('Не удалось загрузить заведения');
      }
    } catch (e) {
      throw Exception('Ошибка загрузки: $e');
    }
  }

  // ============================================================================
  // Get Single Establishment Details
  // ============================================================================

  /// Get detailed information about a single establishment
  Future<PartnerEstablishment> getEstablishmentDetails(String id) async {
    if (useMock) {
      await Future.delayed(const Duration(milliseconds: 300));
      return _getMockEstablishmentDetails(id);
    }

    try {
      final response = await _apiClient.get('/api/v1/partners/me/establishments/$id');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        return PartnerEstablishment.fromJson(
          data['data']?['establishment'] as Map<String, dynamic>,
        );
      } else {
        throw Exception('Не удалось загрузить заведение');
      }
    } catch (e) {
      throw Exception('Ошибка загрузки: $e');
    }
  }

  // ============================================================================
  // Update Establishment
  // ============================================================================

  /// Update establishment information
  Future<PartnerEstablishment> updateEstablishment(
    String id,
    Map<String, dynamic> updateData,
  ) async {
    if (useMock) {
      await Future.delayed(const Duration(milliseconds: 500));
      return _updateMockEstablishment(id, updateData);
    }

    try {
      final response = await _apiClient.put(
        '/api/v1/partners/me/establishments/$id',
        data: updateData,
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        return PartnerEstablishment.fromJson(
          data['data']?['establishment'] as Map<String, dynamic>,
        );
      } else {
        throw Exception('Не удалось обновить заведение');
      }
    } catch (e) {
      throw Exception('Ошибка обновления: $e');
    }
  }

  // ============================================================================
  // Check Partner Status
  // ============================================================================

  /// Check if current user has any establishments (is a partner)
  Future<bool> hasEstablishments() async {
    try {
      final establishments = await getMyEstablishments();
      return establishments.isNotEmpty;
    } catch (e) {
      return false;
    }
  }

  // ============================================================================
  // Mock Data
  // ============================================================================

  /// Mock establishments for development
  List<PartnerEstablishment> _getMockEstablishments() {
    return [
      PartnerEstablishment(
        id: '1',
        name: 'Fiori',
        status: EstablishmentStatus.approved,
        primaryImageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400',
        categories: ['restaurant'],
        cuisineTypes: ['italian', 'european'],
        stats: const EstablishmentStats(
          views: 10,
          viewsTrend: 12,
          shares: 2,
          sharesTrend: 5,
          favorites: 4,
          favoritesTrend: 8,
          reviews: 5,
          averageRating: 4.5,
        ),
        createdAt: DateTime.now().subtract(const Duration(days: 30)),
        updatedAt: DateTime.now(),
        description: 'Уютный итальянский ресторан в центре города',
        phone: '+375 29 123 45 67',
        email: 'info@fiori.by',
        city: 'Минск',
        street: 'Пл. Свободы',
        building: '8',
        subscriptionTier: 'Премиум',
        attributes: ['wifi', 'terrace', 'parking'],
        priceRange: '30-50 BYN',
      ),
      PartnerEstablishment(
        id: '2',
        name: 'Новое кафе',
        status: EstablishmentStatus.pending,
        primaryImageUrl: null,
        categories: ['cafe'],
        cuisineTypes: ['european'],
        stats: const EstablishmentStats(
          views: 0,
          shares: 0,
          favorites: 0,
          reviews: 0,
        ),
        createdAt: DateTime.now().subtract(const Duration(days: 2)),
        updatedAt: DateTime.now(),
        description: 'Современное кафе с авторской кухней',
        phone: '+375 29 987 65 43',
        city: 'Минск',
        street: 'ул. Немига',
        building: '12',
        subscriptionTier: 'Бесплатный',
      ),
      PartnerEstablishment(
        id: '3',
        name: 'Тестовый бар',
        status: EstablishmentStatus.rejected,
        statusMessage: 'Недостаточно фотографий интерьера. Пожалуйста, добавьте минимум 3 фотографии.',
        categories: ['bar'],
        cuisineTypes: ['mixed'],
        stats: const EstablishmentStats(
          views: 0,
          shares: 0,
          favorites: 0,
          reviews: 0,
        ),
        createdAt: DateTime.now().subtract(const Duration(days: 5)),
        updatedAt: DateTime.now(),
        description: 'Коктейльный бар с живой музыкой',
        phone: '+375 29 111 22 33',
        city: 'Минск',
        street: 'ул. Зыбицкая',
        building: '5',
        subscriptionTier: 'Стандарт',
      ),
    ];
  }

  /// Mock establishment details
  PartnerEstablishment _getMockEstablishmentDetails(String id) {
    final establishments = _getMockEstablishments();
    return establishments.firstWhere(
      (e) => e.id == id,
      orElse: () => establishments.first,
    );
  }

  /// Mock update establishment
  PartnerEstablishment _updateMockEstablishment(String id, Map<String, dynamic> data) {
    final establishment = _getMockEstablishmentDetails(id);

    // In mock mode, return updated establishment
    // Real implementation would save to server
    return establishment.copyWith(
      name: data['name'] as String? ?? establishment.name,
      description: data['description'] as String? ?? establishment.description,
      phone: data['phone'] as String? ?? establishment.phone,
      email: data['email'] as String? ?? establishment.email,
      // After edit, rejected establishments go back to pending
      status: establishment.status == EstablishmentStatus.rejected
          ? EstablishmentStatus.pending
          : establishment.status,
      updatedAt: DateTime.now(),
    );
  }
}
