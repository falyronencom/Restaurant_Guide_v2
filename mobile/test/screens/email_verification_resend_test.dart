import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/auth/email_verification_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// «Прислать код повторно», когда письмо не ушло.
///
/// Сервер выдаёт код и отвечает 200 с `sent: false`, если почтовая служба
/// письмо не приняла. Экран при этом писал «Код отправлен повторно», и
/// человек ждал письма, которого не будет. Теперь — честный текст, и кнопка
/// повтора остаётся.
///
/// Поверх настоящих `AuthProvider`, `AuthService` и `ApiClient`: подменён
/// только провод, флаг `sent` читается из настоящего конверта сервера.
void main() {
  const notSent = 'Письмо не отправилось. Попробуйте ещё раз через минуту.';
  const resent = 'Код отправлен повторно';
  const resendLabel = 'Прислать код повторно';

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
  });

  /// Сервер вошедшего: профиль отвечает, повтор кода — с флагом [sent].
  StubAdapter serverWith({required bool sent}) => installWireStand((options) {
        final path = options.uri.path;
        if (path == '/api/v1/auth/me') {
          return jsonBody({
            'success': true,
            'data': {
              'user': {
                'id': 'u-1',
                'email': 'anna@example.com',
                'name': 'Анна',
                'authMethod': 'email',
              },
            },
          });
        }
        if (path == '/api/v1/auth/send-verification-code') {
          return jsonBody({
            'success': true,
            'data': {'sent': sent, 'expiresAt': '2026-10-24T13:00:00.000Z'},
          });
        }
        return jsonBody({'success': false}, status: 404);
      });

  Future<AuthProvider> signedIn(WidgetTester tester) async {
    installSecureStorageStand({
      'access_token': 'valid',
      'refresh_token': 'alive',
    });
    // Сеанс восстанавливается настоящими асинхронными вызовами (хранилище,
    // /auth/me) — вне фейкового времени виджет-теста.
    final auth = (await tester.runAsync(() async {
      final provider = AuthProvider();
      for (var i = 0;
          i < 200 && (provider.isLoading || !provider.isAuthenticated);
          i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      return provider;
    }))!;
    addTearDown(auth.dispose);
    expect(auth.isAuthenticated, isTrue, reason: 'предусловие: вошёл');
    return auth;
  }

  /// Экран подтверждения; ждёт, пока истечёт отсчёт до повтора, и жмёт
  /// «Прислать код повторно».
  Future<void> resendOnScreen(WidgetTester tester, AuthProvider auth) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 900);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const EmailVerificationScreen(),
      ),
    ));
    // Отсчёт до повтора — 12 секунд, по тику в секунду.
    for (var i = 0; i < 13; i++) {
      await tester.pump(const Duration(seconds: 1));
    }
    expect(find.text(resendLabel), findsOneWidget,
        reason: 'предусловие: отсчёт закончился');

    await tester.tap(find.text(resendLabel));
    await tester.pumpAndSettle();
  }

  /// Кнопка повтора — и с отсчётом в подписи («…через 00:12»), и без него.
  TextButton resendButton(WidgetTester tester) => tester.widget<TextButton>(
      find.ancestor(
          of: find.textContaining(resendLabel),
          matching: find.byType(TextButton)));

  testWidgets('sent:false — «письмо не отправилось», кнопка повтора доступна',
      (tester) async {
    final wire = serverWith(sent: false);
    final auth = await signedIn(tester);

    await resendOnScreen(tester, auth);

    expect(
      wire.requests
          .where((r) => r.uri.path == '/api/v1/auth/send-verification-code'),
      hasLength(1),
    );
    expect(find.text(notSent), findsOneWidget);
    expect(find.text(resent), findsNothing,
        reason: 'письмо не ушло — «отправлен» обещает то, чего не будет');
    expect(resendButton(tester).onPressed, isNotNull,
        reason: 'человек должен мочь попробовать ещё раз');
  });

  testWidgets('sent:true — прежнее «Код отправлен повторно», отсчёт заново',
      (tester) async {
    serverWith(sent: true);
    final auth = await signedIn(tester);

    await resendOnScreen(tester, auth);

    expect(find.text(resent), findsOneWidget);
    expect(find.text(notSent), findsNothing);
    expect(find.textContaining('Прислать код повторно через'), findsOneWidget);
  });
}
