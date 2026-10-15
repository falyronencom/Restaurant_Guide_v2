import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/edit_establishment_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/profile_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Что читает партнёр, когда действие на экране заведения не удалось.
///
/// До 13.10.2026 красная плашка показывала `Ошибка удаления: DioException
/// [bad response]: null`, перевод строки, `Error:` — и только потом фразу
/// сервера: сервис заведений заворачивал исключение целиком
/// (`'Ошибка удаления: $e'`), а провайдер снимал с него лишь `Exception: `.
/// Так же — у часов работы, повторной отправки на модерацию, приостановки и
/// возобновления. При сбое сервера после повторов под приставкой шли четыре
/// строки английского текста dio.
///
/// Правило (Координатор, 07.10.2026 «1А» для правки в мастере; 13.10.2026 —
/// то же для экрана заведения): партнёр читает готовую фразу сервера или
/// транспорта целиком, без приставки; без готовой фразы — общую русскую по
/// действию. Фразы по действиям — решение Координатора 13.10.2026; они
/// повторяют тексты успеха на том же экране («Заведение приостановлено» →
/// «Не удалось приостановить заведение…»).
///
/// Проверяется текст самой плашки, точным равенством, после настоящих
/// нажатий — экран, провайдер, сервис и `ApiClient` исполняются целиком.
/// Утверждение «текст содержит фразу сервера» зеленеет вместе с мусором
/// вокруг неё, на этом и держался дефект.
///
/// Ответы — в форме `errorHandler` бэкенда в production
/// (`{success, message, error: {code}, timestamp}`, без `stack`).
const _id = '11111111-2222-3333-4444-555555555555';
const _name = 'Кофейня у моста';

Map<String, dynamic> _refusal(String message, String code) => {
      'success': false,
      'message': message,
      'error': {'code': code},
      'timestamp': '2026-10-13T10:00:00.000Z',
    };

/// Сбой сервера. Для программной ошибки бэкенд отдаёт в `message` текст
/// исключения как есть — английский и внутренний; партнёру он не годится.
ResponseBody _serverFailure(RequestOptions _) => jsonBody(
      _refusal("Cannot read properties of undefined (reading 'id')",
          'INTERNAL_ERROR'),
      status: 500,
    );

/// Партнёр вошёл. Экран профиля смотрит только на этот признак; настоящий
/// вход через хранилище токенов здесь ни при чём.
class _SignedIn extends AuthProvider {
  @override
  bool get isAuthenticated => true;
}

