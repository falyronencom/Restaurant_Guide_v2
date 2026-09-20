import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_location_block.dart';

/// Блок «Карта» на карточке заведения.
///
/// Тестировщики 15.09.2026: под заголовком «Карта» адрес выглядел как место,
/// по которому логично тапнуть, чтобы уехать в навигатор, — и не делал ничего.
/// Кликабельной была только мини-карта, и ведёт она на внутренний экран карты.
///
/// Первая правка дала блоку ДВА контрола: строку-кнопку с адресом и кнопку
/// «Как добраться», обе в один и тот же выбор карт. На устройстве 20.09 стало
/// видно, что это хуже дубля: шеврон на строке обещает «перейти куда-то ещё»,
/// а приводит туда же, куда кнопка. Контрол оставлен один.
///
/// Отсюда форма проверок: адрес обязан БЫТЬ и обязан НЕ БЫТЬ кнопкой.
void main() {
  setUp(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  Future<void> pumpBlock(
    WidgetTester tester, {
    VoidCallback? onRouteTap,
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
            onRouteTap: onRouteTap ?? () {},
          ),
        ),
      ),
    );
  }

  group('EstablishmentLocationBlock', () {
    testWidgets('кнопка «Как добраться» ведёт в навигатор', (tester) async {
      var taps = 0;
      await pumpBlock(tester, onRouteTap: () => taps++);

      await tester.tap(find.text('Как добраться'));

      expect(taps, 1);
    });

    testWidgets('адрес показан, но кнопкой не является', (tester) async {
      var taps = 0;
      await pumpBlock(tester, onRouteTap: () => taps++);

      expect(find.text('Козлова, 2, Минск'), findsOneWidget,
          reason: 'адрес — содержание блока, без него «Карта» не говорит, где');

      await tester.tap(find.text('Козлова, 2, Минск'));
      await tester.pump();

      expect(taps, 0,
          reason: 'второй контрол в то же действие возвращает расхождение '
              'обещания с результатом — ради этого его и убрали');
      expect(find.byIcon(Icons.chevron_right), findsNothing,
          reason: 'шеврон обещает переход, которого нет');
    });

    testWidgets('кнопка маршрута не ниже зоны тапа', (tester) async {
      await pumpBlock(tester);

      // `ElevatedButton.icon` строит ПОДКЛАСС, а `byType` сверяет тип
      // точно — отсюда предикат.
      final button = tester.getRect(
        find.byWidgetPredicate(
          (w) => w is ElevatedButton,
          description: 'ElevatedButton, включая .icon',
        ),
      );

      expect(button.height,
          greaterThanOrEqualTo(EstablishmentLocationBlock.minTapHeight),
          reason: 'единственный контрол блока держит зону тапа сам');
    });

    testWidgets('без координат кнопки нет, адрес остаётся', (tester) async {
      await pumpBlock(tester, showRouteButton: false);

      expect(find.text('Как добраться'), findsNothing,
          reason: 'маршрут прокладывать некуда — кнопка обещала бы несбыточное');
      expect(find.text('Козлова, 2, Минск'), findsOneWidget,
          reason: 'адрес от отсутствия координат не пропадает');
    });

    testWidgets('расстояние рисуется только когда известно', (tester) async {
      await pumpBlock(tester);
      expect(find.textContaining('км от вас'), findsNothing);

      await pumpBlock(tester, distanceText: '5.1 км от вас');
      expect(find.text('5.1 км от вас'), findsOneWidget);
    });
  });
}
