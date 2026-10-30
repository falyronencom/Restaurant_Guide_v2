import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Сторож слова: в текстах приложения — «учётная запись», не «аккаунт» и не
/// «учётка» (слово Координатора 29.10.2026). Прошлый проход по словам
/// пропустил «Аккаунт с таким email уже существует.» — поиск не видел
/// заглавную «А»; сторож ищет оба регистра.
///
/// Смотрятся строки в кавычках в `lib/` — то, что может дойти до экрана.
/// Комментарии и журнал отладки (`debugPrint`) — не текст для человека.
void main() {
  test('в текстах приложения нет «аккаунт» и «учётка»', () {
    final word = RegExp('[Аа]ккаунт|[Уу]чётк');
    final quoted = RegExp(r"'(?:[^'\\]|\\.)*'" '|' r'"(?:[^"\\]|\\.)*"');
    final found = <String>[];
    var scanned = 0;

    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      scanned++;
      final lines = entity.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i].trimLeft();
        if (line.startsWith('//') || line.startsWith('*')) continue;
        if (line.contains('debugPrint(')) continue;
        for (final m in quoted.allMatches(line)) {
          if (word.hasMatch(m.group(0)!)) {
            found.add('${entity.path}:${i + 1}: ${m.group(0)}');
          }
        }
      }
    }

    // Разбор, который ничего не прочитал, прошёл бы и со словом.
    expect(scanned, greaterThan(100), reason: 'lib/ не прочитан');
    expect(found, isEmpty);
  });
}
