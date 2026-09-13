import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Сторож шрифтов канона: и состав сборки, и запрошенные у пакета начертания.
///
/// **Почему одной проверки состава мало.** Первая группа ниже проверяет, что
/// перечисленные .ttf попали в AssetManifest. Она смотрит на одну сторону
/// шва — и остаётся зелёной при дефекте, который до 13.09.2026 жил на проде:
/// `GoogleFonts.josefinSans()` и `GoogleFonts.onest()` вызывались без веса,
/// то есть просили Regular, а вшит у обоих только SemiBold. Файлы лежали в
/// сборке, состав сходился, а вордмарк и заголовки карточек рисовались
/// системным шрифтом.
///
/// **Вторая сторона шва — что код у пакета ЗАПРАШИВАЕТ.** `google_fonts`
/// регистрирует КАЖДОЕ начертание отдельным семейством и возвращает имя
/// ровно того, которое запросили. При `allowRuntimeFetching = false`
/// невшитое начертание не регистрируется: возвращённое имя не разрешается,
/// и текст молча уезжает на системный шрифт — ни падения, ни красного
/// прогона. Вторая группа сводит стороны: разбирает вызовы пакета в `lib/` и
/// требует, чтобы каждому запрошенному весу отвечал вшитый файл.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Состав сборки', () {
    test('файлы шрифтов канона попали в AssetManifest', () async {
      // Проверка одной стороны шва: файл лежит в сборке. Что код просит
      // именно это начертание — проверяет вторая группа.
      final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
      final assets = manifest.listAssets().toSet();

      const required = <String>[
        // Дисплейный — заголовки экранов и числа метрик.
        'google_fonts/Unbounded-Regular.ttf',
        // Body — четыре начертания.
        'google_fonts/NunitoSans-Regular.ttf',
        'google_fonts/NunitoSans-Medium.ttf',
        'google_fonts/NunitoSans-SemiBold.ttf',
        'google_fonts/NunitoSans-Bold.ttf',
        // Заголовок карточки-витрины.
        'google_fonts/Onest-SemiBold.ttf',
        // Вордмарк NIRIVIO.
        'google_fonts/JosefinSans-SemiBold.ttf',
        // Табличные данные — даты, id, УНП (кадры 11–13, дальше таблицы).
        'google_fonts/JetBrainsMono-Regular.ttf',
        'google_fonts/JetBrainsMono-Medium.ttf',
      ];

      for (final font in required) {
        expect(
          assets,
          contains(font),
          reason: '$font не попал в сборку — интерфейс подменит его системным '
              'молча, без ошибки',
        );
      }
    });
  });

  group('Запрошенное у пакета против вшитого', () {
    /// Метод пакета → семейство в имени вшитого файла.
    ///
    /// Имя файла пакет складывает как `Семейство-Начертание.ttf`
    /// (`GoogleFontsFamilyWithVariant.toApiFilenamePrefix`) и ищет в
    /// манифесте сравнением С УЧЁТОМ РЕГИСТРА. Поэтому семейство записано
    /// так, как его пишет сам пакет, а не выведено из имени метода: вывод
    /// регистра работает не всегда (`ibmPlexSans` → `IBMPlexSans`).
    /// Незнакомый метод сторож молча не пропускает.
    const familyOfCall = <String, String>{
      'unbounded': 'Unbounded',
      'nunitoSans': 'NunitoSans',
      'josefinSans': 'JosefinSans',
      'onest': 'Onest',
      'jetBrainsMono': 'JetBrainsMono',
    };

    /// Вес → часть имени файла, по схеме
    /// `GoogleFontsVariant.toApiFilenamePart`. w400 в имени зовётся Regular.
    const variantOfWeight = <int, String>{
      100: 'Thin',
      200: 'ExtraLight',
      300: 'Light',
      400: 'Regular',
      500: 'Medium',
      600: 'SemiBold',
      700: 'Bold',
      800: 'ExtraBold',
      900: 'Black',
    };

    /// Обёртки `AppTheme`, передающие вес в вызов пакета переменной.
    ///
    /// В самом вызове веса не видно — он приходит от вызывающего. Значит по
    /// вызову пакета такую обёртку не проверить, и разбирать надо её вызовы.
    /// Ключ — имя обёртки, значение — семейство, которое она просит.
    const weightForwardingWrappers = <String, String>{
      'unbounded': 'Unbounded',
      'mono': 'JetBrainsMono',
    };

    /// Вес, который обёртка просит, когда вызывающий его не передал.
    ///
    /// Читается из объявления параметра, а не записан здесь числом:
    /// умолчание в сигнатуре — живой факт, оно может уехать. Параметр без
    /// умолчания (`FontWeight? fontWeight`) отдаёт пакету null, а пакет
    /// разрешает null в w400 (`textStyle.fontWeight ?? FontWeight.w400`).
    int wrapperDefaultWeight(String source, String wrapper) {
      final decl =
          RegExp('static\\s+TextStyle\\s+$wrapper\\s*\\(').firstMatch(source);
      expect(
        decl,
        isNotNull,
        reason: 'обёртка $wrapper не найдена в theme.dart — сторож разбирает '
            'её вызовы, но самой обёртки уже нет',
      );
      final params = _argsAt(source, decl!.end - 1);
      final withDefault =
          RegExp(r'FontWeight\s+fontWeight\s*=\s*FontWeight\.w([1-9])00')
              .firstMatch(params);
      if (withDefault != null) {
        return int.parse(withDefault.group(1)!) * 100;
      }
      expect(
        params,
        contains('FontWeight? fontWeight'),
        reason: 'у $wrapper параметр fontWeight изменил форму — умолчание '
            'больше не выводится, и сторож пойдёт по неверному весу',
      );
      return 400;
    }

    /// Исходники `lib/`, по которым идёт разбор.
    List<File> libSources() => Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((entity) => entity.path.endsWith('.dart'))
        .toList()
      ..sort((a, b) => a.path.compareTo(b.path));

    /// Все запросы начертаний, собранные с исходников `lib/`.
    ///
    /// Разбор по тексту: спросить у собранного приложения, какие начертания
    /// оно попросит, сторож не может — вызовы происходят при первом
    /// обращении к экранам, а не в тесте.
    List<_Request> collectRequests() {
      final theme = _stripped(File('lib/config/theme.dart').readAsStringSync());
      final defaults = <String, int>{
        for (final wrapper in weightForwardingWrappers.keys)
          wrapper: wrapperDefaultWeight(theme, wrapper),
      };

      final requests = <_Request>[];
      for (final file in libSources()) {
        final source = _stripped(file.readAsStringSync());
        final path = file.path.replaceAll(r'\', '/');

        for (final call in _callPattern.allMatches(source)) {
          final packageCall = call.group(2);
          final wrapperCall = call.group(3);
          final args = _argsAt(source, call.end - 1);
          final line =
              '\n'.allMatches(source.substring(0, call.start)).length + 1;
          final at = '$path:$line';

          final weights = _weightPattern
              .allMatches(args)
              .map((match) => _weightOf(match.group(1)!))
              .toSet();

          if (packageCall == null) {
            final family = weightForwardingWrappers[wrapperCall]!;
            for (final weight
                in weights.isEmpty ? {defaults[wrapperCall]!} : weights) {
              requests.add(_Request(family, weight, at));
            }
            continue;
          }

          // `nunitoSansTextTheme` — тот же вызов пакета, только сразу по всем
          // слотам TextTheme: веса берутся из переданного литерала, слот без
          // веса просит w400.
          final method = packageCall.endsWith('TextTheme')
              ? packageCall.substring(
                  0, packageCall.length - 'TextTheme'.length)
              : packageCall;
          final family = familyOfCall[method];
          expect(
            family,
            isNotNull,
            reason: 'вызов GoogleFonts.$packageCall в $at просит семейство, '
                'которого сторож не знает: впишите его в familyOfCall так, '
                'как имя пишет сам пакет, и вшейте нужные .ttf',
          );

          if (weights.isEmpty && args.contains('fontWeight:')) {
            // Вес передан выражением — из вызова его не видно. Так можно
            // только в обёртках, чьи вызовы сторож разбирает отдельно; иначе
            // начертания этого вызова не проверяет никто.
            final wrapper = _enclosingStyleHelper(source, call.start);
            expect(
              weightForwardingWrappers.keys,
              contains(wrapper),
              reason: 'в $at вес уходит в пакет выражением из «$wrapper» — '
                  'научите сторожа этой обёртке (weightForwardingWrappers и '
                  'разбор её вызовов), иначе её начертания без присмотра',
            );
            continue;
          }

          for (final weight in weights.isEmpty ? const {400} : weights) {
            requests.add(_Request(family!, weight, at));
          }
        }
      }
      return requests;
    }

    test('разбор находит вызовы, а не зеленеет на пустом месте', () {
      // Сканирующий тест зеленеет и от сломанного поиска: не тот каталог, не
      // та форма вызова — находок ноль, требований ноль, прогон зелёный.
      // Якорь держит сам поиск, а не итог сверки, поэтому при невшитом
      // начертании он остаётся зелёным — краснеет сверка ниже.
      final sources = libSources();
      expect(sources.length, greaterThan(20),
          reason: 'обход lib/ почти ничего не прочитал');

      expect(
        collectRequests().map((request) => request.family).toSet(),
        containsAll(familyOfCall.values),
        reason: 'разбор не нашёл вызовов части семейств канона — изменилась '
            'форма вызова, и сторож перестал что-либо стеречь',
      );

      final all = sources.map((file) => file.readAsStringSync()).join();
      for (final wrapper in weightForwardingWrappers.keys) {
        expect(
          RegExp('AppTheme\\.$wrapper\\s*\\(').hasMatch(all),
          isTrue,
          reason: 'вызовов AppTheme.$wrapper не найдено — либо обёртка мертва '
              'и строку надо снять, либо разбор её вызовов сломан',
        );
      }
    });

    test('каждому запрошенному начертанию отвечает вшитый файл', () async {
      final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
      final assets = manifest.listAssets().toSet();

      for (final request in collectRequests()) {
        final variant = variantOfWeight[request.weight];
        expect(
          variant,
          isNotNull,
          reason: 'вес ${request.weight} в ${request.where} не из шкалы '
              'google_fonts',
        );
        final asset = 'google_fonts/${request.family}-$variant.ttf';
        expect(
          assets,
          contains(asset),
          reason: '${request.where} просит у пакета ${request.family} '
              'w${request.weight}, а $asset в сборку не вшит. При '
              'allowRuntimeFetching = false пакет это начертание не '
              'зарегистрирует: имя семейства не разрешится, и текст молча '
              'уедет на системный шрифт. Либо просить вшитый вес, либо — с '
              'решения владельца — вшить .ttf и назвать его в первой группе',
        );
      }
    });
  });
}

