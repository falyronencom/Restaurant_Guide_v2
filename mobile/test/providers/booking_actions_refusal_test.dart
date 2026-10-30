import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Что получает экран броней, когда сервер не выполнил действие партнёра:
/// «Подтвердить», «Отклонить», «Не пришёл».
///
/// До 13.10.2026 провайдер на любой отказ ставил свой текст («Ошибка
/// подтверждения» и т. п.) в `error` — поле, которое экран показывает только
/// при двух пустых списках. Причину отказа партнёр не видел никогда, а кнопка
/// «молча не срабатывала»: бронь к этому времени истекла, гость её отменил
/// или её подтвердили со второго телефона.
///
/// Тексты отказов — литералы решения Координатора 13.10.2026 (вариант А:
/// пишет сервер, по-русски; коды прежние). Ответы — в форме `errorHandler`
/// бэкенда в production (`{success, message, error: {code}, timestamp}`),
/// через стенд провода: исполняется весь `ApiClient`, с повторами 5xx и
/// пересборкой отказа. Проверки — точным равенством: «содержит фразу»
/// зеленеет и с мусором вокруг неё.
const _est = '11111111-2222-3333-4444-555555555555';
const _booking = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const _base = '/api/v1/partner/bookings/$_est/$_booking';

const _alreadyConfirmed = 'Бронь уже подтверждена. Обновите список броней.';
const _expired = 'Время на ответ истекло — бронь снята автоматически. '
    'Обновите список броней.';
const _cancelledByGuest = 'Гость отменил эту бронь. Обновите список броней.';
const _notFound = 'Бронь не найдена. Обновите список броней.';
const _notOwned = 'Заведение не найдено или принадлежит другой учётной записи. '
    'Обновите список заведений.';

Map<String, dynamic> _refusal(String message, String code) => {
      'success': false,
      'message': message,
      'error': {'code': code},
      'timestamp': '2026-10-13T10:00:00.000Z',
    };

/// Сбой сервера. Для программной ошибки бэкенд отдаёт в `message` текст
/// исключения как есть — английский и внутренний; партнёру он не годится.
ResponseBody _serverFailure(RequestOptions _) => jsonBody(
      _refusal("Cannot read properties of undefined (reading 'status')",
          'INTERNAL_ERROR'),
      status: 500,
    );

