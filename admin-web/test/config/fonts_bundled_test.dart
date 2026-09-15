import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Сторож шрифтов канона: объявление, файлы и запрошенные веса.
///
/// **Где здесь шов.** Шрифты объявлены семействами в pubspec (`flutter:
/// fonts:`), и файл под запрошенный вес выбирает сам Flutter. Ошибиться можно
/// с трёх сторон, и ни одна не падает — все три уводят текст на чужое
/// начертание МОЛЧА:
///
/// 1. файл лежит в `google_fonts/`, но в pubspec не объявлен — мёртвый груз;
/// 2. имя семейства в коде разошлось с `family:` в pubspec — опечатку не
///    поймает компилятор, текст уедет на системный шрифт;
/// 3. код просит вес, которого у семейства нет, — движок нарисует
///    синтетическое утолщение поверх ближайшего начертания.
///
/// Третий случай — причина, по которой устройство вообще поменяли. Пока
/// шрифты шли через `google_fonts`, пакет регистрировал каждое начертание
/// ОТДЕЛЬНЫМ семейством, и любой вес поверх темы упирался в семейство с одним
/// начертанием: с 11.08 по 15.09.2026 синтетикой рисовались все веса панели, а
/// `NunitoSans-Bold.ttf` не использовался ни разу. Прежний сторож этого не
/// видел — он сверял состав сборки, то есть первую сторону шва, и оставался
/// зелёным.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// Собранное объявление шрифтов: семейство → вес → путь файла.
  ///
  /// `FontManifest.json` генерируется из pubspec при сборке, поэтому это
  /// именно то, что попало в приложение, а не то, что написано в исходнике.
  Future<Map<String, Map<int, String>>> bundled() async {
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
  Map<String, String> themeFamilyConstants() {
    final source = File('lib/config/theme.dart').readAsStringSync();
    final found = <String, String>{};
    for (final match
        in RegExp(r"static const String (font\w*Family) = '([^']+)'")
            .allMatches(source)) {
      found[match.group(1)!] = match.group(2)!;
    }
    return found;
  }

  group('Объявленное против лежащего на диске', () {
    test('каждый .ttf из google_fonts/ объявлен, и каждое объявление — файл',
        () async {
      // Только семейства канона: `MaterialIcons` в манифест кладёт сам Flutter
      // по `uses-material-design`, его файл лежит не у нас и нас не касается.
      final ours = themeFamilyConstants().values.toSet();
      final declared = <String>{};
      for (final entry in (await bundled()).entries) {
        if (ours.contains(entry.key)) {
          declared.addAll(entry.value.values);
        }
      }
      final onDisk = Directory('google_fonts')
          .listSync()
          .whereType<File>()
          .map((file) => file.path.replaceAll(r'\', '/'))
          .where((path) => path.endsWith('.ttf'))
          .toSet();

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
            'сборку он попадёт, а выбрать его будет нечем — мёртвый груз. '
            'Либо объявить начертание, либо убрать файл',
      );
    });
  });

  group('Семейства канона объявлены и собраны', () {
    test('каждая константа font*Family темы отвечает объявленному семейству',
        () async {
      final families = await bundled();
      final constants = themeFamilyConstants();

      expect(constants.length, greaterThanOrEqualTo(5),
          reason: 'разбор темы почти не нашёл констант семейств — изменилась '
              'форма объявления, и сторож перестал что-либо стеречь');

      for (final entry in constants.entries) {
        expect(
          families.keys,
          contains(entry.value),
          reason: 'AppTheme.${entry.key} = «${entry.value}», а такого '
              'семейства в сборке нет. Имя в коде ищется ТОЧНО: расхождение с '
              '`family:` в pubspec компилятор не заметит, а текст молча уедет '
              'на системный шрифт',
        );
      }
    });
  });

  group('Вес доходит до своего начертания', () {
    // Проверки выше читают объявления — текст pubspec и текст lib/. Здесь
    // проверяется поведение: что движок действительно берёт РАЗНЫЕ файлы под
    // разные веса. Ровно это и было сломано с 11.08 по 15.09.2026, когда
    // семейство держало одно начертание, а вес поверх него давал синтетику.
    //
    // Шрифты в сьюте настоящие: их грузит test/flutter_test_config.dart. Без
    // загрузки весь замер был бы бессмыслен — подставной шрифт даёт одинаковые
    // метрики любому весу, и тест зеленел бы, ничего не проверяя.
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
    /// Вес, приписанный месту в коде, и семейство, которому он достанется.
    ///
    /// Семейство определяется так: у помощника оно своё; у `TextStyle` с явным
    /// `fontFamily:` — названное; у `TextStyle` без него — body, потому что
    /// именно его тема раздаёт всему тексту.
    List<_Request> collectRequests(Map<String, String> constants) {
      final requests = <_Request>[];
      for (final file in _libSources()) {
        final source = _stripped(file.readAsStringSync());
        final path = file.path.replaceAll(r'\', '/');

        for (final match in _blockPattern.allMatches(source)) {
          final helper = match.group(1);
          final args = _argsAt(source, match.end - 1);
          final line =
              '\n'.allMatches(source.substring(0, match.start)).length + 1;
          final at = '$path:$line';

          final weights = _weightPattern
              .allMatches(args)
              .map((m) => _weightOf(m.group(1)!))
              .toSet();
          if (weights.isEmpty) {
            // Вес не выставлен (или передан переменной — тогда он придёт от
            // вызывающего, и разобран будет там). Требовать нечего.
            continue;
          }

          final String family;
          if (helper != null) {
            family = helper == 'mono'
                ? constants['fontMonoFamily']!
                : constants['fontDisplayFamily']!;
          } else {
            final named = RegExp(r'fontFamily:\s*(?:AppTheme\.)?(font\w*Family)')
                .firstMatch(args);
            family = named == null
                ? constants['fontBodyFamily']!
                : constants[named.group(1)!]!;
          }

          for (final weight in weights) {
            requests.add(_Request(family, weight, at));
          }
        }
      }
      return requests;
    }

    test('разбор находит места, а не зеленеет на пустом месте', () {
      // Сканирующий тест зеленеет и от сломанного поиска: не тот каталог, не
      // та форма — находок ноль, требований ноль, прогон зелёный. Якорь держит
      // сам поиск, а не итог сверки, поэтому при невшитом весе он остаётся
      // зелёным: краснеет сверка ниже.
      final sources = _libSources();
      expect(sources.length, greaterThan(20),
          reason: 'обход lib/ почти ничего не прочитал');

      final requests = collectRequests(themeFamilyConstants());
      expect(requests.length, greaterThan(50),
          reason: 'разбор нашёл подозрительно мало мест с весом — изменилась '
              'форма записи стилей, и сторож перестал что-либо стеречь');
      expect(
        requests.map((request) => request.family).toSet(),
        containsAll(<String>[AppTheme.fontBodyFamily, AppTheme.fontMonoFamily]),
        reason: 'разбор не приписал ни одного веса body или моно — сломалось '
            'определение семейства',
      );
    });

    test('вес нигде не приходит через copyWith — иначе разбор его не увидит',
        () {
      // Разбор приписывает вес семейству по месту, где стиль СОЗДАЁТСЯ.
      // `copyWith(fontWeight: ...)` меняет вес у готового стиля, то есть у
      // чужого семейства, и такому месту сторож семейство назвать не может.
      // Сегодня таких мест нет; появится — пусть прогон об этом скажет, а не
      // промолчит.
      final offenders = <String>[];
      for (final file in _libSources()) {
        final source = _stripped(file.readAsStringSync());
        for (final match in RegExp(r'\.copyWith\s*\(').allMatches(source)) {
          final args = _argsAt(source, match.end - 1);
          if (_weightPattern.hasMatch(args)) {
            final line =
                '\n'.allMatches(source.substring(0, match.start)).length + 1;
            offenders.add('${file.path.replaceAll(r'\', '/')}:$line');
          }
        }
      }
      expect(
        offenders,
        isEmpty,
        reason: 'здесь вес выставляется поверх готового стиля: $offenders. '
            'Сторож не может назвать семейство такому месту — либо создавать '
            'стиль с нужным весом сразу, либо научить разбор этой форме',
      );
    });

    test('каждому запрошенному весу отвечает объявленное начертание', () async {
      final families = await bundled();

      for (final request in collectRequests(themeFamilyConstants())) {
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
class _Request {
  const _Request(this.family, this.weight, this.where);

  /// Семейство так, как оно объявлено в pubspec: `NunitoSans`, `Onest`.
  final String family;

  /// Числовой вес: 400, 600, …
  final int weight;

  /// Место, `файл:строка` — чтобы отчёт указывал на код.
  final String where;
}

/// Исходники `lib/`, по которым идёт разбор.
List<File> _libSources() => Directory('lib')
    .listSync(recursive: true)
    .whereType<File>()
    .where((entity) => entity.path.endsWith('.dart'))
    .toList()
  ..sort((a, b) => a.path.compareTo(b.path));

/// Места, где стиль создаётся: помощники темы и сырой `TextStyle`.
final RegExp _blockPattern =
    RegExp(r'AppTheme\.(unbounded|mono)\s*\(|TextStyle\s*\(');

/// Литерал веса. `FontWeight.normal` и `.bold` — те же 400 и 700.
final RegExp _weightPattern = RegExp(r'FontWeight\.(w[1-9]00|normal|bold)\b');

int _weightOf(String literal) => switch (literal) {
      'normal' => 400,
      'bold' => 700,
      _ => int.parse(literal.substring(1)),
    };

/// Текст аргументов вызова: от открывающей скобки по адресу [open] до парной.
String _argsAt(String source, int open) {
  var depth = 0;
  for (var i = open; i < source.length; i++) {
    if (source[i] == '(') depth++;
    if (source[i] == ')') {
      depth--;
      if (depth == 0) return source.substring(open + 1, i);
    }
  }
  return '';
}

/// Исходник без комментариев и строковых литералов, с сохранением переводов
/// строк.
///
/// Разбор идёт по скобкам, а скобка внутри строки или комментария закрыла бы
/// список аргументов раньше времени — вес за ней сторож бы не увидел и
/// промолчал. Комментарии убираются и затем, чтобы разобранный пример стиля в
/// документации не попал в находки.
String _stripped(String source) {
  final out = StringBuffer();
  var i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      while (i < source.length && source[i] != '\n') {
        i++;
      }
      continue;
    }
    if (source.startsWith('/*', i)) {
      final end = source.indexOf('*/', i);
      final stop = end == -1 ? source.length : end + 2;
      out.write('\n' * '\n'.allMatches(source.substring(i, stop)).length);
      i = stop;
      continue;
    }
    final char = source[i];
    if (char == "'" || char == '"') {
      final quote = source.startsWith(char * 3, i) ? char * 3 : char;
      i += quote.length;
      while (i < source.length) {
        if (source[i] == r'\') {
          i += 2;
          continue;
        }
        if (source.startsWith(quote, i)) {
          i += quote.length;
          break;
        }
        if (source[i] == '\n') {
          out.write('\n');
        }
        i++;
      }
      continue;
    }
    out.write(char);
    i++;
  }
  return out.toString();
}
