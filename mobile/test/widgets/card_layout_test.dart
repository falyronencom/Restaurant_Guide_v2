// Геометрические регрессии карточек-витрин.
//
// Обе проверки ловят «пиксельные» дефекты вёрстки, которые не видны юнит-тестам
// на данных: расхождение вертикальной оси у бейджа рейтинга и сердечка
// (экран результатов поиска) и наезд адреса на строку счётчиков
// (мини-карточка в кабинете партнёра).

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';
import 'package:restaurant_guide_mobile/widgets/partner_establishment_card.dart';

/// Ширина карточки на типовом телефоне: 390 (iPhone 14) − 32 (паддинги списка).
const double _phoneCardWidth = 358.0;

Establishment _establishment() => Establishment(
      id: 'e1',
      name: 'Осмоловка',
      category: 'coffee_shop',
      cuisine: 'Авторская',
      priceRange: r'$',
      rating: 4.5,
      address: 'улица Киселева, 23',
      city: 'Минск',
      status: 'active',
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

PartnerEstablishment _partnerEstablishment({int baseScore = 65}) =>
    PartnerEstablishment(
      id: 'p1',
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

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  double width = _phoneCardWidth,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(width: width, child: child),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  group('EstablishmentCard (результаты поиска)', () {
    testWidgets('сердечко, бейдж рейтинга и цена — на одной вертикали',
        (tester) async {
      await _pump(tester, EstablishmentCard(establishment: _establishment()));

      final ratingCenter = tester.getCenter(find.text('4,5'));
      final priceCenter = tester.getCenter(find.text(r'$'));
      final heartCenter = tester.getCenter(find.byIcon(Icons.favorite_border));

      expect(
        (heartCenter.dx - ratingCenter.dx).abs(),
        lessThan(0.5),
        reason: 'центр сердечка должен совпадать с центром бейджа рейтинга',
      );
      expect(
        (priceCenter.dx - ratingCenter.dx).abs(),
        lessThan(0.5),
        reason: 'цена уже центрируется по бейджу — ось общая',
      );
    });

    testWidgets('сердечко не выходит за правый край карточки', (tester) async {
      await _pump(tester, EstablishmentCard(establishment: _establishment()));

      final cardRight = tester.getRect(find.byType(EstablishmentCard)).right;
      final heartRight = tester.getRect(find.byIcon(Icons.favorite_border)).right;

      expect(heartRight, lessThanOrEqualTo(cardRight));
    });

    testWidgets('на широкой колонке заголовок остаётся базовым кеглем',
        (tester) async {
      await _pump(
        tester,
        EstablishmentCard(establishment: _establishment()),
        width: 700,
      );

      final title = tester.widget<Text>(find.text('Осмоловка'));
      expect(title.style?.fontSize, AppTheme.canonCardTitle.fontSize);
    });

    testWidgets('на узкой колонке заголовок ужимается, но не ниже пола',
        (tester) async {
      await _pump(tester, EstablishmentCard(establishment: _establishment()));

      final title = tester.widget<Text>(find.text('Осмоловка'));
      final size = title.style!.fontSize!;

      expect(size, lessThan(AppTheme.canonCardTitle.fontSize!));
      expect(size, greaterThanOrEqualTo(15.0));
    });

    testWidgets('длинное слово не рвётся по буквам — кегль падает раньше',
        (tester) async {
      // Ширина подобрана так, чтобы «Осмоловка» влезла в одну строку только
      // после уменьшения кегля: при базовом её разорвало бы на «Осмоловк / а».
      // Подбор зависит от метрик шрифта, поэтому предпосылка проверяется
      // первой: прежние 520 после перехода на настоящий Onest (23.09.2026)
      // давали колонку 250 dp, слово в 109 dp влезало на базовом кегле, и
      // тест зеленел, не проверяя уменьшения вовсе.
      const width = 372.0;
      await _pump(
        tester,
        EstablishmentCard(establishment: _establishment()),
        width: width,
      );

      // Ширина колонки: карточка − поля(26) − фото(172) − паддинги(29) − резерв(43)
      const available = width - 26 - 172 - 14 - 15 - 43;

      // Мерить тем стилем, каким слово НАРИСОВАНО: `Text` сливает стиль с
      // `DefaultTextStyle` экрана, и межбуквенный интервал оттуда меняет
      // ширину на доли dp на знак — ровно на них и ошибался AdaptiveTitle до
      // 21.09 («МонеМан / е»). Замер «голым» стилем этот откат не увидел бы.
      final drawn = tester
          .renderObject<RenderParagraph>(find.text('Осмоловка'))
          .text
          .style!;

      double widthAt(double fontSize) {
        final painter = TextPainter(
          text: TextSpan(
            text: 'Осмоловка',
            style: drawn.copyWith(fontSize: fontSize),
          ),
          textDirection: TextDirection.ltr,
        )..layout();
        final measured = painter.width;
        painter.dispose();
        return measured;
      }

      expect(
        widthAt(AppTheme.canonCardTitle.fontSize!),
        greaterThan(available),
        reason: 'предпосылка: на базовом кегле слово в колонку НЕ влезает — '
            'иначе тест не проверяет уменьшения',
      );

      final title = tester.widget<Text>(find.text('Осмоловка'));
      expect(
        widthAt(title.style!.fontSize!),
        lessThanOrEqualTo(available),
        reason: 'слово целиком должно помещаться в строку',
      );
    });

    testWidgets('адрес не заезжает под сердечко', (tester) async {
      await _pump(tester, EstablishmentCard(establishment: _establishment()));

      final address = tester.getRect(find.text('улица Киселева, 23'));
      final heart = tester.getRect(find.byIcon(Icons.favorite_border));

      final overlapsVertically =
          address.top < heart.bottom && heart.top < address.bottom;
      if (overlapsVertically) {
        expect(address.right, lessThanOrEqualTo(heart.left));
      }
    });
  });

  group('PartnerEstablishmentCard (кабинет партнёра)', () {
    testWidgets('адрес не наезжает на строку счётчиков', (tester) async {
      await _pump(
        tester,
        PartnerEstablishmentCard(establishment: _partnerEstablishment()),
      );

      final stats = tester.getRect(find.byIcon(Icons.visibility_outlined));
      final address = tester.getRect(find.text('Революционная, 24'));

      expect(
        address.top,
        greaterThanOrEqualTo(stats.bottom),
        reason: 'адрес должен идти строго ниже счётчиков',
      );
    });

    testWidgets('адрес не наезжает на шкалу заполненности', (tester) async {
      await _pump(
        tester,
        PartnerEstablishmentCard(establishment: _partnerEstablishment()),
      );

      final address = tester.getRect(find.text('Революционная, 24'));
      final completeness = tester.getRect(find.text('Заполненность данных'));

      expect(address.bottom, lessThanOrEqualTo(completeness.top));
    });

    testWidgets('при 100% заполненности адрес всё ещё ниже счётчиков',
        (tester) async {
      await _pump(
        tester,
        PartnerEstablishmentCard(
          establishment: _partnerEstablishment(baseScore: 100),
        ),
      );

      final stats = tester.getRect(find.byIcon(Icons.visibility_outlined));
      final address = tester.getRect(find.text('Революционная, 24'));

      expect(address.top, greaterThanOrEqualTo(stats.bottom));
    });
  });
}
