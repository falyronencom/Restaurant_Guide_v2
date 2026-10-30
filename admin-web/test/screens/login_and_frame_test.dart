import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/router.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/auth_response.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/auth/login_screen.dart';
import 'package:restaurant_guide_admin_web/screens/not_found_screen.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

// Вход, неизвестный адрес и первая загрузка (проход по панели модератора,
// 20.10, пункты A3-07, A3-25, A3-27).

class _AuthService implements AuthService {
  /// Ответ на «есть ли сессия» — держится, пока тест не отпустит.
  final Completer<bool> hasSession = Completer<bool>();

  /// Ответ на вход — тоже держится: так виден ход входа.
  Completer<AuthResponse> loginAnswer = Completer<AuthResponse>();

  @override
  Future<bool> isAuthenticated() => hasSession.future;

  @override
  Future<User> getCurrentUser() async =>
      const User(id: 'u-admin', email: 'admin@nirivio.by', role: 'admin');

  @override
  Future<AuthResponse> login({
    required String email,
    required String password,
  }) =>
      loginAnswer.future;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

DioException _wrongPassword() {
  final options = RequestOptions(path: '/api/v1/admin/auth/login');
  return DioException(
    requestOptions: options,
    response: Response<dynamic>(
      requestOptions: options,
      statusCode: 401,
      data: <String, dynamic>{
        'success': false,
        'error': <String, dynamic>{
          'code': 'INVALID_CREDENTIALS',
          'message': 'Invalid email/phone or password',
        },
      },
    ),
    type: DioExceptionType.badResponse,
  );
}

void main() {
  setUp(() {
    AccountScope.debugReset();
    SessionEvents.debugReset();
  });

  Future<(AuthProvider, GoRouter, _AuthService)> pumpApp(
      WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final service = _AuthService();
    final auth = AuthProvider(authService: service);
    addTearDown(auth.dispose);
    final router = createRouter(auth);
    addTearDown(router.dispose);

    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: auth,
        child: MaterialApp.router(
          theme: AppTheme.lightTheme,
          routerConfig: router,
        ),
      ),
    );
    await tester.pump();
    return (auth, router, service);
  }

  testWidgets('неверный пароль: почта остаётся в поле, причина — над формой',
      (tester) async {
    final (_, _, service) = await pumpApp(tester);
    service.hasSession.complete(false);
    await tester.pumpAndSettle();
    expect(find.byType(LoginScreen), findsOneWidget, reason: 'предпосылка');

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'moderator@example.com');
    await tester.enterText(fields.at(1), 'typo');
    await tester.tap(find.text('Войти'));
    await tester.pump();

    // Ход входа виден на кнопке: экран не уезжает на кадр инициализации.
    expect(find.byType(LoginScreen), findsOneWidget,
        reason: 'вход не пересоздаёт экран входа (A3-07)');
    expect(
        find.descendant(
            of: find.byType(ElevatedButton),
            matching: find.byType(CircularProgressIndicator)),
        findsOneWidget);

    service.loginAnswer.completeError(_wrongPassword());
    await tester.pumpAndSettle();

    final email =
        tester.widget<TextFormField>(find.byType(TextFormField).at(0));
    expect(email.controller!.text, 'moderator@example.com',
        reason: 'после опечатки почту не набирают заново');
    expect(find.text('Неверный email или пароль'), findsOneWidget);
  });

  testWidgets('неизвестный адрес — русская страница со ссылкой на главную',
      (tester) async {
    final (_, router, service) = await pumpApp(tester);
    // Пока идёт инициализация, адрес уезжает в кадр инициализации и
    // возвращается после ответа — так в стенде не строится главная.
    router.go('/no-such-page');
    await tester.pump();
    service.hasSession.complete(true);
    await tester.pumpAndSettle();

    expect(find.byType(NotFoundScreen), findsOneWidget);
    expect(find.text('Такой страницы нет'), findsOneWidget);
    expect(find.text('На главную'), findsOneWidget);
    expect(find.textContaining('Page Not Found'), findsNothing);
    expect(find.textContaining('Go to home'), findsNothing);
  });

  test('index.html: заглушка до старта и язык страницы', () {
    // До 20.10 в теле был только скрипт загрузки — белая страница, пока
    // скачивается движок (A3-27).
    final html = File('web/index.html').readAsStringSync();
    expect(html, contains('<html lang="ru">'));
    expect(html, contains('id="boot-placeholder"'));
    expect(html, contains('NIRIVIO'));
    expect(html.indexOf('boot-placeholder'),
        lessThan(html.indexOf('flutter_bootstrap.js')),
        reason: 'заглушка стоит раньше загрузки движка');

    // Снимает её отдельный файл: встроенный скрипт политика источников
    // панели не пустит (Caddyfile, сверка меток панели 29.10, S2). Файл —
    // обычным (не async) тегом раньше движка: слушатель первого кадра
    // встаёт до того, как движок может его отправить.
    final script = File('web/boot_placeholder.js').readAsStringSync();
    expect(script, contains("'flutter-first-frame'"),
        reason: 'заглушка снимается первым кадром приложения');
    expect(script, contains("getElementById('boot-placeholder')"));
    const tag = '<script src="boot_placeholder.js"></script>';
    expect(html, contains(tag));
    expect(html.indexOf(tag), lessThan(html.indexOf('flutter_bootstrap.js')));
  });

  test('index.html: ни одного встроенного скрипта', () {
    // Политика источников панели — script-src без 'unsafe-inline' (Caddyfile):
    // встроенный <script> или обработчик on…= в разметке молча не
    // исполнится в браузере, а тест на Dart VM этого не увидит.
    final html = File('web/index.html').readAsStringSync();
    final tags = RegExp(r'<script\b([^>]*)>([\s\S]*?)</script>',
            caseSensitive: false)
        .allMatches(html)
        .toList();
    expect(tags, hasLength(2), reason: 'заглушка и загрузчик движка');
    for (final tag in tags) {
      expect(tag.group(1), contains('src='), reason: tag.group(0));
      expect(tag.group(2)!.trim(), isEmpty, reason: tag.group(0));
    }
    expect(RegExp(r'\son[a-z]+\s*=', caseSensitive: false).hasMatch(html),
        isFalse,
        reason: 'обработчик событий в разметке');
  });
}
