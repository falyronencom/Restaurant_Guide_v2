import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_location_block.dart';

/// Блок «Карта» на карточке заведения.
///
/// Тестировщики 15.09.2026: под заголовком «Карта» адрес выглядел как место,
/// по которому логично тапнуть, чтобы уехать в навигатор, — и не делал ничего.
/// Кликабельной была только мини-карта под блоком, и ведёт она на внутренний
/// экран карты, а не в навигатор.
///
/// Тесты пиннят разведение намерений: адресная строка и кнопка «Как добраться»
/// ведут в один и тот же выбор карт, а без координат кнопки нет вовсе.
void main() {
  setUp(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  /// Строка адреса — ближайшая к тексту адреса коробка `Container`.
  Finder addressRowOf(String text) => find
      .ancestor(of: find.text(text), matching: find.byType(Container))
      .first;

  Future<void> pumpBlock(
    WidgetTester tester, {
    VoidCallback? onAddressTap,
    String? distanceText,
    bool showRouteButton = true,
    String address = 'Козлова, 2',
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(390, 700);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: EstablishmentLocationBlock(
            address: address,
            city: 'Минск',
            distanceText: distanceText,
            showRouteButton: showRouteButton,
            onAddressTap: onAddressTap ?? () {},
          ),
        ),
      ),
    );
  }

  group('EstablishmentLocationBlock', () {
    testWidgets('тап по строке адреса ведёт в навигатор', (tester) async {
      var taps = 0;
      await pumpBlock(tester, onAddressTap: () => taps++);

      await tester.tap(find.text('Козлова, 2, Минск'));

      expect(taps, 1, reason: 'адрес под «Картой» был мёртвым текстом');
    });

    testWidgets('кнопка «Как добраться» ведёт туда же', (tester) async {
      var taps = 0;
      await pumpBlock(tester, onAddressTap: () => taps++);

      await tester.tap(find.text('Как добраться'));

      expect(taps, 1);
    });

    testWidgets('строка адреса не ниже зоны тапа', (tester) async {
      // Адрес намеренно короткий: шрифт widget-тестов квадратный, каждый знак
      // шириной в кегль, и «Козлова, 2, Минск» переносится на вторую строку —
      // высота набралась бы содержимым, а проверка зоны тапа зеленела бы
      // независимо от того, задана она или нет.
      await pumpBlock(tester, address: 'Мира, 1');

      final row = tester.getRect(addressRowOf('Мира, 1, Минск'));

      expect(row.height,
          greaterThanOrEqualTo(EstablishmentLocationBlock.minTapHeight),
          reason: 'на устройстве строка в одну линию — 40 dp без запаса');
    });

    testWidgets('без координат кнопки нет, адрес остаётся кликабельным',
        (tester) async {
      var taps = 0;
      await pumpBlock(
        tester,
        onAddressTap: () => taps++,
        showRouteButton: false,
      );

      expect(find.text('Как добраться'), findsNothing,
          reason:
              'маршрут прокладывать некуда — кнопка обещала бы несбыточное');

      await tester.tap(find.text('Козлова, 2, Минск'));
      expect(taps, 1, reason: 'адрес всё ещё ведёт к копированию');
    });

    testWidgets('расстояние рисуется только когда известно', (tester) async {
      await pumpBlock(tester);
      expect(find.textContaining('км от вас'), findsNothing);

      await pumpBlock(tester, distanceText: '5.1 км от вас');
      expect(find.text('5.1 км от вас'), findsOneWidget);
    });
  });
}
