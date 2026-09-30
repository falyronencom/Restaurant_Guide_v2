// Тип заведения и кухня рядом с правой колонкой карточки: квадрат рейтинга,
// под ним цена.
//
// Колонка стоит справа сверху, место под неё зарезервировано только у
// названия. Когда название в одну строку, тип и кухня оказываются рядом с
// ценой, и длинные значения справочника упирались в неё: «{Вегетарианская}»
// при «$$$» — уже при обычном шрифте на 360–364 dp, «{Американская}»,
// «Кондитерская» — с ×1,1. Чем ниже строка названия, тем выше тип и кухня:
// под названием, ужатым до пола кегля, буквы сходились на экранах до 384 dp
// (ревью 29.09.2026, замер и ревью 30.09.2026). Решение Координатора
// 30.09.2026: строка, чьи буквы сходятся с буквами цены, обрывается
// многоточием; строка, чья коробка в колонку не заходит, не меняется.
//
// Почему буквы, а не коробки. Коробка строки выше букв на межстрочный
// интервал, и коробки кухни и цены пересекаются и там, где буквы расходятся на
// 6–10 dp: на 384 и 390 dp при ×1,2 кухня проходит под ценой. Проверка по
// коробкам потребовала бы резать и там. Поэтому касание меряется пикселями:
// «чернила» цены — разница снимков карточки с ценой и без неё (тип и кухня на
// обоих убраны), «чернила» строки — всё, что в её коробке отличается от фона,
// кроме пикселей самой цены. Где буквы наложились, остаются соседние пиксели
// той же буквы строки — касание видно и тогда.
//
// Меряется настоящими шрифтами: тема приложения обязательна
// (test/flutter_test_config.dart), без неё текст — квадраты.

import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';

/// Снимки — с плотностью телефона: 3 пикселя на dp.
const double _dpr = 3;

/// «Чернила» — пиксель, отличающийся от фона больше чем на 48 из 255 по
/// какому-либо каналу: видимая часть буквы без бледного края сглаживания.
const int _inkThreshold = 48;

/// Буквы ближе 1 dp — касание.
const int _touchPx = 3;

/// Зазор между оборванной строкой и ценой — из решения, а не из кода.
const double _cutGap = 4;

final _boundary = GlobalKey();

Map<String, dynamic> _allDay() => {
      for (final day in [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ])
        day: '00:00-00:00',
    };

/// «Васильки» на 360 dp ужимаются: строка названия ниже, тип и кухня выше —
/// ближе всего к цене. Худшая для наезда форма названия.
Establishment _card({
  String name = 'Васильки',
  required String category,
  String? cuisine,
  String? price,
  double? rating = 4.5,
}) =>
    Establishment(
      id: 'c',
      name: name,
      category: category,
      cuisine: cuisine,
      priceRange: price,
      rating: rating,
      address: 'улица Кирова, 13',
      city: 'Минск',
      status: 'active',
      workingHours: _allDay(),
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

/// Название, которое не помещается и на полу кегля: одна строка с
/// многоточием. Строка названия у него ниже всех, тип и кухня — выше всех.
const String _floorTitle = 'Гастрономическое пространство';

/// Масштаб — как его задаёт телефон, через платформу.
Future<void> _pump(
  WidgetTester tester,
  Establishment establishment, {
  required double width,
  required double scale,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 420);
  tester.platformDispatcher.textScaleFactorTestValue = scale;
  await tester.pumpWidget(RepaintBoundary(
    key: _boundary,
    child: MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ListView(children: [
          EstablishmentCard(
            key: UniqueKey(),
            establishment: establishment,
            distanceKm: 12.4,
          ),
        ]),
      ),
    ),
  ));
  await tester.pump();
}

void _resetView(WidgetTester tester) {
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}

/// Строка кухни — по фигурной скобке: оборванная кончается «…}».
final _cuisine = find.byWidgetPredicate(
    (w) => w is RichText && w.text.toPlainText().startsWith('{'));

Finder _category(String label) => find.byWidgetPredicate((w) =>
    w is RichText &&
    w.text.toPlainText() == label);

/// Пиксели снимка, RGBA.
class _Shot {
  _Shot(this.width, this.height, this.bytes);

  final int width;
  final int height;
  final Uint8List bytes;

  int _channelGap(int x, int y, List<int> rgb) {
    final i = (y * width + x) * 4;
    var gap = 0;
    for (var c = 0; c < 3; c++) {
      gap = math.max(gap, (bytes[i + c] - rgb[c]).abs());
    }
    return gap;
  }

