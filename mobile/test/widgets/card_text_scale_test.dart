// Карточка заведения при крупном системном шрифте и при самом высоком
// содержимом.
//
// Ширина карточки задана макетом и от шрифта не зависит: колонка текста
// ≈163 dp на 390-dp телефоне, квадрат рейтинга 31×31. Настройка телефона
// «Размер шрифта» увеличивает буквы, а не коробки, и без предела (замер
// 29.09.2026) рейтинг обрезался с ×1,35 на любой карточке, кухня рвалась
// посреди слова, тип заведения упирался в цену, а нижние строки срезались
// по макетной высоте 291. Высокая карточка — название и адрес в две строки,
// расстояние, «Онлайн бронь» — не помещалась в 291 и при обычном шрифте.
// Решение Координатора 29.09.2026: шрифт внутри карточки растёт до ×1,2 и
// не дальше, а высоту карточка добирает сама, когда содержимое не помещается.
//
// Ошибку раскладки даёт только переполнение колонки. Остальные поломки
// молчат: текст в квадрате рейтинга обрезается без исключения, слово рвётся
// по буквам тоже без исключения. Первый замер считал одни исключения и
// рейтинг пропустил, поэтому каждая поломка проверяется своей геометрией.
//
// Чего эти тесты НЕ утверждают: что длинные категория и кухня не заходят под
// цену и квадрат рейтинга. Это вёрстка правой колонки, а не размер шрифта, —
// её проверяет card_price_column_test.dart (30.09.2026).
//
// Меряется настоящими шрифтами: тема приложения обязательна
// (test/flutter_test_config.dart), без неё текст без семейства — квадраты.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';

/// Квадрат рейтинга и высота карточки по макету.
const double _ratingSquare = 31.0;
const double _cardHeight = 291.0;

/// Вертикальные внешние поля карточки (15 сверху и снизу): прямоугольник
/// виджета их включает.
const double _cardMargins = 30.0;

/// Круглосуточно: для «00:00–00:00» модель считает заведение открытым в
/// любую минуту и пишет самую длинную строку статуса — «Открыто/до 00:00».
/// От времени запуска тест не зависит.
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

/// Длинная карточка: длинное слово названия уходит в многоточие, название
/// занимает одну строку; самая длинная кухня справочника («Вегетарианская»).
/// Категория — как её отдаёт сервер: кириллицей, карточка выводит её как есть
/// (английский ключ `restaurant` карточка превратила бы в «ресторан»).
Establishment _longCard() => Establishment(
      id: 'long',
      name: 'Гастрономическое пространство',
      category: 'Ресторан',
      cuisine: 'Вегетарианская',
      priceRange: r'$$$',
      rating: 4.8,
      address: 'проспект Независимости, 117А',
      city: 'Минск',
      status: 'active',
      bookingEnabled: true,
      workingHours: _allDay(),
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

/// Высокая карточка: название из коротких слов и адрес уходят на вторую
/// строку, плюс «Онлайн бронь» (расстояние передаётся при отрисовке).
/// Не помещалась в макетные 291 уже при обычном шрифте — на 2 dp.
Establishment _tallCard({bool promotion = false}) => Establishment(
      id: 'tall',
      name: 'Кафе на углу',
      category: 'Ресторан',
      cuisine: 'Вегетарианская',
      priceRange: r'$$$$',
      rating: 4.5,
      address: 'улица Кирова, 13, корпус 2',
      city: 'Минск',
      status: 'active',
      bookingEnabled: true,
      hasPromotion: promotion,
      workingHours: _allDay(),
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

/// Масштаб задаётся так же, как его задаёт телефон, — через платформу, а не
/// подменой MediaQuery: проверяется весь путь от настройки до карточки.
Future<void> _pump(
  WidgetTester tester,
  Establishment establishment, {
  required double width,
  required double systemScale,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 900);
  addTearDown(tester.view.reset);
  tester.platformDispatcher.textScaleFactorTestValue = systemScale;
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.lightTheme,
    home: Scaffold(
      body: ListView(children: [
        EstablishmentCard(establishment: establishment, distanceKm: 12.4),
      ]),
    ),
  ));
  await tester.pump();
}

/// Строка «Открыто/Закрыто» — `RichText` без обёртки `Text`.
final _status = find.byWidgetPredicate((w) =>
    w is RichText &&
    w.text.toPlainText().startsWith(RegExp('Открыто|Закрыто')));

/// Высота самой карточки, без внешних полей.
double _cardHeightOf(WidgetTester tester) =>
    tester.getRect(find.byType(EstablishmentCard)).height - _cardMargins;

