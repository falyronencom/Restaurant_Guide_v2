import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/screens/splash/widgets/wordmark_widget.dart';

import 'splash_stand.dart';

/// Геометрия заставки — экран целиком, измерения `getRect`, не на глаз.
///
/// Лаборатория «Заставка NIRIVIO» рисовала на сетке 390×844: центр знака
/// (195, 352), R = 62; вордмарк по алфавитной базовой линии y = 498, линия
/// 62×2 по центру y = 540, слоган по базовой линии y = 572. Здесь то же окно
/// и те же точки в пределах ±4 px. На узком 320×568 ничего не вылезает; на
/// широком радиус упирается в потолок 72.
void main() {
  setUp(resetSplashStand);

  Future<void> pumpAt(WidgetTester tester, Size size) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = size;
    addTearDown(tester.view.reset);
    await pumpSplash(tester); // сессия грузится — заставка остаётся на экране
    await tester.pump();
    // Интро по шагам: переполнение вёрстки на любом кадре — исключение.
    for (var i = 0; i < 7; i++) {
      await tester.pump(const Duration(milliseconds: 400));
      expect(tester.takeException(), isNull,
          reason: 'кадр ${(i + 1) * 400} мс: вёрстка не должна ломаться');
    }
  }

  /// y алфавитной базовой линии текста в координатах окна.
  ///
  /// Абзац меряется тем же `TextPainter`, что и виджет (тот же span, тот же
  /// масштаб), поэтому расстояние до базовой линии совпадает с фактическим.
  double baselineOf(WidgetTester tester, String text) {
    final finder = find.text(text);
    final rect = tester.getRect(finder);
    final paragraph = tester.renderObject<RenderParagraph>(finder);
    final painter = TextPainter(
      text: paragraph.text,
      textDirection: paragraph.textDirection,
      textScaler: paragraph.textScaler,
    )..layout();
    final ascent = painter.computeDistanceToActualBaseline(TextBaseline.alphabetic);
    painter.dispose();
    return rect.top + ascent;
  }

  /// x центра ГЛИФОВ: Flutter добавляет трекинг и после последней буквы,
  /// поэтому центр коробки текста стоит правее центра букв на полтрекинга.
  double glyphCenterOf(WidgetTester tester, String text, double tracking) =>
      tester.getRect(find.text(text)).center.dx - tracking / 2;

  Rect ruleRect(WidgetTester tester) => tester.getRect(
        find.descendant(
          of: find.byType(WordmarkWidget),
          matching: find.byType(Container),
        ),
      );

  bool inside(Rect r, Size s) =>
      r.left >= 0 && r.top >= 0 && r.right <= s.width && r.bottom <= s.height;

  testWidgets('390×844: знак в (195, 352) с R = 62, текст по лаборатории',
      (tester) async {
    await pumpAt(tester, const Size(390, 844));

    final painter = cockadeOf(tester);
    expect(painter.center.dx, closeTo(195, .5));
    expect(painter.center.dy, closeTo(352, .5));
    expect(painter.radius, closeTo(62, .5));
    expect(painter.landed, isTrue);
    expect(painter.scale, closeTo(1, 1e-9), reason: 'перелёт израсходован');
    expect(painter.shadow, 1);
    expect(painter.flight, isNull, reason: 'кольца полёта сняты со сцены');

    expect(baselineOf(tester, 'NIRIVIO'), closeTo(498, 4));
    expect(glyphCenterOf(tester, 'NIRIVIO', 8), closeTo(195, 4));

    final rule = ruleRect(tester);
    expect(rule.center.dy, closeTo(540, 4));
    expect(rule.center.dx, closeTo(195, 4));
    expect(rule.width, closeTo(62, 4));
    expect(rule.height, closeTo(2, 1));

    expect(baselineOf(tester, 'Вкусное рядом'), closeTo(572, 4));
    expect(glyphCenterOf(tester, 'Вкусное рядом', 3.2), closeTo(195, 4));

    // У вшитого Josefin Sans нет кириллицы (cmap без U+0412…U+044F): слоган
    // им «рисовался» системным шрифтом на устройстве и пустотой в рендере.
    // Слоган — Nunito Sans, как в лаборатории; семейство вшито.
    final tagStyle = tester.widget<Text>(find.text('Вкусное рядом')).style!;
    expect(tagStyle.fontFamily, startsWith('NunitoSans'),
        reason: 'слоган обязан идти семейством с кириллицей');
  });

  testWidgets('320×568: всё в пределах экрана, радиус от ширины',
      (tester) async {
    const size = Size(320, 568);
    await pumpAt(tester, size);

    final painter = cockadeOf(tester);
    expect(painter.radius, closeTo(320 * 62 / 390, .5));
    expect(painter.center.dx, closeTo(160, .5));
    expect(painter.center.dy, closeTo(568 * 352 / 844, .5));

    for (final text in ['NIRIVIO', 'Вкусное рядом']) {
      expect(inside(tester.getRect(find.text(text)), size), isTrue,
          reason: '«$text» вылезает за экран 320×568');
    }
    expect(inside(ruleRect(tester), size), isTrue);
    // Текст ниже знака и не заходит на него.
    expect(tester.getRect(find.text('NIRIVIO')).top,
        greaterThan(painter.center.dy + painter.radius));
  });

  testWidgets('480×1000: радиус упирается в потолок 72', (tester) async {
    await pumpAt(tester, const Size(480, 1000));
    expect(cockadeOf(tester).radius, 72);
    expect(cockadeOf(tester).center.dx, 240);
  });
}