  List<int> rgbAt(int x, int y) {
    final i = (y * width + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2]];
  }

  bool inkAgainst(_Shot other, int x, int y) =>
      _channelGap(x, y, other.rgbAt(x, y)) > _inkThreshold;

  bool inkOn(List<int> background, int x, int y) =>
      _channelGap(x, y, background) > _inkThreshold;
}

Future<_Shot> _grab(WidgetTester tester) async {
  final boundary =
      _boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  return (await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: _dpr);
    final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    final shot = _Shot(image.width, image.height, data!.buffer.asUint8List());
    image.dispose();
    return shot;
  }))!;
}

/// Прямоугольник в пикселях снимка, с полем [pad] dp.
(int, int, int, int) _px(Rect r, _Shot shot, {double pad = 0}) => (
      math.max(0, ((r.left - pad) * _dpr).floor()),
      math.max(0, ((r.top - pad) * _dpr).floor()),
      math.min(shot.width - 1, ((r.right + pad) * _dpr).ceil()),
      math.min(shot.height - 1, ((r.bottom + pad) * _dpr).ceil()),
    );

/// Ближе ли буквы строк [lines] к буквам цены, чем на 1 dp. Возвращает
/// названия коснувшихся строк.
Future<List<String>> _touchingLines(
  WidgetTester tester,
  Establishment establishment, {
  required double width,
  required double scale,
  required Map<String, Finder> lines,
}) async {
  // Карточка как есть.
  await _pump(tester, establishment, width: width, scale: scale);
  final priceRect = tester.getRect(find.text(establishment.priceRange!));
  final ratingRect = tester.getRect(find
      .ancestor(
          of: find.text(
              establishment.rating!.toStringAsFixed(1).replaceAll('.', ',')),
          matching: find.byType(Container))
      .first);
  final lineRects = {
    for (final MapEntry(key: name, value: finder) in lines.entries)
      name: tester.getRect(finder),
  };
  final card = await _grab(tester);

  // Цена отдельно: тип — пробел, кухни нет, с ценой и без неё. Колонка от
  // строк не зависит — стоит там же, где на карточке.
  Establishment bare({String? price}) => _card(
        name: establishment.name,
        category: ' ',
        price: price,
        rating: establishment.rating,
      );
  await _pump(tester, bare(price: establishment.priceRange),
      width: width, scale: scale);
  final withPrice = await _grab(tester);
  await _pump(tester, bare(), width: width, scale: scale);
  final withoutPrice = await _grab(tester);

  final priceInk = <int>{};
  final (px0, py0, px1, py1) = _px(priceRect, card, pad: 2);
  for (var y = py0; y <= py1; y++) {
    for (var x = px0; x <= px1; x++) {
      if (withPrice.inkAgainst(withoutPrice, x, y)) priceInk.add(y * card.width + x);
    }
  }
  expect(priceInk, isNotEmpty, reason: 'предпосылка: цена найдена на снимке');

  // Фон — поле карточки над квадратом рейтинга.
  final background = card.rgbAt(
      (priceRect.center.dx * _dpr).round(), ((ratingRect.top - 10) * _dpr).round());
  final (rx0, ry0, rx1, ry1) = _px(ratingRect, card, pad: 1);

  final touching = <String>[];
  for (final MapEntry(key: name, value: rect) in lineRects.entries) {
    final (lx0, ly0, lx1, ly1) = _px(rect, card, pad: 1);
    var touches = false;
    for (var y = ly0; y <= ly1 && !touches; y++) {
      for (var x = lx0; x <= lx1 && !touches; x++) {
        if (x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1) continue;
        if (priceInk.contains(y * card.width + x)) continue;
        if (!card.inkOn(background, x, y)) continue;
        for (var dy = -_touchPx; dy <= _touchPx && !touches; dy++) {
          for (var dx = -_touchPx; dx <= _touchPx; dx++) {
            if (priceInk.contains((y + dy) * card.width + x + dx)) {
              touches = true;
              break;
            }
          }
        }
      }
    }
    if (touches) touching.add(name);
  }
  return touching;
}

/// Строка обрезана: тип — многоточием движка, кухня — «…}» внутри скобок.
List<String> _cutLines(WidgetTester tester, Establishment e) {
  final cut = <String>[];
  final category = tester.renderObject<RenderParagraph>(_category(e.category));
  if (category.didExceedMaxLines) cut.add('тип');
  if (e.cuisine != null &&
      tester.widget<RichText>(_cuisine).text.toPlainText() != '{${e.cuisine}}') {
    cut.add('кухня');
  }
  return cut;
}

