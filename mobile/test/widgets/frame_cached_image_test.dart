// Фото в мелкой рамке, декодированное под рамку (`FrameCachedImage`).
//
// Что утверждается: (1) декодированное фото закрывает рамку × плотность по
// обеим сторонам при любом соотношении сторон от 1 : 2 до 2 : 1 — его не
// растягивают; (2) на карте и в прогулке фото действительно декодируется под
// рамку (до 25.10.2026 — без ужатия: `memCacheWidth`/`memCacheHeight` не
// задавались нигде в `mobile/lib`); (3) карточка ленты — нет: там ужатие
// делает фото мягче, и вид Координатор оставил прежним (25.10.2026);
// (4) ужатую копию на диск не кладём (`maxWidthDiskCache` — см. комментарий
// виджета). Статистика кабинета и отзывы в профиле берут тот же виджет с
// рамкой, заданной самой картинкой, — этот путь проверен на виджете; экраны
// целиком здесь не поднимаются.
//
// Чего эти тесты НЕ утверждают: как фото выглядит — это сравнение «до/после»
// на фото с прода (отчёт D4, 25.10.2026), не тест; какой из трёх адресов
// выбран — адреса здесь не менялись. Само фото в тесте не грузится: сети и
// диска нет, проверяются параметры, с которыми построен `CachedNetworkImage`.

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/utils/walk_reach.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/frame_cached_image.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_map_preview.dart';
import 'package:restaurant_guide_mobile/widgets/map/walk_controls.dart';

/// Превью ленты в форме сервера (PR #123): 1200 в ширину, пропорции файла.
const String _previewUrl =
    'https://res.cloudinary.com/davrzdre8/image/upload/c_limit,w_1200/'
    'f_auto,fl_progressive,q_auto/v1/establishments/e1/interior/photo';

/// Формы фото: от 1 : 2 (самое узкое) до 2 : 1 (самое широкое), между ними —
/// то, что снимает телефон: 9 : 16, 3 : 4, квадрат, 4 : 3, 16 : 9.
const List<double> _aspects = [1 / 2, 9 / 16, 3 / 4, 1, 4 / 3, 16 / 9, 2];