void main() {
  group('EstablishmentCard при крупном шрифте и высоком содержимом', () {
    final cards = {'длинная': _longCard(), 'высокая': _tallCard()};

    // 360 — типовой бюджетный Android, самая узкая колонка; 390 — iPhone.
    // ×3,1 — наибольший «Увеличенный текст» iPhone.
    for (final MapEntry(key: name, value: card) in cards.entries) {
      for (final width in [360.0, 390.0]) {
        for (final scale in [1.0, 1.2, 1.5, 2.0, 3.1]) {
          testWidgets(
              '$name, $width dp, шрифт ×$scale: ничего не срезано, рейтинг '
              'в квадрате, слова целые, бронь не под сердечком',
              (tester) async {
            await _pump(tester, card, width: width, systemScale: scale);

            // Поломки собираются все сразу: первая не должна заслонять
            // остальные — переполнение, например, наступает раньше прочих,
            // и при раздельных expect остальное не проверялось бы.
            final broken = <String>[];

            if (tester.takeException() != null) {
              broken.add('колонка текста переполнена — нижние строки срезаны');
            }

            final ratingText =
                card.rating!.toStringAsFixed(1).replaceAll('.', ',');
            final rating =
                tester.renderObject<RenderParagraph>(find.text(ratingText));
            if (rating.getMaxIntrinsicWidth(double.infinity) > _ratingSquare ||
                rating.getMaxIntrinsicHeight(_ratingSquare) > _ratingSquare) {
              broken.add('рейтинг не помещается в квадрат — «$ratingText» '
                  'обрезан');
            }

            // Слово, которое шире колонки, движок рвёт по буквам. Наименьшая
            // собственная ширина абзаца — самое широкое неразрывное слово:
            // пока она не больше колонки, переносы идут только между словами
            // («Открыто/до» | «00:00» на 360 dp при ×1,2 — законно).
            // Кухня — по скобке: рядом с ценой она может быть оборвана
            // многоточием внутри скобок.
            final words = {
              'кухня': find.byWidgetPredicate((w) =>
                  w is RichText && w.text.toPlainText().startsWith('{')),
              'строка статуса': _status,
            };
            for (final MapEntry(key: line, value: finder) in words.entries) {
              final paragraph = tester.renderObject<RenderParagraph>(finder);
              if (paragraph.getMinIntrinsicWidth(double.infinity) >
                  paragraph.constraints.maxWidth) {
                broken.add('$line: слово шире колонки — рвётся посреди слова');
              }
            }

            final booking = tester.getRect(find.text('Онлайн бронь'));
            final heart = tester.getRect(find.byIcon(Icons.favorite_border));
            if (booking.overlaps(heart)) {
              broken.add('«Онлайн бронь» уходит под сердечко');
            }

            expect(broken, isEmpty);
          });
        }
      }
    }

    testWidgets('текст растёт вместе с системным шрифтом до ×1,2, дальше — нет',
        (tester) async {
      // Высота строки задана в стилях кратной 20 dp (20/13 при кегле 13 у
      // типа, 20/14 при кегле 14 у статуса), поэтому одна строка при
      // масштабе ×k — ровно 20·k dp. Ширина 390: строка статуса и при ×1,2
      // остаётся одной.

      Future<(double, double)> heightsAt(double scale) async {
        await _pump(tester, _longCard(), width: 390, systemScale: scale);
        return (
          tester.getRect(find.text('Ресторан')).height,
          tester.getRect(_status).height,
        );
      }

      final (typeAt1, statusAt1) = await heightsAt(1.0);
      expect(typeAt1, closeTo(20, 0.01));
      expect(statusAt1, closeTo(20, 0.01));

      final (typeAt12, statusAt12) = await heightsAt(1.2);
      expect(typeAt12, closeTo(24, 0.01),
          reason: 'до предела текст обязан расти вместе с настройкой');
      expect(statusAt12, closeTo(24, 0.01),
          reason: 'строка «Открыто/Закрыто» не читает системный шрифт');

      final (typeAt2, statusAt2) = await heightsAt(2.0);
      expect(typeAt2, closeTo(24, 0.01), reason: 'выше ×1,2 — предел');
      expect(statusAt2, closeTo(24, 0.01),
          reason: 'строка статуса обходит предел карточки');
    });

    testWidgets('помещающаяся карточка — ровно макетные 291, высокая подрастает',
        (tester) async {
      for (final scale in [1.0, 1.2]) {
        await _pump(tester, _longCard(), width: 390, systemScale: scale);
        expect(_cardHeightOf(tester), _cardHeight,
            reason: 'содержимое помещается — высота должна остаться '
                'макетной (×$scale)');
      }

      // Предпосылка теста роста: высокой карточке макетной высоты мало.
      // Помести она содержимое в 291 — проверки выше «не ломается» для неё
      // ничего не доказывали бы.
      await _pump(tester, _tallCard(), width: 390, systemScale: 1.0);
      expect(_cardHeightOf(tester), greaterThan(_cardHeight));
    });

    for (final promotion in [false, true]) {
      testWidgets(
          'фото тянется на всю высоту подросшей карточки'
          '${promotion ? ' (с плашкой «АКЦИЯ»)' : ''}', (tester) async {
        await _pump(tester, _tallCard(promotion: promotion),
            width: 390, systemScale: 1.2);

        final cardHeight = _cardHeightOf(tester);
        expect(cardHeight, greaterThan(_cardHeight),
            reason: 'предпосылка: карточка подросла');

        final photo = tester.getRect(find
            .descendant(
              of: find.byType(EstablishmentCard),
              matching: find.byType(ClipPath),
            )
            .first);
        expect(photo.height, closeTo(cardHeight, 0.01),
            reason: 'фото осталось макетной высоты — под ним пустота');

        if (promotion) {
          // Плашка прижата к низу фото: 12 до плашки + 4 её внутреннего поля.
          final badge = tester.getRect(find.text('АКЦИЯ'));
          expect(photo.bottom - badge.bottom, closeTo(16, 0.01),
              reason: 'плашка «АКЦИЯ» не дошла до низа подросшего фото');
        }
      });
    }
  });
}
