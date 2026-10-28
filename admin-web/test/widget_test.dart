import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/main.dart';
import 'package:restaurant_guide_admin_web/screens/auth/login_screen.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

import 'helpers/wire_stand.dart';

// Приложение целиком, как его запускает `main()`.
//
// До 25.10.2026 здесь стояла заглушка из шаблона (`1 + 1 == 2`) под именем
// «smoke test»: `AdminApp` не строил ни один тест, и правка его сборки —
// язык, делегаты локализации, роутер — проходила бы мимо всех. Состав
// провайдеров держит отдельный сторож (`config/account_scope_guard_test`).
void main() {
  setUp(() {
    AccountScope.debugReset();
    SessionEvents.debugReset();
  });

  tearDown(AccountScope.debugReset);

  testWidgets('приложение собирается: без сессии — вход, и по-русски',
      (tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    // Хранилище токенов пустое: сессии нет, в сеть ходить незачем.
    installSecureStorageStand();

    await tester.pumpWidget(const AdminApp());
    await tester.pumpAndSettle();

    expect(find.byType(LoginScreen), findsOneWidget);
    final context = tester.element(find.byType(LoginScreen));
    // Встроенные тексты Material (окно выбора дат журнала, подсказки полей)
    // говорят языком приложения — русским.
    expect(Localizations.localeOf(context), const Locale('ru'));
    expect(MaterialLocalizations.of(context).cancelButtonLabel, 'Отмена');
  });
}