void main() {
  late ResponseBody Function(RequestOptions options) respond;
  late StubAdapter wire;

  setUp(() {
    AccountScope.debugReset();
    respond = (options) =>
        throw StateError('ответ не задан: ${options.method} ${options.path}');
    wire = installWireStand((options) => respond(options));
  });

  BookingProvider provider() {
    final p = BookingProvider();
    addTearDown(p.dispose);
    return p;
  }

  group('Отказ по статусу брони: фраза сервера целиком', () {
    test('Подтвердить — бронь уже подтверждена со второго телефона', () async {
      respond = (_) => jsonBody(
            _refusal(_alreadyConfirmed, 'INVALID_STATUS'),
            status: 400,
          );
      final p = provider();

      final refusal = await p.confirmBooking(_est, _booking);

      expect(refusal, _alreadyConfirmed);
      expect(wire.requests.single.method, 'PUT');
      expect(wire.requests.single.path, '$_base/confirm');
    });

    test('Отклонить — время на ответ истекло', () async {
      respond = (_) =>
          jsonBody(_refusal(_expired, 'INVALID_STATUS'), status: 400);
      final p = provider();

      final refusal = await p.declineBooking(_est, _booking, 'Нет мест');

      expect(refusal, _expired);
      expect(wire.requests.single.method, 'PUT');
      expect(wire.requests.single.path, '$_base/decline');
    });

    test('Не пришёл — гость отменил бронь', () async {
      respond = (_) =>
          jsonBody(_refusal(_cancelledByGuest, 'INVALID_STATUS'), status: 400);
      final p = provider();

      final refusal = await p.markNoShow(_est, _booking);

      expect(refusal, _cancelledByGuest);
      expect(wire.requests.single.method, 'PUT');
      expect(wire.requests.single.path, '$_base/no-show');
    });
  });

  // Брони нет / она чужого заведения / заведение не этого аккаунта — другие
  // коды статуса, но транспорт кладёт фразу сервера тем же путём. Проверено
  // на случай, если 403 или 404 однажды получат в транспорте свою ветку.
  for (final (status, code, message) in [
    (404, 'NOT_FOUND', _notFound),
    (403, 'FORBIDDEN', _notOwned),
  ]) {
    test('Подтвердить — $status $code: фраза сервера целиком', () async {
      respond = (_) => jsonBody(_refusal(message, code), status: status);
      final p = provider();

      final refusal = await p.confirmBooking(_est, _booking);

      expect(refusal, message);
      expect(wire.requests.single.path, '$_base/confirm');
    });
  }

  // Исчерпав повторы 5xx, транспорт отдаёт наверх исходный отказ dio — без
  // готовой фразы. Партнёр читает прежний русский текст провайдера, не
  // внутренний английский текст бэкенда.
  group('Сбой сервера: прежний русский текст провайдера', () {
    test('Подтвердить', () async {
      respond = _serverFailure;
      final p = provider();

      final refusal = await p.confirmBooking(_est, _booking);

      expect(refusal, 'Ошибка подтверждения');
      // Исходный запрос и три повтора — тот самый путь, где транспорт не
      // пересобирает отказ; список при этом не запрашивался.
      expect(wire.requests, hasLength(4));
      expect(wire.requests.map((r) => r.method).toSet(), {'PUT'});
    });

    test('Отклонить', () async {
      respond = _serverFailure;
      final p = provider();

      final refusal = await p.declineBooking(_est, _booking, 'Нет мест');

      expect(refusal, 'Ошибка отклонения');
      expect(wire.requests, hasLength(4));
    });

    test('Не пришёл', () async {
      respond = _serverFailure;
      final p = provider();

      final refusal = await p.markNoShow(_est, _booking);

      expect(refusal, 'Ошибка отметки неявки');
      expect(wire.requests, hasLength(4));
    });
  });

  test('нет связи: фраза транспорта как есть', () async {
    respond = (options) => throw DioException(
          requestOptions: options,
          type: DioExceptionType.connectionError,
        );
    final p = provider();

    final refusal = await p.confirmBooking(_est, _booking);

    expect(refusal, 'Нет связи. Проверьте подключение к интернету.');
  });

  // Ответ 2xx, но не 200 — путь, где сервис сам решает, что не вышло;
  // тексты прежние. У «Не пришёл» на этом пути текста не было (молча
  // `false`), теперь — его же «Ошибка отметки неявки».
  for (final (action, expected, act) in <(
    String,
    String,
    Future<String?> Function(BookingProvider)
  )>[
    ('Подтвердить', 'Не удалось подтвердить бронь',
        (p) => p.confirmBooking(_est, _booking)),
    ('Отклонить', 'Не удалось отклонить бронь',
        (p) => p.declineBooking(_est, _booking, 'Нет мест')),
    ('Не пришёл', 'Ошибка отметки неявки',
        (p) => p.markNoShow(_est, _booking)),
  ]) {
    test('$action: ответ 2xx, но не 200 — «$expected»', () async {
      respond =
          (_) => jsonBody(<String, dynamic>{'success': true}, status: 202);
      final p = provider();

      final refusal = await act(p);

      expect(refusal, expected);
      expect(wire.requests.single.method, 'PUT');
    });
  }

  // Сервер принял — как и до 13.10: отказа нет (экран не покажет красную
  // плашку), список перечитан провайдером.
  for (final (action, path, status, act) in <(
    String,
    String,
    String,
    Future<String?> Function(BookingProvider)
  )>[
    ('Подтвердить', 'confirm', 'confirmed',
        (p) => p.confirmBooking(_est, _booking)),
    ('Отклонить', 'decline', 'declined',
        (p) => p.declineBooking(_est, _booking, 'Нет мест')),
    ('Не пришёл', 'no-show', 'no_show', (p) => p.markNoShow(_est, _booking)),
  ]) {
    test('$action: сервер принял — отказа нет, список перечитан', () async {
      respond = (options) {
        if (options.method == 'PUT') {
          return jsonBody(<String, dynamic>{'success': true, 'data': {}});
        }
        return jsonBody(<String, dynamic>{
          'success': true,
          'data': {
            'items': [
              {
                'id': _booking,
                'establishment_id': _est,
                'user_id': '88888888-8888-4888-8888-888888888888',
                'booking_date': '2030-01-15T00:00:00.000Z',
                'booking_time': '19:00:00',
                'guest_count': 2,
                'contact_phone': '+375291234567',
                'status': status,
                'expires_at': '2030-01-15T13:00:00.000Z',
                'created_at': '2026-10-13T09:00:00.000Z',
                'updated_at': '2026-10-13T10:00:00.000Z',
                'user_name': 'Ирина',
              },
            ],
            'total': 1,
          },
        });
      };
      final p = provider();

      final refusal = await act(p);

      expect(refusal, isNull);
      expect(wire.requests.map((r) => '${r.method} ${r.path}'), [
        'PUT $_base/$path',
        'GET /api/v1/partner/bookings/$_est',
      ]);
      expect(
        [...p.pendingBookings, ...p.confirmedBookings, ...p.historyBookings]
            .map((b) => b.status),
        [status],
        reason: 'в провайдере — ответ перечитанного списка',
      );
    });
  }
}
