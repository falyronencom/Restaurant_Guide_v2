import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';

// Вердикты модератора на экране «Ожидают просмотра».
//
// Проверяется одно обещание и его граница: работа по четырнадцати полям
// переживает перезагрузку своей же карточки, но не переезжает на чужую.
// Числа прогресса — те же, что считает шапка экрана; их состав закреплён
// группой «Прогресс проверки» в test/widgets/moderation_pending_test.dart.

/// Fake via `implements` — сеть в этих тестах не нужна.
///
/// `noSuchMethod` закрывает остальной сервис: фейк обслуживает ровно те
/// вызовы, которые делает проверяемый путь, а любой новый упадёт с именем
/// метода вместо того, чтобы молча вернуть пустоту.
class _FakeModerationService implements ModerationService {
  final Map<String, EstablishmentDetail> details =
      <String, EstablishmentDetail>{};

  int detailCalls = 0;
  int coordinateCalls = 0;

  /// Чем упадёт следующий GET детали. `null` — не падать.
  Object? failDetailWith;

  /// Задержать GET по этой карточке, пока шлюз не откроют. Так в тесте
  /// воспроизводится перехлёст двух загрузок.
  String? gatedId;
  Completer<void>? gate;

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async {
    detailCalls++;
    if (id == gatedId) await gate?.future;
    final failure = failDetailWith;
    if (failure != null) throw failure;
    final detail = details[id];
    if (detail == null) throw StateError('фейк не знает карточки $id');
    return detail;
  }

  @override
  Future<void> updateCoordinates({
    required String id,
    required double latitude,
    required double longitude,
  }) async {
    coordinateCalls++;
    // Бэкенд сохранил правку — значит следующий GET обязан отдать новую точку.
    details[id] = _detail(id: id, latitude: latitude, longitude: longitude);
  }

  int moderateCalls = 0;
  int pendingListCalls = 0;
  Object? failModerateWith;

  /// Держит решение «в пути», пока тест не отпустит.
  Completer<void>? moderateGate;

  @override
  Future<void> moderateEstablishment({
    required String id,
    required String action,
    Map<String, String> moderationNotes = const {},
  }) async {
    moderateCalls++;
    final failure = failModerateWith;
    if (failure != null) throw failure;
    final gate = moderateGate;
    if (gate != null) await gate.future;
  }

