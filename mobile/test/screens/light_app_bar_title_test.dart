import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_menu_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/notification_preferences_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/fake_api_client.dart';
import '../support/wire_stand.dart';

/// Шапки со светлым фоном: заголовок рисовался белым.
///
/// Тема приложения задаёт `appBarTheme.titleTextStyle` с белым цветом (для
/// оранжевой шапки по умолчанию), и он перекрывает `foregroundColor` экрана.
/// Кабинет → Редактирование → «Меню» (Galaxy A72, 10.10.2026) и Профиль →
/// «Настройки уведомлений» показывали заголовок белым по светлому.
///
/// Мерится цвет, которым текст НАРИСОВАН (стиль абзаца после слияния с
/// темой), против фона шапки — по контрасту WCAG, не по коду экрана.
void main() {
  setUp(AccountScope.debugReset);

  double luminance(Color c) => c.computeLuminance();
  double contrast(Color a, Color b) {
    final hi = math.max(luminance(a), luminance(b));
    final lo = math.min(luminance(a), luminance(b));
    return (hi + 0.05) / (lo + 0.05);
  }

  /// Контраст заголовка [title] к фону шапки, в которой он стоит.
  double titleContrast(WidgetTester tester, String title) {
    final appBarFinder = find.byType(AppBar);
    final paragraph = tester.renderObject<RenderParagraph>(find.descendant(
      of: appBarFinder,
      matching: find.byWidgetPredicate(
          (w) => w is RichText && w.text.toPlainText() == title),
    ));
    final textColor = paragraph.text.style!.color!;
    final material = tester.widget<Material>(find
        .descendant(of: appBarFinder, matching: find.byType(Material))
        .first);
    return contrast(textColor, material.color!);
  }

  testWidgets('Кабинет → «Меню»: заголовок читается на фоне шапки',
      (tester) async {
    installWireStand((_) => jsonBody({'success': true, 'data': <dynamic>[]}));

    final provider = PartnerMenuProvider();
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const PartnerMenuScreen(
          establishmentId: '33333333-3333-4333-8333-333333333333',
        ),
      ),
    ));
    await tester.pumpAndSettle(); // загрузка списка доходит до конца

    expect(titleContrast(tester, 'Меню'), greaterThanOrEqualTo(3.0));

    // Экран останавливает опрос в dispose через провайдер — закрываем его,
    // пока провайдер ещё в дереве.
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: const SizedBox(),
    ));
  });

  testWidgets('Профиль → «Настройки уведомлений»: заголовок читается',
      (tester) async {
    final provider = NotificationPreferencesProvider(
      apiClient: FakeApiClient()
        ..prefsFromServer = <String, dynamic>{
          'booking_push_enabled': true,
          'reviews_push_enabled': true,
          'promotions_push_enabled': true,
          'menu_push_enabled': true,
        },
    );
    addTearDown(provider.dispose);

    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const NotificationPreferencesScreen(),
      ),
    ));
    await tester.pump();
    await tester.pump();

    expect(titleContrast(tester, 'Настройки уведомлений'),
        greaterThanOrEqualTo(3.0));
  });
}
