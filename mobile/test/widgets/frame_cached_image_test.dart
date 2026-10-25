// Фото, декодированное под рамку (`FrameCachedImage`).
//
// Что утверждается: (1) декодированное фото закрывает рамку × плотность по
// обеим сторонам при любом соотношении сторон от 1 : 2 до 2 : 1 — то есть
// вид не мягче, чем при декодировании файла целиком; (2) в ленте и на карте
// фото действительно декодируется под рамку, а не в полный размер
// (до 25.10.2026 — без ужатия: `memCacheWidth`/`memCacheHeight` не задавались
// нигде в `mobile/lib`); (3) ужатую копию на диск не кладём
// (`maxWidthDiskCache` — см. комментарий виджета).
//
// Чего эти тесты НЕ утверждают: что фото на экране выглядит так же — это
// снимки экрана на устройстве; какой из трёх адресов выбран — адреса здесь не
// менялись. Само фото в тесте не грузится: сети и диска нет, проверяются
// параметры, с которыми построен `CachedNetworkImage`.

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/frame_cached_image.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_map_preview.dart';

/// Превью ленты в форме сервера (PR #123): 1200 в ширину, пропорции файла.
const String _previewUrl =
    'https://res.cloudinary.com/davrzdre8/image/upload/c_limit,w_1200/'
    'f_auto,fl_progressive,q_auto/v1/establishments/e1/interior/photo';

/// Формы фото: от 1 : 2 (самое узкое) до 2 : 1 (самое широкое), между ними —
/// то, что снимает телефон: 9 : 16, 3 : 4, квадрат, 4 : 3, 16 : 9.
const List<double> _aspects = [1 / 2, 9 / 16, 3 / 4, 1, 4 / 3, 16 / 9, 2];

/// Размер, в который ляжет фото формы [aspect] (ширина / высота), если
/// декодировать его по [decode] — так считает `ResizeImage` с одной стороной.
Size _decoded(({int? width, int? height}) decode, double aspect) {
  if (decode.width != null) {
    return Size(decode.width!.toDouble(), decode.width! / aspect);
  }
  return Size(decode.height! * aspect, decode.height!.toDouble());
}

Establishment _establishment({String? thumbnailUrl}) => Establishment(
      id: 'e1',
      name: 'Осмоловка',
      category: 'coffee_shop',
      cuisine: 'Авторская',
      priceRange: r'$',
      rating: 4.5,
      address: 'улица Киселева, 23',
      city: 'Минск',
      status: 'active',
      thumbnailUrl: thumbnailUrl,
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

Future<void> _pump(WidgetTester tester, Widget child, {double dpr = 3}) async {
  tester.view.devicePixelRatio = dpr;
  tester.view.physicalSize = Size(390 * dpr, 844 * dpr);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.lightTheme,
    home: Scaffold(body: child),
  ));
  await tester.pump();
}

/// Рамка фото на экране (dp) и параметры его `CachedNetworkImage`.
({Size frame, CachedNetworkImage image}) _shown(WidgetTester tester) {
  final finder = find.byType(CachedNetworkImage);
  expect(finder, findsOneWidget);
  return (
    frame: tester.getSize(finder),
    image: tester.widget<CachedNetworkImage>(finder),
  );
}

/// Фото любой формы из [_aspects], декодированное с параметрами [image],
/// закрывает [frame] × [dpr] по обеим сторонам.
void _expectCovers(CachedNetworkImage image, Size frame, double dpr) {
  final decode = (width: image.memCacheWidth, height: image.memCacheHeight);
  for (final aspect in _aspects) {
    final size = _decoded(decode, aspect);
    expect(size.width, greaterThanOrEqualTo(frame.width * dpr),
        reason: 'фото $aspect: ширина');
    expect(size.height, greaterThanOrEqualTo(frame.height * dpr),
        reason: 'фото $aspect: высота');
  }
}

