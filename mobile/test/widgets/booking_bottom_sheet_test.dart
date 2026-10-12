import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/widgets/booking_bottom_sheet.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Форма брони гостя на подставном транспорте: код провайдера и разбор
/// конверта исполняются целиком.
///
/// Найдено 09.10.2026: форма грузила условия с партнёрского адреса, гостю
/// там 403, и форма писала «Заведение не работает в этот день» на любую дату;
/// а закрытие в 00:00 давало ноль слотов и у владельца.
void main() {
  const id = '11111111-1111-4111-8111-111111111111';
  const termsPath = '/api/v1/establishments/$id/booking-settings';

  const terms = {
    'is_enabled': true,
    'max_guests_per_booking': 6,
    'max_days_ahead': 7,
    'min_hours_before': 2,
    'confirmation_timeout_hours': 4,
  };

  Map<String, dynamic> everyDay(Object hours) => {
        for (final day in [
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
        ])
          day: hours,
      };

  Establishment establishment(Map<String, dynamic> hours) =>
      Establishment.fromJson(establishmentRow(id: id, workingHours: hours));

  late StubAdapter wire;
  late int termsStatus;
  Map<String, dynamic>? bookingBody;

  setUp(() {
    termsStatus = 200;
    bookingBody = null;
    wire = installWireStand((options) {
      if (options.uri.path == termsPath) {
        return termsStatus == 200
            ? jsonBody({'success': true, 'data': terms})
            : jsonBody({
                'success': false,
                'error': {'code': 'FORBIDDEN', 'message': 'Нет доступа'},
              }, status: termsStatus);
      }
      if (options.method == 'POST' && options.uri.path == '/api/v1/bookings') {
        bookingBody = Map<String, dynamic>.from(options.data as Map);
        return jsonBody({
          'success': true,
          'data': {'id': 'b-1', 'status': 'pending'},
        }, status: 201);
      }
      return jsonBody({'success': false}, status: 404);
    });
  });

  /// Открывает форму кнопкой, как карточка заведения; возвращает результат
  /// закрытия формы (true — запрос отправлен). Вход проверяет карточка до
  /// открытия формы (detail_screen_test.dart), сама форма на него не смотрит.
  Future<ValueNotifier<bool?>> open(
    WidgetTester tester,
    Establishment place,
  ) async {
    tester.view.devicePixelRatio = 3.0;
    tester.view.physicalSize = const Size(1080, 2400); // 360 × 800 dp
    addTearDown(tester.view.reset);

    final result = ValueNotifier<bool?>(null);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
        ChangeNotifierProvider<BookingProvider>(
            create: (_) => BookingProvider()),
      ],
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () async => result.value =
                    await BookingBottomSheet.show(context, place),
                child: const Text('Хочу забронировать'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Хочу забронировать'));
    await tester.pumpAndSettle();
    return result;
  }

  testWidgets('гость читает условия с публичного адреса, не с партнёрского',
      (tester) async {
    await open(tester, establishment(everyDay('12:00-00:00')));

    final paths = wire.requests.map((r) => r.uri.path).toList();
    expect(paths, contains(termsPath));
    expect(paths.where((p) => p.contains('/partner/')), isEmpty);
  });

  testWidgets(
      'закрытие в 00:00: на завтра есть время до 23:30, «не работает» нет',
      (tester) async {
    await open(tester, establishment(everyDay('12:00-00:00')));

    await tester.tap(find.text('Завтра'));
    await tester.pumpAndSettle();

    expect(find.text('Заведение не работает в этот день'), findsNothing);
    expect(find.text('23:00'), findsOneWidget);
    expect(find.text('23:30'), findsOneWidget);
  });

  testWidgets('гость выбирает 23:30 и отправляет запрос — форма закрывается',
      (tester) async {
    final result = await open(
      tester,
      establishment(
          everyDay({'is_open': true, 'open': '18:00', 'close': '02:00'})),
    );

    await tester.tap(find.text('Завтра'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('23:30'));
    await tester.pump();
    await tester.enterText(
      find.widgetWithText(TextField, '+375 __ _______'),
      '+375291112233',
    );
    final submit = find.text('Отправить запрос');
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    await tester.pumpAndSettle();

    final tomorrow = DateTime.now().add(const Duration(days: 1));
    final date = '${tomorrow.year}-'
        '${tomorrow.month.toString().padLeft(2, '0')}-'
        '${tomorrow.day.toString().padLeft(2, '0')}';
    expect(bookingBody, isNotNull, reason: 'запрос на бронь не ушёл');
    expect(bookingBody!['time'], '23:30');
    expect(bookingBody!['date'], date);
    expect(bookingBody!['establishmentId'], id);
    expect(result.value, isTrue);
  });

  testWidgets(
      'условия не пришли (403) — «бронирование недоступно», не «не работает»',
      (tester) async {
    termsStatus = 403;
    await open(tester, establishment(everyDay('12:00-00:00')));

    expect(find.text('Бронирование сейчас недоступно. Попробуйте позже.'),
        findsOneWidget);
    expect(find.text('Заведение не работает в этот день'), findsNothing);

    final button = tester.widget<ElevatedButton>(
        find.widgetWithText(ElevatedButton, 'Отправить запрос'));
    expect(button.onPressed, isNull);
  });

  testWidgets('выходной по расписанию (is_open: false) — «не работает»',
      (tester) async {
    await open(tester, establishment(everyDay({'is_open': false})));

    expect(find.text('Заведение не работает в этот день'), findsOneWidget);
    final button = tester.widget<ElevatedButton>(
        find.widgetWithText(ElevatedButton, 'Отправить запрос'));
    expect(button.onPressed, isNull);
  });

  test('ответ 404 «бронь недоступна» провайдер отдаёт как null, без исключения',
      () async {
    termsStatus = 404;
    expect(await BookingProvider().loadBookingTerms(id), isNull);
    expect(wire.requests.single.method, 'GET');
    expect(wire.requests.single.uri.path, termsPath);
  });
}
