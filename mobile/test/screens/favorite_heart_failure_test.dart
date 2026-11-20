import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/screens/favorites/favorites_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/results_list_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Вход задаётся одним признаком: экраны смотрят только на `isAuthenticated`.
class _Auth extends AuthProvider {
  @override
  bool get isAuthenticated => true;
}

/// Геолокация в тесте не нужна, и канала у неё нет.
class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> refreshUserLocationSilently() async => false;
}

const _id = '11111111-1111-4111-8111-111111111111';

/// Сообщения о сердце — дословно те, что в экранах.
const _failed = 'Не удалось обновить избранное';
const _added = 'Добавлено в избранное';
const _removed = 'Удалено из избранного';

/// `colorScheme.error` темы приложения (`AppTheme.errorRed`) — фон сообщения
/// о сбое; у сообщения об удаче своего фона нет.
const _errorRed = Color(0xFFF44336);

/// Место в «Избранном»: без фото — у сетевой картинки бесконечный спиннер.
Map<String, dynamic> _favorite() =>
    favoriteRow(id: _id)..['establishment_primary_image'] = null;

/// Место в выдаче — тоже без фото.
Map<String, dynamic> _result() =>
    establishmentRow(id: _id)..['primary_image_url'] = null;

/// Нажатие на сердце не изменило избранное, если сервер ответил отказом.
/// Прежде провайдер такой отказ гасил, откатывал сердце, а экран показывал
/// сообщение об удаче: «Удалено из избранного» у места, вернувшегося в
/// список (проба экранов Nirivio v4, находка 4, 21.11.2026).
///
/// Сбой доходит до экрана не сразу: на ответ 5xx `ApiClient` повторяет
/// запрос трижды, с паузами 0,5 + 1 + 1,5 с подставного времени. Сообщение
/// показывается сразу после этого и живёт 2 с — поэтому проверка смотрит на
/// него на 4-й секунде, а в конце время докручивается до его ухода.
void main() {
  /// Ответ сервера на добавление и снятие сердца.
  late int heartStatus;

  /// Что сервер отдаёт на чтение избранного.
  late List<Map<String, dynamic>> favorites;

  /// Выдача поиска.
  late List<Map<String, dynamic>> results;

  late StubAdapter wire;

  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues(<String, Object>{});
    heartStatus = 200;
    favorites = [];
    results = [];
    wire = installWireStand((options) {
      final path = options.uri.path;
      final method = options.method;
      if (path == '/api/v1/favorites' && method == 'GET') {
        return jsonBody(favoritesEnvelope(favorites: favorites));
      }
      if ((path == '/api/v1/favorites' && method == 'POST') ||
          (path == '/api/v1/favorites/$_id' && method == 'DELETE')) {
        return heartStatus == 200
            ? jsonBody(<String, dynamic>{'success': true, 'data': {}})
            : jsonBody(<String, dynamic>{
                'success': false,
                'error': <String, dynamic>{'code': 'INTERNAL_ERROR'},
              }, status: heartStatus);
      }
      if (path == '/api/v1/search/establishments') {
        return jsonBody(searchEnvelope(
            establishments: results, total: results.length, totalPages: 1));
      }
      if (path == '/api/v1/search/establishments/$_id') {
        final row = establishmentRow(id: _id)
          ..['primary_image_url'] = null
          ..['latitude'] = null
          ..['longitude'] = null;
        return jsonBody(<String, dynamic>{'success': true, 'data': row});
      }
      if (path == '/api/v1/establishments/$_id/reviews') {
        return jsonBody(reviewsEnvelope(reviews: []));
      }
      return jsonBody(<String, dynamic>{'success': false}, status: 404);
    });
  });

  /// Сколько раз ушёл запрос на сердце этим методом.
  int heartRequests(String method) => wire.requests
      .where((r) => r.method == method && r.uri.path.startsWith('/api/v1/favorites'))
      .length;

  /// До 4-й секунды после нажатия: повторы кончились, сообщение на экране.
  Future<void> untilAnswered(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 500));
    }
  }

  /// Удачный ответ приходит без повторов: сообщение — в первую секунду.
  Future<void> firstSecond(WidgetTester tester) async {
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
  }

  /// Сообщение уходит через 2 с и уезжает анимацией: без докрутки его
  /// таймер пережил бы тест.
  Future<void> drainMessages(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);
  }

  Color? messageColor(WidgetTester tester) =>
      tester.widget<SnackBar>(find.byType(SnackBar)).backgroundColor;

  Future<EstablishmentsProvider> pumpScreen(
    WidgetTester tester,
    Widget screen, {
    EstablishmentsProvider? provider,
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 1600);
    addTearDown(tester.view.reset);
    final establishments = provider ?? EstablishmentsProvider();
    addTearDown(establishments.dispose);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>(create: (_) => _Auth()),
        ChangeNotifierProvider<EstablishmentsProvider>.value(
            value: establishments),
        ChangeNotifierProvider<BookingProvider>(
            create: (_) => BookingProvider()),
      ],
      child: MaterialApp(theme: AppTheme.lightTheme, home: screen),
    ));
    await tester.pumpAndSettle();
    return establishments;
  }

  group('«Избранное»', () {
    final heart = find.descendant(
        of: find.byType(EstablishmentCard),
        matching: find.byIcon(Icons.favorite));

    testWidgets(
        'сбой снятия: место возвращается, «$_failed» на красном, '
        '«$_removed» нет', (tester) async {
      favorites = [_favorite()];
      heartStatus = 500;
      final provider = await pumpScreen(tester, const FavoritesScreen());
      expect(find.byType(EstablishmentCard), findsOneWidget,
          reason: 'предпосылка: место пришло в список');

      await tester.tap(heart);
      await tester.pump();
      expect(find.byType(EstablishmentCard), findsNothing,
          reason: 'сердце снимается по нажатию, до ответа сервера');

      await untilAnswered(tester);

      expect(heartRequests('DELETE'), 4,
          reason: 'сбой обязан дойти после повторов, как на телефоне');
      expect(find.byType(EstablishmentCard), findsOneWidget,
          reason: 'место не вернулось в список');
      expect(provider.isFavorite(_id), isTrue);
      expect(find.text(_failed), findsOneWidget);
      expect(find.text(_removed), findsNothing);
      expect(messageColor(tester), _errorRed);

      await drainMessages(tester);
    });

    testWidgets('удачное снятие: «$_removed», без фона, «$_failed» нет',
        (tester) async {
      favorites = [_favorite()];
      final provider = await pumpScreen(tester, const FavoritesScreen());

      await tester.tap(heart);
      await firstSecond(tester);

      expect(heartRequests('DELETE'), 1);
      expect(provider.isFavorite(_id), isFalse);
      expect(find.byType(EstablishmentCard), findsNothing);
      expect(find.text(_removed), findsOneWidget);
      expect(find.text(_failed), findsNothing);
      expect(messageColor(tester), isNull);

      await drainMessages(tester);
    });
  });

  group('Выдача', () {
    final card = find.byType(EstablishmentCard);
    Finder icon(IconData data) =>
        find.descendant(of: card, matching: find.byIcon(data));

    testWidgets(
        'сбой добавления: сердце гаснет, «$_failed» на красном, '
        '«$_added» нет', (tester) async {
      results = [_result()];
      heartStatus = 500;
      final provider = await pumpScreen(tester, const ResultsListScreen());
      expect(card, findsOneWidget, reason: 'предпосылка: место в выдаче');

      await tester.tap(icon(Icons.favorite_border));
      await tester.pump();
      expect(icon(Icons.favorite), findsOneWidget,
          reason: 'сердце загорается по нажатию, до ответа сервера');

      await untilAnswered(tester);

      expect(heartRequests('POST'), 4);
      expect(icon(Icons.favorite_border), findsOneWidget,
          reason: 'сердце осталось гореть у незаписанного избранного');
      expect(provider.isFavorite(_id), isFalse);
      expect(find.text(_failed), findsOneWidget);
      expect(find.text(_added), findsNothing);
      expect(messageColor(tester), _errorRed);
      expect(find.text('Ошибка загрузки'), findsNothing);

      await drainMessages(tester);
    });

    testWidgets('удачное добавление: «$_added», без фона, «$_failed» нет',
        (tester) async {
      results = [_result()];
      // Сервер принял — и при перечитывании отдаёт место в избранном.
      favorites = [_favorite()];
      final provider = await pumpScreen(tester, const ResultsListScreen());

      await tester.tap(icon(Icons.favorite_border));
      await firstSecond(tester);

      expect(heartRequests('POST'), 1);
      expect(icon(Icons.favorite), findsOneWidget);
      expect(provider.isFavorite(_id), isTrue);
      expect(find.text(_added), findsOneWidget);
      expect(find.text(_failed), findsNothing);
      expect(messageColor(tester), isNull);

      await drainMessages(tester);
    });

    testWidgets(
        'пустая выдача не становится «Ошибкой загрузки» после сбоя сердца '
        'на другом экране', (tester) async {
      // Провайдер один на всё приложение: выдача «Ничего не найдено» живёт
      // во вкладке поиска, пока сердце нажимают в «Избранном» или в
      // карточке заведения с карты. Прежде сбой сердца писал общую ошибку,
      // а её читает выдача — и пустая выдача показывала «Ошибка загрузки» и
      // «Проверьте интернет-соединение».
      heartStatus = 500;
      final provider = await pumpScreen(tester, const ResultsListScreen());
      expect(find.text('Ничего не найдено'), findsOneWidget,
          reason: 'предпосылка: выдача пуста');

      provider.toggleFavorite(_id);
      await untilAnswered(tester);

      expect(heartRequests('POST'), 4);
      expect(provider.isFavorite(_id), isFalse,
          reason: 'предпосылка: сбой дошёл, сердце откатилось');
      expect(find.text('Ошибка загрузки'), findsNothing);
      expect(find.text('Ничего не найдено'), findsOneWidget);
      expect(provider.error, isNull);
    });
  });

  group('Карточка заведения', () {
    final heart = find.byWidgetPredicate(
        (w) => w is Semantics && w.properties.identifier == 'e2e-detail-favorite',
        description: 'сердце карточки заведения');
    Finder icon(IconData data) =>
        find.descendant(of: heart, matching: find.byIcon(data));

    Future<EstablishmentsProvider> pumpDetail(WidgetTester tester) async {
      final provider = await pumpScreen(
        tester,
        const EstablishmentDetailScreen(establishmentId: _id),
        provider: _NoLocation(),
      );
      expect(find.text('Васильки'), findsWidgets,
          reason: 'предпосылка: карточка загрузилась');
      return provider;
    }

    testWidgets('сбой добавления: сердце гаснет, «$_failed» на красном',
        (tester) async {
      heartStatus = 500;
      final provider = await pumpDetail(tester);

      await tester.tap(heart);
      await tester.pump();
      expect(icon(Icons.favorite), findsOneWidget,
          reason: 'сердце загорается по нажатию, до ответа сервера');

      await untilAnswered(tester);

      expect(heartRequests('POST'), 4);
      expect(icon(Icons.favorite_border), findsOneWidget);
      expect(provider.isFavorite(_id), isFalse);
      expect(find.text(_failed), findsOneWidget);
      expect(find.text(_added), findsNothing);
      expect(messageColor(tester), _errorRed);

      await drainMessages(tester);
    });

    testWidgets('удачное добавление: сердце горит, сообщений нет, как прежде',
        (tester) async {
      favorites = [_favorite()];
      final provider = await pumpDetail(tester);

      await tester.tap(heart);
      await firstSecond(tester);

      expect(heartRequests('POST'), 1);
      expect(icon(Icons.favorite), findsOneWidget);
      expect(provider.isFavorite(_id), isTrue);
      expect(find.byType(SnackBar), findsNothing);

      await drainMessages(tester);
    });
  });
}
