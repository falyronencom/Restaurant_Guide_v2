import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_menu_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Что видит партнёр на экране «Меню», пока позиций нет, — по состоянию
/// распознавания с сервера.
///
/// До 24.10.2026 (находка 3 инцидента Railway) экран был один на три случая:
/// меню не загружено, распознавание идёт, распознавание упало. Во время
/// инцидента 22–23.10 распознавание падало у всех, а партнёр видел «позиций
/// пока нет… распознавание выполняется автоматически». Теперь сервер кладёт
/// рядом с `data` поле `recognition`; сервер без поля — прежний экран.
///
/// Ответы — в форме контроллера бэкенда (`partnerMenuItemController`):
/// через стенд провода исполняются `ApiClient`, сервис и провайдер целиком.
const _est = '11111111-2222-3333-4444-555555555555';

/// Тексты — литералы: что партнёр читает, а не то, что экран о себе думает.
const _emptyTitle = 'Распознанных позиций меню пока нет';
const _processingTitle = 'Распознаём меню…';
const _failedTitle = 'Не удалось распознать меню';
const _failedHint = 'Нажмите «Перезапустить распознавание» внизу экрана или '
    'загрузите другой файл в разделе «Медиа».';

/// Совет, когда перезапуск этот же файл не прочтёт (пустой, за пределом).
const _otherFileHint =
    'Загрузите другой файл в разделе «Медиа» — например, фото страниц меню.';
const _bannerTitle = 'Часть меню не распознана';
const _notStartedTitle = 'Распознавание не запущено';
const _notStartedHint = 'Файл загружен, но распознавание не началось. '
    'Нажмите «Перезапустить распознавание».';
const _staleText =
    'Не удалось обновить — на экране может быть не последнее состояние.';
const _nothingFoundTitle = 'Позиций не нашлось';
const _nothingFoundHint = 'Файл прочитан, но блюд и цен в нём не нашлось. '
    'Загрузите более чёткое фото или другой файл в разделе «Медиа».';
const _retryButton = 'Перезапустить распознавание';

/// Фраза сервера (`MENU_RECOGNITION_FAILURES.serviceFailure`).
const _serviceFailure = 'Сбой распознавания — попробуйте позже.';

Map<String, dynamic> _item(String name) => {
      'id': 'item-$name',
      'establishment_id': _est,
      'media_id': 'media-1',
      'item_name': name,
      'price_byn': '12.50',
      'category_raw': 'Супы',
      'confidence': 0.9,
      'sanity_flag': null,
      'position': 0,
    };