/// Размер в точках, в который ляжет фото формы [aspect] (ширина / высота),
/// если декодировать его по [decode]: вторую сторону движок считает сам и
/// отбрасывает дробь — высоту `~/`, ширину `round()` (`dart:ui`,
/// `ImageDescriptor.instantiateCodec`).
Size _decoded(({int? width, int? height}) decode, double aspect) {
  if (decode.width != null) {
    return Size(
        decode.width!.toDouble(), (decode.width! ~/ aspect).toDouble());
  }
  return Size(
      (decode.height! * aspect).roundToDouble(), decode.height!.toDouble());
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
    // Мелкие рамки приложения (карта, прогулка, отзыв в профиле, статистика
    // кабинета), крупные — на случай, если виджет возьмут туда, — и крайние.
    const frames = [
      Size(100, 100),
      Size(56, 56),
      Size(59, 59),
      Size(107, 116),
      Size(172, 291),
      Size(393, 657),
      Size(350, 200),
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
    test('карта ×3: ширина 601 вместо 1200', () {
      // Рамка 300 × 300 точек; фото 2 : 1 при ширине 601 — 300 в высоту
      // (601 ~/ 2), при 600 было бы тоже 300, но в рамке 262,5 точки (×2,625)
      // без лишней точки вышло бы 262 — см. следующий тест.
      expect(FrameCachedImage.decodeSize(const Size(100, 100), 3),
          (width: 601, height: null));
    });

    test('карта ×2,625: фото 2 : 1 не короче рамки в 262,5 точки', () {
      // 262,5 × 2 = 525 → 526; 526 ~/ 2 = 263 ≥ 262,5.
      expect(FrameCachedImage.decodeSize(const Size(100, 100), 2.625),
          (width: 526, height: null));
    });

    test('прогулка ×3: ширина 337', () {
      expect(FrameCachedImage.decodeSize(const Size(56, 56), 3),
          (width: 337, height: null));
    });

    test('статистика кабинета ×3: высота 643 вместо 2560 у полного размера',
        () {
      // Рамка 321 × 348 точек — выше, чем шире: задаётся высота; фото 1 : 2
      // при высоте 643 — 322 в ширину (round(321,5)).
      expect(FrameCachedImage.decodeSize(const Size(107, 116), 3),
          (width: null, height: 643));
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
            width: 100,
            height: 100,
            child: FrameCachedImage(imageUrl: _previewUrl),
          ),
        ),
      );
      final shown = _shown(tester);
      expect(shown.image.imageUrl, _previewUrl);
      expect(shown.image.fit, BoxFit.cover);
      expect(shown.image.memCacheWidth, 601);
      expect(shown.image.memCacheHeight, isNull);
      // Ужатая копия на диск не кладётся.
      expect(shown.image.maxWidthDiskCache, isNull);
      expect(shown.image.maxHeightDiskCache, isNull);
    });

    testWidgets('рамка задана самой картинкой (статистика кабинета, ×2)',
        (tester) async {
      await _pump(
        tester,
        const Center(
          child: FrameCachedImage(
            imageUrl: _previewUrl,
            width: 107,
            height: 116,
          ),
        ),
        dpr: 2,
      );
      final shown = _shown(tester);
      expect(shown.frame, const Size(107, 116));
      // Рамка 214 × 232 точки: высота — 2 × 214 + 1 = 429.
      expect(shown.image.memCacheWidth, isNull);
      expect(shown.image.memCacheHeight, 429);
      _expectCovers(shown.image, shown.frame, 2);
    });
  });

  group('перестройка родителя', () {
    testWidgets(
        'та же картинка, пока адрес и рамка те же; новый адрес и новая рамка — '
        'новая', (tester) async {
      late StateSetter rebuild;
      var url = _previewUrl;
      var side = 100.0;
      await _pump(
        tester,
        Center(
          child: StatefulBuilder(builder: (context, setState) {
            rebuild = setState;
            return SizedBox(
              width: side,
              height: side,
              // Заглушки — новые на каждой сборке, как на экранах приложения.
              child: FrameCachedImage(
                imageUrl: url,
                placeholder: (_, __) => const ColoredBox(color: Colors.grey),
                errorWidget: (_, __, ___) =>
                    const ColoredBox(color: Colors.black),
              ),
            );
          }),
        ),
      );
      final image = tester.element(find.byType(Image));
      for (var i = 0; i < 3; i++) {
        rebuild(() {});
        await tester.pump();
      }
      // `octo_image` ставит ключом внутреннего `Image` обёртку `ResizeImage`,
      // которая не сравнивается по значению: пересобранная картинка — новый
      // элемент, и неудавшееся фото скачивалось бы заново на каждом кадре.
      expect(tester.element(find.byType(Image)), same(image),
          reason: 'перестройка родителя пересоздала картинку');

      CachedNetworkImage shown() =>
          tester.widget<CachedNetworkImage>(find.byType(CachedNetworkImage));
      rebuild(() => url = '$_previewUrl-2');
      await tester.pump();
      expect(shown().imageUrl, '$_previewUrl-2');

      rebuild(() => side = 120);
      await tester.pump();
      // 120 × 3 = 360 точек: 2 × 360 + 1.
      expect(shown().memCacheWidth, 721);
    });
  });

  group('экраны приложения', () {
    testWidgets('превью заведения на карте — ужато под рамку', (tester) async {
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

    testWidgets('карточка места в прогулке — ужато под рамку', (tester) async {
      await _pump(
        tester,
        Center(
          child: WalkPlaceCard(
            place: WalkPlace(_establishment(thumbnailUrl: _previewUrl), 550),
          ),
        ),
      );
      final shown = _shown(tester);
      expect(shown.image.imageUrl, _previewUrl);
      expect(shown.frame, const Size(56, 56));
      expect(shown.image.memCacheWidth, isNotNull,
          reason: 'без ужатия превью держится в памяти 1200 × 1600');
      _expectCovers(shown.image, shown.frame, 3);
      expect(shown.image.memCacheWidth, lessThan(1200));
    });

    testWidgets('карточка ленты и избранного — фото декодируется целиком',
        (tester) async {
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
      expect(shown.frame.width, 172);
      // Превью крупнее рамки лишь в ≈ 2,3 раза: ужатие сделало бы фото
      // мягче, вид ленты Координатор оставил прежним (25.10.2026).
      expect(shown.image.memCacheWidth, isNull);
      expect(shown.image.memCacheHeight, isNull);
    });
  });
}
