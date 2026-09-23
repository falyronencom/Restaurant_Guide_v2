import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/widgets/canon_app_bar.dart';

import '../support/dart_source_scan.dart';

/// Семейство, которым текст РИСУЕТСЯ, — а не то, что написано в теме.
///
/// Шрифты объявлены семействами в pubspec (SDL CAT-C-1.3), и тема раздаёт
/// Nunito Sans через `ThemeData.fontFamily`. Но это поле питает только
/// textTheme. Кнопки, заголовок AppBar и чипы берут стиль подписи из своих
/// тем и ЗАМЕНЯЮТ им унаследованный стиль, а не сливают с ним, — поэтому
/// стиль без `fontFamily` даёт подписи пустое семейство: на устройстве
/// системный шрифт, в тесте подставной. Ошибки при этом нет нигде — ни
/// analyze, ни прогон, ни ревью её не показывают, видна только отрисовка.
/// Отсюда форма проверок: семейство читается из `RenderParagraph`, где
/// стиль уже собран так, как его нарисуют.
void main() {
  group('Все пятнадцать слотов textTheme — семейство тела', () {
    // Слотов title* в TextTheme темы нет: их даёт типографика Material по
    // умолчанию. Буквальный `.apply(fontFamily:)` на TextTheme их бы не
    // коснулся, и подписи кнопок входа (textTheme.titleMedium) ушли бы на
    // системный шрифт. Слоты перечислены литералом, а не выведены из темы:
    // выведенный список согласился бы с тем, что тема раздаёт.
    for (final platform in <TargetPlatform>[
      TargetPlatform.android,
      TargetPlatform.iOS,
    ]) {
      test(platform.name, () {
        debugDefaultTargetPlatformOverride = platform;
        addTearDown(() => debugDefaultTargetPlatformOverride = null);
        final text = AppTheme.lightTheme.textTheme;

        final slots = <String, TextStyle?>{
          'displayLarge': text.displayLarge,
          'displayMedium': text.displayMedium,
          'displaySmall': text.displaySmall,
          'headlineLarge': text.headlineLarge,
          'headlineMedium': text.headlineMedium,
          'headlineSmall': text.headlineSmall,
          'titleLarge': text.titleLarge,
          'titleMedium': text.titleMedium,
          'titleSmall': text.titleSmall,
          'bodyLarge': text.bodyLarge,
          'bodyMedium': text.bodyMedium,
          'bodySmall': text.bodySmall,
          'labelLarge': text.labelLarge,
          'labelMedium': text.labelMedium,
          'labelSmall': text.labelSmall,
        };
        expect(slots, hasLength(15));

        for (final slot in slots.entries) {
          expect(
            slot.value?.fontFamily,
            AppTheme.fontBodyFamily,
            reason: 'textTheme.${slot.key} разрешается в '
                '«${slot.value?.fontFamily}», а не в семейство тела. Слот '
                'без семейства рисуется системным шрифтом, и всё, что его '
                'читает, — поля, списки, подписи — уходит вместе с ним',
          );
        }
      });
    }
  });

  group('Подписи компонентов нарисованы семейством канона', () {
    const platforms = TargetPlatformVariant(
      <TargetPlatform>{TargetPlatform.android, TargetPlatform.iOS},
    );

    testWidgets('кнопки — из темы и канонические CTA', (tester) async {
      final buttons = <String, Widget>{
        'ElevatedButton': ElevatedButton(
          onPressed: () {},
          child: const Text('ElevatedButton'),
        ),
        'OutlinedButton': OutlinedButton(
          onPressed: () {},
          child: const Text('OutlinedButton'),
        ),
        'TextButton': TextButton(
          onPressed: () {},
          child: const Text('TextButton'),
        ),
        'FilledButton': FilledButton(
          onPressed: () {},
          child: const Text('FilledButton'),
        ),
        'canonCtaL': ElevatedButton(
          onPressed: () {},
          style: AppTheme.canonCtaL(),
          child: const Text('canonCtaL'),
        ),
        'canonCtaM': ElevatedButton(
          onPressed: () {},
          style: AppTheme.canonCtaM(),
          child: const Text('canonCtaM'),
        ),
      };

      for (final button in buttons.entries) {
        await _pumpInBody(tester, button.value);
        expect(
          _renderedFamily(tester, button.key),
          AppTheme.fontBodyFamily,
          reason: 'подпись ${button.key} нарисована не семейством тела: '
              'стиль подписи в теме кнопки задан без fontFamily, а кнопка '
              'ЗАМЕНЯЕТ им унаследованный стиль',
        );
      }
    }, variant: platforms);

    testWidgets('заголовок AppBar из темы', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(appBar: AppBar(title: const Text('AppBar'))),
        ),
      );
      expect(
        _renderedFamily(tester, 'AppBar'),
        AppTheme.fontBodyFamily,
        reason: 'appBarTheme.titleTextStyle без fontFamily: AppBar ставит его '
            'заголовку целиком, и заголовок уходит на системный шрифт',
      );
    }, variant: platforms);

    testWidgets('подписи чипов из темы', (tester) async {
      final chips = <String, Widget>{
        'ChoiceChip': ChoiceChip(
          label: const Text('ChoiceChip'),
          selected: false,
          onSelected: (_) {},
        ),
        'Chip': const Chip(label: Text('Chip')),
      };

      for (final chip in chips.entries) {
        await _pumpInBody(tester, chip.value);
        expect(
          _renderedFamily(tester, chip.key),
          AppTheme.fontBodyFamily,
          reason: 'chipTheme.labelStyle без fontFamily: он заменяет стиль '
              'подписи по умолчанию, и ${chip.key} рисуется системным '
              'шрифтом',
        );
      }
    }, variant: platforms);

    testWidgets('контроль: явное семейство остаётся своим', (tester) async {
      // Проверки выше обязаны уметь показать и обратное: читается стиль
      // именно этого абзаца, а не «семейство тела вообще».
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(
            appBar: CanonAppBar(title: 'CanonAppBar'),
            body: Text('Body'),
          ),
        ),
      );
      expect(_renderedFamily(tester, 'CanonAppBar'), AppTheme.fontDisplayFamily);
      expect(_renderedFamily(tester, 'Body'), AppTheme.fontBodyFamily);
    });
  });

  group('Стиль, ЗАМЕНЯЮЩИЙ унаследованный, называет семейство сам', () {
    // Проверки выше смотрят на темы. Этот сторож — на весь lib/: стиль,
    // переданный прямо кнопке (`ElevatedButton.styleFrom(textStyle: …)`),
    // так же вытесняет тему, и правка темы до него не доходит. Так до
    // 23.09.2026 рисовались системным шрифтом «Как добраться» на детальной,
    // строка «Открыто/до …» на каждой карточке (RichText) и выбор города в
    // анкете партнёра (DropdownButton).
    test('разбор находит места, а не зеленеет на пустом месте', () {
      expect(libSources().length, greaterThan(50),
          reason: 'обход lib/ почти ничего не прочитал');
      final styles = _replacingStyles();
      expect(
        styles.length,
        greaterThanOrEqualTo(10),
        reason: 'разбор нашёл подозрительно мало стилей в заменяющих '
            'параметрах — изменилась форма записи или сломан поиск, и сторож '
            'перестал что-либо стеречь',
      );
      expect(
        styles.where((style) => style.where.contains('RichText')),
        isNotEmpty,
        reason: 'разбор не нашёл ни одного RichText — сломан поиск этой формы',
      );
    });

    test('разбор исходников не сбивается ни в одном файле', () {
      // Разбор — не парсер Dart. Строка с кавычкой того же вида внутри
      // `${…}` выбила бы его из синхрона молча, и сторож читал бы код
      // наизнанку, ничего не находя. Сошедшиеся скобки — признак, что
      // синхрон не потерян.
      final broken = <String>[];
      for (final file in libSources()) {
        final mismatch = strippingMismatch(file.readAsStringSync());
        if (mismatch != null) broken.add('${unixPath(file)}: $mismatch');
      }
      expect(broken, isEmpty,
          reason: 'очистка исходника сбилась — сторожа по этим файлам '
              'слепы: $broken');
    });

    test('у каждого такого стиля есть fontFamily', () {
      final offenders = _replacingStyles()
          .where((style) => style.problem != null)
          .map((style) => '${style.where}: ${style.problem}')
          .toList();
      expect(
        offenders,
        isEmpty,
        reason: 'стиль в параметре, который ЗАМЕНЯЕТ унаследованный, не '
            'называет семейство — подпись уйдёт на системный шрифт: '
            '$offenders. Назвать семейство явно (AppTheme.fontBodyFamily)',
      );
    });
  });
}

