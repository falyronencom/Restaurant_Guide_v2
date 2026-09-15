import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/widgets/filter_icon_button.dart';

/// Геометрия индикатора активных фильтров.
///
/// Дефект, найденный на устройстве 15.09.2026: индикатор читался как капля с
/// острым углом. Причина не в форме — круг рисовался целым, но `Stack` со
/// значением `clipBehavior` по умолчанию (`Clip.hardEdge`) срезал всё, что
/// вышло за коробку кнопки: 4 px справа и 2 px сверху. Два прямых среза
/// встречались ровно в углу кнопки, и прямой угол спорил со скруглением.
///
/// Каждая из трёх проверок ниже красная на прежнем коде — это и есть их смысл:
/// срез, прямоугольная коробка индикатора (18×22 из-за `padding` и высоты
/// строки, отчего видимый отступ расходился с заявленным) и посадка «на глаз»
/// вместо посадки на дугу скругления.
void main() {
  /// Индикатор — ближайшая к тексту счётчика коробка `Container`.
  Finder badgeOf(String count) => find
      .ancestor(of: find.text(count), matching: find.byType(Container))
      .first;

  Future<void> pumpButton(
    WidgetTester tester, {
    required int activeCount,
    VoidCallback? onTap,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: FilterIconButton(
              activeCount: activeCount,
              onTap: onTap ?? () {},
            ),
          ),
        ),
      ),
    );
  }

  group('FilterIconButton', () {
    testWidgets('коробка индикатора строго квадратная', (tester) async {
      await pumpButton(tester, activeCount: 4);

      final badge = tester.getRect(badgeOf('4'));

      expect(badge.width, FilterIconButton.badgeDiameter);
      expect(badge.height, FilterIconButton.badgeDiameter,
          reason: 'BoxShape.circle рисует круг по КОРОТКОЙ стороне: у '
              'прямоугольной коробки заявленный отступ и видимый расходятся');
    });

    testWidgets('центр индикатора сидит на дуге скругления угла',
        (tester) async {
      await pumpButton(tester, activeCount: 4);

      final button = tester.getRect(find.byType(FilterIconButton));
      final badge = tester.getRect(badgeOf('4'));

      // Центр дуги правого верхнего угла и точка этой дуги под 45°.
      const r = FilterIconButton.cornerRadius;
      final arcCentre = Offset(button.right - r, button.top + r);
      final onArc = arcCentre +
          const Offset(FilterIconButton.cornerRadius / math.sqrt2,
              -FilterIconButton.cornerRadius / math.sqrt2);

      expect((badge.center - onArc).distance, lessThan(0.01),
          reason: 'посадка индикатора должна выводиться из скругления кнопки, '
              'а не назначаться отступом на глаз');
    });

    testWidgets('индикатор выходит за кнопку и НЕ срезается', (tester) async {
      await pumpButton(tester, activeCount: 4);

      final button = tester.getRect(find.byType(FilterIconButton));
      final badge = tester.getRect(badgeOf('4'));

      // Сначала — что резать вообще есть что: без выхода за границы проверка
      // среза ничего не значила бы.
      expect(badge.top, lessThan(button.top));
      expect(badge.right, greaterThan(button.right));

      final stack = tester.widget<Stack>(
        find.descendant(
          of: find.byType(FilterIconButton),
          matching: find.byType(Stack),
        ),
      );
      expect(stack.clipBehavior, Clip.none,
          reason: 'Clip.hardEdge по умолчанию срезает круг двумя прямыми');
    });

    testWidgets('без активных фильтров индикатора нет', (tester) async {
      await pumpButton(tester, activeCount: 0);

      expect(find.text('0'), findsNothing);
      expect(find.byIcon(Icons.tune), findsOneWidget);
    });

    testWidgets('счётчик показывает число и тап уходит наружу', (tester) async {
      var taps = 0;
      await pumpButton(tester, activeCount: 6, onTap: () => taps++);

      expect(find.text('6'), findsOneWidget);

      await tester.tap(find.byType(FilterIconButton));
      expect(taps, 1);
    });
  });
}