void main() {
  /// Статус карточки так, как его отдаёт сервер (у опубликованной — 'active').
  late String status;

  /// Ответ на само действие — любой запрос, кроме чтения карточки и списка.
  late ResponseBody Function(RequestOptions options) action;
  late StubAdapter wire;

  setUp(() {
    AccountScope.debugReset();
    status = 'active';
    action = (options) =>
        throw StateError('ответ не задан: ${options.method} ${options.path}');
    wire = installWireStand((options) {
      if (options.method != 'GET') return action(options);
      final card = <String, dynamic>{
        'id': _id,
        'name': _name,
        'status': status,
      };
      if (options.uri.path.endsWith('/partner/establishments')) {
        return jsonBody(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'establishments': <Map<String, dynamic>>[card],
          },
        });
      }
      return jsonBody(<String, dynamic>{
        'success': true,
        'data': <String, dynamic>{'establishment': card},
      });
    });
  });

  /// Запросы самого действия — без чтения карточки.
  List<RequestOptions> actionRequests() =>
      wire.requests.where((r) => r.method != 'GET').toList();

  Future<void> openScreen(WidgetTester tester) async {
    final provider = PartnerDashboardProvider();
    addTearDown(provider.dispose);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: const MaterialApp(
        home: EditEstablishmentScreen(establishmentId: _id),
      ),
    ));
    await tester.pumpAndSettle();
  }

  /// Пункты меню — ниже края поверхности теста, их надо докрутить.
  Future<void> tapText(WidgetTester tester, String text) async {
    final target = find.text(text);
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
    await tester.tap(target);
    await tester.pumpAndSettle();
  }

  /// Кнопка подтверждения в диалоге. Последнее нажатие запускает запрос,
  /// поэтому без `pumpAndSettle`: время дальше ведёт [snackBarText].
  Future<void> confirm(WidgetTester tester, String button) async {
    await tester.tap(find.widgetWithText(TextButton, button));
    await tester.pump();
  }

  /// Текст красной плашки — целиком.
  ///
  /// Время идёт шагами по 100 мс, пока плашка не появится: при сбое сервера
  /// транспорт трижды повторяет запрос с паузами 0,5 / 1 / 1,5 с, а
  /// `pumpAndSettle` вернулся бы раньше — между повторами кадров нет. Один
  /// большой шаг тоже не годится: у отказа без повторов плашка успела бы
  /// уехать (она живёт 4 с).
  ///
  /// Когда плашка появилась, переходы доводятся до конца: мгновенный отказ
  /// приходит, пока экран часов работы ещё уезжает, а плашку рисует каждый
  /// `Scaffold` на экране — на эти доли секунды их две. Таймер плашки кадров
  /// не просит, так что `pumpAndSettle` её не дожидается.
  Future<String> snackBarText(WidgetTester tester) async {
    for (var i = 0; i < 100 && find.byType(SnackBar).evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.pumpAndSettle();
    final bar = tester.widget<SnackBar>(find.byType(SnackBar));
    return (bar.content as Text).data!;
  }

  Future<void> suspend(WidgetTester tester) async {
    status = 'active';
    await openScreen(tester);
    await tapText(tester, 'Приостановить или удалить');
    await tapText(tester, 'Приостановить');
    await confirm(tester, 'Приостановить');
  }

  Future<void> resume(WidgetTester tester) async {
    status = 'suspended';
    await openScreen(tester);
    await tapText(tester, 'Приостановить или удалить');
    await tester.tap(find.text('Возобновить'));
    await tester.pump();
  }

  Future<void> delete(WidgetTester tester) async {
    status = 'draft';
    await openScreen(tester);
    await tapText(tester, 'Приостановить или удалить');
    await tapText(tester, 'Удалить заведение');
    await confirm(tester, 'Удалить');
  }

  Future<void> resubmit(WidgetTester tester) async {
    status = 'rejected';
    await openScreen(tester);
    await tapText(tester, 'Отправить повторно на модерацию');
    await confirm(tester, 'Отправить');
  }

  Future<void> saveHours(WidgetTester tester) async {
    status = 'active';
    await openScreen(tester);
    await tapText(tester, 'Время работы');
    await tester.tap(find.text('Сохранить'));
    await tester.pump();
  }

  group('Отказ: готовая фраза целиком, без приставки', () {
    testWidgets('«Приостановить» без сети — фраза транспорта', (tester) async {
      action = (options) => throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          );

      await suspend(tester);

      expect(await snackBarText(tester),
          'Нет связи. Проверьте подключение к интернету.');
      expect(actionRequests().single.path,
          '/api/v1/partner/establishments/$_id/suspend');
    });

    testWidgets('«Возобновить», а модератор уже приостановил — фраза сервера',
        (tester) async {
      // Литерал бэкенда (`establishmentService.resumeEstablishment`).
      const refusal = 'Заведение приостановлено модератором. Исправьте '
          'замечания и отправьте повторно на модерацию.';
      action = (_) =>
          jsonBody(_refusal(refusal, 'ADMIN_SUSPENDED'), status: 403);

      await resume(tester);

      expect(await snackBarText(tester), refusal);
      expect(actionRequests().single.path,
          '/api/v1/partner/establishments/$_id/resume');
    });

    testWidgets('«Удалить» — отказ сервера', (tester) async {
      // Литерал решения Координатора 01.10.2026 — `NOT_DELETABLE_MESSAGE`
      // бэкенда. Карточка — черновик, пункт удаления на экране есть; так
      // бывает, когда экран устарел (карточку уже отправили с сайта).
      const refusal = 'Удалить можно только черновик или отклонённую '
          'карточку, которая ещё не была на сайте. Чтобы убрать эту '
          'карточку, напишите в поддержку.';
      action = (_) => jsonBody(
            _refusal(refusal, 'ESTABLISHMENT_NOT_DELETABLE'),
            status: 403,
          );

      await delete(tester);

      expect(await snackBarText(tester), refusal);
      expect(actionRequests().single.method, 'DELETE');
    });

    testWidgets('повторная отправка на модерацию — отказ сервера как есть',
        (tester) async {
      // Текст бэкенда сегодня английский (перевод текстов сервера — отдельная
      // задача). Правило одно: партнёр читает его целиком и без приставки —
      // после перевода на сервере прочтёт русский без правки приложения.
      const refusal = "Cannot submit establishment with status 'pending'. "
          'Only draft, rejected, or suspended establishments can be '
          'submitted.';
      action = (_) => jsonBody(
            _refusal(refusal, 'INVALID_STATUS_FOR_SUBMISSION'),
            status: 400,
          );

      await resubmit(tester);

      expect(await snackBarText(tester), refusal);
      expect(actionRequests().single.path,
          '/api/v1/partner/establishments/$_id/submit');
    });

    testWidgets('время работы — строка проверки полей от транспорта',
        (tester) async {
      // 422 проверки полей: транспорт сам собирает строку «Поле: фраза» по
      // своей таблице переводов — это и есть готовая фраза.
      action = (_) => jsonBody(<String, dynamic>{
            'success': false,
            'message': 'Validation failed',
            'error': <String, dynamic>{
              'code': 'VALIDATION_ERROR',
              'details': <Map<String, dynamic>>[
                {
                  'field': 'working_hours',
                  'message': 'Working hours must be a valid JSON object',
                  'value': null,
                },
              ],
            },
            'timestamp': '2026-10-13T10:00:00.000Z',
          }, status: 422);

      await saveHours(tester);

      expect(await snackBarText(tester),
          'Время работы: Некорректный формат времени работы');
      expect(actionRequests().single.method, 'PUT');
    });
  });

  group('Сбой сервера: общая фраза по действию', () {
    testWidgets('приостановить', (tester) async {
      action = _serverFailure;

      await suspend(tester);

      expect(await snackBarText(tester),
          'Не удалось приостановить заведение. Попробуйте ещё раз.',
          reason: 'у отказа после повторов 5xx нет готовой фразы; если '
              'транспорт начнёт отдавать `message` сервера, партнёр прочтёт '
              'внутренний английский текст бэкенда');
      // Исходный запрос и три повтора: отказ пришёл с того самого пути, где
      // транспорт не пересобирает ошибку.
      expect(actionRequests(), hasLength(4));
    });

    testWidgets('возобновить', (tester) async {
      action = _serverFailure;

      await resume(tester);

      expect(await snackBarText(tester),
          'Не удалось отправить заявку на возобновление. Попробуйте ещё раз.');
    });

    testWidgets('удалить', (tester) async {
      action = _serverFailure;

      await delete(tester);

      expect(await snackBarText(tester),
          'Не удалось удалить заведение. Попробуйте ещё раз.');
    });

    testWidgets('повторно отправить на модерацию', (tester) async {
      action = _serverFailure;

      await resubmit(tester);

      expect(await snackBarText(tester),
          'Не удалось отправить на модерацию. Попробуйте ещё раз.');
    });

    testWidgets('сохранить время работы', (tester) async {
      action = _serverFailure;

      await saveHours(tester);

      expect(await snackBarText(tester),
          'Не удалось сохранить время работы. Попробуйте ещё раз.');
    });
  });

  testWidgets(
      'после отказа действия профиль показывает список заведений, '
      'а не «проверьте интернет»', (tester) async {
    // До 13.10.2026 отказ любого действия на экране заведения записывался в
    // ту же ошибку, что и неудачная загрузка списка. Профиль под экраном
    // заведения (тот же стек вкладки) по ней прятал список и писал «Не
    // удалось загрузить данные. Проверьте интернет-соединение.» — пока
    // партнёр не нажмёт «Повторить» или не переключит вкладку.
    action = (_) => jsonBody(
          _refusal('Cannot suspend. Establishment must be in active status.',
              'INVALID_STATUS_TRANSITION'),
          status: 400,
        );
    final partner = PartnerDashboardProvider();
    addTearDown(partner.dispose);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>(create: (_) => _SignedIn()),
        ChangeNotifierProvider.value(value: partner),
        ChangeNotifierProvider(create: (_) => NotificationProvider()),
      ],
      child: const MaterialApp(home: ProfileScreen()),
    ));
    await tester.pumpAndSettle();
    expect(find.text(_name), findsOneWidget,
        reason: 'список не загрузился — проверка ниже ничего не докажет');

    // Так действие зовёт экран заведения, открытый поверх профиля.
    final suspending = partner.suspendEstablishment(_id);
    await tester.pumpAndSettle();
    expect(await suspending, isFalse,
        reason: 'действие должно было не удаться — иначе проверка пустая');

    expect(find.text(_name), findsOneWidget);
    expect(
      find.text('Не удалось загрузить данные. Проверьте интернет-соединение.'),
      findsNothing,
    );
  });
}
