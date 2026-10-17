import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_reviews_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/profile_screen.dart';
import 'package:restaurant_guide_mobile/screens/reviews/reviews_list_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Сбой загрузки отзывов не выдаётся за «отзывов нет», подгрузка при сбое
/// останавливается, отказ удаления ответа владельца читается текстом
/// (проход тестировщика 17.10, Х5, Х23, Х26).
///
/// До 17.10.2026 `ReviewsService` глотал любую ошибку: при сбое сети карточка
/// заведения писала «Пока нет отзывов. Станьте первым!», «Все отзывы» и
/// «Мои отзывы» — что отзывов нет, а ветки ошибки с «Повторить» на этих
/// экранах были недостижимы. Поверх настоящих `ApiClient` и
/// `ReviewsService`, подменён только провод.
const _placeId = '11111111-1111-4111-8111-111111111111';
const _failed = 'Не удалось загрузить отзывы';
const _moreFailed = 'Не удалось загрузить ещё отзывы';

ResponseBody _offline(RequestOptions options) =>
    throw DioException.connectionError(
      requestOptions: options,
      reason: 'нет сети (тест)',
    );

Map<String, dynamic> _review(int n, {String? partnerResponse}) => reviewRow(
      id: '33333333-3333-4333-8333-${n.toString().padLeft(12, '0')}',
      content: 'Отзыв $n',
      partnerResponse: partnerResponse,
    );

/// Страница из [count] отзывов, начиная с номера [first].
Map<String, dynamic> _page(int page, {int first = 1, int count = 10}) =>
    reviewsEnvelope(
      reviews: [for (var n = first; n < first + count; n++) _review(n)],
      page: page,
      limit: 10,
      total: 30,
      pages: 3,
    );

int _pageRequests(StubAdapter wire, int page) => wire.requests
    .where((r) =>
        r.method == 'GET' &&
        r.uri.path.endsWith('/reviews') &&
        r.queryParameters['page'] == page)
    .length;

Future<void> _pumpUntil(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 80 && finder.evaluate().isEmpty; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// До самого низа списка. Дважды: строка «Не удалось загрузить ещё…»
/// добавляется в конец после первой прокрутки и остаётся под краем экрана.
Future<void> toEnd(WidgetTester tester, Finder list) async {
  for (var i = 0; i < 2; i++) {
    await tester.drag(list, const Offset(0, -8000));
    await tester.pumpAndSettle();
  }
}

/// Геолокация в тесте не нужна и канала у неё нет.
class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> fetchUserLocation() async => false;
}

class _Guest extends AuthProvider {
  @override
  bool get isAuthenticated => false;
}

class _SignedIn extends AuthProvider {
  @override
  bool get isAuthenticated => true;

  @override
  User? get currentUser => const User(id: 'u-1', name: 'Гость');
}