  @override
  Future<PendingListResponse> getPendingEstablishments({
    int page = 1,
    int perPage = 20,
  }) async {
    pendingListCalls++;
    return PendingListResponse(
      establishments: <EstablishmentListItem>[
        for (final id in details.keys)
          EstablishmentListItem(id: id, name: 'Заведение $id'),
      ],
      total: details.length,
      page: page,
      pages: 1,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'фейк не обслуживает ${invocation.memberName}',
      );
}

EstablishmentDetail _detail({
  required String id,
  double? latitude,
  double? longitude,
}) {
  return EstablishmentDetail(
    id: id,
    partnerId: 'partner-1',
    name: 'Заведение $id',
    status: 'pending',
    city: 'Минск',
    address: 'пр. Независимости, 1',
    latitude: latitude,
    longitude: longitude,
  );
}

void main() {
  group('Вердикты при перезагрузке карточки', () {
    late _FakeModerationService fake;
    late ModerationProvider provider;

    setUp(() {
      fake = _FakeModerationService()
        ..details['est-1'] =
            _detail(id: 'est-1', latitude: 53.9, longitude: 27.5)
        ..details['est-2'] =
            _detail(id: 'est-2', latitude: 52.1, longitude: 23.7);
      provider = ModerationProvider(service: fake);
    });

    test('правка координат не сбрасывает проверку', () async {
      await provider.selectEstablishment('est-1');
      provider
        ..approveField('legal_name')
        ..approveField('unp')
        ..rejectField('address', comment: 'точка стоит в поле за городом');

      expect(provider.checkedFieldCount, 3);

      final ok = await provider.updateCoordinates(53.902, 27.562);

      // Координаты записаны и деталь перечитана — новая точка на экране.
      expect(ok, isTrue);
      expect(fake.coordinateCalls, 1);
      expect(provider.selectedDetail?.latitude, 53.902);
      expect(provider.selectedDetail?.longitude, 27.562);

      // И ровно то, ради чего всё это: «3 из 14» осталось «3 из 14».
      expect(provider.checkedFieldCount, 3);
      expect(provider.tabCheckedCounts, <int>[2, 0, 0, 1]);
      expect(provider.remainingFieldCount, 11);
      // Комментарий к полю — часть работы модератора, а не только статус.
      expect(
        provider.getFieldState('address').comment,
        'точка стоит в поле за городом',
      );
    });

    test('переход на другую карточку обнуляет вердикты', () async {
      await provider.selectEstablishment('est-1');
      provider
        ..approveField('legal_name')
        ..approveField('unp')
        ..rejectField('address', comment: 'точка стоит в поле за городом');

      expect(provider.checkedFieldCount, 3);

      await provider.selectEstablishment('est-2');

      // Другая заявка — проверка начинается с нуля: переносить вердикты
      // между карточками нельзя ни при каких условиях.
      expect(provider.selectedId, 'est-2');
      expect(provider.fieldReviews, isEmpty);
      expect(provider.checkedFieldCount, 0);
      expect(provider.tabCheckedCounts, <int>[0, 0, 0, 0]);
      expect(provider.getFieldState('address').comment, isNull);
    });

    test('повторное открытие своей карточки после сбоя сохраняет проверку',
        () async {
      await provider.selectEstablishment('est-1');
      provider
        ..approveField('legal_name')
        ..approveField('unp');

      // Сеть отвалилась ровно на перечитывании детали после правки.
      fake.failDetailWith = DioException(requestOptions: RequestOptions(path: '/'), type: DioExceptionType.connectionError);
      await provider.updateCoordinates(53.902, 27.562);
      expect(provider.detailError, kNoConnectionPhrase);
      expect(provider.checkedFieldCount, 2);

      // Тап по той же строке очереди — это «попробовать снова», а не смена
      // заявки: загрузка обязана повториться, вердикты — уцелеть.
      fake.failDetailWith = null;
      final callsBeforeRetry = fake.detailCalls;
      await provider.selectEstablishment('est-1');

      expect(fake.detailCalls, callsBeforeRetry + 1);
      expect(provider.detailError, isNull);
      expect(provider.checkedFieldCount, 2);
    });

    test('запоздавший ответ не подменяет открытую карточку', () async {
      // Открытие est-1 зависло в сети.
      fake.gatedId = 'est-1';
      fake.gate = Completer<void>();
      final slowOpen = provider.selectEstablishment('est-1');

      // Модератор ждать не стал и открыл следующую заявку — она успела
      // загрузиться первой.
      await provider.selectEstablishment('est-2');
      expect(provider.selectedDetail?.id, 'est-2');

      // Ответ по est-1 приходит последним и остаётся за бортом: иначе на
      // экране была бы карточка est-1 под именем est-2, и вердикты по ней
      // ушли бы в чужую заявку.
      fake.gate!.complete();
      await slowOpen;

      expect(provider.selectedId, 'est-2');
      expect(provider.selectedDetail?.id, 'est-2');
      expect(provider.isLoadingDetail, isFalse);
    });

    test('запоздавший ОТКАЗ по прежней карточке не ложится на открытую',
        () async {
      // Выше — поздний успех. Отказ идёт той же проверкой, но его не видел
      // никто: ошибка est-1 встала бы над загруженной est-2, и панель
      // показала бы сообщение вместо карточки.
      fake.gatedId = 'est-1';
      fake.gate = Completer<void>();
      final slowOpen = provider.selectEstablishment('est-1');

      await provider.selectEstablishment('est-2');
      expect(provider.selectedDetail?.id, 'est-2');

      fake.failDetailWith = Exception('timeout');
      fake.gate!.complete();
      await slowOpen;

      expect(provider.selectedDetail?.id, 'est-2');
      expect(provider.detailError, isNull);
      expect(provider.isLoadingDetail, isFalse);
    });
  });

  group('Решение по заявке', () {
    late _FakeModerationService fake;
    late ModerationProvider provider;

    setUp(() {
      fake = _FakeModerationService()
        ..details['est-1'] = _detail(id: 'est-1');
      provider = ModerationProvider(service: fake);
    });

    test('второй клик «Одобрить», пока решение в пути, запроса не шлёт',
        () async {
      await provider.selectEstablishment('est-1');
      fake.moderateGate = Completer<void>();

      final first = provider.approveEstablishment();
      final second = await provider.approveEstablishment();

      expect(second, isFalse);
      expect(fake.moderateCalls, 1, reason: 'защита — в провайдере (A1-03)');
      fake.moderateGate!.complete();
      expect(await first, isTrue);
    });

    test('«заявку уже разобрали»: причина словами, очередь перечитана',
        () async {
      await provider.selectEstablishment('est-1');
      final options =
          RequestOptions(path: '/api/v1/admin/establishments/est-1/moderate');
      fake.failModerateWith = DioException(
        requestOptions: options,
        response: Response<dynamic>(
          requestOptions: options,
          statusCode: 400,
          data: <String, dynamic>{
            'success': false,
            'message': "Cannot moderate establishment with status 'active'.",
            'error': <String, dynamic>{'code': 'INVALID_STATUS_FOR_MODERATION'},
          },
        ),
        type: DioExceptionType.badResponse,
      );

      final ok = await provider.approveEstablishment();
      await pumpEventQueue();

      expect(ok, isFalse);
      expect(provider.submitError,
          'Заявку уже разобрали — она больше не ждёт проверки.');
      expect(fake.pendingListCalls, 1,
          reason: 'очередь устарела — повтор получил бы тот же отказ');
    });
  });
}
