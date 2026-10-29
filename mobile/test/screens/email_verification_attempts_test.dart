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

/// «Профиль → Подтвердить email»: каждый неверный ввод кода — одна попытка
/// (сверка «Честность тестов клиентов», 25.10.2026, Q-M401).
///
/// Сервер на неверный код отвечает 401 `INVALID_CODE` и считает попытку за
/// каждый запрос; после пяти неверных код гаснет. Клиент принимал любой 401
/// за протухший доступ, обновлял сеанс и повторял запрос с тем же кодом —
/// за один ввод сгорали две попытки, и на третьем вводе человек видел «Код
/// истёк» вместо «Неверный код».
///
/// Поверх настоящих `AuthProvider`, `AuthService` и `ApiClient`: подменён
/// только провод. «Сервер» стенда считает попытки, как
/// `backend/src/services/authService.js` (`verifyEmailCode`: неверный код →
/// +1 попытка, на пятой код гасится; нет действующего кода → 410) и
/// отвечает, как `backend/src/controllers/authController.js`
/// (`verifyEmailCode`: 401 `INVALID_CODE`, 410 `INVALID_OR_EXPIRED_CODE`).
void main() {
  const wrong = 'Неверный код. Проверьте код из письма и попробуйте ещё раз.';
  const expired = 'Код истёк или недействителен. Запросите новый.';
  const issued = '482915';

  var sessionExpired = 0;

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
    sessionExpired = 0;
    SessionEvents.expired.listen((_) => sessionExpired++);
  });

  late int attempts;
  late bool codeUsed;

  StubAdapter server() {
    attempts = 0;
    codeUsed = false;
    return installWireStand((options) {
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
      if (path == '/api/v1/auth/refresh') {
        return jsonBody({
          'success': true,
          'data': {'accessToken': 'fresh', 'refreshToken': 'fresh-r'},
        });
      }
      if (path == '/api/v1/auth/verify-email-code') {
        if (codeUsed) {
          return jsonBody({
            'success': false,
            'error': {
              'code': 'INVALID_OR_EXPIRED_CODE',
              'message': 'No active code or it has expired',
            },
          }, status: 410);
        }
        if ((options.data as Map)['code'] != issued) {
          attempts++;
          if (attempts >= 5) codeUsed = true;
          return jsonBody({
            'success': false,
            'error': {
              'code': 'INVALID_CODE',
              'message': 'Verification code is incorrect',
            },
          }, status: 401);
        }
        codeUsed = true;
        return jsonBody({
          'success': true,
          'data': {
            'user': {
              'id': 'u-1',
              'email': 'anna@example.com',
              'emailVerified': true,
            },
          },
        });
      }
      return jsonBody({'success': false}, status: 404);
    });
  }

  Future<AuthProvider> signedIn(WidgetTester tester) async {
    installSecureStorageStand({
      'access_token': 'valid',
      'refresh_token': 'alive',
    });
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

  Future<void> openScreen(WidgetTester tester, AuthProvider auth) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 900);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const EmailVerificationScreen(),
        routes: {
          '/home': (_) => const Scaffold(body: Text('Главная')),
        },
      ),
    ));
    await tester.pump();
  }

  /// Набирает [code] в шесть ячеек; шестая цифра отправляет код сама
  /// (ячейка срабатывает на изменение, поэтому вводы отличаются последней
  /// цифрой — как у человека, который исправляет ошибку).
  /// Ждёт, пока запрос закончится (на время запроса ячейки закрыты).
  Future<void> enter(WidgetTester tester, String code) async {
    final boxes = find.byType(TextField);
    for (var i = 0; i < 6; i++) {
      await tester.enterText(boxes.at(i), code[i]);
      await tester.pump();
    }
    // Экран ушёл (верный код ведёт на главную) — ждать больше нечего.
    bool busy() =>
        boxes.evaluate().isNotEmpty &&
        !tester.widget<TextField>(boxes.at(0)).enabled!;
    for (var i = 0; i < 100 && busy(); i++) {
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 5)));
      // Шаг кадров — чтобы и переход на главную успел доиграть.
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(busy(), isFalse, reason: 'запрос кода не закончился');
  }

  Iterable<String> paths(StubAdapter wire) =>
      wire.requests.map((r) => r.uri.path);

  int verifyCalls(StubAdapter wire) =>
      paths(wire).where((p) => p == '/api/v1/auth/verify-email-code').length;

  testWidgets('пять неверных вводов — пять запросов и «Неверный код» каждый '
      'раз; шестой — «Код истёк»', (tester) async {
    final wire = server();
    final auth = await signedIn(tester);
    await openScreen(tester, auth);

    for (var entry = 1; entry <= 5; entry++) {
      await enter(tester, '00000$entry');
      expect(verifyCalls(wire), entry,
          reason: 'ввод $entry: один ввод — один запрос');
      expect(attempts, entry, reason: 'ввод $entry сжёг лишнюю попытку');
      expect(find.text(wrong), findsOneWidget,
          reason: 'ввод $entry из пяти — ещё «Неверный код»');
    }
    expect(paths(wire), isNot(contains('/api/v1/auth/refresh')),
        reason: 'неверный код — не протухший доступ: обновлять нечего');

    await enter(tester, '000006');
    expect(find.text(expired), findsOneWidget,
        reason: 'после пяти неверных код погашен — как задумано сервером');
    expect(sessionExpired, 0, reason: 'неверный код — не конец сеанса');

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('верный код после четырёх неверных проходит', (tester) async {
    final wire = server();
    final auth = await signedIn(tester);
    await openScreen(tester, auth);

    for (var entry = 1; entry <= 4; entry++) {
      await enter(tester, '00000$entry');
    }
    expect(attempts, 4);

    await enter(tester, issued);
    await tester.pumpAndSettle();
    expect(verifyCalls(wire), 5);
    expect(find.text(expired), findsNothing,
        reason: 'на старом клиенте код гас на третьем вводе');
    expect(find.text('Главная'), findsOneWidget,
        reason: 'верный код подтверждает почту');

    await tester.pumpWidget(const SizedBox.shrink());
  });
}
