import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/basic_info_step.dart';
import 'package:restaurant_guide_mobile/utils/venue_labels.dart';

import '../support/wire_stand.dart';

/// Мастер партнёра, «Средний чек»: под значком — те же слова, что в карточке
/// и фильтре («до 50 руб»), а не один «$$», по которому партнёр угадывал
/// (слово Координатора 29.10.2026). На сервер уходит прежнее «$$».
/// Слова при крупном шрифте на узком экране переносятся, а не обрезаются и
/// не переполняют кнопку.
void main() {
  setUp(() {
    installWireStand((_) => jsonBody({'success': false}, status: 500));
  });

  Future<PartnerRegistrationProvider> pumpStep(
    WidgetTester tester, {
    double width = 390,
    double scale = 1.0,
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = Size(width, 2400);
    tester.platformDispatcher.textScaleFactorTestValue = scale;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    final provider = PartnerRegistrationProvider(
      initialStep: 2,
      initialData: const PartnerRegistration(name: 'Кофейня у моста'),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChangeNotifierProvider.value(
            value: provider,
            child: const BasicInfoStep(),
          ),
        ),
      ),
    );
    await tester.pump();
    return provider;
  }

  testWidgets('под каждым значком — слова; выбор сохраняет значок',
      (tester) async {
    final provider = await pumpStep(tester);

    for (final entry in priceRangeDescriptions.entries) {
      final option = find.byKey(BasicInfoStep.priceOptionKey(entry.key));
      await tester.ensureVisible(option);
      expect(
          find.descendant(of: option, matching: find.text(entry.value)),
          findsOneWidget,
          reason: entry.key);
    }

    await tester.tap(find.byKey(BasicInfoStep.priceOptionKey(r'$$')));
    await tester.pump();
    expect(provider.data.priceRange, r'$$');
  });

  for (final (width, scale) in [(320.0, 1.0), (320.0, 2.0), (320.0, 3.1)]) {
    testWidgets('$width dp, шрифт ×$scale: слова целиком внутри кнопки',
        (tester) async {
      // Шаг «Основное» на 320 dp переполняется по ширине и без этой правки
      // (2 места при обычном шрифте, 7 при ×2 — сверено на прежнем коде,
      // находка отчёта). Здесь меряются только кнопки цены: значок и слова
      // целиком внутри своей кнопки, кнопки — внутри экрана.
      final previous = FlutterError.onError;
      FlutterError.onError = (details) {
        if (!details.exceptionAsString().contains('overflowed')) {
          previous?.call(details);
        }
      };
      addTearDown(() => FlutterError.onError = previous);

      await pumpStep(tester, width: width, scale: scale);
      FlutterError.onError = previous;

      for (final entry in priceRangeDescriptions.entries) {
        final option = find.byKey(BasicInfoStep.priceOptionKey(entry.key));
        final box = tester.getRect(option);
        for (final text in [entry.key, entry.value]) {
          final rect = tester.getRect(
              find.descendant(of: option, matching: find.text(text)));
          expect(rect.left, greaterThanOrEqualTo(box.left), reason: text);
          expect(rect.top, greaterThanOrEqualTo(box.top), reason: text);
          expect(rect.right, lessThanOrEqualTo(box.right), reason: text);
          expect(rect.bottom, lessThanOrEqualTo(box.bottom), reason: text);
        }
        expect(box.right, lessThanOrEqualTo(width), reason: entry.key);
      }
    });
  }
}
