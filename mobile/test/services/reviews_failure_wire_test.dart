import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';
import 'package:restaurant_guide_mobile/utils/error_helpers.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Сбой и отказ в `ReviewsService` летят наверх, а не превращаются в «пусто»
/// или молчаливое `false` (проход тестировщика 17.10, Х5, Х23, Х26).
///
/// До 17.10.2026 сервис ловил любую ошибку: загрузка отзывов отдавала пустую
/// страницу — карточка писала «Пока нет отзывов. Станьте первым!»; удаление
/// отзыва и ответа владельца возвращало `false`, и причину отказа никто не
/// видел. Поверх настоящих `ApiClient` и `ReviewsService`, подменён только
/// провод.
const _id = '33333333-3333-4333-8333-333333333333';

ResponseBody _offline(RequestOptions options) =>
    throw DioException.connectionError(
      requestOptions: options,
      reason: 'нет сети (тест)',
    );

/// Отказ в форме `errorHandler.js`: текст — как у сервиса бэкенда сейчас.
ResponseBody _refusal(int status, String code, String message) => jsonBody({
      'success': false,
      'message': message,
      'error': {'code': code},
      'timestamp': '2026-10-17T10:00:00.000Z',
    }, status: status);

void main() {
  group('загрузка', () {
    test('отзывы заведения: сбой сети — исключение, а не пустая страница',
        () async {
      installWireStand(_offline);

      await expectLater(
        ReviewsService().getReviewsForEstablishment('est-1', perPage: 5),
        throwsA(isA<DioException>()),
      );
    });

    // Только ответ без данных (204). Ответ 200 с чужим конвертом сервис
    // сегодня читает как пустую страницу — «отзывов нет», без исключения
    // (аудит честности тестов 18.10.2026: дефект продукта в списке отчёта;
    // проверка «любая чужая форма — исключение» на этом коде красная).
    test('отзывы заведения: ответ без данных (204) — исключение', () async {
      installWireStand((_) => jsonBody({'success': true, 'data': null},
          status: 204));

      await expectLater(
        ReviewsService().getReviewsForEstablishment('est-1'),
        throwsA(anything),
      );
    });

    test('мои отзывы: сбой сети — исключение, а не «отзывов нет»', () async {
      installWireStand(_offline);

      await expectLater(
        ReviewsService().getUserReviews(userId: 'u-1'),
        throwsA(isA<DioException>()),
      );
    });

    test('удачная загрузка — как раньше', () async {
      installWireStand((_) => jsonBody(reviewsEnvelope(total: 1, pages: 1)));

      final page = await ReviewsService().getReviewsForEstablishment('est-1');

      expect(page.data.single.text, 'Драники как у бабушки');
      expect(page.meta.total, 1);
    });
  });

  group('удаление', () {
    test('отказ удаления отзыва доходит исключением с ответом сервера',
        () async {
      final wire = installWireStand((_) => _refusal(
          403,
          'UNAUTHORIZED_REVIEW_DELETION',
          'You can only delete your own reviews'));

      final error = await ReviewsService()
          .deleteReview(_id)
          .then<Object?>((_) => null, onError: (Object e) => e);

      expect(error, isA<DioException>(),
          reason: 'отказ не должен становиться молчаливым false');
      expect((error as DioException).response?.statusCode, 403);
      expect(wire.requests.single.method, 'DELETE');
      expect(wire.requests.single.path, '/api/v1/reviews/$_id');
    });

    test('отказ удаления ответа владельца доходит исключением', () async {
      final wire = installWireStand((_) => _refusal(
          404, 'RESPONSE_NOT_FOUND', 'This review has no partner response'));

      final error = await ReviewsService()
          .deletePartnerResponse(_id)
          .then<Object?>((_) => null, onError: (Object e) => e);

      expect(error, isA<DioException>());
      expect((error as DioException).response?.statusCode, 404);
      expect(wire.requests.single.path, '/api/v1/reviews/$_id/response');
    });

    test('удачное удаление — true, как раньше', () async {
      installWireStand((_) => jsonBody({'success': true, 'data': {}}));

      expect(await ReviewsService().deleteReview(_id), isTrue);
      expect(await ReviewsService().deletePartnerResponse(_id), isTrue);
    });
  });

  /// Что из отказа попадает на экран: русский текст сервера — как есть,
  /// английский — нет.
  group('russianFailureText', () {
    Future<Object> failureOf(
        ResponseBody Function(RequestOptions) respond) async {
      installWireStand(respond);
      return ReviewsService()
          .deletePartnerResponse(_id)
          .then<Object>((_) => fail('удаление не должно было пройти'),
              onError: (Object e) => e);
    }

    const fallback = 'Не удалось удалить ответ';

    test('русский текст лимитера — как есть', () async {
      final error = await failureOf((_) => jsonBody({
            'success': false,
            'message': 'Слишком много запросов. Попробуйте позже.',
            'error': {
              'code': 'RATE_LIMIT_EXCEEDED',
              'details': {
                'limit': 100,
                'window': '1 минута',
                'retry_after': 42,
              },
            },
          }, status: 429));

      expect(russianFailureText(error, fallback: fallback),
          'Слишком много запросов. Попробуйте позже.');
    });

    test('нет сети — русская фраза транспорта', () async {
      final error = await failureOf(_offline);

      expect(russianFailureText(error, fallback: fallback),
          'Нет связи. Проверьте подключение к интернету.');
    });

    test('английский отказ сервиса — запасная фраза', () async {
      final error = await failureOf((_) => _refusal(
          403,
          'UNAUTHORIZED_PARTNER_RESPONSE',
          'You can only manage responses for your own establishments'));

      expect(russianFailureText(error, fallback: fallback), fallback);
    });

    test('не отказ запроса — запасная фраза', () {
      expect(russianFailureText(StateError('x'), fallback: fallback),
          fallback);
    });
  });
}
