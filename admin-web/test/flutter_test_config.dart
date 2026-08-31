import 'dart:async';

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
  await testMain();
}
