import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/legal_info_step.dart';

import '../support/wire_stand.dart';

/// Шаг «Ваши данные» мастера партнёра: под полями УНП и e-mail — почему
/// «Продолжить» серая.
///
/// Находка № 11 нитки «Часы работы» (Координатор, 11.11.2026: «предлагаю
/// реализовать находку № 11»): при УНП короче 9 цифр или почте не по формату
/// кнопка просто серела, текста у полей не было. Тексты — первые фразы
/// утверждённых отказов сервера (`unpInvalid`, `contactEmailInvalid`); здесь
/// литералами. Как у телефона на шаге «О заведении»: пустое поле — без
/// подписи, подпись видна и во время ввода.
const _unpText = 'УНП — это 9 цифр.';
const _emailText = 'Адрес электронной почты указан неверно.';

PartnerRegistration _card({String unp = '123456789', String email = 'anna@example.com'}) =>
    PartnerRegistration(
      legalName: 'ООО «Мост»',
      unp: unp,
      contactPerson: '+375291234567',
      contactEmail: email,
    );

final _unpField = find.byWidgetPredicate(
    (w) => w is TextField && w.decoration?.hintText == '9 символов',
    description: 'поле УНП');
final _emailField = find.byWidgetPredicate(
    (w) => w is TextField && w.decoration?.hintText == 'E-mail',
    description: 'поле e-mail');

void main() {
  setUp(() => installWireStand((_) => jsonBody({'success': true})));

  Future<PartnerRegistrationProvider> open(
    WidgetTester tester,
    PartnerRegistration data,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(400, 1600);
    addTearDown(tester.view.reset);
    final provider =
        PartnerRegistrationProvider(initialStep: 5, initialData: data);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ChangeNotifierProvider.value(
          value: provider,
          child: const LegalInfoStep(),
        ),
      ),
    ));
    return provider;
  }

  group('УНП', () {
    testWidgets('8 цифр — подпись, «Продолжить» серая', (tester) async {
      final provider = await open(tester, _card(unp: '12345678'));
      expect(find.text(_unpText), findsOneWidget);
      expect(provider.canProceed(), isFalse);
    });

    testWidgets('9 цифр — подписи нет', (tester) async {
      final provider = await open(tester, _card());
      expect(find.text(_unpText), findsNothing);
      expect(provider.canProceed(), isTrue);
    });

    testWidgets('пустое поле — подписи нет, как у телефона', (tester) async {
      await open(tester, _card(unp: ''));
      expect(find.text(_unpText), findsNothing);
    });

    testWidgets('подпись видна во время ввода и уходит на девятой цифре',
        (tester) async {
      await open(tester, _card(unp: ''));

      await tester.enterText(_unpField, '1234');
      await tester.pump();
      expect(find.text(_unpText), findsOneWidget);

      await tester.enterText(_unpField, '123456789');
      await tester.pump();
      expect(find.text(_unpText), findsNothing);
    });
  });

  group('e-mail', () {
    testWidgets('без «@» — подпись, «Продолжить» серая', (tester) async {
      final provider = await open(tester, _card(email: 'anna.example.com'));
      expect(find.text(_emailText), findsOneWidget);
      expect(provider.canProceed(), isFalse);
    });

    testWidgets('верный адрес — подписи нет', (tester) async {
      await open(tester, _card());
      expect(find.text(_emailText), findsNothing);
    });

    testWidgets('пустое поле — подписи нет', (tester) async {
      await open(tester, _card(email: ''));
      expect(find.text(_emailText), findsNothing);
    });

    testWidgets('подпись уходит, когда адрес дописан', (tester) async {
      await open(tester, _card(email: ''));

      await tester.enterText(_emailField, 'anna@example');
      await tester.pump();
      expect(find.text(_emailText), findsOneWidget);

      await tester.enterText(_emailField, 'anna@example.com');
      await tester.pump();
      expect(find.text(_emailText), findsNothing);
    });
  });

  testWidgets('ошибки в обоих полях — обе подписи, каждая под своим полем',
      (tester) async {
    await open(tester, _card(unp: '123', email: 'anna'));
    expect(find.text(_unpText), findsOneWidget);
    expect(find.text(_emailText), findsOneWidget);
    // Подпись УНП — выше поля e-mail, подпись e-mail — ниже него.
    final unpTextY = tester.getTopLeft(find.text(_unpText)).dy;
    final emailFieldY = tester.getTopLeft(_emailField).dy;
    final emailTextY = tester.getTopLeft(find.text(_emailText)).dy;
    expect(unpTextY, lessThan(emailFieldY));
    expect(emailTextY, greaterThan(emailFieldY));
  });
}
