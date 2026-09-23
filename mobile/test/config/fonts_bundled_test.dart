import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

import '../support/dart_source_scan.dart';

/// Сторож шрифтов канона mobile: объявление, файлы и запрошенные веса.
///
/// **Где здесь шов.** Шрифты объявлены семействами в pubspec (`flutter:
/// fonts:`, SDL CAT-C-1.3, с 23.09.2026), и файл под запрошенный вес выбирает
/// сам Flutter. Ошибиться можно с нескольких сторон, и ни одна не падает — все
/// уводят текст на чужое начертание МОЛЧА:
///
/// 1. файл лежит в `google_fonts/`, но в pubspec не объявлен — мёртвый груз;
///    или объявлен не тем весом, что записан в нём самом;
/// 2. имя семейства в коде разошлось с `family:` в pubspec — опечатку не
///    поймает компилятор, текст уедет на системный шрифт;
/// 3. код просит вес, которого у семейства нет, — движок нарисует
///    синтетическое утолщение поверх ближайшего начертания.
///
/// Третий случай — причина, по которой устройство поменяли. Пока шрифты шли
/// через пакет google_fonts, он регистрировал каждое начертание ОТДЕЛЬНЫМ
/// семейством, и вес, выставленный поверх темы, упирался в семейство с одним
/// начертанием: около 240 весов приложения не доходили до своего файла —
/// движок брал ближайшее начертание и дорисовывал разницу синтетикой. Стили,
/// созданные пакетом сразу с весом, свой файл получали. Образец сторожа —
/// admin-web (`7bee487`).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Объявленное против лежащего на диске', () {
    test('каждый .ttf из google_fonts/ объявлен, и каждое объявление — файл',
        () async {
      // Только семейства канона: `MaterialIcons` в манифест кладёт сам Flutter
      // по `uses-material-design`, его файл лежит не у нас.
      final ours = _themeFamilyConstants().values.toSet();
      final declared = <String>{};
      for (final entry in (await _bundled()).entries) {
        if (ours.contains(entry.key)) {
          declared.addAll(entry.value.values);
        }
      }
      final onDisk = _filesOnDisk();

      expect(onDisk, isNotEmpty,
          reason: 'каталог google_fonts/ пуст — читается не то место');
      expect(declared, isNotEmpty,
          reason: 'ни одно семейство канона не нашлось в собранном манифесте');

      expect(
        declared.difference(onDisk),
        isEmpty,
        reason: 'объявлено в pubspec, но файла нет — сборка подставит пустоту',
      );
      expect(
        onDisk.difference(declared),
        isEmpty,
        reason: 'файл лежит в google_fonts/, но в pubspec не объявлен: в '
            'сборку он не попадёт, а выбрать его будет нечем — мёртвый груз. '
            'Либо объявить начертание, либо убрать файл',
      );
    });

    test('объявленный вес — тот, что записан в самом файле', () async {
      // Начертание под запрошенный вес движок подбирает по весу, записанному
      // в файле (таблица OS/2), а не по строке `weight:` из pubspec — в
      // тестах иначе и не может быть: `FontLoader` веса не принимает вовсе.
      // Значит, начертание, объявленное не тем весом, обманывает сторож весов
      // ниже: по объявлению вес есть, а под запрос движок возьмёт другой файл.
      // Сравнение с точностью до сотни: у JosefinSans-ExtraLight в файле 250,
      // объявлен он как 200 — это одна и та же ступень шкалы.
      final ours = _themeFamilyConstants().values.toSet();
      var checked = 0;
      for (final family in (await _bundled()).entries) {
        if (!ours.contains(family.key)) continue;
        for (final face in family.value.entries) {
          final inFile =
              _weightClassOf(File(face.value).readAsBytesSync()) ~/ 100 * 100;
          checked++;
          expect(
            face.key,
            inFile,
            reason: '${face.value} объявлен в семействе ${family.key} весом '
                '${face.key}, а в самом файле записан вес $inFile: запрос '
                'w${face.key} движок сопоставит с весом файла, и начертание '
                'окажется не тем, что обещает объявление',
          );
        }
      }
      expect(checked, greaterThanOrEqualTo(9),
          reason: 'проверено меньше начертаний, чем вшито в канон');
    });
  });

  group('Семейства канона объявлены и собраны', () {
    test('каждая константа font*Family темы отвечает объявленному семейству',
        () async {
      final families = await _bundled();
      final constants = _themeFamilyConstants();

      // Якорь: дисплейное, тело, вордмарк, карточка. Моноширинного в mobile
      // нет.
      expect(constants.length, greaterThanOrEqualTo(4),
          reason: 'разбор темы почти не нашёл констант семейств — изменилась '
              'форма объявления, и сторож перестал что-либо стеречь');

      for (final entry in constants.entries) {
        expect(
          families.keys,
          contains(entry.value),
          reason: 'AppTheme.${entry.key} = «${entry.value}», а такого '
              'семейства в сборке нет. Имя ищется ТОЧНО: расхождение с '
              '`family:` в pubspec компилятор не заметит, а текст молча уедет '
              'на системный шрифт',
        );
      }
    });

    test('в стилях lib/ семейство названо константой темы, а не строкой', () {
      // Проверка выше сверяет только константы. Семейство, записанное в стиле
      // строкой (`fontFamily: 'Nunito Sans'`), обошло бы её целиком — и
      // опечатка в нём ушла бы на системный шрифт незамеченной.
      final offenders = <String>[];
      var named = 0;
      for (final file in libSources()) {
        final source = stripped(file.readAsStringSync());
        for (final match
            in RegExp(r'\bfontFamily\s*:\s*([^,)\n]*)').allMatches(source)) {
          named++;
          if (!_familyConstant.hasMatch(match.group(1)!.trim())) {
            offenders.add('${unixPath(file)}:${lineAt(source, match.start)}');
          }
        }
      }
      expect(named, greaterThan(30),
          reason: 'разбор почти не нашёл fontFamily: в lib/ — сломан поиск');
      expect(
        offenders,
        isEmpty,
        reason: 'здесь семейство задано не константой AppTheme.font*Family: '
            '$offenders. Сторож не может сверить такое имя с pubspec',
      );
    });
  });

  group('Вес доходит до своего начертания', () {
    // Проверки выше читают объявления — текст pubspec и текст lib/. Здесь
    // проверяется поведение: что движок действительно берёт РАЗНЫЕ файлы под
    // разные веса. Ровно это и было сломано до 23.09.2026, когда семейство
    // держало одно начертание, а вес поверх него давал синтетику.
    //
    // Шрифты в сьюте настоящие: их грузит test/flutter_test_config.dart. Без
    // загрузки замер бессмыслен — подставной шрифт даёт одинаковые метрики
    // любому весу, и первая проверка покраснела бы, а вторая зеленела бы,
    // ничего не проверяя.
    testWidgets('у body-семейства каждое начертание своё, а не одно на всех',
        (tester) async {
      final widths = <int, double>{};
      for (final weight in <FontWeight>[
        FontWeight.w400,
        FontWeight.w500,
        FontWeight.w600,
        FontWeight.w700,
      ]) {
        widths[weight.value] =
            await _widthOf(tester, AppTheme.fontBodyFamily, weight);
      }

      expect(
        widths.values.toSet().length,
        widths.length,
        reason: 'веса ${widths.keys.toList()} дали совпадающие ширины '
            '($widths) — значит начертание было взято ОДНО, а разницу движок '
            'дорисовал синтетикой. Так выглядел дефект, ради которого шрифты '
            'перевели на объявление семейств в pubspec',
      );
    });

    testWidgets('семейство с одним начертанием на вес не отзывается',
        (tester) async {
      // Контроль к проверке выше: она обязана уметь показать и обратное.
      // Onest вшит одним начертанием (w600) сознательно — значит его ширины
      // на разных весах совпадают, и это НЕ дефект, а верхняя граница того,
      // что вообще может дать одно начертание.
      final atRegular =
          await _widthOf(tester, AppTheme.fontCardTitleFamily, FontWeight.w400);
      final atSemiBold =
          await _widthOf(tester, AppTheme.fontCardTitleFamily, FontWeight.w600);

      expect(atRegular, atSemiBold,
          reason: 'у ${AppTheme.fontCardTitleFamily} появилось второе '
              'начертание — контроль устарел, проверить состав канона');
    });
  });

  group('Запрошенные веса против объявленных начертаний', () {
    test('разбор находит места, а не зеленеет на пустом месте', () {
      // Сканирующий тест зеленеет и от сломанного поиска: не тот каталог, не
      // та форма — находок ноль, требований ноль, прогон зелёный. Якорь держит
      // сам поиск, а не итог сверки, поэтому при невшитом весе он остаётся
      // зелёным: краснеет сверка ниже.
      expect(libSources().length, greaterThan(50),
          reason: 'обход lib/ почти ничего не прочитал');

      final requests = _collectRequests(_themeFamilyConstants());
      expect(requests.length, greaterThan(100),
          reason: 'разбор нашёл подозрительно мало мест с весом — изменилась '
              'форма записи стилей, и сторож перестал что-либо стеречь');
      expect(
        requests.map((request) => request.family).toSet(),
        containsAll(
            <String>[AppTheme.fontBodyFamily, AppTheme.fontDisplayFamily]),
        reason: 'разбор не приписал ни одного веса body или дисплейному — '
            'сломалось определение семейства',
      );
      expect(
        requests.where((request) => request.viaTextTheme).length,
        greaterThanOrEqualTo(10),
        reason: 'разбор не нашёл весов, выставленных поверх слотов textTheme '
            '(`textTheme.titleMedium?.copyWith(fontWeight: …)`), — сломан '
            'поиск этой формы',
      );
    });

    test('вес через copyWith — только поверх слота textTheme', () {
      // Разбор приписывает вес семейству по месту, где стиль СОЗДАЁТСЯ.
      // `copyWith(fontWeight: …)` меняет вес у готового стиля, то есть у
      // чужого семейства. Одну форму разбор понимает: поверх слота textTheme —
      // это семейство тела, все пятнадцать слотов которого стережёт
      // test/config/theme_text_families_test.dart. Любой другой приёмник
      // пусть прогон назовёт, а не промолчит.
      final offenders = <String>[];
      for (final file in libSources()) {
        final source = stripped(file.readAsStringSync());
        for (final match in _copyWithPattern.allMatches(source)) {
          final args = argsAt(source, match.end - 1);
          if (_weightPattern.hasMatch(args) &&
              !_textThemeReceiver
                  .hasMatch(source.substring(0, match.start))) {
            offenders.add('${unixPath(file)}:${lineAt(source, match.start)}');
          }
        }
      }
      expect(
        offenders,
        isEmpty,
        reason: 'здесь вес выставляется поверх готового стиля, чьё семейство '
            'сторож назвать не может: $offenders. Либо создавать стиль с '
            'нужным весом сразу, либо научить разбор этой форме',
      );
    });

    test('семейство поверх слота textTheme меняется только вместе с весом', () {
      // `textTheme.headlineSmall?.copyWith(fontFamily: AppTheme.fontDisplayFamily)`
      // без веса наследует вес СЛОТА (у headlineSmall — w600), а у нового
      // семейства такого начертания может не быть: Unbounded вшит одним w400,
      // и заголовок молча ушёл бы в синтетику. Разбор видит веса только
      // написанные — значит, при смене семейства вес обязан быть написан.
      final offenders = <String>[];
      for (final file in libSources()) {
        final source = stripped(file.readAsStringSync());
        for (final match in _copyWithPattern.allMatches(source)) {
          if (!_textThemeReceiver.hasMatch(source.substring(0, match.start))) {
            continue;
          }
          final args = argsAt(source, match.end - 1);
          if (_familyNamedIn(args) != null && !_weightPattern.hasMatch(args)) {
            offenders.add('${unixPath(file)}:${lineAt(source, match.start)}');
          }
        }
      }
      expect(
        offenders,
        isEmpty,
        reason: 'семейство сменено поверх слота textTheme без явного веса — '
            'вес придёт от слота, и нового семейства он может не иметь: '
            '$offenders. Написать fontWeight рядом с fontFamily',
      );
    });

    test('каждому запрошенному весу отвечает объявленное начертание', () async {
      final families = await _bundled();

      for (final request in _collectRequests(_themeFamilyConstants())) {
        final faces = families[request.family];
        expect(faces, isNotNull,
            reason: 'семейство ${request.family} из ${request.where} не '
                'объявлено');
        expect(
          faces!.keys,
          contains(request.weight),
          reason: '${request.where} просит у семейства ${request.family} вес '
              'w${request.weight}, а объявлены только '
              '${faces.keys.toList()..sort()}. Flutter возьмёт ближайшее '
              'начертание и дорисует разницу синтетикой — молча, без ошибки. '
              'Либо просить объявленный вес, либо — с решения владельца — '
              'вшить .ttf и объявить его в pubspec',
        );
      }
    });
  });
}

