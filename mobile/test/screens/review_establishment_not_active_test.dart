import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/screens/reviews/write_review_screen.dart';

import '../support/wire_stand.dart';

/// Что читает гость, когда карточки нет в каталоге — на модерации,
/// приостановлена, отклонена, черновик или в архиве: новый отзыв сервер не
/// принимает (решение Координатора 19.10.2026, аудит честности, В1).
///
/// Ответ — записанный с сервера (backend
/// `integration/review-establishment-status.test.js`, 19.10.2026, без
/// `stack`, которого нет на проде): 400, текст на верхнем уровне. Без
/// своей ветки экран показывал бы «Не удалось отправить отзыв. Попробуйте
/// ещё раз» — повтор не поможет. Поверх настоящих `ApiClient` и
/// `ReviewsService`, подменён только провод.
const _refusal =
    'Это заведение сейчас не показывается в каталоге — оставить отзыв нельзя';

void main() {
  Future<void> pumpUntil(WidgetTester tester, Finder finder) async {
    for (var i = 0; i < 60 && finder.evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

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

  Future<void> submit(WidgetTester tester, Finder waitFor) async {
    await tester.pumpWidget(
      MaterialApp(home: WriteReviewScreen(establishment: establishment)),
    );
    await tester.tap(find.byIcon(Icons.star).at(4));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'любой текст отзыва');
    await tester.pump();
    await tester.tap(find.byType(ElevatedButton));
    await pumpUntil(tester, waitFor);
  }

  testWidgets('карточки нет в каталоге: текст сервера, а не «попробуйте ещё раз»',
      (tester) async {
    final wire = installWireStand((_) => jsonBody({
          'success': false,
          'message': _refusal,
          'error': {'code': 'ESTABLISHMENT_NOT_ACTIVE'},
          'timestamp': '2026-10-19T13:16:31.592Z',
        }, status: 400));

    await submit(tester, find.text(_refusal));

    expect(find.text(_refusal), findsOneWidget);
    expect(find.text('Не удалось отправить отзыв. Попробуйте ещё раз'),
        findsNothing);
    expect(wire.requests.single.method, 'POST');
    expect(wire.requests.single.path, '/api/v1/reviews');
  });

  testWidgets('400 с другим кодом — прежняя общая фраза', (tester) async {
    installWireStand((_) => jsonBody({
          'success': false,
          'message': 'Неверный формат данных',
          'error': {'code': 'INVALID_FORMAT'},
        }, status: 400));

    const general = 'Не удалось отправить отзыв. Попробуйте ещё раз';
    await submit(tester, find.text(general));

    expect(find.text(general), findsOneWidget);
  });
}
