import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/profile_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// «Связаться с тех. поддержкой» показывает адрес, на который письмо дойдёт.
///
/// До 12.10.2026 экран показывал `support@niriveo.by` — опечатка в имени
/// домена (`niriveo` вместо `nirivio`); письмо на такой адрес не доходит.
/// Найдено при сверке публичного репозитория перед показом кода сторонним
/// разработчикам. Проверяется весь текст подсказки, а не наличие слова
/// «nirivio»: опечатка сидела именно в домене, и частичное совпадение её бы
/// пропустило.
void main() {
  setUp(() {
    AccountScope.debugReset();
    // Гость: экран профиля ничего не грузит, но транспорт всё равно
    // подставной — чтобы случайный запрос не ушёл в сеть.
    installWireStand((_) => jsonBody(<String, dynamic>{}, status: 404));
  });

  testWidgets('подсказка поддержки называет адрес на домене nirivio.by',
      (tester) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => AuthProvider()),
          ChangeNotifierProvider(create: (_) => PartnerDashboardProvider()),
          ChangeNotifierProvider(create: (_) => NotificationProvider()),
        ],
        child: const MaterialApp(home: ProfileScreen()),
      ),
    );
    await tester.pump();

    final item = find.text('Связаться с тех. поддержкой');
    await tester.scrollUntilVisible(item, 200);
    await tester.tap(item);
    // Снекбар выезжает анимацией.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 750));

    expect(find.text('Поддержка: support@nirivio.by'), findsOneWidget);
  });
}
