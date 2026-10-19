import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/delete_account_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Выход на телефоне после удаления учётки — тот, что экран делает сам, без
/// подставного (бриф В1, 18.10.2026).
///
/// Учётки на сервере больше нет, все её сеансы погашены. Телефон стирает
/// токены и сообщает провайдеру входа, что сеанс кончился, — тем же
/// сигналом, которым транспорт сообщает о сеансе, который сервер больше не
/// продлит (`SessionEvents`). Свидетелей два: настоящий провайдер переходит
/// в «гость»; и хранилище пустеет, даже если провайдер сигнал не принял
/// (он принимает его только из состояния «вошёл»).
class _SignedInByGetter extends AuthProvider {
  @override
  bool get isAuthenticated => true;

  @override
  User? get currentUser => const User(id: 'u-1', name: 'Иван', authMethod: 'email');
}

void main() {
  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
  });

  ResponseBody server(RequestOptions options) {
    final path = options.uri.path;
    if (path == '/api/v1/auth/me') {
      return jsonBody({
        'success': true,
        'data': {
          'user': {'id': 'u-1', 'email': 'ivan@example.com', 'name': 'Иван', 'authMethod': 'email'},
        },
      });
    }
    if (path == '/api/v1/auth/account/deletion') {
      return jsonBody({'success': true, 'data': {'allowed': true, 'refusal': null}});
    }
    if (path == '/api/v1/auth/account' && options.method == 'DELETE') {
      return jsonBody({'success': true, 'data': {'deleted': true}});
    }
    return jsonBody({'success': false}, status: 404);
  }

  Future<void> deleteThroughScreen(WidgetTester tester, AuthProvider auth) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(420, 1600);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: auth),
        ChangeNotifierProvider(create: (_) => NotificationProvider()),
        ChangeNotifierProvider(create: (_) => PartnerDashboardProvider()),
      ],
      child: MaterialApp(
        routes: {
          '/home': (_) => const Scaffold(body: Center(child: Text('Главный экран'))),
        },
        home: const DeleteAccountScreen(),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('delete-account-word')), 'УДАЛИТЬ');
    await tester.pump();
    await tester.tap(find.byKey(const Key('delete-account-button')));
    await tester.pumpAndSettle();
  }

  testWidgets('вошедший по сохранённому сеансу — после удаления «гость», токенов нет',
      (tester) async {
    installWireStand(server);
    final storage = installSecureStorageStand({
      'access_token': 'valid',
      'refresh_token': 'alive',
    });
    // Сеанс восстанавливается настоящими асинхронными вызовами (хранилище,
    // /auth/me) — вне фейкового времени виджет-теста.
    final auth = (await tester.runAsync(() async {
      final provider = AuthProvider();
      for (var i = 0; i < 200 && (provider.isLoading || !provider.isAuthenticated); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      return provider;
    }))!;
    addTearDown(auth.dispose);
    expect(auth.isAuthenticated, isTrue, reason: 'предусловие: вошёл');

    await deleteThroughScreen(tester, auth);

    expect(auth.isAuthenticated, isFalse);
    expect(auth.currentUser, isNull);
    expect(storage.containsKey('access_token'), isFalse);
    expect(storage.containsKey('refresh_token'), isFalse);
    expect(find.text('Главный экран'), findsOneWidget);
  });

  testWidgets('провайдер, не принявший сигнал, — хранилище всё равно пустеет', (tester) async {
    installWireStand(server);
    final storage = installSecureStorageStand({
      'access_token': 'valid',
      'refresh_token': 'alive',
      'user_data': '{}',
    });
    // Статус внутри — «не вошёл» (вошедшим его делает только геттер), и
    // _onSessionExpired сигнал пропустит: стереть токены должен экран.
    final auth = _SignedInByGetter();
    addTearDown(auth.dispose);

    await deleteThroughScreen(tester, auth);

    expect(storage.containsKey('access_token'), isFalse);
    expect(storage.containsKey('refresh_token'), isFalse);
    expect(storage.containsKey('user_data'), isFalse);
  });
}
