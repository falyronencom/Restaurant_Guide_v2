import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/search_home_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Кириллица на главной поиска набрана семейством, в котором она есть.
///
/// У вшитого Josefin Sans кириллицы нет вовсе (cmap без U+0410…U+044F):
/// кириллический текст этим семейством рисуется системным шрифтом на
/// устройстве и пустотой в тестовом рендере, а ошибки при этом нет нигде.
/// Слоган «Вкусное рядом» был набран Josefin ExtraLight с 29.07 по 23.09.2026;
/// слоган заставки ушёл с Josefin на Nunito Sans ещё 14.09 (SDL CAT-C-1.3,
/// дополнение 2026-09-23, п. 7). Латинский вордмарк NIRIVIO остаётся на
/// Josefin — для латиницы шрифт годен.
void main() {
  setUp(() {
    AccountScope.debugReset();
    // Город в хранилище: без него post-frame ветка «GPS не дали и города нет»
    // открывает шторку выбора города поверх экрана.
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
  });

  Future<void> pumpHome(WidgetTester tester) async {
    installWireStand((_) => jsonBody(searchEnvelope()));
    final establishments = EstablishmentsProvider();
    addTearDown(establishments.dispose);
    final smart = SmartSearchProvider();
    addTearDown(smart.dispose);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<EstablishmentsProvider>.value(
              value: establishments),
          ChangeNotifierProvider<SmartSearchProvider>.value(value: smart),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const SearchHomeScreen(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  testWidgets('слоган «Вкусное рядом» набран семейством тела', (tester) async {
    await pumpHome(tester);

    final tagline =
        tester.renderObject<RenderParagraph>(find.text('Вкусное рядом'));
    expect(
      tagline.text.style?.fontFamily,
      AppTheme.fontBodyFamily,
      reason: 'слоган обязан идти семейством с кириллицей — Nunito Sans, как '
          'слоган заставки',
    );
  });

  testWidgets('ни одна кириллическая строка экрана не набрана Josefin Sans',
      (tester) async {
    await pumpHome(tester);

    final paragraphs = tester
        .renderObjectList<RenderParagraph>(find.byType(RichText))
        .toList();
    expect(paragraphs.length, greaterThan(5),
        reason: 'экран почти пуст — проверять нечего, стенд не поднялся');

    final offenders = <String>[];
    for (final paragraph in paragraphs) {
      paragraph.text.visitChildren((span) {
        if (span is TextSpan &&
            _cyrillic.hasMatch(span.text ?? '') &&
            _familyOf(paragraph.text, span) == AppTheme.fontWordmarkFamily) {
          offenders.add(span.text!);
        }
        return true;
      });
    }
    expect(
      offenders,
      isEmpty,
      reason: 'кириллица набрана Josefin Sans, в котором её нет: $offenders — '
          'на устройстве эти буквы берутся из системного шрифта',
    );
  });
}

final RegExp _cyrillic = RegExp('[Ѐ-ӿ]');

/// Семейство, которым нарисован [span] внутри абзаца [root]: своё, иначе
/// ближайшего предка, у которого оно задано.
String? _familyOf(InlineSpan root, InlineSpan span) {
  String? found;
  bool walk(InlineSpan node, String? inherited) {
    final own = node.style?.fontFamily ?? inherited;
    if (identical(node, span)) {
      found = own;
      return true;
    }
    if (node is TextSpan) {
      for (final child in node.children ?? const <InlineSpan>[]) {
        if (walk(child, own)) return true;
      }
    }
    return false;
  }

  walk(root, null);
  return found;
}
