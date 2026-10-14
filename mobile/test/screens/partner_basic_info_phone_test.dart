import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/basic_info_step.dart';

import '../support/wire_stand.dart';

/// Что партнёр видит под полем телефона на шаге «О заведении».
///
/// Кнопка «Продолжить» при неверном номере просто сереет — без подписи
/// партнёр не узнал бы почему. Тест вводит номер в само поле: так проходит
/// весь путь — форматирование поля, запись в провайдер, проверка, подпись.
/// Правило и подписи — `partner_registration_phone_step_test.dart`.
const _codeMessage = 'Неверный код после +375. Мобильный: 25, 29, 33 или 44; '
    'городской: код города — 17 Минск, 152 Гродно, 232 Гомель… '
    'Номер вида 8 017… вводите как +375 17…';

final _phoneField = find.byWidgetPredicate(
  (w) => w is TextField && w.decoration?.hintText == '+375 29 123 45 67',
);

void main() {
  setUp(() {
    installWireStand((_) => jsonBody({'success': false}, status: 500));
  });

  testWidgets(
      'номер через 8 — подпись и стоп; городской номер — подпись уходит',
      (tester) async {
    final provider = PartnerRegistrationProvider(
      initialStep: 2,
      initialData: const PartnerRegistration(
        name: 'Кофейня у моста',
        priceRange: r'$$',
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChangeNotifierProvider.value(
            value: provider,
            child: const BasicInfoStep(),
          ),
        ),
      ),
    );

    await tester.enterText(_phoneField, '8 029 123 45 67');
    await tester.pump();

    expect(find.text('+375 80 291 23 45'), findsOneWidget);
    expect(provider.data.phone, '+375802912345');
    expect(find.text(_codeMessage), findsOneWidget);
    expect(provider.canProceed(), isFalse);

    await tester.enterText(_phoneField, '+375 17 123 45 67');
    await tester.pump();

    expect(provider.data.phone, '+375171234567');
    expect(find.text(_codeMessage), findsNothing);
    expect(find.textContaining('После +375'), findsNothing);
    expect(provider.canProceed(), isTrue);
  });

  testWidgets(
      'номер, записанный в базе со скобками и дефисами, проверяется таким, '
      'каким его видит партнёр', (tester) async {
    // Старые скрипты наполнения писали «+375 (29) 123-45-67» прямо в базу.
    // Поле показывает его отформатированным; без передачи в провайдер шаг
    // проверял бы и отправлял сырой номер — подпись «неверный код» под
    // аккуратным номером, «Сохранить» серое.
    final provider = PartnerRegistrationProvider(
      editMode: true,
      establishmentId: '11111111-2222-3333-4444-555555555555',
      initialStep: 2,
      initialData: const PartnerRegistration(
        name: 'Кофейня у моста',
        priceRange: r'$$',
        phone: '+375 (29) 123-45-67',
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChangeNotifierProvider.value(
            value: provider,
            child: const BasicInfoStep(),
          ),
        ),
      ),
    );
    await tester.pump();

    // По тексту не искать: образец в пустом поле — тот же «+375 29 123 45 67».
    expect(
      tester.widget<TextField>(_phoneField).controller!.text,
      '+375 29 123 45 67',
    );
    expect(provider.data.phone, '+375291234567');
    expect(find.text(_codeMessage), findsNothing);
    expect(provider.canProceed(), isTrue);
  });
}