void main() {
  late Map<String, dynamic> Function() answer;

  /// Ответ по адресу запроса — для теста двух карточек; `null` — [answer].
  Map<String, dynamic> Function(String path)? answerFor;
  late StubAdapter wire;

  /// Связи нет: запрос меню падает, ответа сервера нет.
  var offline = false;

  setUp(() {
    AccountScope.debugReset();
    answer = () => {'success': true, 'data': <dynamic>[]};
    answerFor = null;
    offline = false;
    wire = installWireStand((RequestOptions options) {
      if (offline) {
        throw DioException(
            requestOptions: options, type: DioExceptionType.connectionError);
      }
      return jsonBody(answerFor?.call(options.path) ?? answer());
    });
  });

  Future<PartnerMenuProvider> openMenu(WidgetTester tester) async {
    final provider = PartnerMenuProvider();
    addTearDown(provider.dispose);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: const MaterialApp(home: PartnerMenuScreen(establishmentId: _est)),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    return provider;
  }

  testWidgets('распознавание идёт → «Распознаём меню…», не «позиций пока нет»',
      (tester) async {
    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {'status': 'processing'},
        };
    await openMenu(tester);

    expect(find.text(_processingTitle), findsOneWidget);
    expect(find.text(_emptyTitle), findsNothing);
    expect(find.text(_failedTitle), findsNothing);
  });

  testWidgets(
      'распознавание упало → «Не удалось распознать меню», причина сервера '
      'и путь к существующей кнопке', (tester) async {
    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {
            'status': 'failed',
            'cause': 'service_failure',
            'reason': _serviceFailure,
            'failedAt': '2026-10-23T09:12:00.000Z',
          },
        };
    await openMenu(tester);

    expect(find.text(_failedTitle), findsOneWidget);
    expect(find.text(_serviceFailure), findsOneWidget);
    expect(find.text(_failedHint), findsOneWidget);
    expect(find.text(_retryButton), findsOneWidget);
    expect(find.text(_emptyTitle), findsNothing);
    expect(find.text(_processingTitle), findsNothing);
  });

  testWidgets('упало без причины в ответе → заголовок и подсказка, без пустой строки',
      (tester) async {
    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {'status': 'failed', 'reason': null},
        };
    await openMenu(tester);

    expect(find.text(_failedTitle), findsOneWidget);
    expect(find.text(_failedHint), findsOneWidget);
    expect(find.text(''), findsNothing);
  });

  // Ревью 24.10.2026: перезапуск при пустом файле или файле за пределом
  // перечитает все файлы карточки из суточного предела и упадёт так же.
  for (final (cause, reason) in [
    ('unreadable', 'Не удалось прочитать файл: текста меню в нём не нашлось.'),
    ('over_limit',
        'Файл слишком большой или сложный — превышен предел распознавания.'),
  ]) {
    testWidgets('упало, причина «$cause» → совет загрузить другой файл, не перезапуск',
        (tester) async {
      answer = () => {
            'success': true,
            'data': <dynamic>[],
            'recognition': {'status': 'failed', 'cause': cause, 'reason': reason},
          };
      await openMenu(tester);

      expect(find.text(_failedTitle), findsOneWidget);
      expect(find.text(reason), findsOneWidget);
      expect(find.text(_otherFileHint), findsOneWidget);
      expect(find.text(_failedHint), findsNothing);
    });
  }

  testWidgets('упало, код причины незнаком → совет как при сбое сервиса',
      (tester) async {
    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {'status': 'failed', 'cause': 'something_new', 'reason': _serviceFailure},
        };
    await openMenu(tester);

    expect(find.text(_failedHint), findsOneWidget);
    expect(find.text(_otherFileHint), findsNothing);
  });

  testWidgets('«none» без позиций → прежний пустой экран', (tester) async {
    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {'status': 'none'},
        };
    await openMenu(tester);

    expect(find.text(_emptyTitle), findsOneWidget);
    expect(find.text(_processingTitle), findsNothing);
    expect(find.text(_failedTitle), findsNothing);
    expect(find.text(_notStartedTitle), findsNothing);
    expect(find.text(_nothingFoundTitle), findsNothing);
  });

  // Находка Н39 (25.10.2026): файл загружен, а задания нет (суточный предел
  // отказал при загрузке, постановка упала). До правки сервер отдавал
  // «none», и экран обещал «распознавание выполняется автоматически».
  testWidgets('файл без задания → «Распознавание не запущено» и что нажать',
      (tester) async {
    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {'status': 'not_started'},
        };
    await openMenu(tester);

    expect(find.text(_notStartedTitle), findsOneWidget);
    expect(find.text(_notStartedHint), findsOneWidget);
    expect(find.text(_retryButton), findsOneWidget);
    expect(find.text(_emptyTitle), findsNothing);
    expect(find.textContaining('автоматически'), findsNothing);
  });

  testWidgets(
      'позиции есть, а у одного файла распознавание не начиналось → список и '
      'плашка над ним', (tester) async {
    answer = () => {
          'success': true,
          'data': [_item('Борщ')],
          'recognition': {'status': 'not_started'},
        };
    await openMenu(tester);

    expect(find.text('Борщ'), findsOneWidget);
    expect(find.text(_notStartedTitle), findsOneWidget);
    expect(find.text(_notStartedHint), findsOneWidget);
    expect(find.text(_bannerTitle), findsNothing);
    expect(tester.getTopLeft(find.text(_notStartedTitle)).dy,
        lessThan(tester.getTopLeft(find.text('Борщ')).dy));
  });

  // Находка Н38 (25.10.2026): текст прочитан, блюд нет — задание `done`,
  // список пуст. До правки — тот же экран «…выполняется автоматически».
  testWidgets('распознано, позиций ноль → «Позиций не нашлось» и что сделать',
      (tester) async {
    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {'status': 'done'},
        };
    await openMenu(tester);

    expect(find.text(_nothingFoundTitle), findsOneWidget);
    expect(find.text(_nothingFoundHint), findsOneWidget);
    expect(find.text(_emptyTitle), findsNothing);
    expect(find.textContaining('автоматически'), findsNothing);
  });

  testWidgets('сервер без поля (до правки) и статус, которого сборка не знает, '
      '→ прежний пустой экран', (tester) async {
    final provider = await openMenu(tester);
    expect(find.text(_emptyTitle), findsOneWidget);
    expect(find.text(_failedTitle), findsNothing);

    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {'status': 'queued_somewhere_new', 'reason': 'x'},
        };
    // Ответ приходит через транспорт стенда — его доводят кадры, не await.
    provider.fetchMenuItems(silent: true);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text(_emptyTitle), findsOneWidget);
    expect(find.text(_failedTitle), findsNothing);
    expect(find.text(_processingTitle), findsNothing);
  });

  testWidgets(
      'позиции есть, а один файл не распознан → список и плашка с причиной над ним',
      (tester) async {
    answer = () => {
          'success': true,
          'data': [_item('Борщ')],
          'recognition': {'status': 'failed', 'reason': _serviceFailure},
        };
    await openMenu(tester);

    expect(find.text('Борщ'), findsOneWidget);
    expect(find.text(_bannerTitle), findsOneWidget);
    expect(find.text(_serviceFailure), findsOneWidget);
    expect(find.text(_failedTitle), findsNothing);
    // Плашка — над списком.
    expect(tester.getTopLeft(find.text(_bannerTitle)).dy,
        lessThan(tester.getTopLeft(find.text('Борщ')).dy));
  });

  testWidgets('позиции есть и распознано → список без плашки', (tester) async {
    answer = () => {
          'success': true,
          'data': [_item('Борщ')],
          'recognition': {'status': 'done'},
        };
    await openMenu(tester);

    expect(find.text('Борщ'), findsOneWidget);
    expect(find.text(_bannerTitle), findsNothing);
  });

  // Ревью 24.10.2026 (линза): провайдер один на все экраны «Меню», а push или
  // уведомление открывает экран меню поверх открытого. Нижний экран, снова
  // оказавшись сверху, показывал карточку верхнего или застывал без опроса.
  testWidgets(
      'экран меню поверх другого и назад → нижний снова показывает свою карточку и опрашивается',
      (tester) async {
    const estA = 'aaaaaaaa-1111-4111-8111-111111111111';
    const estB = 'bbbbbbbb-2222-4222-8222-222222222222';
    answerFor = (path) => path.contains(estA)
        ? {
            'success': true,
            'data': [_item('Борщ')],
            'recognition': {'status': 'failed', 'cause': 'service_failure', 'reason': _serviceFailure},
          }
        : {
            'success': true,
            'data': [_item('Хачапури')],
            'recognition': {'status': 'done'},
          };
    int requestsOfA() =>
        wire.requests.where((r) => r.path.contains(estA)).length;

    final provider = PartnerMenuProvider();
    addTearDown(provider.dispose);
    final navigator = GlobalKey<NavigatorState>();
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: MaterialApp(
        navigatorKey: navigator,
        home: const PartnerMenuScreen(establishmentId: estA),
      ),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Борщ'), findsOneWidget);
    expect(find.text(_bannerTitle), findsOneWidget);

    // Нажатие на уведомление о карточке B — её меню поверх.
    navigator.currentState!.push(MaterialPageRoute<void>(
      builder: (_) => const PartnerMenuScreen(establishmentId: estB),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Хачапури'), findsOneWidget);

    // Назад: на экране A — карточка A, а не B.
    navigator.currentState!.pop();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Хачапури'), findsNothing);
    expect(find.text('Борщ'), findsOneWidget);
    expect(find.text(_bannerTitle), findsOneWidget);

    // И опрос карточки A идёт: через 30 с — новый запрос её меню.
    final before = requestsOfA();
    await tester.pump(const Duration(seconds: 31));
    await tester.pump(const Duration(milliseconds: 100));
    expect(requestsOfA(), before + 1);
  });

  // Находка Н41 (25.10.2026): ошибка фонового обновления терялась молча — экран
  // мог застыть на «Распознаём меню…», когда всё уже кончилось.
  testWidgets(
      'фоновое обновление не удалось дважды подряд → тихая строка «мог устареть»; '
      'одна неудача — нет; удачный ответ её снимает', (tester) async {
    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {'status': 'processing'},
        };
    await openMenu(tester);

    Future<void> nextPoll() async {
      await tester.pump(const Duration(seconds: 31));
      await tester.pump(const Duration(milliseconds: 100));
    }

    offline = true;
    await nextPoll();
    expect(find.text(_staleText), findsNothing,
        reason: 'один обрыв связи опрос переживает сам');
    expect(find.text(_processingTitle), findsOneWidget);

    await nextPoll();
    expect(find.text(_staleText), findsOneWidget);
    // Что было на экране, остаётся; красной плашки нет.
    expect(find.text(_processingTitle), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);

    offline = false;
    answer = () => {
          'success': true,
          'data': [_item('Борщ')],
          'recognition': {'status': 'done'},
        };
    await tester.tap(find.text('Обновить'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text(_staleText), findsNothing);
    expect(find.text('Борщ'), findsOneWidget);
  });

  // Ревью 25.10.2026: строка не должна пересоздавать список под собой.
  testWidgets('строка «мог устареть» появляется — список остаётся на том же месте',
      (tester) async {
    answer = () => {
          'success': true,
          'data': [for (var i = 0; i < 40; i++) _item('Блюдо $i')],
          'recognition': {'status': 'done'},
        };
    await openMenu(tester);
    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pump();
    final before = tester.state<ScrollableState>(find.byType(Scrollable)).position.pixels;
    expect(before, greaterThan(0));

    offline = true;
    for (var i = 0; i < 2; i++) {
      await tester.pump(const Duration(seconds: 31));
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.text(_staleText), findsOneWidget);
    expect(tester.state<ScrollableState>(find.byType(Scrollable)).position.pixels,
        before);
  });

  // Ревью 25.10.2026 (линза): сервер не смог прочитать состояние —
  // `recognition: null`. Это не «поля нет»: плашка и экран отказа остаются.
  testWidgets('состояние не прочиталось на сервере → показанное остаётся',
      (tester) async {
    answer = () => {
          'success': true,
          'data': [_item('Борщ')],
          'recognition': {'status': 'failed', 'reason': _serviceFailure},
        };
    await openMenu(tester);
    expect(find.text(_bannerTitle), findsOneWidget);

    answer = () => {
          'success': true,
          'data': [_item('Борщ')],
          'recognition': null,
        };
    await tester.pump(const Duration(seconds: 31));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text(_bannerTitle), findsOneWidget);
    expect(find.text(_serviceFailure), findsOneWidget);
  });

  testWidgets('«распознаём» сменяется списком сам — опросом, без действий партнёра',
      (tester) async {
    answer = () => {
          'success': true,
          'data': <dynamic>[],
          'recognition': {'status': 'processing'},
        };
    await openMenu(tester);
    expect(find.text(_processingTitle), findsOneWidget);

    answer = () => {
          'success': true,
          'data': [_item('Борщ')],
          'recognition': {'status': 'done'},
        };
    // Опрос провайдера — каждые 30 с.
    await tester.pump(const Duration(seconds: 31));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Борщ'), findsOneWidget);
    expect(find.text(_processingTitle), findsNothing);
  });
}