/// Поднимает [child] в теле экрана под темой приложения.
Future<void> _pumpInBody(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(body: Center(child: child)),
    ),
  );
}

/// Семейство, которым нарисован абзац с текстом [label].
///
/// `Text` собирает стиль из своего и `DefaultTextStyle` и отдаёт собранное
/// `RenderParagraph` — там и видно, что заменило что.
String? _renderedFamily(WidgetTester tester, String label) =>
    tester.renderObject<RenderParagraph>(find.text(label)).text.style?.fontFamily;

/// Где стиль текста ЗАМЕНЯЕТ унаследованный, а не сливается с ним:
/// конструктор (или `.styleFrom`) → параметры. Сверено по исходникам Flutter
/// 3.35.2: кнопки берут `textStyle` виджета, иначе темы, иначе умолчания —
/// без слияния; AppBar, диалог, подсказка, снекбар и выпадающий список кладут
/// стиль в `DefaultTextStyle(style: …)`; чип и вкладки берут стиль темы вместо
/// умолчания. Параметры, которые СЛИВАЮТСЯ (`labelStyle` у самого чипа,
/// подписи нижней навигации, стили поля ввода), сюда не входят: там семейство
/// приходит от темы. `RichText` разобран отдельно: он не наследует ничего.
const Map<String, Set<String>> _replacing = <String, Set<String>>{
  'styleFrom': <String>{'textStyle'},
  'ButtonStyle': <String>{'textStyle'},
  'AppBar': <String>{'titleTextStyle', 'toolbarTextStyle'},
  'SliverAppBar': <String>{'titleTextStyle', 'toolbarTextStyle'},
  'AppBarTheme': <String>{'titleTextStyle', 'toolbarTextStyle'},
  'ChipThemeData': <String>{'labelStyle'},
  'TabBar': <String>{'labelStyle', 'unselectedLabelStyle'},
  'TabBarThemeData': <String>{'labelStyle', 'unselectedLabelStyle'},
  'DefaultTextStyle': <String>{'style'},
  'AnimatedDefaultTextStyle': <String>{'style'},
  'Material': <String>{'textStyle'},
  'AlertDialog': <String>{'titleTextStyle', 'contentTextStyle'},
  'DialogThemeData': <String>{'titleTextStyle', 'contentTextStyle'},
  'Tooltip': <String>{'textStyle'},
  'TooltipThemeData': <String>{'textStyle'},
  'SnackBarThemeData': <String>{'contentTextStyle'},
  'DropdownButton': <String>{'style'},
  'DropdownButtonFormField': <String>{'style'},
};

