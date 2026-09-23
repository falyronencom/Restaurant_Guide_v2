import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/results_list_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/search_home_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/widgets/filter_icon_button.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Индикатор фильтров на ЖИВОЙ главной, а не на стенде виджета.
///
/// Стенд не отвечает на главный вопрос этой правки: срез приходит не от самого
/// индикатора, а от ПРЕДКА. На стенде предков нет по построению, и проверка
/// `clipBehavior` там говорит только о собственном `Stack` кнопки. Любой
/// `ClipRect`, `ClipRRect`, прокрутка или чужой `Stack` выше по дереву срезал бы
/// круг снова — стенд остался бы зелёным, а на устройстве вернулся бы острый
/// угол.
///
/// Поэтому здесь проверяется вся цепочка отрисовки: у каждого предка
/// спрашивается его обрезка (`describeApproximatePaintClip` — та же, которой
/// пользуется отладочный инспектор), и она обязана вмещать прямоугольник
/// индикатора целиком.
void main() {
  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
  });

  testWidgets('индикатор выходит за кнопку, и ни один предок его не режет',
      (tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.reset);

    installWireStand((_) => jsonBody(searchEnvelope()));

    final establishments = EstablishmentsProvider();
    addTearDown(establishments.dispose);
    final smart = SmartSearchProvider();
    addTearDown(smart.dispose);

    // Два вида фильтров — счётчик показывает «2».
    establishments.toggleCategoryFilter('Бар');
    establishments.togglePriceFilter(PriceRange.budget);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<EstablishmentsProvider>.value(
            value: establishments,
          ),
          ChangeNotifierProvider<SmartSearchProvider>.value(value: smart),
        ],
        child: const MaterialApp(home: SearchHomeScreen()),
      ),
    );
    // Post-frame цепочка главной: город из хранилища, отказ геолокации.
    await tester.pump();
    await tester.pump();

    expect(find.text('2'), findsOneWidget, reason: 'счётчик на экране');

    final button = tester.getRect(find.byType(FilterIconButton));
    final badgeFinder = find
        .ancestor(of: find.text('2'), matching: find.byType(Container))
        .first;
    final badge = tester.getRect(badgeFinder);

    // Сначала — что резать есть что. Без выноса за кнопку проверка ниже
    // зеленела бы независимо от обрезки.
    expect(badge.top, lessThan(button.top));
    expect(badge.right, greaterThan(button.right));

    final culprit =
        _clippingAncestorOf(tester.renderObject<RenderBox>(badgeFinder));

    expect(culprit, isNull,
        reason: 'обрезка предка вернула бы индикатору прямой угол в точке '
            'угла кнопки — ровно тот дефект, ради которого правка делалась');
  });

  testWidgets('то же на экране результатов: шапка индикатор не режет',
      (tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.reset);

    installWireStand((_) => jsonBody(searchEnvelope()));

    final establishments = EstablishmentsProvider();
    addTearDown(establishments.dispose);

    establishments.toggleCategoryFilter('Бар');
    establishments.togglePriceFilter(PriceRange.budget);

    await tester.pumpWidget(
      ChangeNotifierProvider<EstablishmentsProvider>.value(
        value: establishments,
        child: const MaterialApp(home: ResultsListScreen()),
      ),
    );
    // Экран запрашивает выдачу сам, в post-frame.
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }

    // Шапка экрана результатов держит кнопку фильтров в коробке высотой
    // `43 * shrinkFactor` — там вынос индикатора вверх рискует попасть под
    // чужую обрезку сильнее, чем на главной.
    final badgeFinder = find
        .ancestor(of: find.text('2'), matching: find.byType(Container))
        .first;
    expect(badgeFinder, findsOneWidget, reason: 'счётчик в шапке результатов');

    final button = tester.getRect(find.byType(FilterIconButton));
    final badge = tester.getRect(badgeFinder);
    expect(badge.top, lessThan(button.top));

    final culprit =
        _clippingAncestorOf(tester.renderObject<RenderBox>(badgeFinder));

    expect(culprit, isNull);
  });
}

/// Первый предок, чья обрезка не вмещает индикатор целиком, или `null`.
RenderObject? _clippingAncestorOf(RenderBox badge) {
  final badgeGlobal = MatrixUtils.transformRect(
    badge.getTransformTo(null),
    Offset.zero & badge.size,
  );

  RenderObject child = badge;
  RenderObject? parent = badge.parent;
  while (parent != null) {
    final clip = parent.describeApproximatePaintClip(child);
    if (clip != null) {
      final clipGlobal =
          MatrixUtils.transformRect(parent.getTransformTo(null), clip)
              .inflate(0.01);
      if (!clipGlobal.contains(badgeGlobal.topLeft) ||
          !clipGlobal.contains(badgeGlobal.bottomRight)) {
        return parent;
      }
    }
    child = parent;
    parent = parent.parent;
  }
  return null;
}
