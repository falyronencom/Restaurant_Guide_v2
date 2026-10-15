// Экран «Бронирования» партнёра: сервер не выполнил «Подтвердить»,
// «Отклонить» или «Не пришёл» — партнёр видит почему, а список перечитан.
//
// До 13.10.2026 отказ не показывался ничем: провайдер писал свой текст в
// поле, которое экран выводит только при двух пустых списках, а список после
// отказа не перечитывался. Бронь, которую уже подтвердили со второго
// телефона, которую отменил гость или с истёкшим сроком ответа, оставалась на
// месте, и кнопка «молча не срабатывала» сколько угодно раз (решение
// Координатора 13.10.2026, вариант Б).
//
// Тексты отказов — литералы того же решения (пишет сервер). Ответы — в форме
// `errorHandler` бэкенда в production, через стенд провода. Строки броней —
// в форме ответа `GET /partner/bookings/:id` (`b.*` + имя гостя): дата брони
// приходит меткой времени полуночи UTC — так node-pg отдаёт колонку DATE на
// Railway, — время с секундами.

import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/bookings_management_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

import '../support/wire_stand.dart';

const _est = '11111111-2222-3333-4444-555555555555';
const _bookingId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const _list = '/api/v1/partner/bookings/$_est';

const _alreadyConfirmed = 'Бронь уже подтверждена. Обновите список броней.';
const _expired = 'Время на ответ истекло — бронь снята автоматически. '
    'Обновите список броней.';
const _cancelledByGuest = 'Гость отменил эту бронь. Обновите список броней.';

Map<String, dynamic> _refusal(String message) => {
      'success': false,
      'message': message,
      'error': {'code': 'INVALID_STATUS'},
      'timestamp': '2026-10-13T10:00:00.000Z',
    };

/// Транспорт стенда, который держит ответ на ВТОРОЙ и последующие запросы
/// списка, пока тест его не отпустит: так видно, что экран показывает
/// причину отказа, ещё не получив перечитанный список. Первый запрос (загрузка
/// экрана) и действия проходят сразу. Ответы — те же, что у [StubAdapter]
/// стенда; прежний транспорт стенд вернёт сам в `tearDown`.
class _HeldReloadAdapter implements HttpClientAdapter {
  _HeldReloadAdapter(this.stand);

  final StubAdapter stand;
  final _gate = Completer<void>();
  int _lists = 0;

  /// Сколько запросов списка сейчас ждёт [release].
  int waiting = 0;

