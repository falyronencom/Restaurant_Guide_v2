import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_registration_screen.dart';

/// Мастер «Ваше заведение»: кухня у бара и клуба и выход из мастера.
///
/// - Кухня необязательна для бара и клуба (решение Координатора В5,
///   17.10.2026); бар, который ещё и ресторан, живёт по правилу ресторана.
/// - Нижняя «Назад» выглядела выключенной (п. 33), диалог выхода звался
///   «Выйти из регистрации?» (п. 35), системная «Назад» закрывала мастер без
///   вопроса (Х10) — находки тестировщика 17.10.2026.
void main() {
  group('кухня по категориям', () {
    bool cuisineStepPasses(List<String> categories) => PartnerRegistrationProvider(
          initialStep: 1,
          initialData: PartnerRegistration(categories: categories),
        ).canProceed();

    test('бар, клуб, бар и клуб — шаг кухни проходится без выбора', () {
      expect(cuisineStepPasses(['bar']), isTrue);
      expect(cuisineStepPasses(['nightclub']), isTrue);
      expect(cuisineStepPasses(['bar', 'nightclub']), isTrue);
    });

    test('ресторан, бар и ресторан, клуб и кафе, паб — без кухни не пройти', () {
      expect(cuisineStepPasses(['restaurant']), isFalse);
      expect(cuisineStepPasses(['bar', 'restaurant']), isFalse);
      expect(cuisineStepPasses(['nightclub', 'cafe_dining']), isFalse);
      expect(cuisineStepPasses(['pub']), isFalse);
    });

    test('без категории кухня нужна', () {
      expect(CategoryOptions.isCuisineRequired(const []), isTrue);
    });

    test('бар без кухни уходит на сервер пустым списком', () {
      const data = PartnerRegistration(categories: ['bar']);
      expect(data.toJson()['cuisines'], isEmpty);
      expect(data.toJson()['categories'], ['Бар']);
    });

    test('бар и клуб — те же категории, что на сервере', () {
      final names = CategoryOptions.items
          .where((c) => CategoryOptions.cuisineOptionalIds.contains(c.id))
          .map((c) => c.name)
          .toSet();
      expect(names, {'Бар', 'Клуб'});
    });
  });

  /// Профиль с открытым поверх него мастером.
  Future<void> openWizard(
    WidgetTester tester, {
    required int step,
    required PartnerRegistration data,
  }) async {
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => PartnerRegistrationScreen(
                    initialStep: step,
                    initialData: data,
                  ),
                ),
              ),
              child: const Text('Профиль'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Профиль'));
    await tester.pumpAndSettle();
  }

  PartnerRegistrationProvider wizard(WidgetTester tester) => tester
      .element(find.byType(PageView))
      .read<PartnerRegistrationProvider>();

  const hint = 'Бару и клубу кухню выбирать необязательно — '
      'можно сразу нажать «Продолжить».';

  group('шаг «Категория кухни»', () {
    testWidgets('у бара — подсказка, «Продолжить» ведёт дальше без кухни',
        (tester) async {
      await openWizard(tester,
          step: 1, data: const PartnerRegistration(categories: ['bar']));

      expect(find.text(hint), findsOneWidget);
      await tester.tap(find.text('Продолжить'));
      await tester.pumpAndSettle();
      expect(wizard(tester).currentStep, 2);
    });

    testWidgets('у ресторана подсказки нет и «Продолжить» не ведёт дальше',
        (tester) async {
      await openWizard(tester,
          step: 1, data: const PartnerRegistration(categories: ['restaurant']));

      expect(find.text(hint), findsNothing);
      await tester.tap(find.text('Продолжить'));
      await tester.pumpAndSettle();
      expect(wizard(tester).currentStep, 1);
    });
  });

  testWidgets('нижняя «Назад» — цветом текста, не цветом выключенной кнопки',
      (tester) async {
    await openWizard(tester,
        step: 1, data: const PartnerRegistration(categories: ['bar']));

    final label = tester.widget<Text>(find.text('Назад'));
    expect(label.style?.color, AppTheme.textPrimary);
    expect(label.style?.color, isNot(AppTheme.strokeGrey));
  });

  group('системная «Назад»', () {
    testWidgets('на втором шаге — шаг назад, мастер открыт', (tester) async {
      await openWizard(tester,
          step: 1, data: const PartnerRegistration(categories: ['bar']));

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.byType(PartnerRegistrationScreen), findsOneWidget);
      expect(wizard(tester).currentStep, 0);
    });

    testWidgets('на первом шаге с выбранной категорией — вопрос о выходе',
        (tester) async {
      await openWizard(tester,
          step: 0, data: const PartnerRegistration(categories: ['bar']));

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.text('Выйти из добавления заведения?'), findsOneWidget);
      expect(find.text('Выйти из регистрации?'), findsNothing);
      expect(find.byType(PartnerRegistrationScreen), findsOneWidget);

      await tester.tap(find.text('Выйти'));
      await tester.pumpAndSettle();
      expect(find.byType(PartnerRegistrationScreen), findsNothing);
      expect(find.text('Профиль'), findsOneWidget);
    });

    testWidgets('«Отмена» оставляет в мастере', (tester) async {
      await openWizard(tester,
          step: 0, data: const PartnerRegistration(categories: ['bar']));

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();

      expect(find.byType(PartnerRegistrationScreen), findsOneWidget);
    });

    testWidgets('на первом шаге без выбора — выход сразу', (tester) async {
      await openWizard(tester, step: 0, data: const PartnerRegistration());

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.byType(PartnerRegistrationScreen), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
    });
  });
}
