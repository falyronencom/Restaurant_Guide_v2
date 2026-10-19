import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/screens/reviews/write_review_screen.dart';

import '../support/wire_stand.dart';

/// Одиннадцатый отзыв за день (аудит честности тестов, Д3; решение
/// Координатора 19.10.2026).
///
/// Сервер отказывает 429 RATE_LIMIT_EXCEEDED — тем же кодом, что и лимитер
/// частых запросов, — а экран ждал код DAILY_QUOTA_EXCEEDED, которого сервер
/// никогда не слал, и писал «Слишком много запросов. Попробуйте позже», хотя
/// новый отзыв можно оставить только после полуночи по Минску. Теперь сервер
/// объясняет отказ по-русски, экран показывает его слова. Поверх настоящих
/// `ApiClient` и `ReviewsService`, подменён только провод; тело — как его
/// собирает `errorHandler.js` из отказа `reviewService.createReview`.
const _dailyLimit = 'Лимит отзывов на сегодня исчерпан: не больше 10 в день. '
    'Новый отзыв можно написать завтра.';

Map<String, dynamic> _limitRefusal(String message, Object details) => {
      'success': false,
      'message': message,
      'error': {'code': 'RATE_LIMIT_EXCEEDED', 'details': details},
      'timestamp': '2026-10-19T20:00:00.000Z',
    };

void main() {
  final establishment = Establishment(
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Тестовое место',
    category: 'Ресторан',
    address: 'ул. Тестовая, 1',
    city: 'Минск',
    status: 'active',
    createdAt: DateTime(2026, 10, 1),
    updatedAt: DateTime(2026, 10, 1),
  );

  Future<void> submit(WidgetTester tester, String expected) async {
    await tester.pumpWidget(
      MaterialApp(home: WriteReviewScreen(establishment: establishment)),
    );
    await tester.tap(find.byIcon(Icons.star).at(4));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'любой текст');
    await tester.pump();
    await tester.tap(find.byType(ElevatedButton));
    for (var i = 0; i < 60 && find.text(expected).evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('11-й отзыв за день: текст о дневном лимите, а не «позже»',
      (tester) async {
    final wire = installWireStand((_) => jsonBody(
          _limitRefusal(_dailyLimit, {
            'reviews_limit': 10,
            'retry_after': 14400,
            'reset_at': '2026-10-19T21:00:00.000Z',
          }),
          status: 429,
        ));

    await submit(tester, _dailyLimit);

    expect(find.text(_dailyLimit), findsOneWidget);
    expect(find.text('Слишком много запросов. Попробуйте позже'),
        findsNothing);
    expect(wire.requests.single.method, 'POST',
        reason: 'отказ лимита не повторяется сам');
    expect(wire.requests.single.path, '/api/v1/reviews');
    expect(find.text('любой текст'), findsOneWidget,
        reason: 'набранный отзыв остаётся в поле');
  });

  testWidgets('частые запросы: слова лимитера, без «дневного лимита»',
      (tester) async {
    // Лимитер (`middleware/rateLimiter.js`, `constants/rateLimitRefusal.js`)
    // отвечает тем же кодом, но своим текстом: «дневной лимит» тут был бы
    // неправдой.
    const throttle = 'Слишком много запросов. Попробуйте позже.';
    installWireStand((_) => jsonBody(
          _limitRefusal(throttle, {
            'limit': 100,
            'window': '1 minute',
            'retry_after': 37,
            'reset_at': '2026-10-19T20:01:00.000Z',
          }),
          status: 429,
        ));

    await submit(tester, throttle);

    expect(find.text(throttle), findsOneWidget);
    expect(find.text(_dailyLimit), findsNothing);
  });

  testWidgets('429 без русского текста — общая фраза', (tester) async {
    const fallback = 'Слишком много запросов. Попробуйте позже';
    installWireStand((_) => jsonBody(
          _limitRefusal('Too many requests', {'window': '1 minute'}),
          status: 429,
        ));

    await submit(tester, fallback);

    expect(find.text(fallback), findsOneWidget);
  });
}
