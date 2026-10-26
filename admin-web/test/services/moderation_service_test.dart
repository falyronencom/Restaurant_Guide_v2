import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

import '../helpers/wire_stand.dart';

/// Решения модератора на проводе — настоящий `ModerationService` поверх
/// подставного транспорта.
///
/// Все провайдеры модерации тестируются на фейках сервиса (`implements`), и
/// что уходит на сервер, не видел никто: ключ причин отказа под другим именем
/// сервер принял бы ответом 200 и молча потерял бы причины — партнёр узнал
/// бы об отказе без единого слова, что исправить. Ожидание — со стороны
/// бэкенда: `adminModerationController` читает `action` и `moderation_notes`
/// (moderate), `reason` (suspend).
void main() {
  setUp(() => installSecureStorageStand(initial: {'access_token': 'a1'}));

  test('отказ уходит с причинами по полям под ключом moderation_notes',
      () async {
    final adapter = StubAdapter((_) => jsonBody(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{'id': 'est-1', 'status': 'rejected'},
        }));
    final service = ModerationService.withClient(stubClient(adapter));

    await service.moderateEstablishment(
      id: 'est-1',
      action: 'reject',
      moderationNotes: const {'name': 'Название не совпадает с вывеской'},
    );

    final request = adapter.requests.single;
    expect(request.method, 'POST');
    expect(request.uri.path, '/api/v1/admin/establishments/est-1/moderate');
    expect(request.data, <String, dynamic>{
      'action': 'reject',
      'moderation_notes': <String, String>{
        'name': 'Название не совпадает с вывеской',
      },
    });
  });

  test('приостановка уходит с причиной под ключом reason', () async {
    final adapter = StubAdapter((_) => jsonBody(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{'id': 'est-1', 'status': 'suspended'},
        }));
    final service = ModerationService.withClient(stubClient(adapter));

    await service.suspendEstablishment(
        id: 'est-1', reason: 'Жалобы посетителей');

    final request = adapter.requests.single;
    expect(request.method, 'POST');
    expect(request.uri.path, '/api/v1/admin/establishments/est-1/suspend');
    expect(request.data, <String, dynamic>{'reason': 'Жалобы посетителей'});
  });

  // «Назначить партнёра» и «Исправить координаты» — тоже решения, у которых
  // провод не видел никто: фейки провайдеров отдают готовый результат.
  // Ожидание — со стороны бэкенда: `adminRoutes.js` (POST …/claim, PATCH
  // …/coordinates), `adminModerationController` читает `user_id` (claim),
  // `latitude` и `longitude` (coordinates).
  test('«Назначить партнёра» уходит с id человека под ключом user_id',
      () async {
    final adapter = StubAdapter((_) => jsonBody(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{'id': 'est-1'},
        }));
    final service = ModerationService.withClient(stubClient(adapter));

    await service.claimEstablishment(id: 'est-1', userId: 'u-77');

    final request = adapter.requests.single;
    expect(request.method, 'POST');
    expect(request.uri.path, '/api/v1/admin/establishments/est-1/claim');
    expect(request.data, <String, dynamic>{'user_id': 'u-77'});
  });

  test('«Исправить координаты» — PATCH с latitude и longitude', () async {
    final adapter = StubAdapter((_) => jsonBody(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{'id': 'est-1'},
        }));
    final service = ModerationService.withClient(stubClient(adapter));

    // Широта и долгота разные — перестановка ключей не прошла бы.
    await service.updateCoordinates(
        id: 'est-1', latitude: 53.9045, longitude: 27.5615);

    final request = adapter.requests.single;
    expect(request.method, 'PATCH');
    expect(request.uri.path, '/api/v1/admin/establishments/est-1/coordinates');
    expect(request.data, <String, dynamic>{
      'latitude': 53.9045,
      'longitude': 27.5615,
    });
  });
}