void main() {
  group('decodeSize: фото закрывает рамку', () {
    // Рамки приложения: лента, карта, прогулка, герой карточки (393 dp),
    // меню, акция, кабинет — и пара крайних.
    const frames = [
      Size(172, 291),
      Size(100, 100),
      Size(56, 56),
      Size(393, 657),
      Size(165, 275),
      Size(350, 200),
      Size(107, 116),
      Size(430, 120),
      Size(40, 400),
    ];
    for (final dpr in [1.0, 2.0, 2.625, 3.0, 3.5]) {
      for (final frame in frames) {
        test('${frame.width}×${frame.height} dp, ×$dpr', () {
          final decode = FrameCachedImage.decodeSize(frame, dpr);
          expect((decode.width == null) != (decode.height == null), isTrue,
              reason: 'ровно одна сторона: две растянули бы фото');
          for (final aspect in _aspects) {
            final size = _decoded(decode, aspect);
            expect(size.width, greaterThanOrEqualTo(frame.width * dpr),
                reason: 'фото $aspect: ширина');
            expect(size.height, greaterThanOrEqualTo(frame.height * dpr),
                reason: 'фото $aspect: высота');
          }
        });
      }
    }
  });

  group('decodeSize: ужимает', () {
    test('лента ×3: высота 1032 вместо 1600 у вертикального превью', () {
      // 291 × 3 = 873 по высоте рамки; ширина 172 × 3 = 516 у фото 1 : 2
      // требует 1032 по высоте.
      expect(FrameCachedImage.decodeSize(const Size(172, 291), 3),
          (width: null, height: 1032));
    });

    test('карта ×3: ширина 600 вместо 1200', () {
      expect(FrameCachedImage.decodeSize(const Size(100, 100), 3),
          (width: 600, height: null));
    });

    test('рамка без конечного размера — без ужатия', () {
      const none = (width: null, height: null);
      expect(FrameCachedImage.decodeSize(const Size(double.infinity, 200), 3),
          none);
      expect(FrameCachedImage.decodeSize(const Size(200, double.infinity), 3),
          none);
      expect(FrameCachedImage.decodeSize(Size.zero, 3), none);
    });
  });

  group('виджет', () {
    testWidgets('рамка от родителя: cover, ужатие, адрес как есть',
        (tester) async {
      await _pump(
        tester,
        const Center(
          child: SizedBox(
            width: 172,
            height: 291,
            child: FrameCachedImage(imageUrl: _previewUrl),
          ),
        ),
      );
      final shown = _shown(tester);
      expect(shown.image.imageUrl, _previewUrl);
      expect(shown.image.fit, BoxFit.cover);
      expect(shown.image.memCacheWidth, isNull);
      expect(shown.image.memCacheHeight, 1032);
      // Ужатая копия на диск не кладётся.
      expect(shown.image.maxWidthDiskCache, isNull);
      expect(shown.image.maxHeightDiskCache, isNull);
    });

    testWidgets('рамка задана самой картинкой', (tester) async {
      await _pump(
        tester,
        const Center(
          child: FrameCachedImage(
            imageUrl: _previewUrl,
            width: 76,
            height: 76,
          ),
        ),
        dpr: 2,
      );
      final shown = _shown(tester);
      expect(shown.frame, const Size(76, 76));
      expect(shown.image.memCacheWidth, 304);
      expect(shown.image.memCacheHeight, isNull);
    });
  });

  group('экраны приложения декодируют фото под рамку', () {
    testWidgets('карточка ленты и избранного', (tester) async {
      // Как в выдаче и избранном: список, высоту карточки задаёт её текст.
      await _pump(
        tester,
        ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          children: [
            EstablishmentCard(
              establishment: _establishment(thumbnailUrl: _previewUrl),
            ),
          ],
        ),
      );
      final shown = _shown(tester);
      expect(shown.image.imageUrl, _previewUrl);
      // Рамка ленты: 172 dp в ширину, по высоте — карточка, не ниже макета.
      expect(shown.frame.width, 172);
      expect(shown.frame.height, inInclusiveRange(291, 400));
      expect(shown.image.memCacheHeight, isNotNull,
          reason: 'без ужатия превью держится в памяти 1200 × 1600');
      _expectCovers(shown.image, shown.frame, 3);
      // Вертикальное превью (1200 × 1600) действительно ужимается.
      expect(shown.image.memCacheHeight, lessThan(1600));
    });

    testWidgets('превью заведения на карте', (tester) async {
      await _pump(
        tester,
        Stack(children: [
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: EstablishmentMapPreview(
              establishment: _establishment(thumbnailUrl: _previewUrl),
              onClose: () {},
              onDetails: () {},
            ),
          ),
        ]),
      );
      final shown = _shown(tester);
      expect(shown.image.imageUrl, _previewUrl);
      expect(shown.frame, const Size(100, 100));
      expect(shown.image.memCacheWidth, isNotNull,
          reason: 'без ужатия превью держится в памяти 1200 × 1600');
      _expectCovers(shown.image, shown.frame, 3);
      expect(shown.image.memCacheWidth, lessThan(1200));
    });
  });
}
