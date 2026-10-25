import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_filter_dropdown.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_search_decoration.dart';

// Поле поиска в шапке — на одной линии с фильтрами и не меняет высоту после
// ввода (проход по панели модератора, 20.10, Ч20, F-29). Замер 25.10: у
// «Пользователей», «Отзывов» и «Одобренных» рамка была 21 px у верхнего края
// слота 40, а с крестиком очистки — 40.

/// Рамка поля: её рисует служебный виджет поля ввода, по нему и мерим.
Finder _border() => find.byWidgetPredicate(
    (widget) => widget.runtimeType.toString() == '_BorderContainer');

Future<void> _pump(WidgetTester tester, {required bool withClear}) async {
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.lightTheme,
    home: Scaffold(
      body: Center(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          spacing: 10,
          children: <Widget>[
            SizedBox(
              width: 240,
              height: AdminFilterDropdown.height,
              child: TextField(
                style: const TextStyle(fontSize: 14),
                decoration: adminSearchDecoration(
                  hint: 'Почта, телефон или имя',
                  suffixIcon: withClear
                      ? IconButton(
                          icon: const Icon(Icons.close, size: 17),
                          onPressed: () {},
                        )
                      : null,
                ),
              ),
            ),
            AdminFilterDropdown<String>(
              value: null,
              options: const <AdminFilterOption<String>>[],
              onChanged: (_) {},
              emptyLabel: 'Все',
            ),
          ],
        ),
      ),
    ),
  ));
}

void main() {
  for (final withClear in <bool>[false, true]) {
    testWidgets(
        withClear
            ? 'с крестиком очистки рамка та же'
            : 'пустое поле — рамка 40 на одной линии с фильтром',
        (tester) async {
      await _pump(tester, withClear: withClear);

      final border = tester.getRect(_border());
      final filter = tester.getRect(find.byType(AdminFilterDropdown<String>));

      expect(border.height, AdminFilterDropdown.height);
      expect(border.top, filter.top, reason: 'верх — на одной линии');
      expect(border.bottom, filter.bottom, reason: 'низ — на одной линии');
      expect(tester.takeException(), isNull);
    });
  }
}
