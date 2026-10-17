import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/utils/establishment_share.dart';
import 'package:restaurant_guide_mobile/utils/open_status.dart';
import 'package:restaurant_guide_mobile/utils/russian_plural.dart';

import '../support/wire_fixtures.dart';

/// Ссылка и текст «Поделиться» (проход тестировщика 17.10, п. 15, Х7), подпись
/// «Открыто · до …» (п. 11) и склонение «отзыв» (Х6).
///
/// Ожидания записаны литералами, а не вычислены тем же кодом: адрес карточки
/// на сайте — `/{город}/{категория}/{slug}`, как строит его
/// `web/src/lib/establishment-path.ts`.
void main() {
  Establishment fromRow({
    String? slug = 'vasilki-minsk',
    String? citySlug = 'minsk',
    String? categorySlug = 'restaurants',
  }) {
    final row = establishmentRow()
      ..['slug'] = slug
      ..['city_slug'] = citySlug
      ..['category_slug'] = categorySlug;
    return Establishment.fromJson(row);
  }

  group('ссылка на страницу заведения', () {
    test('город, категория и slug из ответа сервера', () {
      expect(
        establishmentWebUrl(fromRow(
          citySlug: 'grodno',
          categorySlug: 'coffee',
          slug: 'kofe-na-sovetskoy',
        ), siteBaseUrl: 'https://nirivio.by'),
        'https://nirivio.by/grodno/coffee/kofe-na-sovetskoy',
      );
    });

    test('слеш в конце адреса сайта не удваивается', () {
      expect(
        establishmentWebUrl(fromRow(), siteBaseUrl: 'https://nirivio.by/'),
        'https://nirivio.by/minsk/restaurants/vasilki-minsk',
      );
    });

    test('нет города или категории — запасные части адреса, как у сайта', () {
      expect(
        establishmentWebUrl(fromRow(citySlug: null, categorySlug: null),
            siteBaseUrl: 'https://nirivio.by'),
        'https://nirivio.by/minsk/restaurants/vasilki-minsk',
      );
    });

    test('нет slug — адреса нет', () {
      expect(
        establishmentWebUrl(fromRow(slug: null),
            siteBaseUrl: 'https://nirivio.by'),
        isNull,
      );
    });
  });

  group('текст «Поделиться»', () {
    test('название, адрес, ссылка и подпись NIRIVIO', () {
      expect(
        establishmentShareText(fromRow(), siteBaseUrl: 'https://nirivio.by'),
        'Васильки — ресторан\n'
        '📍 пр. Независимости, 43, Минск\n'
        '🔗 https://nirivio.by/minsk/restaurants/vasilki-minsk\n'
        '\n'
        'Найдено в NIRIVIO',
      );
    });

    test('без slug строки со ссылкой нет, прежнего имени тоже', () {
      final text = establishmentShareText(fromRow(slug: null),
          siteBaseUrl: 'https://nirivio.by');
      expect(text, isNot(contains('🔗')));
      expect(text, isNot(contains('Restaurant Guide Belarus')));
      expect(text, endsWith('Найдено в NIRIVIO'));
    });
  });

  group('«Открыто · до …»', () {
    test('хвост подписи', () {
      expect(openUntilSuffix('22:00'), ' · до 22:00');
    });
  });

  group('склонение «отзыв»', () {
    test('числа по правилу русского языка', () {
      const expected = {
        0: '0 отзывов',
        1: '1 отзыв',
        2: '2 отзыва',
        3: '3 отзыва',
        4: '4 отзыва',
        5: '5 отзывов',
        11: '11 отзывов',
        12: '12 отзывов',
        14: '14 отзывов',
        21: '21 отзыв',
        22: '22 отзыва',
        25: '25 отзывов',
        101: '101 отзыв',
        111: '111 отзывов',
        112: '112 отзывов',
        121: '121 отзыв',
      };
      expect({for (final n in expected.keys) n: reviewsCountLabel(n)}, expected);
    });
  });
}
