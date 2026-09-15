import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:leak_tracker_flutter_testing/leak_tracker_flutter_testing.dart';

/// Отслеживание течей — на весь сьют admin-web.
///
/// **Включается здесь, а не в отдельных файлах.** Пофайловый выключатель, про
/// который забудут на следующем экране, хуже отсутствия сторожа: он создаёт
/// видимость покрытия. Здесь же новый тест попадает под проверку по факту
/// своего существования.
///
/// Ловушка, стоившая одной холостой пробы: параметр `experimentalLeakTesting`
/// у `testWidgets` сам по себе НИЧЕГО не включает — без `LeakTesting.enable()`
/// настройки читаются, а отслеживание не работает, и мутация «снять dispose»
/// проходит зелёной. Проверять сторожа надо мутацией, иначе «течей нет» и
/// «отслеживание выключено» неотличимы.
///
/// Что ловится: объект, доживший до сборки мусора без `dispose` —
/// `ChangeNotifier`, `TextEditingController`, `AnimationController` и прочие
/// `Disposable`. Это касается и стенда: незакрытый провайдер-заглушка
/// сообщает о течи ТЕСТА и маскирует проверяемую, поэтому свои объекты тест
/// освобождает сам (`addTearDown(provider.dispose)`).
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  LeakTesting.enable();
  LeakTesting.settings = LeakTesting.settings
      .withTracked(allNotDisposed: true)
      // Распознаватели жестов исключены осознанно: их создаёт САМ фреймворк
      // внутри своих виджетов (в `lib/` нет ни одного `GestureRecognizer` —
      // проверено грепом), и освободить их нам нечем. 294 неустранимых находки
      // научили бы всех пропускать отчёт целиком, вместе с настоящими течами.
      // Если однажды заведём распознаватель сами — строку убрать.
      .withIgnored(classes: <String>[
        'TapGestureRecognizer',
        'PanGestureRecognizer',
        'LongPressGestureRecognizer',
      ]);
  await _loadBundledFonts();
  await testMain();
}

/// Шрифты сборки грузятся на весь сьют — иначе весь слой геометрии врёт.
///
/// `flutter test` объявленные в pubspec семейства САМ не подключает: текст
/// рисуется подставным шрифтом, у которого каждый глиф — квадрат в кегль.
/// Метрики такого шрифта не совпадают ни с Nunito Sans, ни с Unbounded, а
/// половина сторожей панели меряет именно геометрию — переполнения шапки,
/// высоту панелей, раскладку скелетонов. Без загрузки они сверяли бы вёрстку с
/// несуществующим шрифтом: и зелёный, и красный значили бы не то.
///
/// Это не новая потребность, а восстановление прежнего свойства. Пока шрифты
/// шли через `google_fonts`, пакет звал `FontLoader` сам, и часть семейств в
/// сьюте оказывалась настоящей — побочным эффектом, о котором нигде не было
/// сказано. Переход на объявление в pubspec этот побочный эффект убрал, и
/// сорок пять тестов геометрии разом поехали. Теперь загрузка явная.
///
/// Состав берётся из `FontManifest.json`, то есть из того, что реально попало
/// в сборку: перечислять семейства здесь значило бы завести второй список,
/// который разойдётся с pubspec молча.
Future<void> _loadBundledFonts() async {
  TestWidgetsFlutterBinding.ensureInitialized();
  final manifest = jsonDecode(
    await rootBundle.loadString('FontManifest.json'),
  ) as List<dynamic>;

  for (final entry in manifest) {
    final family = (entry as Map<String, dynamic>)['family'] as String;
    final loader = FontLoader(family);
    for (final face in entry['fonts'] as List<dynamic>) {
      loader.addFont(
        rootBundle.load((face as Map<String, dynamic>)['asset'] as String),
      );
    }
    await loader.load();
  }
}
