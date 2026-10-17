// Карта «Избранного» (`FavoritesMap`, этап 3).
//
// Нативная карта в тестах не рождается (канал platform_views заглушен), но
// виджет YandexMap строится — и пины, которые ему переданы, читаются из
// дерева. Нажатие по пину — вызов его собственного onTap, тот же путь, что у
// нажатия на телефоне. Положение камеры и вид пинов — телефон.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/action_sheet.dart';
import 'package:restaurant_guide_mobile/widgets/favorites/favorites_map.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_map_preview.dart';
import 'package:yandex_mapkit/yandex_mapkit.dart';

Establishment _place(String id, {double? lat, double? lng}) => Establishment(
      id: id,
      name: 'Место $id',
      category: 'Ресторан',
      address: 'пр. Независимости, 43',
      city: 'Минск',
      status: 'active',
      latitude: lat,
      longitude: lng,
      createdAt: DateTime(2026, 10, 17),
      updatedAt: DateTime(2026, 10, 17),
    );

final _a = _place('a', lat: 53.90, lng: 27.50);
final _b = _place('b', lat: 53.91, lng: 27.51);
final _noCoords = _place('без координат');
final _d = _place('d', lat: 53.93, lng: 27.53);

void main() {
  setUp(() {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
        SystemChannels.platform_views, (_) async => null);
    addTearDown(() => messenger.setMockMethodCallHandler(
        SystemChannels.platform_views, null));
  });

  late List<Establishment> opened;

  Future<void> pumpMap(WidgetTester tester, List<Establishment> places) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: FavoritesMap(
          establishments: places,
          onDetails: opened.add,
        ),
      ),
    ));
    await tester.pump();
  }

  setUp(() => opened = []);

  YandexMap mapWidget(WidgetTester tester) =>
      tester.widget<YandexMap>(find.byType(YandexMap));

  List<PlacemarkMapObject> pins(WidgetTester tester) {
    final collection =
        mapWidget(tester).mapObjects.single as MapObjectCollection;
    return collection.mapObjects.cast<PlacemarkMapObject>();
  }

  List<String> pinIds(WidgetTester tester) =>
      [for (final p in pins(tester)) p.mapId.value];

  Future<void> tapPin(WidgetTester tester, String id) async {
    final pin = pins(tester).singleWhere((p) => p.mapId.value == 'marker_$id');
    pin.onTap!(pin, pin.point);
    await tester.pump();
  }

  final preview = find.byType(EstablishmentMapPreview);

  testWidgets('пины — все места с координатами, без координат — нет',
      (tester) async {
    await pumpMap(tester, [_a, _noCoords, _b]);
    expect(pinIds(tester), ['marker_a', 'marker_b']);
    expect(preview, findsNothing);
  });

  testWidgets('тап по пину — карточка этого места, пин выбран', (tester) async {
    await pumpMap(tester, [_a, _b]);
    await tapPin(tester, 'a');

    expect(preview, findsOneWidget);
    expect(find.text('Место a'), findsOneWidget);
    expect(find.byType(RouteButton), findsOneWidget,
        reason: '«Маршрут» рядом с «Подробнее»');
    // Выбранный — последним и выше: жёлтый маркер рисуется поверх.
    expect(pinIds(tester).last, 'marker_a');
    expect(pins(tester).last.zIndex, 1.0);
  });

  testWidgets('«✕» — карточка закрыта, пин прежний', (tester) async {
    await pumpMap(tester, [_a, _b]);
    await tapPin(tester, 'b');
    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();

    expect(preview, findsNothing);
    expect(pins(tester).every((p) => p.zIndex == 0.0), isTrue);
  });

  testWidgets('«Подробнее» — переход к этому месту, карточка закрыта',
      (tester) async {
    await pumpMap(tester, [_a, _b]);
    await tapPin(tester, 'b');
    await tester.tap(find.text('Подробнее'));
    await tester.pump();

    expect(opened.map((e) => e.id), ['b']);
    expect(preview, findsNothing);
  });

  testWidgets('двойное нажатие «Подробнее» до кадра — один переход',
      (tester) async {
    await pumpMap(tester, [_a, _b]);
    await tapPin(tester, 'a');
    final details = tester.widget<ElevatedButton>(
        find.widgetWithText(ElevatedButton, 'Подробнее'));
    details.onPressed!();
    details.onPressed!();
    await tester.pump();

    expect(opened.map((e) => e.id), ['a']);
  });

  testWidgets(
      'место убрали из избранного, пока карточка открыта, — пина нет, '
      'карточка закрыта', (tester) async {
    await pumpMap(tester, [_a, _b]);
    await tapPin(tester, 'b');
    expect(preview, findsOneWidget);

    await pumpMap(tester, [_a]);
    expect(pinIds(tester), ['marker_a']);
    expect(preview, findsNothing);
    expect(find.text('Место b'), findsNothing);
  });

  testWidgets(
      'место убрали и вернули — его карточка сама не всплывает: выбор '
      'сброшен вместе с местом', (tester) async {
    await pumpMap(tester, [_a, _b]);
    await tapPin(tester, 'b');

    await pumpMap(tester, [_a]);
    await pumpMap(tester, [_a, _b]);
    expect(preview, findsNothing);
    expect(pins(tester).every((p) => p.zIndex == 0.0), isTrue);
  });

  testWidgets('у открытого места пропали координаты — пина и карточки нет',
      (tester) async {
    await pumpMap(tester, [_a, _b]);
    await tapPin(tester, 'b');

    await pumpMap(tester, [_a, _place('b')]);
    expect(pinIds(tester), ['marker_a']);
    expect(preview, findsNothing);
  });

  testWidgets('убрали другое место — карточка открытого остаётся',
      (tester) async {
    await pumpMap(tester, [_a, _b]);
    await tapPin(tester, 'a');

    await pumpMap(tester, [_a]);
    expect(find.text('Место a'), findsOneWidget);
    expect(pinIds(tester), ['marker_a']);
  });

  testWidgets('добавленное место появляется пином', (tester) async {
    await pumpMap(tester, [_a]);
    await pumpMap(tester, [_a, _d]);
    expect(pinIds(tester), ['marker_a', 'marker_d']);
  });

  testWidgets(
      'те же места новым списком — виджет карты тот же: пины плагин заново '
      'не сравнивает', (tester) async {
    await pumpMap(tester, [_a, _b]);
    final before = mapWidget(tester);
    await pumpMap(tester, [_place('a', lat: 53.90, lng: 27.50), _b]);
    expect(identical(mapWidget(tester), before), isTrue);

    await pumpMap(tester, [_a, _b, _d]);
    expect(identical(mapWidget(tester), before), isFalse,
        reason: 'состав сменился — карта получает новые пины');
  });
}