  void release() => _gate.complete();

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.method == 'GET' && ++_lists > 1 && !_gate.isCompleted) {
      waiting++;
      await _gate.future;
      waiting--;
    }
    return stand.fetch(options, requestStream, cancelFuture);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  // Что сервер знает о брони сейчас. Тест меняет его между загрузкой экрана
  // и нажатием — «тем временем на втором телефоне…».
  late String status;
  late String bookingDate;
  late String bookingTime;
  // Ответ на действие (PUT); `null` — сервер действие принял.
  late Map<String, dynamic>? refusal;
  late StubAdapter wire;

  setUp(() {
    AccountScope.debugReset();
    status = 'pending';
    bookingDate = '2030-01-15T00:00:00.000Z';
    bookingTime = '19:00:00';
    refusal = null;
    wire = installWireStand((RequestOptions options) {
      if (options.method == 'PUT') {
        final body = refusal;
        if (body != null) return jsonBody(body, status: 400);
        return jsonBody(<String, dynamic>{'success': true, 'data': {}});
      }
      return jsonBody(<String, dynamic>{
        'success': true,
        'data': {
          'items': [
            {
              'id': _bookingId,
              'establishment_id': _est,
              'user_id': '88888888-8888-4888-8888-888888888888',
              'booking_date': bookingDate,
              'booking_time': bookingTime,
              'guest_count': 2,
              'comment': null,
              'contact_phone': '+375291234567',
              'status': status,
              'decline_reason': null,
              'expires_at': '2030-01-15T13:00:00.000Z',
              'confirmed_at': null,
              'cancelled_at': null,
              'created_at': '2026-10-13T09:00:00.000Z',
              'updated_at': '2026-10-13T09:00:00.000Z',
              'user_name': 'Ирина',
              'user_phone': '+375291234567',
            },
          ],
          'total': 1,
        },
      });
    });
  });

  Future<void> openScreen(WidgetTester tester) async {
    final provider = BookingProvider();
    addTearDown(provider.dispose);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: const MaterialApp(
        home: BookingsManagementScreen(
          establishmentId: _est,
          establishmentName: 'Кофейня у моста',
        ),
      ),
    ));
    await tester.pumpAndSettle();
  }

  List<String> calls() =>
      wire.requests.map((r) => '${r.method} ${r.path}').toList();

  testWidgets(
      '«Подтвердить», а бронь уже подтверждена со второго телефона: '
      'причина на экране, бронь переехала в подтверждённые', (tester) async {
    await openScreen(tester);
    expect(find.text('Новые запросы (1)'), findsOneWidget);

    status = 'confirmed';
    refusal = _refusal(_alreadyConfirmed);
    await tester.tap(find.text('Подтвердить'));
    await tester.pumpAndSettle();

    expect(find.text(_alreadyConfirmed), findsOneWidget);
    expect(find.text('Новые запросы (0)'), findsOneWidget);
    expect(find.text('Подтверждённые (1)'), findsOneWidget);
    expect(calls(), [
      'GET $_list',
      'PUT $_list/$_bookingId/confirm',
      'GET $_list',
    ]);
  });

  testWidgets(
      '«Отклонить» после истечения срока ответа: причина на экране, '
      'бронь ушла в историю', (tester) async {
    await openScreen(tester);

    status = 'expired';
    refusal = _refusal(_expired);
    await tester.tap(find.text('Отклонить'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Нет свободных столов');
    await tester.tap(find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text('Отклонить'),
    ));
    await tester.pumpAndSettle();

    expect(find.text(_expired), findsOneWidget);
    expect(find.text('Новые запросы (0)'), findsOneWidget);
    expect(find.text('Истекла'), findsOneWidget,
        reason: 'бронь в истории с новым статусом');
    expect(calls(), [
      'GET $_list',
      'PUT $_list/$_bookingId/decline',
      'GET $_list',
    ]);
    expect(wire.requests[1].data, {'reason': 'Нет свободных столов'});
  });

  testWidgets(
      'окно отклонения: без причины не отправляется, «Отмена» закрывает '
      'без запроса', (tester) async {
    await openScreen(tester);

    await tester.tap(find.text('Отклонить'));
    await tester.pumpAndSettle();
    final dialogDecline = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text('Отклонить'),
    );
    await tester.enterText(find.byType(TextField), '   ');
    await tester.tap(dialogDecline);
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget,
        reason: 'пустая причина: окно остаётся открытым');

    await tester.tap(find.text('Отмена'));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('Новые запросы (1)'), findsOneWidget);
    expect(calls(), ['GET $_list']);
  });

  testWidgets(
      '«Не пришёл», а гость уже отменил бронь: причина на экране, '
      'бронь ушла в историю', (tester) async {
    // Кнопка «Не пришёл» есть только у подтверждённой брони на сегодня,
    // время которой прошло, — и только когда экран сумел сложить дату и
    // время в момент. Из ответа сервера (метка полуночи UTC и время с
    // секундами) он этого не умеет: в production кнопки, судя по чтению,
    // нет вовсе (найдено сверкой «живое приложение против спеки» 01.10.2026,
    // пакет «Брони»). Здесь — форма, при которой кнопка появляется: дата без
    // времени, время без секунд. Проверяется не разбор даты, а что
    // происходит после нажатия; когда разбор починят, фикстуру — на форму
    // сервера. «Сегодня» считают и тест, и экран: прогон, пересекающий
    // полночь, покраснеет.
    final now = DateTime.now();
    bookingDate = '${now.year}-${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
    bookingTime = '00:00';
    status = 'confirmed';
    await openScreen(tester);
    expect(find.text('Не пришёл'), findsOneWidget);

    status = 'cancelled';
    refusal = _refusal(_cancelledByGuest);
    await tester.tap(find.text('Не пришёл'));
    await tester.pumpAndSettle();

    expect(find.text(_cancelledByGuest), findsOneWidget);
    expect(find.text('Подтверждённые (0)'), findsOneWidget);
    expect(find.text('Отменена'), findsOneWidget,
        reason: 'бронь в истории с новым статусом');
    expect(calls(), [
      'GET $_list',
      'PUT $_list/$_bookingId/no-show',
      'GET $_list',
    ]);
  });

  testWidgets(
      'причина видна сразу, не дожидаясь перечитывания списка '
      '(без связи оно ждёт до 30 с таймаута)', (tester) async {
    final held = _HeldReloadAdapter(wire);
    ApiClient().dio.httpClientAdapter = held;
    await openScreen(tester);

    status = 'confirmed';
    refusal = _refusal(_alreadyConfirmed);
    await tester.tap(find.text('Подтвердить'));
    for (var i = 0; i < 20 && held.waiting == 0; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(held.waiting, 1, reason: 'перечитывание запрошено и ждёт ответа');
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text(_alreadyConfirmed), findsOneWidget);
    expect(find.text('Новые запросы (1)'), findsOneWidget,
        reason: 'список ещё прежний — ответ на перечитывание не пришёл');

    held.release();
    await tester.pumpAndSettle();
    expect(find.text('Новые запросы (0)'), findsOneWidget);
  });

  testWidgets('сервер принял «Подтвердить»: плашки нет, бронь подтверждена',
      (tester) async {
    await openScreen(tester);

    status = 'confirmed';
    await tester.tap(find.text('Подтвердить'));
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsNothing);
    expect(find.text('Подтверждённые (1)'), findsOneWidget);
    expect(calls(), [
      'GET $_list',
      'PUT $_list/$_bookingId/confirm',
      'GET $_list',
    ]);
  });
}
