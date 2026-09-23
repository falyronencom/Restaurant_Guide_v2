import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Настройка всего сьюта mobile: `flutter test` зовёт её раньше любого теста.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  await _loadBundledFonts();
  await testMain();
}

/// Шрифты сборки грузятся на весь сьют — иначе геометрия меряется не тем.
///
/// `flutter test` объявленные в pubspec семейства САМ не подключает: текст
/// рисуется подставным шрифтом, у которого каждый глиф — квадрат в кегль.
/// Метрики такого шрифта не совпадают ни с одним шрифтом канона, а тесты
/// раскладки меряют именно их — разрывы строк в заголовке карточки, базовые
/// линии заставки, наезды подписей. На квадратах и зелёный, и красный
/// значили бы не то.
///
/// Прежде часть шрифтов в сьюте всё же оказывалась настоящей: их по ходу
/// поднимал пакет google_fonts своим `FontLoader` — побочным эффектом, о
/// котором нигде не было сказано, и асинхронно, то есть не к каждому тесту
/// вовремя. После перехода на объявление семейств (23.09.2026, SDL CAT-C-1.3)
/// загрузка явная и одна на весь сьют.
///
/// Состав берётся из `FontManifest.json`, то есть из того, что реально попало
/// в сборку: перечислять семейства здесь значило бы завести второй список,
/// который разойдётся с pubspec молча.
///
/// Чего это НЕ меняет: текст без явного семейства в тестах, поднятых без темы
/// приложения, по-прежнему идёт семейством темы по умолчанию (`Roboto`), а
/// его в сборке нет — там остаётся подставной шрифт. Меряет настоящим шрифтом
/// только тест, который поднимает `AppTheme.lightTheme` или называет
/// семейство сам.
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
