import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Текст отказа сервера доходит до экрана — вход, регистрация, правка
/// профиля.
///
/// Поверх настоящих `AuthService()` и `ApiClient()`, подменён только провод:
/// дефект жил на стыке — транспорт пересобирает `DioException`, а провайдер
/// искал текст сервера в `toString()` по `error:` со строчной буквы, тогда
/// как dio пишет `Error:`. Текст не находился никогда: русский отказ
/// лимитера, имя не по правилу при правке профиля, запрет — всё доходило
/// общей фразой «Произошла ошибка» (проход тестировщика 17.10, п. 32, Х2).
void main() {
  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
  });

  Future<void> settled(AuthProvider auth) async {
    for (var i = 0; i < 200 && auth.isLoading; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(auth.isLoading, isFalse, reason: 'провайдер не вышел из загрузки');
  }

  /// Провайдер гостя: хранилище пусто, сессии нет.
  Future<AuthProvider> guest(
    ResponseBody Function(RequestOptions options) respond,
  ) async {
    installWireStand(respond);
    installSecureStorageStand();
    final auth = AuthProvider();
    addTearDown(auth.dispose);
    await settled(auth);
    return auth;
  }

  /// Провайдер вошедшего: токен в хранилище, профиль отвечает.
  Future<AuthProvider> signedIn(
    ResponseBody Function(RequestOptions options) respond,
  ) async {
    installWireStand((options) {
      if (options.uri.path.endsWith('/auth/me')) {
        return jsonBody({
          'success': true,
          'data': {
            'user': {'id': 'u-1', 'email': 'guest@example.com', 'name': 'Гость'},
          },
        });
      }
      return respond(options);
    });
    installSecureStorageStand({
      'access_token': 'valid',
      'refresh_token': 'alive',
    });
    final auth = AuthProvider();
    addTearDown(auth.dispose);
    await settled(auth);
    expect(auth.isAuthenticated, isTrue, reason: 'предусловие: вошёл');
    return auth;
  }

  Map<String, dynamic> refusal(
    String code,
    String message, {
    Object? details,
  }) =>
      {
        'success': false,
        'error': {
          'code': code,
          'message': message,
          if (details != null) 'details': details,
        },
      };

  group('Регистрация', () {
    test('русский текст проверки имени из details — на экран', () async {
      // Форма express-validator: details — объект «поле → список фраз»,
      // общая фраза рядом — английская.
      final auth = await guest((_) => jsonBody(
            refusal('VALIDATION_ERROR', 'Invalid input data', details: {
              'name': [
                'Имя может содержать только буквы, пробел, дефис и апостроф',
              ],
            }),
            status: 422,
          ));

      final ok = await auth.registerWithEmail(
        email: 'new@example.com',
        password: 'Secret123',
        name: 'Анна',
      );

      expect(ok, isFalse);
      expect(auth.errorMessage,
          'Имя может содержать только буквы, пробел, дефис и апостроф');
    });

    test('русский текст в error.message — на экран', () async {
      final auth = await guest((_) => jsonBody(
            refusal('VALIDATION_ERROR', 'Имя содержит недопустимые слова'),
            status: 400,
          ));

      final ok = await auth.registerWithPhone(
        phone: '+375291234567',
        password: 'Secret123',
        name: 'Анна',
      );

      expect(ok, isFalse);
      expect(auth.errorMessage, 'Имя содержит недопустимые слова');
    });

    test('английский отказ «почта занята» — русской фразой таблицы', () async {
      final auth = await guest((_) => jsonBody(
            refusal('EMAIL_EXISTS', 'An account with this email already exists'),
            status: 409,
          ));

      await auth.registerWithEmail(
        email: 'taken@example.com',
        password: 'Secret123',
        name: 'Анна',
      );

      expect(auth.errorMessage,
          'Этот email уже зарегистрирован. Попробуйте войти.');
    });

    test('английская фраза правила имени (сервер до перевода) — по-русски',
        () async {
      final auth = await guest((_) => jsonBody(
            refusal('VALIDATION_ERROR', 'Invalid input data', details: {
              'name': [
                'Name can only contain letters, spaces, hyphens and apostrophes',
              ],
            }),
            status: 422,
          ));

      await auth.registerWithEmail(
        email: 'new@example.com',
        password: 'Secret123',
        name: 'Анна',
      );

      expect(auth.errorMessage, nameCharactersMessage);
    });
  });

  group('Вход', () {
    test('русский отказ лимитера (429) — текстом сервера', () async {
      // Тело — как у `rateLimiter.js`: фраза сверху, в details служебные
      // поля. Строка окна лимита в details — не текст для человека.
      final auth = await guest((_) => jsonBody({
            'success': false,
            'message': 'Слишком много запросов. Попробуйте позже.',
            'error': {
              'code': 'RATE_LIMIT_EXCEEDED',
              'details': {
                'limit': 5,
                'window': '15 минут',
                'retry_after': 840,
              },
            },
          }, status: 429));

      final ok = await auth.login(
        emailOrPhone: 'guest@example.com',
        password: 'Secret123',
      );

      expect(ok, isFalse);
      expect(auth.errorMessage, 'Слишком много запросов. Попробуйте позже.');
    });

    test('нет связи — русской фразой транспорта, не общей', () async {
      final auth = await guest((options) => throw DioException.connectionError(
            requestOptions: options,
            reason: 'Failed host lookup',
          ));

      await auth.login(emailOrPhone: 'guest@example.com', password: 'Secret123');

      expect(auth.errorMessage, 'Нет связи. Проверьте подключение к интернету.');
    });

    test('429 с кодом TOO_MANY_ATTEMPTS — про код, а не общий лимит', () async {
      // Ветка кода стоит в таблице раньше ветки статуса 429.
      final auth = await guest((_) => jsonBody(
            refusal('TOO_MANY_ATTEMPTS', 'Too many failed attempts'),
            status: 429,
          ));

      await auth.login(emailOrPhone: 'guest@example.com', password: 'Secret123');

      expect(auth.errorMessage,
          'Слишком много неверных попыток. Запросите новый код.');
    });

    test('OAUTH_NO_EMAIL — про сервис входа, не «на аккаунте нет email»',
        () async {
      final auth = await guest((_) => jsonBody(
            refusal('OAUTH_NO_EMAIL',
                'OAuth account does not have an email address'),
            status: 400,
          ));

      await auth.login(emailOrPhone: 'guest@example.com', password: 'Secret123');

      expect(auth.errorMessage,
          'Сервис входа не передал адрес почты. Войдите другим способом.');
    });

    test('неверный пароль — по-прежнему русской фразой таблицы', () async {
      final auth = await guest((_) => jsonBody(
            refusal('INVALID_CREDENTIALS', 'Invalid email/phone or password'),
            status: 401,
          ));

      await auth.login(emailOrPhone: 'guest@example.com', password: 'typo');

      expect(auth.errorMessage, 'Неверный email/телефон или пароль');
    });
  });

  group('Правка профиля', () {
    test('русский отказ сервера в имени — на экран', () async {
      final auth = await signedIn((_) => jsonBody(
            refusal('VALIDATION_ERROR',
                'Имя может содержать только буквы, пробел, дефис и апостроф'),
            status: 400,
          ));

      final ok = await auth.updateProfile(name: 'Анна К');

      expect(ok, isFalse);
      expect(auth.errorMessage,
          'Имя может содержать только буквы, пробел, дефис и апостроф');
    });

    test('английский отказ длины имени — «от 2 до 50»', () async {
      final auth = await signedIn((_) => jsonBody(
            refusal('VALIDATION_ERROR', 'Name must be 100 characters or fewer'),
            status: 400,
          ));

      await auth.updateProfile(name: 'Анна');

      expect(auth.errorMessage, 'Имя — от 2 до 50 символов');
    });

    test('«500» в тексте отказа — не «ошибка сервера»', () async {
      // Подстрочный поиск «500» давал «Ошибка сервера» на фразе
      // «must be 500 characters or fewer» — ответе 400, а не 5xx.
      final auth = await signedIn((_) => jsonBody(
            refusal('VALIDATION_ERROR',
                'Avatar URL must be 500 characters or fewer'),
            status: 400,
          ));

      await auth.updateProfile(avatarUrl: 'https://example.com/a.jpg');

      expect(auth.errorMessage, 'Проверьте введённые данные.');
    });

    test('без текста сервера — общая фраза', () async {
      final auth = await signedIn(
          (_) => jsonBody({'success': false}, status: 400));

      await auth.updateProfile(name: 'Анна');

      expect(auth.errorMessage, AuthProvider.genericErrorMessage);
    });
  });
}
