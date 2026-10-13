import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/promotion.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/create_promotion_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/promotions_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Что читает партнёр, когда сервер не принял акцию.
///
/// До 13.10.2026 приложение причину отказа не показывало вовсе: создание и
/// правка печатали свою фразу («Ошибка создания акции» — и на четвёртую акцию
/// при трёх действующих, хотя сервер объяснял, что не так), завершение акции
/// отказ молча проглатывало. А после неудачного создания флаг загрузки списка
/// так и оставался поднятым: пустой список крутил индикатор бесконечно.
///
/// Проверки — точным равенством: «текст содержит фразу сервера» зеленеет и
/// с мусором вокруг неё.
///
/// Ответы — в форме `errorHandler` бэкенда в production
/// (`{success, message, error: {code}, timestamp}`), тексты — литералы,
/// утверждённые Координатором 13.10.2026 для сервера. Через стенд провода
/// исполняется весь `ApiClient`, включая повторы 5xx и пересборку отказа.
const _est = '11111111-2222-3333-4444-555555555555';
const _promoId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const _limitRefusal = 'Одновременно может действовать не больше 3 акций. '
    'Удалите одну из текущих, чтобы добавить новую.';
const _notFoundRefusal =
    'Акция не найдена — возможно, её уже удалили. Обновите список акций.';
const _ownershipRefusal = 'Заведение не найдено или принадлежит другому '
    'аккаунту. Обновите список заведений.';

Map<String, dynamic> _refusal(String message, String code) => {
      'success': false,
      'message': message,
      'error': {'code': code},
      'timestamp': '2026-10-13T10:00:00.000Z',
    };

/// Сбой сервера. Для программной ошибки бэкенд отдаёт в `message` текст
/// исключения как есть — английский и внутренний.
ResponseBody _serverFailure() => jsonBody(
      _refusal("Cannot read properties of undefined (reading 'id')",
          'INTERNAL_ERROR'),
      status: 500,
    );

Map<String, dynamic> _promotionJson() => {
      'id': _promoId,
      'establishment_id': _est,
      'title': 'Скидка 20% на десерты',
      'status': 'active',
      'valid_from': '2026-10-01',
      'created_at': '2026-10-01T10:00:00.000Z',
    };

