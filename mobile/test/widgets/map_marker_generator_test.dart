import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_generator.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_marker_painter.dart';

/// Картинки карты: пин и кружок группы.
///
/// MapKit ставит картинку на карту по якорю — доле ширины и высоты холста.
/// Поэтому здесь меряется нарисованное (пиксели готового PNG) и сверяется с
/// тем, куда якорь поставит его на карте.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final generator = MapMarkerGenerator();

  group('пин', () {
    test('якорь стоит на кончике хвостика, а не в центре холста', () async {
      // До 29.09.2026 якорь был умолчанием MapKit (0.5, 0.5): координаты
      // заведения приходились на нижнюю часть круга, и кончик указывал на
      // ~25 dp южнее — на масштабе 15 это ~70 м.
      const dpr = 4.0;
      await generator.ensureInitialized(dpr);
      final image = await _decode(generator.getMarkerImage(isOpen: true)!);
      final pixels = await _rgba(image);

      // Хвостик симметричен относительно середины холста; его нижний белый
      // пиксель в среднем столбце — кончик. Тень под ним оранжевая и
      // полупрозрачная, белой не считается.
      final column = image.width ~/ 2;
      var tipRow = -1;
      for (var y = 0; y < image.height; y++) {
        if (_isWhite(pixels, image.width, column, y)) tipRow = y;
      }
      expect(tipRow, greaterThan(0), reason: 'белых пикселей в столбце нет');

      final anchorRow = MapMarkerPainter.anchor.dy * image.height;
      expect(MapMarkerPainter.anchor.dx, 0.5);
      // Нижняя граница белой строки против якоря; допуск 3 px = 0.75 dp.
      expect((tipRow + 1 - anchorRow).abs(), lessThanOrEqualTo(3),
          reason: 'кончик нарисован на строке $tipRow, якорь — на '
              '${anchorRow.toStringAsFixed(1)} из ${image.height}');
    });
  });

  group('кружок группы', () {
    test('размер по ступеням числа: 44 / 52 / 62 dp плюс поля под тень', () async {
      // Сторона холста = диаметр + 2 × (8 размытие + 3 смещение тени) dp,
      // при плотности 3: 66 → 198, 74 → 222, 84 → 252 px.
      await generator.ensureInitialized(3.0);
      const expected = <int, int>{
        2: 198,
        9: 198,
        10: 222,
        49: 222,
        50: 252,
        500: 252,
      };
      for (final entry in expected.entries) {
        final image = await _decode((await generator.getClusterImage(entry.key))!);
        expect([image.width, image.height], [entry.value, entry.value],
            reason: 'кружок на ${entry.key}');
      }
    });

    test('круг — в центре холста: якорь MapKit по умолчанию (0.5, 0.5) '
        'ставит на точку группы середину кружка', () async {
      await generator.ensureInitialized(3.0);
      final image = await _decode((await generator.getClusterImage(7))!);
      final pixels = await _rgba(image);

      var left = image.width, right = -1, top = image.height, bottom = -1;
      for (var y = 0; y < image.height; y++) {
        for (var x = 0; x < image.width; x++) {
          if (!_isWhite(pixels, image.width, x, y)) continue;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }

      // Белая кайма — внешний край круга; тень ниже неё не белая.
      expect((left + right + 1) / 2, closeTo(image.width / 2, 1.5));
      expect((top + bottom + 1) / 2, closeTo(image.height / 2, 1.5));
      // Диаметр 44 dp × 3 = 132 px.
      expect(right - left + 1, closeTo(132, 2));
      expect(bottom - top + 1, closeTo(132, 2));
    });

    test('одно число рисуется один раз: повторный запрос — те же байты',
        () async {
      // MapKit пересоздаёт все кружки на каждом шаге масштаба; кружок на то же
      // число обязан стоить поиска в кэше, а не отрисовки.
      await generator.ensureInitialized(3.0);
      final first = await generator.getClusterImage(4);
      final again = await generator.getClusterImage(4);
      final other = await generator.getClusterImage(5);

      expect(identical(first, again), isTrue);
      expect(identical(first, other), isFalse);
    });

    test('смена плотности пикселей перерисовывает кружки', () async {
      await generator.ensureInitialized(2.0);
      final atTwo = await _decode((await generator.getClusterImage(3))!);
      await generator.ensureInitialized(3.0);
      final atThree = await _decode((await generator.getClusterImage(3))!);

      // Сторона 66 dp.
      expect(atTwo.width, 132);
      expect(atThree.width, 198);
    });
  });
}

Future<ui.Image> _decode(Uint8List png) async {
  final codec = await ui.instantiateImageCodec(png);
  final frame = await codec.getNextFrame();
  codec.dispose();
  return frame.image;
}

Future<ByteData> _rgba(ui.Image image) async =>
    (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;

/// Почти белый и почти непрозрачный: покрытие фигурой не меньше ~3/4.
bool _isWhite(ByteData pixels, int width, int x, int y) {
  final offset = (y * width + x) * 4;
  for (var channel = 0; channel < 4; channel++) {
    if (pixels.getUint8(offset + channel) < 190) return false;
  }
  return true;
}
