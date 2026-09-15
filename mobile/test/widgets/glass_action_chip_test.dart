import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/widgets/glass_action_chip.dart';

/// Чипы адреса, телефона и сайта на фото-герое карточки заведения.
///
/// Тестировщики 15.09.2026: адрес и телефон не читались как кнопки, хотя тап
/// там был. Подчёркивание сигналом не работало, а зона тапа равнялась высоте
/// текста — около 19 dp при рекомендованных платформой 44.
///
/// Длинный адрес — вторая половина дефекта: чип получает в `Wrap` всю ширину
/// строки, и без сжимаемого слота текст уезжает за край экрана.
void main() {
  /// Ширина экрана iPhone 14 минус горизонтальные отступы оверлея (17 + 17).
  const double overlayWidth = 390 - 34;

  Future<void> pumpChips(WidgetTester tester, List<Widget> chips) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(390, 700);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 17),
            child: Wrap(spacing: 8, runSpacing: 8, children: chips),
          ),
        ),
      ),
    );
  }

  group('GlassActionChip', () {
    testWidgets('чип не ниже зоны тапа платформы', (tester) async {
      await pumpChips(tester, [
        GlassActionChip(
          icon: Icons.place_outlined,
          label: 'Козлова, 2',
          onTap: () {},
        ),
      ]);

      final chip = tester.getRect(find.byType(GlassActionChip));

      expect(chip.height, greaterThanOrEqualTo(GlassActionChip.minTapHeight),
          reason: 'прежняя строка адреса ловила тап высотой текста, ≈19 dp');
    });

    testWidgets('длинный адрес остаётся внутри экрана', (tester) async {
      await pumpChips(tester, [
        GlassActionChip(
          icon: Icons.place_outlined,
          label: 'проспект Независимости, 58, корпус 2, помещение 14Н',
          onTap: () {},
          maxLines: 2,
        ),
      ]);

      final chip = tester.getRect(find.byType(GlassActionChip));

      expect(chip.width, lessThanOrEqualTo(overlayWidth));
      expect(chip.height, greaterThan(GlassActionChip.minTapHeight),
          reason: 'адрес переносится на вторую строку, а не режется');
    });

    testWidgets('тап зовёт действие', (tester) async {
      var taps = 0;
      await pumpChips(tester, [
        GlassActionChip(
          icon: Icons.phone,
          label: '+375 29 323-53-92',
          onTap: () => taps++,
        ),
      ]);

      await tester.tap(find.byType(GlassActionChip));
      expect(taps, 1);
    });
  });
}
