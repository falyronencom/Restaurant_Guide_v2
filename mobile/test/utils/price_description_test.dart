import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/utils/venue_labels.dart';
import 'package:restaurant_guide_mobile/widgets/average_check_line.dart';

/// Средний чек словами — как на сайте: «до 50 руб» вместо одних значков «$$»
/// (находка нитки панели 25.10, слово Координатора 29.10.2026).
///
/// Набор значений читается из проверки сервера (`VALID_PRICE_RANGES`), слова —
/// из карточки сайта (`PRICE_DESCRIPTION` в `InfoCard.tsx`): сервер добавит
/// значение или сайт сменит слова — тест покраснеет, а не приложение молча
/// разойдётся. CI вынимает репозиторий целиком, `../backend` и `../web` рядом.
void main() {
  group('слова среднего чека', () {
    test('набор значений — как у сервера (VALID_PRICE_RANGES)', () {
      final source = File('../backend/src/validators/establishmentValidation.js')
          .readAsStringSync();
      final line = RegExp(r'const VALID_PRICE_RANGES = \[([^\]]*)\]')
          .firstMatch(source);
      expect(line, isNotNull, reason: 'в проверке сервера нет VALID_PRICE_RANGES');
      final values = RegExp(r"'([^']*)'")
          .allMatches(line!.group(1)!)
          .map((m) => m.group(1)!)
          .toSet();
      expect(values, isNotEmpty, reason: 'VALID_PRICE_RANGES разобрался пустым');

      expect(priceRangeDescriptions.keys.toSet(), values);
    });

    test('слова — как в карточке сайта (PRICE_DESCRIPTION)', () {
      final source =
          File('../web/src/components/establishment/InfoCard.tsx').readAsStringSync();
      final start = source.indexOf('const PRICE_DESCRIPTION');
      expect(start, isNonNegative, reason: 'в карточке сайта нет PRICE_DESCRIPTION');
      final block = source.substring(start, source.indexOf('};', start));
      final site = {
        for (final m in RegExp(r"^\s*(\$+):\s*'([^']*)',", multiLine: true)
            .allMatches(block))
          m.group(1)!: m.group(2)!,
      };
      expect(site, isNotEmpty, reason: 'PRICE_DESCRIPTION разобрался пустым');

      expect(priceRangeDescriptions, site);
    });

    test('priceDescription: слова, пусто и незнакомое', () {
      expect(priceDescription(r'$$'), 'до 50 руб');
      expect(priceDescription(r' $ '), 'до 20 руб');
      expect(priceDescription(r'$$$'), 'более 50 руб');
      expect(priceDescription(null), isNull);
      expect(priceDescription(''), isNull);
      expect(priceDescription(r'$$$$'), isNull);
    });

    test('фильтр подписывает карточки цены теми же словами', () {
      for (final range in PriceRange.values) {
        expect(range.description, priceRangeDescriptions[range.apiValue]);
      }
    });
  });

  group('строка «Средний чек» на узком экране', () {
    for (final scale in [1.0, 2.0, 3.1]) {
      testWidgets('320 dp, шрифт ×$scale: переносится, а не переполняется',
          (tester) async {
        tester.view.devicePixelRatio = 1.0;
        tester.view.physicalSize = const Size(320, 800);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.view.reset);
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

        await tester.pumpWidget(MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(
            body: Padding(
              // Отступ раздела «Меню» карточки.
              padding: EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [AverageCheckLine(r'$$$')],
              ),
            ),
          ),
        ));

        expect(tester.takeException(), isNull);
        final line = find.byKey(AverageCheckLine.lineKey);
        expect(line, findsOneWidget);
        expect(tester.getRect(line).right, lessThanOrEqualTo(320 - 16));
        expect(find.text('Средний чек: более 50 руб', findRichText: true),
            findsOneWidget);
      });
    }

    testWidgets('цены нет — строки нет', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: AverageCheckLine(null)),
      ));
      expect(find.byKey(AverageCheckLine.lineKey), findsNothing);
    });
  });
}
