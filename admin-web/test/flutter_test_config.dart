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
  // Биндинг сбрасывается после КАЖДОГО теста — тем же публичным и
  // идемпотентным `reset()`, который flutter_test сам зовёт в НАЧАЛЕ
  // виджет-теста. Без этого последний тест файла, где кончилась прокрутка
  // (переход по вкладке `TabBarView`, листание `PageView`, бросок списка),
  // отчитывается о течи `TestRestorationManager` с его корневой
  // `RestorationBucket`: конец прокрутки (`ScrollableState.saveOffset` →
  // `flushData()`) будит менеджер, биндинг создаёт его лениво, а освобождает
  // только в `reset()` следующего теста, которого у последнего нет. Течь
  // стенда, не продукта, — и зелёный файл держался на том, какой тест стоит
  // последним.
  //
  // Порядок гарантирован: корневой `tearDown` идёт после `addTearDown` теста
  // и `binding.postTest`, но до `tearDownAll` файла, где сторож собирает
  // отчёт. Обычные `test()` сброс не задевает: из каналов он трогает только
  // `SystemChannels.textInput`, ставя туда обработчик самого flutter_test.
  // Тест, повесивший на этот канал свой обработчик в `setUpAll`, потерял бы
  // его после первого теста — таких в сьюте нет. Классы стенда в исключения
  // не вносить: исключение снимает класс целиком, вместе с настоящими течами.
  // Сторож этой строки — группа в конце
  // `test/config/leak_tracking_guard_test.dart`.
  tearDown(TestWidgetsFlutterBinding.ensureInitialized().reset);
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
