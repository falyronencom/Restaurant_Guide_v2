import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_reviews_screen.dart';
import 'package:restaurant_guide_mobile/screens/reviews/write_review_screen.dart';

import '../support/wire_stand.dart';

/// Что читает человек, когда сервер не принял отзыв или ответ владельца из-за
/// мата (проход тестировщика 17.10, Х17 и Х22; сервер — PR #64).
///
/// Раньше «Написать отзыв» показывал «Проверьте правильность заполнения
/// формы», а ответ владельца — «Не удалось отправить ответ»: оба экрана
/// знали про 422 только то, что он есть. Поверх настоящих `ApiClient` и
/// `ReviewsService`, подменён только провод; форма ответа — как у общего
/// `validate` бэкенда.
const _profane = 'Текст содержит нецензурные выражения — уберите их, '
    'пожалуйста';

Map<String, dynamic> _validationRefusal(String field) => {
      'success': false,
      'message': 'Validation failed',
      'error': {
        'code': 'VALIDATION_ERROR',
        'details': [
          {'field': field, 'message': _profane, 'value': 'текст'},
        ],
      },
      'timestamp': '2026-10-17T10:00:00.000Z',
    };

void main() {
  Future<void> pumpUntil(WidgetTester tester, Finder finder) async {
    for (var i = 0; i < 60 && finder.evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  group('Написать отзыв', () {
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

    Future<void> submit(WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(home: WriteReviewScreen(establishment: establishment)),
      );
      await tester.tap(find.byIcon(Icons.star).at(4));
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'любой текст');
      await tester.pump();
      await tester.tap(find.byType(ElevatedButton));
      await pumpUntil(tester, find.text(_profane));
    }

    testWidgets('мат: текст сервера, а не общая фраза', (tester) async {
      final wire = installWireStand(
        (_) => jsonBody(_validationRefusal('content'), status: 422),
      );

      await submit(tester);

      expect(find.text(_profane), findsOneWidget);
      expect(find.text('Проверьте правильность заполнения формы'),
          findsNothing);
      expect(wire.requests.single.method, 'POST');
      expect(wire.requests.single.path, '/api/v1/reviews');
    });

    testWidgets('422 без русского текста — прежняя общая фраза',
        (tester) async {
      installWireStand((_) => jsonBody({
            'success': false,
            'message': 'Validation failed',
            'error': {
              'code': 'VALIDATION_ERROR',
              'details': [
                {'field': 'rating', 'message': 'Rating is required'},
              ],
            },
          }, status: 422));

      await submit(tester);
      await pumpUntil(
          tester, find.text('Проверьте правильность заполнения формы'));

      expect(find.text('Проверьте правильность заполнения формы'),
          findsOneWidget);
    });
  });

  group('Ответ владельца на отзыв', () {
    Map<String, dynamic> reviewJson() => {
          'id': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          'establishment_id': '11111111-2222-3333-4444-555555555555',
          'user_id': 'u-1',
          'author': {'id': 'u-1', 'name': 'Гость'},
          'rating': 5,
          'content': 'Вкусно',
          'created_at': '2026-10-10T10:00:00.000Z',
          'updated_at': '2026-10-10T10:00:00.000Z',
        };

    Future<void> reply(WidgetTester tester) async {
      tester.view.physicalSize = const Size(800, 2000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(
        home: PartnerReviewsScreen(
          establishmentId: '11111111-2222-3333-4444-555555555555',
        ),
      ));
      await pumpUntil(tester, find.text('Ответить'));
      await tester.tap(find.text('Ответить'));
      await tester.pump();
      await tester.enterText(find.byType(TextFormField), 'любой ответ');
      await tester.pump();
      await tester.tap(find.text('Отправить'));
      await pumpUntil(tester, find.byType(SnackBar));
    }

    String snackBarText(WidgetTester tester) {
      final content = tester.widget<SnackBar>(find.byType(SnackBar)).content;
      return (content as Text).data!;
    }

    testWidgets('мат: текст сервера, а не «Не удалось отправить ответ»',
        (tester) async {
      final wire = installWireStand((options) {
        if (options.method == 'GET') {
          return jsonBody({
            'success': true,
            'data': {
              'reviews': [reviewJson()],
              'pagination': {'page': 1, 'limit': 20, 'total': 1, 'totalPages': 1},
            },
          });
        }
        return jsonBody(_validationRefusal('response'), status: 422);
      });

      await reply(tester);

      expect(snackBarText(tester), _profane);
      final post = wire.requests.where((r) => r.method == 'POST').single;
      expect(post.path,
          '/api/v1/reviews/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/response');
    });

    testWidgets('сбой сервера — прежняя общая фраза', (tester) async {
      installWireStand((options) {
        if (options.method == 'GET') {
          return jsonBody({
            'success': true,
            'data': {
              'reviews': [reviewJson()],
              'pagination': {'page': 1, 'limit': 20, 'total': 1, 'totalPages': 1},
            },
          });
        }
        return jsonBody({
          'success': false,
          'message': "Cannot read properties of undefined (reading 'id')",
          'error': {'code': 'INTERNAL_ERROR'},
        }, status: 500);
      });

      await reply(tester);

      expect(snackBarText(tester), 'Не удалось отправить ответ');
    });
  });
}
