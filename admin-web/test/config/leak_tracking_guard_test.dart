import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:leak_tracker_flutter_testing/leak_tracker_flutter_testing.dart';

/// Сторож самого сторожа течей.
///
/// Отслеживание включается в `test/flutter_test_config.dart` и потому легко
/// гаснет молча: `flutter test` берёт БЛИЖАЙШИЙ конфиг вверх по дереву, и файл
/// `test/screens/flutter_test_config.dart` выключил бы проверку для всей папки,
/// ничего не изменив в выводе. Точно так же гасит отдельный тест, переприсвоив
/// `LeakTesting.settings` или передав `experimentalLeakTesting` с исключением
/// всего.
///
/// Отсюда два утверждения: настройки действительно те, что задумывались, и в
/// сьюте нет второго места, где их переопределяют.
void main() {
  test('отслеживание включено и настроено ожидаемо', () {
    expect(LeakTesting.enabled, isTrue);

    final ignored = LeakTesting.settings.ignoredLeaks.notDisposed;
    expect(ignored.ignoreAll, isFalse,
        reason: 'исключение ВСЕГО сделало бы отчёт пустым при любой течи');
    expect(
      ignored.byClass.keys.toSet(),
      <String>{
        'TapGestureRecognizer',
        'PanGestureRecognizer',
        'LongPressGestureRecognizer',
      },
      reason: 'список исключений расширяют осознанно, а не по ходу отладки',
    );
  });

  test('исключение распознавателей жестов остаётся обоснованным', () {
    // Оно снимает КЛАСС, а не чужое владение: заведём распознаватель сами —
    // например `TextSpan(recognizer: TapGestureRecognizer())` в одной из восьми
    // площадок `Text.rich`, — и течь будет наша, а сторож промолчит.
    // Проверка привязывает исключение к его основанию.
    final own = <String>[];
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      if (entity.readAsStringSync().contains('GestureRecognizer')) {
        own.add(entity.path);
      }
    }

    expect(own, isEmpty,
        reason: 'появился свой распознаватель — снять его класс из исключений '
            'в test/flutter_test_config.dart');
  });

  test('второго конфига и точечных отключений в сьюте нет', () {
    final offenders = <String>[];

    for (final entity in Directory('test').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;

      final path = entity.path.replaceAll(r'\', '/');
      final isRootConfig = path.endsWith('test/flutter_test_config.dart');
      // Сам сторож пропускается: искомые строки лежат в его собственных
      // сообщениях, и без исключения он ловит себя. Дырой это не становится —
      // здесь записано само правило, и правка в нём видна по определению.
      if (path.endsWith('test/config/leak_tracking_guard_test.dart')) continue;

      if (path.endsWith('flutter_test_config.dart') && !isRootConfig) {
        // Ближайший конфиг побеждает — такой файл выключил бы проверку для
        // своей папки, не изменив ни строчки вывода.
        offenders.add('${entity.path}: второй flutter_test_config');
        continue;
      }
      if (isRootConfig) continue;

      final source = entity.readAsStringSync();
      if (source.contains('LeakTesting.settings =')) {
        offenders.add('${entity.path}: переприсваивает LeakTesting.settings');
      }
      if (source.contains('experimentalLeakTesting')) {
        offenders.add('${entity.path}: гасит отслеживание точечно');
      }
    }

    expect(offenders, isEmpty);
  });
}
