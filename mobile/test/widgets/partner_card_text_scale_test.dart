// Карточка заведения в кабинете партнёра при крупном системном шрифте и на
// узком экране.
//
// Прежде карточка была фиксированной высоты 310: текст рос от top: 125, а
// шкала заполненности и кнопка «Продвижение» были прибиты к низу. Замер
// 30.09.2026 шрифтами сборки: адрес касался подписи шкалы при ×1,1 и
// ложился на неё с ×1,2, длинный адрес уходил под кнопку уже с ×1,05, кнопка
// с ×1,2 наезжала на «65%», при ×2 адрес уходил за низ карточки. На экране
// 320 dp (такой даёт и обычный телефон с увеличенным «Размером экрана»)
// карточка с тремя кухнями ломалась и при обычном шрифте. Решение
// Координатора 30.09.2026: шкала и кнопка — в общем потоке под текстом,
// карточка подрастает, когда содержимому тесно, шрифт во всей карточке
// вместе со строками под ней — до ×1,2, как у карточки поиска.
//
// Ни одна из этих поломок не давала ошибки раскладки: наезд, срез за низом
// карточки, кнопка поверх шкалы — всё молча. Поэтому каждая проверяется
// своей геометрией и собирается списком: первая не заслоняет остальные.
//
// Чего эти тесты НЕ утверждают: что подпись «Заполненность данных» видна
// целиком. На узкой шкале она сокращается многоточием — на 320 dp уже при
// обычном шрифте, на 360 dp при ×1,2, когда шкала уступает место выросшей
// кнопке.
//
// Меряется настоящими шрифтами: тема приложения обязательна
// (test/flutter_test_config.dart), без неё текст без семейства — квадраты.

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/widgets/partner_establishment_card.dart';

/// Высота карточки по макету.
const double _cardHeight = 310.0;

/// Зазор между адресом и нижним рядом, который оставляет макет при обычном
/// шрифте: адрес кончается на 248, кнопка начинается на 251.
const double _contentGap = 3.0;

/// Наименьший зазор между шкалой и кнопкой «Продвижение».
const double _barButtonGap = 8.0;

/// Допуск на дробные координаты.
const double _eps = 0.01;

/// Короткая карточка — как в брифе.
PartnerEstablishment _short({int baseScore = 65}) => PartnerEstablishment(
      id: 'short',
      name: 'Zalkind Kitchen',
      status: EstablishmentStatus.approved,
      categories: const ['restaurant'],
      cuisineTypes: const ['author'],
      street: 'Революционная',
      building: '24',
      baseScore: baseScore,
      stats: const EstablishmentStats(views: 2, shares: 0, favorites: 0),
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

/// Самая высокая и широкая форма: две категории и три самые длинные кухни
/// справочника (строка кухонь переносится с ×1,1 на 360 dp и уже при ×1,0 на
/// 320 dp), длинные название и адрес — в многоточие, пятизначные счётчики.
PartnerEstablishment _max({int baseScore = 65}) => PartnerEstablishment(
      id: 'max',
      name: 'Гастрономическое пространство',
      status: EstablishmentStatus.approved,
      categories: const ['confectionery', 'restaurant'],
      cuisineTypes: const ['vegetarian', 'american', 'italian'],
      street: 'проспект Независимости',
      building: '117А',
      baseScore: baseScore,
      stats: const EstablishmentStats(views: 12345, shares: 1234, favorites: 5678),
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

/// Карточка — как в кабинете: экран заданной ширины, поля списка по 16 dp.
/// Масштаб задаётся так же, как его задаёт телефон, — через платформу.
/// `UniqueKey` пересобирает дерево на каждом шаге: ошибку переполнения
/// объект раскладки сообщает только один раз.
Future<void> _pump(
  WidgetTester tester,
  PartnerEstablishment establishment, {
  required double screen,
  required double systemScale,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(screen, 1000);
  addTearDown(tester.view.reset);
  tester.platformDispatcher.textScaleFactorTestValue = systemScale;
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

  await tester.pumpWidget(MaterialApp(
    key: UniqueKey(),
    theme: AppTheme.lightTheme,
    home: Scaffold(
      body: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [PartnerEstablishmentCard(establishment: establishment)],
          ),
        ),
      ),
    ),
  ));
  await tester.pump();
}

