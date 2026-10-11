import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/models/auth_response.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_settings_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/main_navigation.dart';
import 'package:restaurant_guide_mobile/screens/profile/notification_preferences_screen.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';

import 'fake_api_client.dart';
import 'wire_fixtures.dart';
import 'wire_stand.dart';

// Стенд главной для проверок регистрации адреса телефона для push.
//
// Главная поднимается так же, как в приложении после заставки: единственный
// маршрут корневого навигатора, провайдеры — как в RestaurantGuideApp.
// Подменены авторизация ([FakeSessionAuthService]: вход и восстановление
// сессии отвечают сразу), транспорт `ApiClient` (ответы «сервера») и, когда
// нужно, канал плагина Firebase ([PhoneMessaging]). Сервис push и
// `FirebaseMessaging` — настоящие.
//
// Стенд пользуется только тем, что было и до исправления 08.10.2026, —
// поэтому тесты поверх него можно прогнать на старом коде.

const userA = User(id: 'u-a', email: 'a@example.com');
const userB = User(id: 'u-b', email: 'b@example.com');

/// Ответы «телефона»: канал плагина `firebase_messaging`.
class PhoneMessaging {
  static const _channel = MethodChannel('plugins.flutter.io/firebase_messaging');

  /// 1 — уведомления разрешены, 0 — запрещены (коды плагина).
  int authorizationStatus = 1;

  /// Адрес Apple; null — Apple адрес не выдал (сборка без права push).
  String? apnsToken = 'apns-token';

  /// Не null — Firebase отказывает в адресе телефона с этой ошибкой.
  Object? tokenError;

  /// Адрес телефона, который выдаёт Firebase.
  String token = 'fcm-token-1';

  /// Не null — Firebase отвечает на запрос адреса только после того, как
  /// тест завершит этот Completer: так тест держит регистрацию незаконченной.
  Completer<void>? tokenGate;

  void install() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (call) async {
      switch (call.method) {
        case 'Messaging#requestPermission':
        case 'Messaging#getNotificationSettings':
          return <String, int>{
            'authorizationStatus': authorizationStatus,
            'alert': 1,
            'badge': 1,
            'sound': 1,
          };
        case 'Messaging#getAPNSToken':
          return <String, Object?>{'token': apnsToken};
        case 'Messaging#getToken':
          final gate = tokenGate;
          if (gate != null) await gate.future;
          final error = tokenError;
          if (error != null) throw error;
          return <String, Object?>{'token': token};
        default:
          return null;
      }
    });
  }

  /// «Телефон» сообщает приложению новый адрес: Firebase сменил токен.
  Future<void> refreshToken(String newToken) async {
    token = newToken;
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(
      _channel.name,
      _channel.codec.encodeMethodCall(
        MethodCall('Messaging#onTokenRefresh', newToken),
      ),
      (_) {},
    );
  }
}

/// Сессия без сервера авторизации.
class FakeSessionAuthService implements AuthService {
  FakeSessionAuthService({this.storedUser});

  /// Не null — в хранилище есть сессия этого пользователя.
  User? storedUser;

  /// Кем войдёт следующий [login].
  User nextLoginUser = userA;

  @override
  Future<bool> isAuthenticated() async => storedUser != null;

  @override
  Future<User> getCurrentUser() async {
    final user = storedUser;
    if (user == null) throw Exception('no session');
    return user;
  }

  @override
  Future<AuthResponse> login({
    required String emailOrPhone,
    required String password,
  }) async {
    storedUser = nextLoginUser;
    return AuthResponse(
      accessToken: 'access',
      refreshToken: 'refresh',
      user: nextLoginUser,
    );
  }

  @override
  Future<void> logout() async => storedUser = null;

  @override
  Future<void> clearAuthData() async => storedUser = null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class PushHome {
  PushHome(this.adapter, this.auth, this.authService, this.putAccounts);

  final StubAdapter adapter;
  final AuthProvider auth;
  final FakeSessionAuthService authService;

  /// Чей аккаунт был вошедшим, когда до сервера дошёл каждый
  /// `PUT /api/v1/notifications/device-token`, — по порядку.
  final List<String?> putAccounts;

  /// Что дошло до сервера: `PUT /api/v1/notifications/device-token`.
  List<RequestOptions> deviceTokenPuts() => adapter.requests
      .where((r) =>
          r.method == 'PUT' &&
          r.uri.path.endsWith('/api/v1/notifications/device-token'))
      .toList();
}

ResponseBody _respond(RequestOptions options) {
  final path = options.uri.path;
  if (path.endsWith('/notifications/device-token')) {
    return jsonBody(<String, dynamic>{
      'success': true,
      'data': <String, dynamic>{'id': 'dt-1', 'is_active': true},
    });
  }
  if (path.endsWith('/notifications/unread-count')) {
    return jsonBody(<String, dynamic>{
      'success': true,
      'data': <String, dynamic>{'count': 0},
    });
  }
  return jsonBody(searchEnvelope());
}

/// Поднять главную. [storedUser] — сессия в хранилище (холодный старт
/// вошедшего); без него — гость.
Future<PushHome> pumpPushHome(WidgetTester tester, {User? storedUser}) async {
  final authService = FakeSessionAuthService(storedUser: storedUser);
  final auth = AuthProvider(authService: authService);
  final putAccounts = <String?>[];
  final adapter = installWireStand((options) {
    if (options.method == 'PUT' &&
        options.uri.path.endsWith('/api/v1/notifications/device-token')) {
      putAccounts.add(auth.currentUser?.id);
    }
    return _respond(options);
  }, accessToken: 'access');

  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => auth),
        ChangeNotifierProvider(create: (_) => EstablishmentsProvider()),
        ChangeNotifierProvider(create: (_) => PartnerDashboardProvider()),
        ChangeNotifierProvider(create: (_) => NotificationProvider()),
        ChangeNotifierProvider(create: (_) => PromotionProvider()),
        ChangeNotifierProvider(create: (_) => PartnerMenuProvider()),
        ChangeNotifierProvider(create: (_) => BookingSettingsProvider()),
        ChangeNotifierProvider(create: (_) => BookingProvider()),
        ChangeNotifierProvider(
            create: (_) => NotificationPreferencesProvider()),
        ChangeNotifierProvider(create: (_) => SmartSearchProvider()),
      ],
      child: const MaterialApp(home: MainNavigationScreen()),
    ),
  );
  await settlePush(tester);
  return PushHome(adapter, auth, authService, putAccounts);
}

/// Экран настроек уведомлений — поверх того же сервиса push.
Future<void> pumpPushPreferences(WidgetTester tester) async {
  final prefs = NotificationPreferencesProvider(
    apiClient: FakeApiClient()
      ..prefsFromServer = <String, dynamic>{
        'booking_push_enabled': true,
        'reviews_push_enabled': true,
        'promotions_push_enabled': true,
        'menu_push_enabled': true,
      },
  );
  addTearDown(prefs.dispose);
  await tester.pumpWidget(
    ChangeNotifierProvider<NotificationPreferencesProvider>.value(
      value: prefs,
      child: const MaterialApp(home: NotificationPreferencesScreen()),
    ),
  );
  await tester.pump();
  await tester.pump();
}

/// Регистрация — несколько асинхронных шагов (канал Firebase, хранилище
/// токена, транспорт): кадр и секунда на хвосты.
Future<void> settlePush(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));
}

/// Снять дерево: провайдеры гасят таймеры (опрос непрочитанных каждые 30 с),
/// иначе тест упадёт на висящем таймере.
Future<void> unmountPushHome(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump();
}