void main() {
  group('Тип и кухня рядом с ценой', () {
    testWidgets(
        'буквы типа и кухни не касаются цены на узких телефонах при любом '
        'шрифте до предела', (tester) async {
      _resetView(tester);
      // Самые длинные значения справочника (кириллица — как отдаёт сервер)
      // и пара из прода («Европейская» при «$$$») под ужатым названием.
      Establishment worst({String name = 'Васильки', String price = r'$$$'}) =>
          _card(
              name: name,
              category: 'Кондитерская',
              cuisine: 'Вегетарианская',
              price: price);
      final cases = [
        for (final e in [
          worst(),
          _card(category: 'Кальянная', cuisine: 'Американская', price: r'$$$'),
          _card(category: 'Ресторан', cuisine: 'Вегетарианская', price: r'$'),
          _card(category: 'Ресторан', cuisine: 'Европейская', price: r'$$$'),
        ])
          for (final width in [360.0, 364.0, 368.0])
            for (final scale in [1.0, 1.1, 1.2]) (e, width, scale),
        // Название, ужатое до пола кегля в одну строку, ниже всех — тип и
        // кухня выше всех, и буквы сходились на экранах до 384 dp (ревью
        // 30.09.2026).
        for (final (width, scale) in [
          (364.0, 1.0),
          (375.0, 1.12),
          (380.0, 1.15),
          (384.0, 1.2),
        ])
          (worst(name: _floorTitle), width, scale),
        // Кухня вровень с «$$»: коробки заходят друг за друга всего на 0,6 dp.
        (worst(name: _floorTitle, price: r'$$'), 360.0, 1.0),
        // Кухня подходит к цене снизу, углом.
        for (final width in [369.0, 370.0, 372.0]) (worst(), width, 1.12),
      ];
      final touching = <String>[];
      for (final (e, width, scale) in cases) {
        final lines = await _touchingLines(tester, e,
            width: width,
            scale: scale,
            lines: {'тип': _category(e.category), 'кухня': _cuisine});
        for (final line in lines) {
          touching.add('${e.name} ${e.category}/${e.cuisine}/${e.priceRange} '
              '$width dp ×$scale: $line касается цены');
        }
      }
      expect(touching, isEmpty);
    });

    testWidgets(
        'где буквы с ценой не сходятся, тип и кухня не укорачиваются',
        (tester) async {
      _resetView(tester);
      // Карточки прода, ближе всех подходящие к цене (имена настоящие: от
      // названия зависит, насколько ужимается его строка). На экранах от
      // 360 dp буквы там не сходились — ближе всего 3,5 dp у «МонеМане» на
      // 360 dp при ×1,2, и кухня подходит к «$$» снизу, углом.
      final prod = [
        _card(name: 'Charlie', category: 'Ресторан', cuisine: 'Европейская', price: r'$$$', rating: 0),
        _card(name: 'МонеМане', category: 'Ресторан', cuisine: 'Европейская', price: r'$$', rating: 0),
        _card(name: 'Сорренто', category: 'Ресторан', cuisine: 'Итальянская', price: r'$$', rating: 5),
        _card(name: 'underdog', category: 'Пиццерия', cuisine: 'Итальянская', price: r'$$', rating: 0),
        _card(name: 'Осмоловка', category: 'Кофейня', cuisine: 'Авторская', price: r'$', rating: 0),
      ];
      // Худшее сочетание справочника там, где коробки ещё пересекаются, а
      // буквы уже нет: кухня проходит под ценой (384 dp — Samsung A72, 390 —
      // iPhone).
      final wide = _card(
          category: 'Кондитерская', cuisine: 'Вегетарианская', price: r'$$$');
      // Название в две строки: тип и кухня ниже колонки, место есть.
      final twoLines = _card(
          name: 'Кафе на углу',
          category: 'Кондитерская',
          cuisine: 'Вегетарианская',
          price: r'$$$');

      // Узкий экран, где коробки пересекаются, а буквы кухни далеко: у
      // «Charlie» строка названия не ужимается, кухня ниже и проходит под
      // ценой на 5 dp и дальше (тип там с ценой сходится и обрывается).
      final charlie = _card(
          name: 'Charlie',
          category: 'Кондитерская',
          cuisine: 'Вегетарианская',
          price: r'$$$',
          rating: 0);

      const allScales = [1.0, 1.1, 1.15, 1.2];
      final cases = [
        for (final e in prod)
          for (final width in [360.0, 364.0, 368.0, 375.0, 384.0, 390.0, 411.0])
            (e, width, allScales, const {'тип', 'кухня'}),
        for (final width in [375.0, 384.0, 390.0])
          (wide, width, allScales, const {'тип', 'кухня'}),
        for (final width in [360.0, 390.0])
          (twoLines, width, allScales, const {'тип', 'кухня'}),
        for (final width in [360.0, 364.0])
          (charlie, width, const [1.2], const {'кухня'}),
      ];
      final cut = <String>[];
      for (final (e, width, scales, whole) in cases) {
        for (final scale in scales) {
          await _pump(tester, e, width: width, scale: scale);
          for (final line in _cutLines(tester, e).where(whole.contains)) {
            cut.add('${e.name} ${e.category}/${e.cuisine}/${e.priceRange} '
                '$width dp ×$scale: $line укорочена');
          }
        }
      }
      expect(cut, isEmpty);
    });

    testWidgets(
        'укороченная строка — многоточие, скобки кухни целы, до цены '
        '$_cutGap dp', (tester) async {
      _resetView(tester);
      final e = _card(
          category: 'Кондитерская', cuisine: 'Вегетарианская', price: r'$$$');
      final broken = <String>[];

      // Обычный шрифт: касалась только кухня. Обрыв не глубже нужного —
      // «Вегетариан» остаётся (снято с отрисовки 30.09.2026).
      await _pump(tester, e, width: 360, scale: 1.0);
      final cuisineText = tester.widget<RichText>(_cuisine).text.toPlainText();
      if (!RegExp(r'^\{Вегетариан.*…\}$').hasMatch(cuisineText)) {
        broken.add('×1,0: кухня «$cuisineText» — ждали «{Вегетариан…}»');
      }
      if (_cutLines(tester, e).contains('тип')) {
        broken.add('×1,0: тип укорочен, хотя с ценой не сходился');
      }
      var price = tester.getRect(find.text(r'$$$'));
      var gap = price.left - tester.getRect(_cuisine).right;
      if (gap < _cutGap - 0.01) {
        broken.add('×1,0: кухня кончается за ${gap.toStringAsFixed(2)} dp до цены');
      }
      // Оборванный текст помещается целиком: шире строки — и «…}» срезало бы.
      final cuisine = tester.renderObject<RenderParagraph>(_cuisine);
      if (cuisine.getMaxIntrinsicWidth(double.infinity) >
          cuisine.constraints.maxWidth) {
        broken.add('×1,0: «$cuisineText» шире своей строки — конец срезан');
      }
      // Экранный чтец читает кухню целиком, как до обрыва. Тексты карточки
      // он читает одним узлом — метки строк в нём через перевод строки.
      final semantics = tester.ensureSemantics();
      await tester.pump();
      final spoken =
          tester.getSemantics(find.byType(EstablishmentCard)).label.split('\n');
      semantics.dispose();
      if (!spoken.contains('{Вегетарианская}')) {
        broken.add('×1,0: чтец читает кухню как «${spoken.where((l) => l.startsWith('{')).join()}»');
      }

      // ×1,2: касался и тип.
      await _pump(tester, e, width: 360, scale: 1.2);
      final category =
          tester.renderObject<RenderParagraph>(_category('Кондитерская'));
      if (!category.didExceedMaxLines) {
        broken.add('×1,2: тип не укорочен');
      }
      // Сторожит настройку, а не картинку: знак «…» на отрисовке не виден
      // объекту раскладки — он рисуется поверх обрезанного текста.
      if (category.overflow != TextOverflow.ellipsis) {
        broken.add('×1,2: тип обрезается без многоточия (${category.overflow})');
      }
      price = tester.getRect(find.text(r'$$$'));
      gap = price.left - tester.getRect(_category('Кондитерская')).right;
      if (gap < _cutGap - 0.01) {
        broken.add('×1,2: тип кончается за ${gap.toStringAsFixed(2)} dp до цены');
      }
      expect(broken, isEmpty);
    });

    testWidgets('тип не заходит под квадрат рейтинга', (tester) async {
      _resetView(tester);
      // Длинное название ужимается до пола кегля, его строка становится
      // ниже, и строка типа поднимается к самому квадрату. На 360 dp ни один
      // тип справочника до квадрата не дотягивается, на самых узких экранах
      // (320 dp — iPhone SE первого поколения) «Кондитерская» заходила под
      // него: верх букв — выше нижней кромки квадрата. Поэтому колонка для
      // строк — это и квадрат, а не одна цена.
      final e = _card(
          name: 'Осмоловка',
          category: 'Кондитерская',
          cuisine: 'Народная',
          price: r'$');
      await _pump(tester, e, width: 320, scale: 1.0);

      final rating = tester.getRect(find
          .ancestor(of: find.text('4,5'), matching: find.byType(Container))
          .first);
      final category = tester.getRect(_category(e.category));
      // Предпосылка: коробка типа по высоте задевает квадрат.
      expect(category.top, lessThan(rating.bottom));
      expect(category.right, lessThanOrEqualTo(rating.left - _cutGap + 0.01),
          reason: 'тип заходит под квадрат рейтинга');
    });
  });
}
