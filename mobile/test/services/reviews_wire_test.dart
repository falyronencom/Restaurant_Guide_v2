import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Отзывы заведения на проводе: какой размер страницы просит приложение.
///
/// До 17.10.2026 сервис слал размер как `per_page`, а сервер
/// (`reviewController.getEstablishmentReviews`) читает только `limit` и без
/// него отдаёт 10 (`parseInt(req.query.limit) || 10`, потолок 50).
/// Карточка заведения просит превью из 5 отзывов, карусель рисует всё
/// пришедшее — показывались 10.
void main() {
  test('размер страницы уходит как limit — имя, которое читает сервер',
      () async {
    final adapter = installWireStand((_) => jsonBody(reviewsEnvelope()));

    await ReviewsService().getReviewsForEstablishment('est-1', perPage: 5);

    final request = adapter.requests.single;
    expect(request.path, '/api/v1/establishments/est-1/reviews');
    expect(request.queryParameters['limit'], 5);
    expect(request.queryParameters.containsKey('per_page'), isFalse,
        reason: 'per_page сервер не читает');
  });
}
