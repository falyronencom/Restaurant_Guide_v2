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

/// Экран кода подтверждения почты: над «Прислать код повторно» — подсказка
/// «Не пришёл код? Проверьте папку «Спам».» (слово Координатора 30.10.2026:
/// письмо с кодом пришло ему в «Спам» — у домена ещё нет сайта). Те же слова
/// — на сайте. На узком экране и при крупном шрифте строка целиком в экране
/// и не наезжает на кнопку.
void main() {
  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
  });

  test('слова подсказки', () {
    expect(EmailVerificationScreen.spamHint,
        'Не пришёл код? Проверьте папку «Спам».');
  });

  for (final (width, scale) in [
    (390.0, 1.0),
    (320.0, 1.0),
    (320.0, 2.0),
    (320.0, 3.1)
  ]) {
    testWidgets(
        '$width dp, шрифт ×$scale: подсказка над «Прислать код '
        'повторно», целиком в экране', (tester) async {
      installWireStand((_) => jsonBody({'success': false}, status: 404));
      installSecureStorageStand();
      final auth = (await tester.runAsync(() async {
        final provider = AuthProvider();
        for (var i = 0; i < 200 && provider.isLoading; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 5));
        }
        return provider;
      }))!;
      addTearDown(auth.dispose);

      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = Size(width, 900);
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
        value: auth,
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const EmailVerificationScreen(),
        ),
      ));
      await tester.pump();

      final hint = find.byKey(EmailVerificationScreen.spamHintKey);
      await tester.ensureVisible(hint);
      await tester.pump();
      expect(
          find.text('Не пришёл код? Проверьте папку «Спам».'), findsOneWidget);

      final hintRect = tester.getRect(hint);
      expect(hintRect.left, greaterThanOrEqualTo(0));
      expect(hintRect.right, lessThanOrEqualTo(width));

      final resend = find.textContaining('Прислать код повторно');
      expect(resend, findsOneWidget);
      expect(hintRect.bottom, lessThanOrEqualTo(tester.getRect(resend).top));

      // Подсказка — не повтор подзаголовка: «Спам» назван на экране один раз.
      expect(find.textContaining('пам'), findsOneWidget);

      // Шесть клеток кода — в экране: шесть по 50 dp на 320 уходили за край.
      final boxes = find.byType(TextFormField);
      expect(boxes, findsNWidgets(6));
      expect(tester.getRect(boxes.at(0)).left, greaterThanOrEqualTo(0));
      expect(tester.getRect(boxes.at(5)).right, lessThanOrEqualTo(width));
    });
  }
}
