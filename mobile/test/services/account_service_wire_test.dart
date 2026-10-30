import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/account_service.dart';

import '../support/wire_stand.dart';

/// Провод удаления учётной записи (бриф В1, 18.10.2026): что приложение шлёт и как
/// читает ответ.
///
/// Ответы — литеральные снимки того, что отдаёт сервер
/// (`backend/src/controllers/accountDeletionController.js`,
/// `services/accountDeletionService.js`; сторож сервера —
/// `backend/src/tests/integration/delete-own-account.test.js`). Тело запроса
/// удаления — ровно то, что сервер читает: `{ confirmation: 'УДАЛИТЬ' }`.
void main() {
  const ownsCardsText = 'У вас есть карточки заведений. Удалить учётную запись можно, '
      'когда их передадут другому владельцу, — напишите в поддержку: '
      'support@nirivio.by';

  group('GET /api/v1/auth/account/deletion', () {
    test('«можно» разбирается, запрос — один GET по адресу проверки', () async {
      final wire = installWireStand(
        (_) => jsonBody({
          'success': true,
          'data': {'allowed': true, 'refusal': null},
        }),
        accessToken: 'valid',
      );

      final check = await AccountService().getDeletionCheck();

      expect(wire.requests.single.method, 'GET');
      expect(wire.requests.single.uri.path, '/api/v1/auth/account/deletion');
      expect(check.allowed, isTrue);
      expect(check.refusalCode, isNull);
      expect(check.refusalMessage, isNull);
    });

    test('отказ владельцу карточек — код и текст сервера как есть', () async {
      installWireStand(
        (_) => jsonBody({
          'success': true,
          'data': {
            'allowed': false,
            'refusal': {'code': 'ACCOUNT_OWNS_ESTABLISHMENTS', 'message': ownsCardsText},
          },
        }),
        accessToken: 'valid',
      );

      final check = await AccountService().getDeletionCheck();

      expect(check.allowed, isFalse);
      expect(check.refusalCode, 'ACCOUNT_OWNS_ESTABLISHMENTS');
      expect(check.refusalMessage, ownsCardsText);
    });

    test('ответ без поля allowed — удаления нет', () async {
      installWireStand(
        (_) => jsonBody({'success': true, 'data': <String, dynamic>{'refusal': null}}),
        accessToken: 'valid',
      );

      final check = await AccountService().getDeletionCheck();

      expect(check.allowed, isFalse);
    });

    test('ответ без data — исключение, а не «можно»', () async {
      installWireStand((_) => jsonBody({'success': true}), accessToken: 'valid');

      await expectLater(
        AccountService().getDeletionCheck(),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('DELETE /api/v1/auth/account', () {
    test('уходит один DELETE с телом { confirmation: УДАЛИТЬ }', () async {
      final wire = installWireStand(
        (_) => jsonBody({'success': true, 'data': {'deleted': true}}),
        accessToken: 'valid',
      );

      await AccountService().deleteAccount(confirmation: 'УДАЛИТЬ');

      final sent = wire.requests.single;
      expect(sent.method, 'DELETE');
      expect(sent.uri.path, '/api/v1/auth/account');
      expect(sent.data, {'confirmation': 'УДАЛИТЬ'});
    });

    test('отказ сервера (409) — исключение с ответом сервера внутри', () async {
      installWireStand(
        (_) => jsonBody({
          'success': false,
          'message': ownsCardsText,
          'error': {'code': 'ACCOUNT_OWNS_ESTABLISHMENTS'},
        }, status: 409),
        accessToken: 'valid',
      );

      try {
        await AccountService().deleteAccount(confirmation: 'УДАЛИТЬ');
        fail('отказ сервера не дошёл до вызывающего');
      } on DioException catch (error) {
        expect(error.response?.statusCode, 409);
        expect((error.response?.data as Map)['message'], ownsCardsText);
      }
    });
  });
}
