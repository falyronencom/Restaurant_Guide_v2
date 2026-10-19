import 'package:restaurant_guide_mobile/models/account_deletion_check.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Удаление учётки самим человеком (бриф В1, 18.10.2026: App Store
/// 5.1.1(v), Google Play, закон 99-З).
///
/// Сервер удаляет обезличиванием (`backend/src/services/accountDeletionService.js`):
/// имя, почта, телефон и фото стираются, вход в ту же запись закрыт, сеансы
/// погашены, адреса push удалены; отзывы остаются с автором «Гость».
/// Отказы приходят по-русски, транспорт ([ApiClient]) их не переписывает.
class AccountService {
  final ApiClient _apiClient;

  static final AccountService _instance = AccountService._internal();
  factory AccountService() => _instance;

  AccountService._internal() : _apiClient = ApiClient();

  /// Слово, которым человек подтверждает удаление (решение 4 брифа). Его же
  /// проверяет сервер.
  static const String confirmationWord = 'УДАЛИТЬ';

  /// Можно ли удалить учётку сейчас. Бросает при сбое — экран показывает
  /// «Повторить».
  Future<AccountDeletionCheck> getDeletionCheck() async {
    final response = await _apiClient.get('/api/v1/auth/account/deletion');
    final body = response.data;
    final data = body is Map ? body['data'] : null;
    if (data is! Map<String, dynamic>) {
      throw const FormatException('ответ проверки удаления без data');
    }
    return AccountDeletionCheck.fromJson(data);
  }

  /// Удалить учётку. Бросает при отказе или сбое: учётка тогда на месте.
  Future<void> deleteAccount({required String confirmation}) async {
    await _apiClient.delete(
      '/api/v1/auth/account',
      data: {'confirmation': confirmation},
    );
  }
}