final RegExp _replacingCall = RegExp(
    '\\b(${_replacing.keys.join('|')})\\s*(?:<[^<>()]*>)?\\s*\\(');

/// Стиль в заменяющем параметре: где стоит и чем плох (`null` — годен).
typedef _ReplacingStyle = ({String where, String? problem});

List<_ReplacingStyle> _replacingStyles() {
  final members = _themeStyleMembers();
  final found = <_ReplacingStyle>[];
  for (final file in libSources()) {
    final source = stripped(file.readAsStringSync());
    String where(int at, String what) =>
        '${unixPath(file)}:${lineAt(source, at)} ($what)';

    for (final call in _replacingCall.allMatches(source)) {
      final name = call.group(1)!;
      final open = call.end - 1;
      final args = argsAt(source, open);
      for (final arg in namedArgs(args).entries) {
        if (!_replacing[name]!.contains(arg.key)) continue;
        found.add((
          where: where(open + 1 + arg.value.offset, '$name → ${arg.key}'),
          problem: _styleProblem(arg.value.value, members),
        ));
      }
    }

    // RichText стиль темы не наследует вовсе: всё, что не задано у корневого
    // TextSpan, пусто — включая семейство.
    for (final call in RegExp(r'\bRichText\s*\(').allMatches(source)) {
      final open = call.end - 1;
      final text = namedArgs(argsAt(source, open))['text'];
      if (text == null) continue;
      final at = open + 1 + text.offset;
      final span =
          RegExp(r'^\s*(?:const\s+)?TextSpan\s*\(').firstMatch(text.value);
      if (span == null) {
        found.add((
          where: where(at, 'RichText → text'),
          problem: 'корневой span не литерал TextSpan — семейство не проверить',
        ));
        continue;
      }
      final style = namedArgs(argsAt(text.value, span.end - 1))['style'];
      found.add((
        where: where(at, 'RichText → TextSpan.style'),
        problem: style == null
            ? 'у корневого TextSpan нет style — семейства нет вовсе'
            : _styleProblem(style.value, members),
      ));
    }
  }
  return found;
}

