import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/widgets/separated_wrap.dart';

// Строка фактов «город · дата · статус» переносится целыми фактами, и «·»
// на месте переноса не висит в конце строки (находка П7 № 6, волна 3).

Widget _fact(String text) => SizedBox(width: 100, height: 20, child: Text(text));

Future<void> _pump(WidgetTester tester, double width) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: Align(
        alignment: Alignment.topLeft,
        child: SizedBox(
          width: width,
          child: SeparatedWrap(
            spacing: 8,
            runSpacing: 4,
            separator: const SizedBox(width: 6, child: Text('·')),
            items: <Widget>[_fact('Минск'), _fact('дата'), _fact('статус')],
          ),
        ),
      ),
    ),
  ));
}

/// Разделители, которые видны и ловят касания.
int _visibleDots(WidgetTester tester) =>
    find.text('·').hitTestable().evaluate().length;

void main() {
  testWidgets('всё в строку — две точки между тремя фактами', (tester) async {
    // 3 × 100 + 2 × (8 + 6 + 8) = 344.
    await _pump(tester, 400);

    expect(_visibleDots(tester), 2);
    final city = tester.getRect(find.text('Минск'));
    final status = tester.getRect(find.text('статус'));
    expect(status.top, city.top, reason: 'одна строка');
  });

  testWidgets('перенос — точки на месте переноса нет', (tester) async {
    // Минск · дата = 222 — помещается; статус уходит на вторую строку.
    await _pump(tester, 300);

    final city = tester.getRect(find.text('Минск'));
    final date = tester.getRect(find.text('дата'));
    final status = tester.getRect(find.text('статус'));
    expect(date.top, city.top);
    expect(status.top, greaterThan(city.bottom), reason: 'статус — ниже');
    expect(status.left, city.left, reason: 'новая строка начинается фактом');
    expect(_visibleDots(tester), 1,
        reason: 'точка между датой и статусом пропала, а не повисла в конце');
    expect(tester.takeException(), isNull);
  });

  testWidgets('каждый факт своей строкой — точек нет вовсе', (tester) async {
    await _pump(tester, 150);

    expect(_visibleDots(tester), 0);
    final city = tester.getRect(find.text('Минск'));
    final date = tester.getRect(find.text('дата'));
    expect(date.top, city.bottom + 4, reason: 'отступ между строками');
  });
}
