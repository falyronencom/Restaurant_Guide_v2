import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

// Шрифты канона обязаны быть в сборке, а не подтягиваться из сети:
// `GoogleFonts.config.allowRuntimeFetching = false` в main.dart означает, что
// недостающий файл не будет скачан — он просто молча заменится системным.
// Дефект такого рода не падает и не логируется: интерфейс остаётся рабочим,
// но перестаёт быть каноном. Поэтому проверка идёт по AssetManifest — по
// тому, что реально попало в сборку, а не по объявлениям в pubspec.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('шрифты канона вшиты в сборку', () async {
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
}
