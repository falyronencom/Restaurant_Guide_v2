import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/account_deletion_provider.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Шаги удаления учётки (бриф В1, 18.10.2026) поверх настоящих
/// `AccountService()` и `ApiClient()` — подменён только провод.
///
/// Решения Координатора, которые здесь видны: владелец карточек получает
/// «напишите в поддержку» до слова (вопрос 3); подтверждение — словом
/// УДАЛИТЬ (вопрос 4); после удаления телефон выходит из учётки.
void main() {
  const ownsCardsText = 'У вас есть карточки заведений. Удалить учётку можно, '
      'когда их передадут другому владельцу, — напишите в поддержку: '
      'support@nirivio.by';

  late int signOuts;

  setUp(() {
    signOuts = 0;
  });

  AccountDeletionProvider makeProvider() {
    final provider = AccountDeletionProvider(onDeleted: () async {
      signOuts += 1;
    });
    addTearDown(provider.dispose);
    return provider;
  }

  ResponseBody allowed(RequestOptions options) => jsonBody({
        'success': true,
        'data': {'allowed': true, 'refusal': null},
      });

  group('Проверка до слова', () {
    test('«можно» — предупреждение и поле для слова', () async {
      installWireStand(allowed, accessToken: 'valid');
      final provider = makeProvider();

      await provider.check();

      expect(provider.stage, AccountDeletionStage.ready);
      expect(provider.refusalMessage, isNull);
    });

    test('владельцу карточек — отказ с текстом сервера, слово не спрашивается', () async {
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
      final provider = makeProvider();

      await provider.check();

      expect(provider.stage, AccountDeletionStage.refused);
      expect(provider.refusalMessage, ownsCardsText);
    });

    test('нет связи — шаг «не удалось проверить», повтор спрашивает снова', () async {
      var calls = 0;
      installWireStand((options) {
        calls += 1;
        if (calls == 1) {
          throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          );
        }
        return allowed(options);
      }, accessToken: 'valid');
      final provider = makeProvider();

      await provider.check();
      expect(provider.stage, AccountDeletionStage.checkFailed);

      await provider.check();
      expect(provider.stage, AccountDeletionStage.ready);
      expect(calls, 2);
    });
  });

  group('Слово УДАЛИТЬ', () {
    test('сверяется без учёта регистра и пробелов по краям', () {
      expect(AccountDeletionProvider.isConfirmation('УДАЛИТЬ'), isTrue);
      expect(AccountDeletionProvider.isConfirmation('  удалить '), isTrue);
      expect(AccountDeletionProvider.isConfirmation('Удалить'), isTrue);
    });

    test('другое слово, пустое поле, слово с лишним знаком — не подтверждение', () {
      expect(AccountDeletionProvider.isConfirmation(''), isFalse);
      expect(AccountDeletionProvider.isConfirmation('удали'), isFalse);
      expect(AccountDeletionProvider.isConfirmation('УДАЛИТЬ.'), isFalse);
      expect(AccountDeletionProvider.isConfirmation('ДА'), isFalse);
    });

    test('без слова на сервер ничего не уходит', () async {
      final wire = installWireStand(allowed, accessToken: 'valid');
      final provider = makeProvider();
      await provider.check();

      final deleted = await provider.delete('удали');

      expect(deleted, isFalse);
      expect(wire.requests.map((r) => r.method), ['GET']);
      expect(signOuts, 0);
      expect(provider.stage, AccountDeletionStage.ready);
    });
  });

  group('Удаление', () {
    test('DELETE со словом, как его набрали, затем выход на телефоне и шаг «удалена»', () async {
      final wire = installWireStand((options) {
        if (options.method == 'DELETE') {
          return jsonBody({'success': true, 'data': {'deleted': true}});
        }
        return allowed(options);
      }, accessToken: 'valid');
      final provider = makeProvider();
      await provider.check();

      final deleted = await provider.delete(' удалить ');

      expect(deleted, isTrue);
      final sent = wire.requests.last;
      expect(sent.method, 'DELETE');
      expect(sent.uri.path, '/api/v1/auth/account');
      expect(sent.data, {'confirmation': ' удалить '});
      expect(signOuts, 1);
      expect(provider.stage, AccountDeletionStage.deleted);
    });

    test('отказ сервера — его текст под кнопкой, телефон остаётся вошедшим', () async {
      installWireStand((options) {
        if (options.method == 'DELETE') {
          return jsonBody({
            'success': false,
            'message': ownsCardsText,
            'error': {'code': 'ACCOUNT_OWNS_ESTABLISHMENTS'},
          }, status: 409);
        }
        return allowed(options);
      }, accessToken: 'valid');
      final provider = makeProvider();
      await provider.check();

      final deleted = await provider.delete('УДАЛИТЬ');

      expect(deleted, isFalse);
      expect(provider.deleteError, ownsCardsText);
      expect(provider.stage, AccountDeletionStage.ready);
      expect(signOuts, 0);
    });

    test('повтор упёрся в погашенный сеанс — выход на телефоне, «удалена» без подтверждения сервера',
        () async {
      // Ответ на первую попытку потерялся: учётки уже нет, повтор получает 401,
      // транспорт пробует продлить сеанс — тоже 401 — и стирает токены.
      final wire = installWireStand((options) {
        final path = options.uri.path;
        if (path == '/api/v1/auth/account' && options.method == 'DELETE') {
          return jsonBody({
            'success': false,
            'message': 'User account is inactive',
            'error': {'code': 'ACCOUNT_INACTIVE'},
          }, status: 401);
        }
        if (path == '/api/v1/auth/refresh') {
          return jsonBody({
            'success': false,
            'error': {'code': 'INVALID_REFRESH_TOKEN', 'message': 'Invalid refresh token'},
          }, status: 401);
        }
        return allowed(options);
      });
      final storage = installSecureStorageStand({
        'access_token': 'valid',
        'refresh_token': 'alive',
      });
      final provider = makeProvider();
      await provider.check();

      final deleted = await provider.delete('УДАЛИТЬ');

      expect(deleted, isTrue);
      expect(provider.stage, AccountDeletionStage.deleted);
      expect(provider.deletionConfirmed, isFalse);
      expect(signOuts, 1);
      expect(storage.containsKey('access_token'), isFalse,
          reason: 'предусловие: транспорт стёр токены после отказа продления');
      expect(wire.requests.map((r) => r.uri.path), contains('/api/v1/auth/refresh'));
    });

    test('удалено сервером — подтверждение есть', () async {
      installWireStand((options) {
        if (options.method == 'DELETE') {
          return jsonBody({'success': true, 'data': {'deleted': true}});
        }
        return allowed(options);
      }, accessToken: 'valid');
      final provider = makeProvider();
      await provider.check();

      await provider.delete('УДАЛИТЬ');

      expect(provider.deletionConfirmed, isTrue);
    });

    test('нет связи — фраза транспорта, телефон остаётся вошедшим', () async {
      installWireStand((options) {
        if (options.method == 'DELETE') {
          throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          );
        }
        return allowed(options);
      }, accessToken: 'valid');
      final provider = makeProvider();
      await provider.check();

      final deleted = await provider.delete('УДАЛИТЬ');

      expect(deleted, isFalse);
      expect(provider.deleteError, 'Нет связи. Проверьте подключение к интернету.');
      expect(signOuts, 0);
    });
  });
}