/// Собранное объявление шрифтов: семейство → вес → путь файла.
///
/// `FontManifest.json` генерируется из pubspec при сборке, поэтому это
/// именно то, что попало в приложение, а не то, что написано в исходнике.
Future<Map<String, Map<int, String>>> _bundled() async {
  final raw = await rootBundle.loadString('FontManifest.json');
  final families = <String, Map<int, String>>{};
  for (final entry in jsonDecode(raw) as List<dynamic>) {
    final family = (entry as Map<String, dynamic>)['family'] as String;
    final faces = <int, String>{};
    for (final face in entry['fonts'] as List<dynamic>) {
      final map = face as Map<String, dynamic>;
      // Начертание без `weight:` в pubspec Flutter считает обычным (400).
      faces[(map['weight'] as int?) ?? 400] = map['asset'] as String;
    }
    families[family] = faces;
  }
  return families;
}

/// Константы семейств из темы: имя константы → значение.
///
/// Берутся разбором исходника, а не перечислением здесь: перечисление
/// разошлось бы с темой молча, и новая константа осталась бы без присмотра.
Map<String, String> _themeFamilyConstants() {
  final source = File('lib/config/theme.dart').readAsStringSync();
  final found = <String, String>{};
  for (final match
      in RegExp(r"static const String (font\w*Family) = '([^']+)'")
          .allMatches(source)) {
    found[match.group(1)!] = match.group(2)!;
  }
  return found;
}

