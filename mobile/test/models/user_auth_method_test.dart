import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/user.dart';

/// Способ входа в профиле — для «Мои данные» (бриф В1, 18.10.2026).
///
/// Сервер шлёт его как `authMethod` во всех ответах с профилем — вход,
/// регистрация, Google и Яндекс, `/auth/me`, правка профиля
/// (`backend/src/controllers/authController.js`); `toJson` пишет
/// `auth_method`, и сохранённый профиль читается обратно тем же разбором.
void main() {
  test('authMethod из ответа сервера (как шлёт /auth/me)', () {
    final user = User.fromJson({
      'id': 'u-1',
      'email': 'ivan@example.com',
      'name': 'Иван',
      'role': 'user',
      'authMethod': 'yandex',
    });

    expect(user.authMethod, 'yandex');
  });

  test('сохранённый профиль читается обратно с тем же способом', () {
    const user = User(id: 'u-1', name: 'Иван', authMethod: 'phone');

    final restored = User.fromJson(user.toJson());

    expect(user.toJson()['auth_method'], 'phone');
    expect(restored.authMethod, 'phone');
  });

  test('профиль без поля — способ неизвестен', () {
    final user = User.fromJson({'id': 'u-1', 'name': 'Иван'});

    expect(user.authMethod, isNull);
    expect(user.toJson().containsKey('auth_method'), isFalse);
  });

  test('copyWith сохраняет способ входа', () {
    const user = User(id: 'u-1', name: 'Иван', authMethod: 'google');

    expect(user.copyWith(role: 'partner').authMethod, 'google');
  });
}
