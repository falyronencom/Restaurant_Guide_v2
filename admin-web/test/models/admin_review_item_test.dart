import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';

// Проекция отзыва и единственная величина, которую клиент считает сам, —
// «каким станет рейтинг заведения без этого отзыва».
//
// Считать её на клиенте можно потому, что все три слагаемых приходят с
// бэкенда одним ответом и относятся к одному моменту. Но у вопроса есть
// случаи, когда он бессмыслен, и молча подставить в них ноль было бы хуже,
// чем не отвечать.

Map<String, dynamic> _json(Map<String, dynamic> overrides) => <String, dynamic>{
      'id': 'r1',
      'rating': 2,
      'content': 'Кофе холодный',
      'created_at': '2026-08-12T16:24:00.000Z',
      ...overrides,
    };

void main() {
  group('Разбор проекции', () {
    test('новые поля читаются числами', () {
      final review = AdminReviewItem.fromJson(_json(<String, dynamic>{
        'establishment_average_rating': 4.1,
        'establishment_review_count': 187,
        'author_review_count': 4,
        'author_average_rating': 3.8,
        'partner_response': 'Прабачце за чаканне',
        'partner_response_at': '2026-08-13T07:02:00.000Z',
        'has_partner_response': true,
      }));

      expect(review.establishmentAverageRating, 4.1);
      expect(review.establishmentReviewCount, 187);
      expect(review.authorReviewCount, 4);
      expect(review.authorAverageRating, 3.8);
      // Дата ответа приходила с самого начала и молча отбрасывалась.
      expect(review.partnerResponseAt, DateTime.utc(2026, 8, 13, 7, 2));
    });

    test('целое приходит целым и разбирается как дробное', () {
      // Средняя ровно 4 приедет из JSON как `4`, а не `4.0`.
      final review = AdminReviewItem.fromJson(_json(<String, dynamic>{
        'establishment_average_rating': 4,
        'author_average_rating': 5,
      }));

      expect(review.establishmentAverageRating, 4.0);
      expect(review.authorAverageRating, 5.0);
    });

    test('отсутствующие поля дают null, а не нули', () {
      final review = AdminReviewItem.fromJson(_json(<String, dynamic>{}));

      expect(review.establishmentAverageRating, isNull);
      expect(review.authorReviewCount, isNull);
      expect(review.partnerResponseAt, isNull);
    });

    test('copyWith не теряет новые поля', () {
      final review = AdminReviewItem.fromJson(_json(<String, dynamic>{
        'establishment_average_rating': 4.1,
        'establishment_review_count': 187,
        'author_review_count': 4,
        'author_average_rating': 3.8,
        'partner_response_at': '2026-08-13T07:02:00.000Z',
      }));

      // Оптимистичное скрытие проходит через copyWith, и панель после него
      // рисуется из этого же объекта.
      final hidden = review.copyWith(isVisible: false);

      expect(hidden.establishmentAverageRating, 4.1);
      expect(hidden.establishmentReviewCount, 187);
      expect(hidden.authorReviewCount, 4);
      expect(hidden.authorAverageRating, 3.8);
      expect(hidden.partnerResponseAt, isNotNull);
    });
  });

  group('Рейтинг без этого отзыва', () {
    test('считается из средней, числа отзывов и своей оценки', () {
      final review = AdminReviewItem.fromJson(_json(<String, dynamic>{
        'rating': 2,
        'establishment_average_rating': 4.1,
        'establishment_review_count': 187,
      }));

      // (4,1 × 187 − 2) / 186
      expect(review.ratingWithoutThisReview, closeTo(4.1113, 0.0001));
    });

    test('у удалённого — null: он уже не в агрегате', () {
      final review = AdminReviewItem.fromJson(_json(<String, dynamic>{
        'is_deleted': true,
        'establishment_average_rating': 4.1,
        'establishment_review_count': 187,
      }));

      // Триггер рейтинга считает неудалённые отзывы, поэтому «убрать» уже
      // убранное нельзя, и любое число здесь было бы выдумкой.
      expect(review.ratingWithoutThisReview, isNull);
    });

    test('у скрытого — null: он тоже вне агрегата', () {
      // Первая редакция этого теста утверждала обратное — «скрытый в агрегате
      // остаётся» — и запирала настоящий дефект. Посылка была взята из
      // триггера `update_metrics_after_review`, который считает по всем
      // неудалённым. Но после него на каждом пути записи идёт
      // `updateEstablishmentAggregates` с `is_visible = true`, и её значение
      // и остаётся в колонке.
      final review = AdminReviewItem.fromJson(_json(<String, dynamic>{
        'is_visible': false,
        'rating': 1,
        'establishment_average_rating': 4.0,
        'establishment_review_count': 10,
      }));

      expect(review.ratingWithoutThisReview, isNull);
    });

    test('арифметика не даёт оценок выше шкалы', () {
      // Ровно тот случай, на котором дефект виден глазом: две видимые пятёрки
      // и скрытая единица. Без гарда вышло бы «9,00».
      final review = AdminReviewItem.fromJson(_json(<String, dynamic>{
        'is_visible': false,
        'rating': 1,
        'establishment_average_rating': 5.0,
        'establishment_review_count': 2,
      }));

      expect(review.ratingWithoutThisReview, isNull);
    });

    test('у единственного — null, а не ноль', () {
      final review = AdminReviewItem.fromJson(_json(<String, dynamic>{
        'rating': 5,
        'establishment_average_rating': 5.0,
        'establishment_review_count': 1,
      }));

      // Без него оценки не останется вовсе, и «0,0» означало бы не ноль, а
      // пустоту — ровно та подмена, из-за которой рейтинг прячут до первого
      // отзыва и в карточках каталога.
      expect(review.ratingWithoutThisReview, isNull);
    });

    test('без данных о заведении — null', () {
      expect(
        AdminReviewItem.fromJson(_json(<String, dynamic>{}))
            .ratingWithoutThisReview,
        isNull,
      );
    });
  });
}