/// Файлы `.ttf` в `google_fonts/` — путями, как их пишет манифест.
Set<String> _filesOnDisk() => Directory('google_fonts')
    .listSync()
    .whereType<File>()
    .map(unixPath)
    .where((path) => path.endsWith('.ttf'))
    .toSet();

/// Вес, записанный в самом файле шрифта: `usWeightClass` таблицы OS/2.
int _weightClassOf(Uint8List bytes) {
  final data = ByteData.sublistView(bytes);
  final tables = data.getUint16(4);
  for (var i = 0; i < tables; i++) {
    final record = 12 + 16 * i;
    if (String.fromCharCodes(bytes.sublist(record, record + 4)) == 'OS/2') {
      return data.getUint16(data.getUint32(record + 8) + 4);
    }
  }
  throw StateError('в файле нет таблицы OS/2 — это не TrueType-шрифт');
}

/// Ширина строки, набранной семейством [family] с весом [weight].
///
/// Мера косвенная, но прямой нет: спросить у движка, какой файл он взял,
/// нельзя. Зато разные начертания одного семейства различаются метриками —
/// значит совпадение ширин означает, что начертание было одно.
Future<double> _widthOf(
  WidgetTester tester,
  String family,
  FontWeight weight,
) async {
  const sample = 'Заведения Могилёв 1234';
  await tester.pumpWidget(
    MaterialApp(
      home: Center(
        child: Text(
          sample,
          style:
              TextStyle(fontFamily: family, fontSize: 24, fontWeight: weight),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return tester.getSize(find.text(sample)).width;
}

/// Один запрос веса у семейства.
typedef _Request = ({
  String family,
  int weight,
  String where,
  bool viaTextTheme,
});

/// Вес, приписанный месту в коде, и семейство, которому он достанется.
///
/// Семейство определяется так: у `TextStyle` и у `textTheme.<слот>?.copyWith(…)`
/// с явным `fontFamily:` — названное константой (шесть заголовков экранов
/// входа меняют так слот на Unbounded); без него — body: `TextStyle` его
/// получает от темы, а все пятнадцать слотов темы — семейство тела.
List<_Request> _collectRequests(Map<String, String> constants) {
  final requests = <_Request>[];
  for (final file in libSources()) {
    final source = stripped(file.readAsStringSync());
    final path = unixPath(file);

    void add(String family, String args, int at, {bool viaTextTheme = false}) {
      for (final weight in _weightPattern
          .allMatches(args)
          .map((m) => _weightOf(m.group(1)!))
          .toSet()) {
        requests.add((
          family: family,
          weight: weight,
          where: '$path:${lineAt(source, at)}',
          viaTextTheme: viaTextTheme,
        ));
      }
    }

    String familyOf(String args) =>
        constants[_familyNamedIn(args) ?? 'fontBodyFamily']!;

    for (final match in _textStylePattern.allMatches(source)) {
      final args = argsAt(source, match.end - 1);
      add(familyOf(args), args, match.start);
    }

    for (final match in _copyWithPattern.allMatches(source)) {
      if (!_textThemeReceiver.hasMatch(source.substring(0, match.start))) {
        continue; // Другие приёмники — забота тревоги copyWith.
      }
      final args = argsAt(source, match.end - 1);
      add(familyOf(args), args, match.start, viaTextTheme: true);
    }
  }
  return requests;
}

/// Имя константы семейства (`fontDisplayFamily`), названной в аргументах
/// [args] как `fontFamily:`, или `null`, если семейство не названо либо
/// названо не константой (такое место отдельно ловит проверка «семейство
/// названо константой темы»).
String? _familyNamedIn(String args) => _familyConstant
    .firstMatch(RegExp(r'\bfontFamily\s*:\s*([^,)\n]*)')
            .firstMatch(args)
            ?.group(1)
            ?.trim() ??
        '')
    ?.group(1);

/// Места, где стиль создаётся.
final RegExp _textStylePattern = RegExp(r'\bTextStyle\s*\(');

/// Вес, выставленный поверх готового стиля.
final RegExp _copyWithPattern = RegExp(r'\.copyWith\s*\(');

/// Приёмник `.copyWith(` — слот textTheme: `theme.textTheme.titleMedium?`
/// (исходник обрезан по началу `.copyWith`).
final RegExp _textThemeReceiver = RegExp(r'\btextTheme\.\w+\s*[?!]?\s*$');

/// Значение `fontFamily:` — константа темы, с префиксом `AppTheme.` или без.
final RegExp _familyConstant = RegExp(r'^(?:AppTheme\.)?(font\w*Family)$');

/// Литерал веса. `FontWeight.normal` и `.bold` — те же 400 и 700.
final RegExp _weightPattern = RegExp(r'FontWeight\.(w[1-9]00|normal|bold)\b');

int _weightOf(String literal) => switch (literal) {
      'normal' => 400,
      'bold' => 700,
      _ => int.parse(literal.substring(1)),
    };