/// Один запрос начертания у `google_fonts`.
class _Request {
  const _Request(this.family, this.weight, this.where);

  /// Семейство так, как пишет его пакет: `JosefinSans`, `NunitoSans`.
  final String family;

  /// Числовой вес: 400, 600, …
  final int weight;

  /// Место вызова, `файл:строка` — чтобы отчёт указывал на код.
  final String where;
}

/// Вызовы, доносящие вес до пакета: сам пакет и обёртки `AppTheme`,
/// передающие вес переменной.
final RegExp _callPattern =
    RegExp(r'(GoogleFonts\.([A-Za-z0-9]+)|AppTheme\.(unbounded|mono))\s*\(');

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

/// Имя ближайшего объявления `static TextStyle <имя>(` выше позиции.
String? _enclosingStyleHelper(String source, int index) {
  String? last;
  for (final match in RegExp(r'static\s+TextStyle\s+(\w+)\s*\(')
      .allMatches(source)) {
    if (match.start > index) break;
    last = match.group(1);
  }
  return last;
}

/// Исходник без комментариев и строковых литералов, с сохранением переводов
/// строк.
///
/// Разбор идёт по скобкам, а скобка внутри строки или комментария закрыла бы
/// список аргументов раньше времени — вес за ней сторож бы не увидел и
/// промолчал. Комментарии убираются и затем, чтобы разобранный пример вызова
/// в документации не попал в находки.
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