void main() {
  group('Карточка заведения', () {
    late bool reviewsOffline;
    late Map<String, dynamic> reviewsBody;
    late StubAdapter wire;

    setUp(() {
      reviewsOffline = true;
      reviewsBody = reviewsEnvelope(total: 1, pages: 1);
      wire = installWireStand((options) {
        final path = options.uri.path;
        if (path == '/api/v1/search/establishments/$_placeId') {
          final row = establishmentRow(id: _placeId)
            // Сетевая картинка и карта Яндекса в тесте не работают.
            ..['primary_image_url'] = null
            ..['latitude'] = null
            ..['longitude'] = null;
          return jsonBody({'success': true, 'data': row});
        }
        if (path == '/api/v1/establishments/$_placeId/reviews') {
          if (reviewsOffline) return _offline(options);
          return jsonBody(reviewsBody);
        }
        return jsonBody({'success': false}, status: 404);
      });
    });

    Future<void> pumpCard(WidgetTester tester) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 900);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(create: (_) => _Guest()),
          ChangeNotifierProvider<EstablishmentsProvider>(
              create: (_) => _NoLocation()),
          ChangeNotifierProvider<BookingProvider>(
              create: (_) => BookingProvider()),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const EstablishmentDetailScreen(establishmentId: _placeId),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Васильки'), findsWidgets,
          reason: 'сбой отзывов не должен прятать само заведение');
    }

    testWidgets('сбой сети: «Не удалось загрузить отзывы», а не «отзывов нет»',
        (tester) async {
      await pumpCard(tester);

      expect(find.text(_failed), findsOneWidget);
      expect(find.text('Повторить'), findsOneWidget);
      expect(find.text('Пока нет отзывов. Станьте первым!'), findsNothing);
      // Число отзывов неизвестно — «0 отзывов» было бы неправдой.
      expect(find.text('0 отзывов'), findsNothing);
      expect(find.text('Все отзывы'), findsOneWidget);
    });

    testWidgets('«Повторить» загружает отзывы', (tester) async {
      await pumpCard(tester);
      reviewsOffline = false;

      await tester.ensureVisible(find.text('Повторить'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Повторить'));
      await _pumpUntil(tester, find.text('Драники как у бабушки'));

      expect(find.text('Драники как у бабушки'), findsOneWidget);
      expect(find.text('1 отзыв'), findsOneWidget);
      expect(find.text(_failed), findsNothing);
      expect(
          wire.requests
              .where((r) => r.uri.path.endsWith('/reviews'))
              .length,
          2);
    });

    testWidgets('отзывов действительно нет — прежнее «Станьте первым»',
        (tester) async {
      reviewsOffline = false;
      reviewsBody = reviewsEnvelope(reviews: [], total: 0, pages: 0);

      await pumpCard(tester);

      expect(find.text('Пока нет отзывов. Станьте первым!'), findsOneWidget);
      expect(find.text(_failed), findsNothing);
      expect(find.text('0 отзывов'), findsOneWidget);
    });
  });

  group('Все отзывы', () {
    final establishment = Establishment(
      id: _placeId,
      name: 'Тестовое место',
      category: 'Ресторан',
      address: 'ул. Тестовая, 1',
      city: 'Минск',
      status: 'active',
      createdAt: DateTime(2026, 10, 1),
      updatedAt: DateTime(2026, 10, 1),
    );

    Future<void> pumpList(WidgetTester tester) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 800);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        home: ReviewsListScreen(establishment: establishment),
      ));
      await tester.pump();
    }

    testWidgets('сбой первой страницы: ошибка и «Повторить»', (tester) async {
      var offline = true;
      installWireStand(
          (options) => offline ? _offline(options) : jsonBody(_page(1)));

      await pumpList(tester);
      await _pumpUntil(tester, find.text(_failed));

      expect(find.text(_failed), findsOneWidget);
      expect(find.text('Пока нет отзывов'), findsNothing);

      offline = false;
      await tester.tap(find.text('Повторить'));
      await _pumpUntil(tester, find.text('Отзыв 1'));

      expect(find.text('Отзыв 1'), findsOneWidget);
      expect(find.text(_failed), findsNothing);
    });

    testWidgets(
        'сбой подгрузки: листание стоит, «Повторить» внизу догружает страницу',
        (tester) async {
      var page2Offline = true;
      final wire = installWireStand((options) {
        final page = options.queryParameters['page'];
        if (page == 2) {
          return page2Offline
              ? _offline(options)
              : jsonBody(_page(2, first: 11));
        }
        if (page == 3) return jsonBody(_page(3, first: 21));
        return jsonBody(_page(1));
      });

      await pumpList(tester);
      await _pumpUntil(tester, find.text('Отзыв 1'));

      final list = find.byType(ListView);
      await toEnd(tester, list);

      expect(find.text(_moreFailed), findsOneWidget);
      expect(_pageRequests(wire, 2), 1);

      // Человек листает у конца ещё и ещё: запросов в сбой больше нет.
      for (var i = 0; i < 3; i++) {
        await tester.drag(list, const Offset(0, 300));
        await tester.pump(const Duration(milliseconds: 200));
        await tester.drag(list, const Offset(0, -600));
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(_pageRequests(wire, 2), 1,
          reason: 'после сбоя листание не должно слать запрос на каждую '
              'прокрутку');
      expect(_pageRequests(wire, 3), 0,
          reason: 'страница 2 не загрузилась — третью не просить');

      page2Offline = false;
      await toEnd(tester, list);
      await tester.tap(find.widgetWithText(TextButton, 'Повторить'));
      await tester.pumpAndSettle();

      expect(_pageRequests(wire, 2), 2);
      expect(find.text(_moreFailed), findsNothing);
      await tester.scrollUntilVisible(find.text('Отзыв 15'), 200,
          scrollable: find.byType(Scrollable).last);
      // Прокрутка к концу просит третью страницу — дождаться её.
      await tester.pumpAndSettle();
      expect(find.text('Отзыв 15'), findsOneWidget);
    });
  });

  group('Отзывы заведения у владельца', () {
    Future<void> pumpPartner(WidgetTester tester) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(800, 1200);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(
        home: PartnerReviewsScreen(establishmentId: _placeId),
      ));
    }

    testWidgets('сбой подгрузки: листание стоит до «Повторить»',
        (tester) async {
      var page2Offline = true;
      final wire = installWireStand((options) {
        final page = options.queryParameters['page'];
        if (page == 2) {
          return page2Offline
              ? _offline(options)
              : jsonBody(_page(2, first: 11));
        }
        if (page == 3) return jsonBody(_page(3, first: 21));
        return jsonBody(_page(1));
      });

      await pumpPartner(tester);
      await _pumpUntil(tester, find.text('Отзыв 1'));

      final list = find.byType(ListView);
      await toEnd(tester, list);

      expect(find.text(_moreFailed), findsOneWidget);
      expect(_pageRequests(wire, 2), 1);
      for (var i = 0; i < 3; i++) {
        await tester.drag(list, const Offset(0, 300));
        await tester.pump(const Duration(milliseconds: 200));
        await tester.drag(list, const Offset(0, -600));
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(_pageRequests(wire, 2), 1);

      page2Offline = false;
      await toEnd(tester, list);
      await tester.tap(find.widgetWithText(TextButton, 'Повторить'));
      await tester.pumpAndSettle();

      expect(_pageRequests(wire, 2), 2);
      expect(find.text(_moreFailed), findsNothing);
      await tester.scrollUntilVisible(find.text('Отзыв 15'), 200,
          scrollable: find.byType(Scrollable).last);
      // Прокрутка к концу просит третью страницу — дождаться её.
      await tester.pumpAndSettle();
      expect(find.text('Отзыв 15'), findsOneWidget);
    });

    group('удаление ответа', () {
      Future<String> deleteWith(WidgetTester tester,
          ResponseBody Function(RequestOptions) onDelete) async {
        installWireStand((options) {
          if (options.method == 'DELETE') return onDelete(options);
          return jsonBody(reviewsEnvelope(
            reviews: [_review(1, partnerResponse: 'Спасибо, ждём снова')],
            total: 1,
            pages: 1,
          ));
        });

        await pumpPartner(tester);
        await _pumpUntil(tester, find.text('Редактировать'));
        await tester.tap(find.text('Редактировать'));
        await tester.pump();
        await tester.tap(find.text('Удалить'));
        await _pumpUntil(tester, find.byType(SnackBar));

        final content =
            tester.widget<SnackBar>(find.byType(SnackBar)).content;
        return (content as Text).data!;
      }

      testWidgets('русский текст сервера — как есть', (tester) async {
        final text = await deleteWith(
            tester,
            (_) => jsonBody({
                  'success': false,
                  'message': 'Слишком много запросов. Попробуйте позже.',
                  'error': {
                    'code': 'RATE_LIMIT_EXCEEDED',
                    'details': {'limit': 100, 'window': '1 минута'},
                  },
                }, status: 429));

        expect(text, 'Слишком много запросов. Попробуйте позже.');
      });

      testWidgets('сбой сервера после повторов — его русский текст',
          (tester) async {
        // Исчерпав повторы 5xx, транспорт отдаёт наверх исходный отказ без
        // готовой фразы: текст берётся из тела ответа общим разбором.
        final text = await deleteWith(
            tester,
            (_) => jsonBody({
                  'success': false,
                  'message':
                      'Сбой на сервере. Попробуйте ещё раз через минуту.',
                  'error': {'code': 'INTERNAL_ERROR'},
                }, status: 500));

        expect(text, 'Сбой на сервере. Попробуйте ещё раз через минуту.');
      });

      testWidgets('нет сети — «Нет связи…»', (tester) async {
        final text = await deleteWith(tester, _offline);

        expect(text, 'Нет связи. Проверьте подключение к интернету.');
      });

      testWidgets('английский отказ — прежняя русская фраза', (tester) async {
        final text = await deleteWith(
            tester,
            (_) => jsonBody({
                  'success': false,
                  'message': 'This review has no partner response',
                  'error': {'code': 'RESPONSE_NOT_FOUND'},
                }, status: 404));

        expect(text, 'Не удалось удалить ответ');
      });

      testWidgets('удачное удаление — «Ответ удалён», как раньше',
          (tester) async {
        final text = await deleteWith(
            tester, (_) => jsonBody({'success': true, 'data': {}}));

        expect(text, 'Ответ удалён');
      });
    });
  });

  group('Мои отзывы в профиле', () {
    setUp(AccountScope.debugReset);

    testWidgets('сбой: ошибка и «Повторить», а не «У вас пока нет отзывов»',
        (tester) async {
      var offline = true;
      installWireStand((options) {
        if (options.uri.path == '/api/v1/users/u-1/reviews') {
          if (offline) return _offline(options);
          return jsonBody({
            'success': true,
            'data': {
              'reviews': [
                {
                  'id': '33333333-3333-4333-8333-000000000001',
                  'establishment_id': _placeId,
                  'establishment_name': 'Васильки',
                  'rating': 5,
                  'content': 'Отзыв из профиля',
                  'created_at': '2026-10-10T10:00:00.000Z',
                },
              ],
              'pagination': {'page': 1, 'limit': 20, 'total': 1, 'pages': 1},
            },
          });
        }
        return jsonBody({'success': false}, status: 404);
      });

      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 2000);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(create: (_) => _SignedIn()),
          ChangeNotifierProvider<EstablishmentsProvider>(
              create: (_) => _NoLocation()),
          ChangeNotifierProvider(create: (_) => PartnerDashboardProvider()),
          ChangeNotifierProvider(create: (_) => NotificationProvider()),
          ChangeNotifierProvider(create: (_) => BookingProvider()),
        ],
        child: const MaterialApp(home: ProfileScreen()),
      ));
      await tester.pump();
      await tester.tap(find.text('Показать профиль'));
      await _pumpUntil(tester, find.text(_failed));

      expect(find.text(_failed), findsOneWidget);
      expect(find.text('У вас пока нет отзывов'), findsNothing);

      offline = false;
      await tester.tap(find.text('Повторить'));
      await _pumpUntil(tester, find.text('Отзыв из профиля'));

      expect(find.text('Отзыв из профиля'), findsOneWidget);
      expect(find.text(_failed), findsNothing);
    });
  });
}