void main() {
  /// Список акций, который отдаёт сервер на GET.
  late List<Map<String, dynamic>> listed;

  /// Ответ на запрос, меняющий акцию (POST / PATCH / DELETE).
  late ResponseBody Function(RequestOptions options) mutation;
  late StubAdapter wire;

  setUp(() {
    AccountScope.debugReset();
    listed = [];
    mutation = (options) =>
        throw StateError('ответ не задан: ${options.method} ${options.path}');
    wire = installWireStand((options) {
      if (options.method == 'GET') {
        return jsonBody({'success': true, 'data': listed});
      }
      return mutation(options);
    });
  });

  /// Запросы, меняющие акцию, — без перечитываний списка.
  List<RequestOptions> mutations() =>
      wire.requests.where((r) => r.method != 'GET').toList();

  PromotionProvider newProvider() {
    final p = PromotionProvider();
    addTearDown(p.dispose);
    return p;
  }

  Future<void> pumpScreen(
    WidgetTester tester,
    PromotionProvider provider,
    Widget screen,
  ) async {
    // Высокий экран: форма акции — ленивый ListView, и в 800×600 кнопка
    // сохранения за краем не строится вовсе — её не найти.
    tester.view.physicalSize = const Size(800, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: MaterialApp(home: screen),
    ));
    await tester.pump();
  }

  /// Шаги по 100 мс, пока не появится [finder]. Длительность у `pump` нужна:
  /// паузы между повторами 5xx у транспорта — таймеры поддельного времени.
  /// `pumpAndSettle` здесь не годится: индикатор на кнопке сохранения (и
  /// вечный индикатор старого кода) кадры просит всегда.
  Future<void> pumpUntil(WidgetTester tester, Finder finder) async {
    for (var i = 0; i < 60 && finder.evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  String snackBarText(WidgetTester tester) {
    final content = tester.widget<SnackBar>(find.byType(SnackBar)).content;
    return (content as Text).data!;
  }

  Future<void> submitNewPromotion(WidgetTester tester) async {
    await tester.enterText(find.byType(TextFormField).first, 'Скидка 20%');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Создать акцию'));
    await pumpUntil(tester, find.byType(SnackBar));
  }

  group('Создание акции', () {
    testWidgets('четвёртая акция: причина отказа — фраза сервера целиком',
        (tester) async {
      mutation = (_) => jsonBody(
            _refusal(_limitRefusal, 'PROMOTION_LIMIT_EXCEEDED'),
            status: 400,
          );
      await pumpScreen(tester, newProvider(),
          const CreatePromotionScreen(establishmentId: _est));

      await submitNewPromotion(tester);

      expect(snackBarText(tester), _limitRefusal);
      // Отказ пришёл именно на создание.
      expect(mutations().single.method, 'POST');
      expect(mutations().single.path, '/api/v1/partner/promotions');
    });

    testWidgets('нет связи: фраза транспорта', (tester) async {
      mutation = (options) => throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          );
      await pumpScreen(tester, newProvider(),
          const CreatePromotionScreen(establishmentId: _est));

      await submitNewPromotion(tester);

      expect(snackBarText(tester),
          'Нет связи. Проверьте подключение к интернету.');
    });

    testWidgets('сбой сервера: прежняя русская фраза, а не текст исключения',
        (tester) async {
      mutation = (_) => _serverFailure();
      await pumpScreen(tester, newProvider(),
          const CreatePromotionScreen(establishmentId: _est));

      await submitNewPromotion(tester);

      expect(snackBarText(tester), 'Ошибка создания акции',
          reason: 'у отказа после повторов 5xx нет готовой фразы; если '
              'показывать `message` сервера, партнёр прочтёт внутренний '
              'английский текст бэкенда');
      // Отказ пришёл на создание. Сколько раз запрос дошёл до провода —
      // забота транспорта, не этого теста: сейчас один (повтор 5xx до
      // провода не доходит, тело формы израсходовано первой попыткой), и
      // наверх уходит сырой отказ первой попытки без готовой фразы.
      expect(mutations().map((r) => r.method).toSet(), {'POST'});
    });
  });

  group('Изменение акции', () {
    testWidgets('акцию уже удалили: причина отказа — фраза сервера',
        (tester) async {
      mutation = (_) => jsonBody(
            _refusal(_notFoundRefusal, 'PROMOTION_NOT_FOUND'),
            status: 404,
          );
      await pumpScreen(
        tester,
        newProvider(),
        CreatePromotionScreen(
          establishmentId: _est,
          existingPromotion: Promotion.fromJson(_promotionJson()),
        ),
      );

      await tester.tap(find.widgetWithText(ElevatedButton, 'Сохранить'));
      await pumpUntil(tester, find.byType(SnackBar));

      expect(snackBarText(tester), _notFoundRefusal);
      expect(mutations().single.method, 'PATCH');
      expect(mutations().single.path, '/api/v1/partner/promotions/$_promoId');
    });
  });

  group('Завершение акции', () {
    Future<void> confirmDeactivate(WidgetTester tester) async {
      listed = [_promotionJson()];
      await pumpScreen(tester, newProvider(),
          const PromotionsScreen(establishmentId: _est, establishmentName: 'Мост'));
      await pumpUntil(tester, find.text('Скидка 20% на десерты'));

      // Кнопка на карточке, затем такая же в окне подтверждения.
      await tester.tap(find.widgetWithText(TextButton, 'Завершить'));
      await tester.pumpAndSettle();
      await tester.tap(find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(TextButton, 'Завершить'),
      ));
      await pumpUntil(tester, find.byType(SnackBar));
    }

    testWidgets('акцию уже удалили: отказ виден, с причиной сервера',
        (tester) async {
      mutation = (_) => jsonBody(
            _refusal(_notFoundRefusal, 'PROMOTION_NOT_FOUND'),
            status: 404,
          );

      await confirmDeactivate(tester);

      expect(find.byType(SnackBar), findsOneWidget,
          reason: 'до 13.10.2026 отказ в завершении проглатывался молча');
      expect(snackBarText(tester), _notFoundRefusal);
      expect(mutations().single.method, 'DELETE');
      expect(mutations().single.path, '/api/v1/partner/promotions/$_promoId');
    });

    testWidgets('сбой сервера: прежняя русская фраза провайдера',
        (tester) async {
      mutation = (_) => _serverFailure();

      await confirmDeactivate(tester);

      expect(find.byType(SnackBar), findsOneWidget);
      expect(snackBarText(tester), 'Ошибка деактивации акции');
    });
  });

  group('Пустой список после отказа в создании', () {
    testWidgets('индикатор не крутится, отказ не выдаётся за ошибку списка',
        (tester) async {
      // Карточку удалили со второго телефона: сервер отвечает отказом по
      // владению. В пустом списке это реально: ограничение в три акции до
      // первой не наступает.
      mutation = (_) => jsonBody(
            _refusal(_ownershipRefusal, 'ESTABLISHMENT_NOT_FOUND'),
            status: 404,
          );
      await pumpScreen(tester, newProvider(),
          const PromotionsScreen(establishmentId: _est, establishmentName: 'Мост'));
      await pumpUntil(tester, find.text('Нет акций'));

      // Кнопка пустого списка (`ElevatedButton.icon` — свой подкласс, поиск
      // по типу ElevatedButton её не находит).
      await tester.tap(find.text('Создать акцию'));
      await tester.pumpAndSettle();
      await submitNewPromotion(tester);
      // Отказ дошёл до экрана; его текст — забота тестов выше, здесь — что
      // после него со списком.
      expect(find.byType(SnackBar), findsOneWidget);

      // Партнёр возвращается к списку.
      Navigator.of(tester.element(find.byType(CreatePromotionScreen))).pop();
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }

      expect(find.byType(CreatePromotionScreen), findsNothing,
          reason: 'экран создания должен закрыться — иначе проверки ниже '
              'смотрят не на список');
      expect(find.byType(CircularProgressIndicator), findsNothing,
          reason: 'флаг загрузки списка остался поднятым после отказа');
      // Пустой список, а не ошибка списка (текст и кнопка «Повторить» на
      // месте списка): отказ в создании к загрузке списка не относится,
      // партнёр уже прочёл его в плашке.
      expect(find.text('Нет акций'), findsOneWidget);
    });
  });

  group('Провайдер после отказа', () {
    test('создание: флаг загрузки списка опущен, ошибки списка нет', () async {
      mutation = (_) => jsonBody(
            _refusal(_limitRefusal, 'PROMOTION_LIMIT_EXCEEDED'),
            status: 400,
          );
      final p = newProvider();

      final created =
          await p.createPromotion(establishmentId: _est, title: 'Скидка');

      expect(created, isFalse);
      expect(p.isLoading, isFalse);
      expect(p.error, isNull);
    });

    test('изменение: флаг загрузки списка опущен, ошибки списка нет',
        () async {
      mutation = (_) => jsonBody(
            _refusal(_notFoundRefusal, 'PROMOTION_NOT_FOUND'),
            status: 404,
          );
      final p = newProvider();

      final updated = await p.updatePromotion(
          promotionId: _promoId, establishmentId: _est, title: 'Скидка');

      expect(updated, isFalse);
      expect(p.isLoading, isFalse);
      expect(p.error, isNull);
    });

    test('смена аккаунта стирает причину отказа прежнего', () async {
      mutation = (_) => jsonBody(
            _refusal(_limitRefusal, 'PROMOTION_LIMIT_EXCEEDED'),
            status: 400,
          );
      final p = newProvider();
      await p.createPromotion(establishmentId: _est, title: 'Скидка');
      // Причина записана — иначе проверке ниже нечего стирать.
      expect(p.actionError, _limitRefusal);

      AccountScope.resetAll();

      expect(p.actionError, isNull);
    });
  });
}
