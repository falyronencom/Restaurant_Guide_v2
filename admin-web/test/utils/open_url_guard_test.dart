import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/utils/open_url_features.dart';

import '../helpers/dart_source_scan.dart';

// Сторож ссылок из панели в новую вкладку (сверка меток панели 29.10, «Вне
// меток» п. 2): новая вкладка не должна получать связь с вкладкой панели
// (`window.opener`) и её адрес. Вкладку на Dart VM не открыть, поэтому
// сторож читает исходник: все внешние адреса идут через один путь, и он
// передаёт запрет третьим аргументом `window.open`. Что строка доехала до
// бандла и работает, проверено в собранной панели (PR «укрепление панели»).

const String _webImpl = 'lib/utils/open_url_web.dart';

void main() {
  test('запрет связи с вкладкой панели — noopener и noreferrer', () {
    final features = kNewTabFeatures.split(',').map((f) => f.trim()).toSet();
    expect(features, containsAll(<String>['noopener', 'noreferrer']));
  });

  test('открытие вкладки передаёт запрет третьим аргументом window.open', () {
    final source = stripped(File(_webImpl).readAsStringSync());
    // Первое вхождение — объявление `external void _windowOpen(…)`, дальше —
    // вызовы, и каждый обязан передать запрет.
    final calls = RegExp(r'_windowOpen\(').allMatches(source).skip(1).toList();
    expect(calls, isNotEmpty, reason: '$_webImpl: вызова _windowOpen нет');
    for (final call in calls) {
      final args = argsAt(source, call.end - 1).split(',');
      expect(args, hasLength(3),
          reason: 'строка ${lineAt(source, call.start)}: три аргумента');
      expect(args.last.trim(), 'kNewTabFeatures.toJS',
          reason: 'строка ${lineAt(source, call.start)}');
    }
  });

  test('внешние адреса открывает только openInNewTab', () {
    // Второй путь мимо openInNewTab (свой window.open, url_launcher, ссылка
    // HTML) открыл бы вкладку без запрета.
    final offenders = <String>[];
    var anchor = 0;
    for (final file in libSources()) {
      final path = unixPath(file);
      // Без комментариев, но со строками: импорт пакета и имя в @JS(…) —
      // строки, а в документации эти имена упоминаются законно.
      final source = _withoutComments(file.readAsStringSync());
      if (path == _webImpl) {
        if (source.contains("@JS('window.open')")) anchor++;
        continue;
      }
      for (final pattern in <String>[
        'window.open',
        'launchUrl',
        'url_launcher',
        'AnchorElement',
        'HTMLAnchorElement',
      ]) {
        if (source.contains(pattern)) offenders.add('$path: $pattern');
      }
    }
    // Якорь: разбор, не нашедший и сам путь, молчал бы о любом обходе.
    expect(anchor, 1, reason: '$_webImpl: объявления window.open не найдено');
    expect(offenders, isEmpty);
  });
}

/// Исходник без комментариев `//` и `/* */`. Грубо: `//` внутри строки
/// (адрес) обрезает её хвост — для поиска имён это безразлично.
String _withoutComments(String source) => source
    .replaceAll(RegExp(r'/\*.*?\*/', dotAll: true), '')
    .replaceAll(RegExp(r'//[^\n]*'), '');