/// Сама карточка (без строк под ней).
Rect _card(WidgetTester tester) => tester.getRect(find
    .descendant(
      of: find.byType(PartnerEstablishmentCard),
      matching: find.byType(GestureDetector),
    )
    .first);

/// Оранжевая плашка кнопки «Продвижение».
Rect _button(WidgetTester tester) => tester.getRect(find
    .ancestor(of: find.text('Продвижение'), matching: find.byType(Container))
    .first);

String _dp(double value) => value.toStringAsFixed(1);

void main() {
  group('PartnerEstablishmentCard при крупном шрифте и на узком экране', () {
    final forms = {'короткая': _short, 'самая высокая': _max};

    // 320 — узкий экран (и 360-dp телефон с увеличенным «Размером экрана»),
    // 360 — типовой Android, 390 — iPhone. ×3,1 — наибольший «Увеличенный
    // текст» iPhone.
    for (final MapEntry(key: name, value: build) in forms.entries) {
      for (final screen in [320.0, 360.0, 390.0]) {
        for (final score in [65, 100]) {
          testWidgets(
              '$name, ${screen.toInt()} dp, заполнено $score %: при любом шрифте '
              'адрес над нижним рядом, шкала не сходится с кнопкой, '
              '«Продвижение» целое, всё в карточке',
              (tester) async {
            final establishment = build(baseScore: score);
            final broken = <String>[];

            for (final scale in [1.0, 1.1, 1.2, 1.5, 2.0, 3.1]) {
              await _pump(tester, establishment,
                  screen: screen, systemScale: scale);
              final at = '×$scale';

              final exception = tester.takeException();
              if (exception != null) {
                broken.add('$at: ошибка раскладки — '
                    '${exception.toString().split('\n').first}');
                continue;
              }

              final card = _card(tester);
              final address =
                  tester.getRect(find.text(establishment.shortAddress));
              final button = _button(tester);

              // Место кнопки растёт вместе с ней: прибитое к 150 dp, оно с
              // ×1,2 рвало «Продвижение» посреди слова (ревью 30.09.2026).
              // Наименьшая собственная ширина абзаца — ширина слова: пока
              // она не больше отведённой, слово целое.
              final buttonText =
                  tester.renderObject<RenderParagraph>(find.text('Продвижение'));
              if (buttonText.getMinIntrinsicWidth(double.infinity) >
                  buttonText.constraints.maxWidth + _eps) {
                broken.add('$at: «Продвижение» рвётся посреди слова');
              }

              // Верх нижнего ряда — верх кнопки или подписи шкалы, что выше.
              var bottomRowTop = button.top;
              final bottomRow = <Rect>[button];
              if (score < 100) {
                final label = tester.getRect(find.text('Заполненность данных'));
                final percent = tester.getRect(find.text('$score%'));
                bottomRowTop = math.min(bottomRowTop, label.top);
                bottomRow.addAll([label, percent]);

                final barRight = math.max(label.right, percent.right);
                if (button.left - barRight < _barButtonGap - _eps) {
                  broken.add('$at: шкала подошла к кнопке ближе '
                      '$_barButtonGap dp (${_dp(button.left - barRight)})');
                }
              }

              if (bottomRowTop - address.bottom < _contentGap - _eps) {
                broken.add('$at: адрес заходит на нижний ряд — до него '
                    '${_dp(bottomRowTop - address.bottom)} dp');
              }

              for (final part in [address, ...bottomRow]) {
                if (part.bottom > card.bottom + _eps ||
                    part.right > card.right + _eps) {
                  broken.add('$at: текст или кнопка за краем карточки');
                  break;
                }
              }
            }

            expect(broken, isEmpty);
          });
        }
      }
    }

    // При обычном шрифте свободного места в карточке нет: текст с зазором и
    // нижний ряд занимают ровно 310. Прижат ли нижний ряд к низу, видно
    // только при мелком шрифте (×0,85 — «Мелкий» на Android): текст короче,
    // и под ним остаётся место, как в макете.
    testWidgets(
        'при обычном и мелком шрифте — геометрия макета: 310 dp, текст с 125 '
        'в колонке от 18 до 10 dp по краям, шкала от 18 до 160 dp от правого '
        'края в 10 от низа, кнопка в 10 и 18',
        (tester) async {
      final broken = <String>[];

      for (final MapEntry(key: name, value: build) in forms.entries) {
        for (final (screen, scale) in [
          (360.0, 1.0),
          (390.0, 1.0),
          (390.0, 0.85),
        ]) {
          for (final score in [65, 100]) {
            final at = '$name, ${screen.toInt()} dp, ×$scale, $score %';
            final establishment = build(baseScore: score);
            await _pump(tester, establishment,
                screen: screen, systemScale: scale);

            final card = _card(tester);
            final title = tester.getRect(find.text(establishment.name));
            final button = _button(tester);

            if ((card.height - _cardHeight).abs() > _eps) {
              broken.add('$at: высота ${_dp(card.height)} вместо 310');
            }
            if ((title.top - card.top - 125).abs() > _eps) {
              broken.add('$at: название начинается не с 125');
            }
            // Колонка текста — от 18 dp слева до 10 справа: по ширине,
            // отведённой абзацу, а не по его рамке, — короткая строка правого
            // поля не показывает.
            final address =
                tester.getRect(find.text(establishment.shortAddress));
            final titleText =
                tester.renderObject<RenderParagraph>(find.text(establishment.name));
            if ((title.left - card.left - 18).abs() > _eps ||
                (address.left - card.left - 18).abs() > _eps ||
                (titleText.constraints.maxWidth - (card.width - 28)).abs() >
                    _eps) {
              broken.add('$at: колонка текста не от 18 dp слева до 10 справа');
            }
            if ((card.right - button.right - 10).abs() > _eps ||
                (card.bottom - button.bottom - 18).abs() > _eps) {
              broken.add('$at: кнопка не в 10 dp от края и 18 от низа');
            }
            if (score < 100) {
              final track =
                  tester.getRect(find.byType(LinearProgressIndicator));
              final percent = tester.getRect(find.text('$score%'));
              if ((track.left - card.left - 18).abs() > _eps ||
                  (card.right - percent.right - 160).abs() > _eps ||
                  (card.bottom - percent.bottom - 10).abs() > _eps) {
                broken.add('$at: шкала не от 18 до 160 dp от правого края '
                    'или не в 10 от низа');
              }
            }
          }
        }
      }

      expect(broken, isEmpty);
    });

    testWidgets(
        'карточка подрастает, только когда содержимому тесно: при ×1,2 и на '
        '320 dp с тремя кухнями даже при обычном шрифте', (tester) async {
      // Предпосылки проверок «адрес над нижним рядом»: не подрасти карточка
      // здесь, матрица выше ничего не доказывала бы про рост.
      await _pump(tester, _short(), screen: 390, systemScale: 1.2);
      expect(_card(tester).height, greaterThan(_cardHeight));

      await _pump(tester, _max(), screen: 320, systemScale: 1.0);
      expect(_card(tester).height, greaterThan(_cardHeight));
    });

    testWidgets(
        'шрифт растёт с настройкой до ×1,2, дальше — нет: в карточке и в '
        'строках под ней', (tester) async {
      Future<(double, double)> heightsAt(double scale) async {
        await _pump(tester, _short(), screen: 390, systemScale: scale);
        return (
          tester.getRect(find.text('Революционная, 24')).height,
          tester.getRect(find.text('Редактировать')).height,
        );
      }

      final (addressAt1, editAt1) = await heightsAt(1.0);
      final (addressAt12, editAt12) = await heightsAt(1.2);
      final (addressAt2, editAt2) = await heightsAt(2.0);

      expect(addressAt12, closeTo(addressAt1 * 1.2, _eps),
          reason: 'до предела текст карточки обязан расти вместе с настройкой');
      expect(editAt12, closeTo(editAt1 * 1.2, _eps),
          reason: 'до предела строки под карточкой растут вместе с ней');
      expect(addressAt2, closeTo(addressAt12, _eps),
          reason: 'выше ×1,2 — предел');
      expect(editAt2, closeTo(editAt12, _eps),
          reason: 'предел действует и на строки под карточкой');
    });
  });
}
