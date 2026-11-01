import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/environment.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/auth/login_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// «Забыли пароль?» на экране входа открывает в браузере страницу
/// восстановления пароля на сайте. Прежде — плашка «Восстановление пароля
/// будет добавлено позже», хотя сброс на сайте работает целиком (сводка
/// находок, группа Б, 30.10.2026).
void main() {
  const urlLauncher = MethodChannel('plugins.flutter.io/url_launcher');

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
    installWireStand((_) => jsonBody({'success': false}, status: 404));
    installSecureStorageStand();
  });

  test('адрес — страница восстановления на сайте из настройки приложения', () {
    expect(LoginScreen.forgotPasswordUrl(siteBaseUrl: 'https://nirivio.by/'),
        'https://nirivio.by/forgot-password');
    expect(LoginScreen.forgotPasswordUrl(siteBaseUrl: 'https://nirivio.by'),
        'https://nirivio.by/forgot-password');
    expect(LoginScreen.forgotPasswordUrl(),
        '${Environment.siteBaseUrl}/forgot-password');
  });

  /// Экран входа; браузер «открывается» с ответом [opened]. Возвращает
  /// вызовы канала url_launcher.
  Future<List<MethodCall>> tapForgot(WidgetTester tester,
      {required bool opened}) async {
    final calls = <MethodCall>[];
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(urlLauncher, (call) async {
      calls.add(call);
      return opened;
    });
    addTearDown(() => messenger.setMockMethodCallHandler(urlLauncher, null));

    final auth = (await tester.runAsync(() async {
      final provider = AuthProvider();
      for (var i = 0; i < 200 && provider.isLoading; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      return provider;
    }))!;
    addTearDown(auth.dispose);

    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 900);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const LoginScreen(),
      ),
    ));
    await tester.pump();

    final link = find.text('Забыли пароль?');
    await tester.ensureVisible(link);
    await tester.pump();
    await tester.tap(link);
    // Плашка выезжает анимацией.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 750));
    return calls;
  }

  testWidgets('открывает страницу сайта в браузере, отдельным приложением',
      (tester) async {
    final calls = await tapForgot(tester, opened: true);

    expect(calls.map((c) => c.method), ['launch']);
    final args = calls.single.arguments as Map;
    expect(args['url'], LoginScreen.forgotPasswordUrl());
    // `useSafariVC`/`useWebView` — «внутри приложения»; страница сайта —
    // в браузере.
    expect(args['useSafariVC'], isFalse);
    expect(args['useWebView'], isFalse);

    expect(find.text('Восстановление пароля будет добавлено позже'),
        findsNothing);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('браузер не открылся — плашка с адресом сайта', (tester) async {
    final calls = await tapForgot(tester, opened: false);

    expect(calls, hasLength(1));
    expect(
        find.text('Не удалось открыть браузер. Восстановить пароль можно на '
            'сайте: ${LoginScreen.forgotPasswordUrl()}'),
        findsOneWidget);
  });
}
