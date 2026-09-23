import 'dart:io';

/// Разбор исходников `lib/` для сканирующих сторожей шрифтов.
///
/// Копия `mobile/test/support/dart_source_scan.dart`: тесты двух приложений
/// не могут импортировать друг друга. Сторож шрифтов admin-web
/// (`test/config/fonts_bundled_test.dart`, 15.09) держит свой разбор внутри
/// себя и этим файлом не пользуется.
///
/// Сторожа ищут места в коде по форме записи — вызов, скобка, аргументы, —
/// поэтому разбор обязан видеть скобки так, как их видит компилятор. Скобка
/// внутри строки или комментария закрыла бы список аргументов раньше времени,
/// и всё за ней сторож бы не увидел и промолчал; отсюда [stripped]. Промах
/// поиска в сканирующем стороже беззвучен: ноль находок выглядит как «всё
/// чисто», — поэтому у каждого сторожа свой якорь, требующий находок.

/// Исходники `lib/` в стабильном порядке.
List<File> libSources() => Directory('lib')
    .listSync(recursive: true)
    .whereType<File>()
    .where((entity) => entity.path.endsWith('.dart'))
    .toList()
  ..sort((a, b) => a.path.compareTo(b.path));

/// Путь с прямыми слэшами — одинаково на Windows и в CI.
String unixPath(File file) => file.path.replaceAll(r'\', '/');

/// Номер строки для смещения [offset] в [source] — чтобы отчёт указывал на
/// код.
int lineAt(String source, int offset) =>
    '\n'.allMatches(source.substring(0, offset)).length + 1;

/// Текст аргументов вызова: от открывающей скобки по адресу [open] до парной.
String argsAt(String source, int open) {
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

/// Именованные аргументы верхнего уровня в тексте [args]: имя → смещение
/// начала значения внутри [args] и само значение.
///
/// Верхний уровень — вне вложенных `()`, `[]`, `{}`: у `DefaultTextStyle(style:
/// …, child: Text(…, style: …))` свой `style:` только первый.
Map<String, ({int offset, String value})> namedArgs(String args) {
  final found = <String, ({int offset, String value})>{};
  var depth = 0;
  var start = 0;

  void segment(int end) {
    final text = args.substring(start, end);
    final match = RegExp(r'^\s*(\w+)\s*:(?!:)').firstMatch(text);
    if (match != null) {
      found[match.group(1)!] = (
        offset: start + match.end,
        value: text.substring(match.end),
      );
    }
  }

  for (var i = 0; i < args.length; i++) {
    final char = args[i];
    if (char == '(' || char == '[' || char == '{') depth++;
    if (char == ')' || char == ']' || char == '}') depth--;
    if (char == ',' && depth == 0) {
      segment(i);
      start = i + 1;
    }
  }
  segment(args.length);
  return found;
}

/// Исходник без комментариев и строковых литералов, с сохранением переводов
/// строк (и потому номеров строк).
String stripped(String source) {
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
      // Блочные комментарии в Dart вкладываются: `/* /* */ */` — один
      // комментарий, и первый `*/` его не закрывает.
      var depth = 0;
      var stop = i;
      while (stop < source.length) {
        if (source.startsWith('/*', stop)) {
          depth++;
          stop += 2;
        } else if (source.startsWith('*/', stop)) {
          depth--;
          stop += 2;
          if (depth == 0) break;
        } else {
          stop++;
        }
      }
      out.write('\n' * '\n'.allMatches(source.substring(i, stop)).length);
      i = stop;
      continue;
    }
    final char = source[i];
    if (char == "'" || char == '"') {
      // Сырая строка (`r'\s+'`) обратную косую не экранирует: `r'\'` —
      // законченный литерал, и пропуск символа после косой съел бы кавычку.
      final raw = i > 0 &&
          source[i - 1] == 'r' &&
          (i < 2 || !RegExp(r'\w').hasMatch(source[i - 2]));
      final quote = source.startsWith(char * 3, i) ? char * 3 : char;
      i += quote.length;
      while (i < source.length) {
        if (!raw && source[i] == r'\') {
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

/// Скобки очищенного исходника сходятся, и строк столько же, сколько было.
///
/// Разбор — не парсер Dart: строка с кавычкой того же вида внутри `${…}`
/// выбила бы его из синхрона молча, и всё после неё читалось бы наизнанку.
/// Эта проверка превращает такой сбой в красный прогон вместо тихого пропуска:
/// возвращает описание расхождения или `null`, если всё сошлось.
String? strippingMismatch(String source) {
  final clean = stripped(source);
  if ('\n'.allMatches(clean).length != '\n'.allMatches(source).length) {
    return 'число строк изменилось';
  }
  for (final pair in const <List<String>>[
    <String>['(', ')'],
    <String>['[', ']'],
    <String>['{', '}'],
  ]) {
    var depth = 0;
    for (var i = 0; i < clean.length; i++) {
      if (clean[i] == pair[0]) depth++;
      if (clean[i] == pair[1]) depth--;
      if (depth < 0) return 'лишняя «${pair[1]}» у строки ${lineAt(clean, i)}';
    }
    if (depth != 0) return 'не закрыто «${pair[0]}»: $depth';
  }
  return null;
}