/// Чем плох стиль [value] в заменяющем параметре; `null` — годен.
///
/// Годен литерал `TextStyle(…)` с `fontFamily:`; слот `textTheme` (его
/// семейство стережёт группа выше); стиль темы, в объявлении которого
/// семейство названо; и любое выражение, где семейство задано прямо в
/// `copyWith(fontFamily: …)`. Всё прочее — переменная, вызов, стиль темы без
/// семейства — сторож назвать не может и потому не пропускает.
String? _styleProblem(String value, Map<String, bool> members) {
  for (final literal in RegExp(r'\bTextStyle\s*\(').allMatches(value)) {
    if (!_namesFamily.hasMatch(argsAt(value, literal.end - 1))) {
      return 'TextStyle без fontFamily';
    }
  }
  for (final copy in RegExp(r'\.copyWith\s*\(').allMatches(value)) {
    if (_namesFamily.hasMatch(argsAt(value, copy.end - 1))) return null;
  }
  if (value.contains('textTheme.')) return null;
  final referenced = RegExp(r'\b(?:AppTheme\.)?(\w+)\b')
      .allMatches(value)
      .map((match) => match.group(1)!)
      .where(members.containsKey)
      .toSet();
  for (final name in referenced) {
    if (!members[name]!) return 'AppTheme.$name без fontFamily';
  }
  if (referenced.isNotEmpty ||
      RegExp(r'\bTextStyle\s*\(').hasMatch(value)) {
    return null;
  }
  return 'стиль не литерал и не стиль темы — семейство не проверить';
}

final RegExp _namesFamily = RegExp(r'\bfontFamily\s*:');

/// Стили темы: имя члена `AppTheme` → названо ли в его объявлении семейство.
///
/// Константы (`static const TextStyle x = …;`) и помощники
/// (`static TextStyle x(…) => …;` или с телом в скобках).
Map<String, bool> _themeStyleMembers() {
  final source = stripped(File('lib/config/theme.dart').readAsStringSync());
  final members = <String, bool>{};
  for (final match in RegExp(
          r'static\s+(?:const\s+|final\s+)?TextStyle\??\s+(?:get\s+)?(\w+)\b')
      .allMatches(source)) {
    var depth = 0;
    var end = match.end;
    for (; end < source.length; end++) {
      final char = source[end];
      if ('([{'.contains(char)) depth++;
      if (')]}'.contains(char)) depth--;
      if (char == ';' && depth == 0) break;
      if (char == '}' && depth == 0) break;
    }
    members[match.group(1)!] =
        _namesFamily.hasMatch(source.substring(match.end, end));
  }
  return members;
}
