import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_settings_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/screens/favorites/favorites_screen.dart';
import 'package:restaurant_guide_mobile/screens/main_navigation.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/widgets/selected_tab_scope.dart';

import '../support/push_home_stand.dart';
import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Избранное известно приложению сразу после входа (п. 40 прохода
/// тестировщика, 17.10.2026).
///
/// **Что было.** Список избранного заполняли только переход на вкладку
/// «Избранное» и первый кадр её экрана, если человек к этому кадру уже вошёл.
/// Вход изнутри приложения («Профиль» → «Войти») возвращает на уже открытую
/// главную, поэтому вошедший, не открывая вкладку, видел в профиле 0 вместо
/// сохранённого, пустые сердечки в выдаче, а повторное нажатие «добавляло»
/// то, что уже сохранено.
///
/// **Как проверяется.** Главная — настоящая, со всеми вкладками; подменены
/// авторизация, транспорт (сервер с избранным у каждого аккаунта) и канал
/// Firebase. Тест смотрит то, что видит человек (число в профиле, сердечки
/// провайдера), и то, что видит сервер (сколько раз его спросили).
void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });

  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues({
      BelarusCities.persistenceKey: BelarusCities.defaultCity,
    });
    PhoneMessaging().install();
  });

  /// Избранное каждого аккаунта на «сервере».
  late Map<String, List<String>> serverFavorites;

  /// Не null — придержать ответ на следующее чтение избранного этого
  /// аккаунта до слова теста.
  late Map<String, Completer<void>> heldReads;

  /// Читать избранное сервер отказывается. Ответ 400, не 500: на 5xx транспорт
  /// сам повторяет запрос с задержкой, и «сорвавшееся» чтение выздоровело бы
  /// без участия приложения.
  late bool failFavorites;

  setUp(() {
    serverFavorites = {
      'u-a': ['p1', 'p2'],
      'u-b': ['p3'],
    };
    heldReads = {};
    failFavorites = false;
  });

  ResponseBody held(Completer<void> gate, Map<String, dynamic> body) {
    return ResponseBody(
      Stream<Uint8List>.fromFuture(gate.future.then(
        (_) => Uint8List.fromList(utf8.encode(jsonEncode(body))),
      )),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  late _Home home;

  /// Главная, как в приложении. [storedUser] — сессия в хранилище.
  Future<_Home> pumpHome(
    WidgetTester tester, {
    User? storedUser,
    bool rateLimitedProfile = false,
  }) async {
    final authService = _RateLimitedAuthService(storedUser: storedUser)
      ..profileRateLimited = rateLimitedProfile;
    final auth = AuthProvider(authService: authService);
    final adapter = installWireStand((options) {
      final path = options.uri.path;
      if (path == '/api/v1/favorites' && options.method == 'GET') {
        final account = auth.currentUser?.id ?? authService.storedUser?.id;
        if (failFavorites) return jsonBody({'success': false}, status: 400);
        final rows = [
          for (final id in serverFavorites[account] ?? const <String>[])
            favoriteRow(id: id, name: 'Место $id'),
        ];
        final body = favoritesEnvelope(favorites: rows);
        final gate = heldReads.remove(account);
        return gate == null ? jsonBody(body) : held(gate, body);
      }
      if (path.endsWith('/notifications/device-token')) {
        return jsonBody({
          'success': true,
          'data': {'id': 'dt-1', 'is_active': true},
        });
      }
      if (path.endsWith('/notifications/unread-count')) {
        return jsonBody({
          'success': true,
          'data': {'count': 0},
        });
      }
      return jsonBody(searchEnvelope());
    }, accessToken: 'access');

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => auth),
          ChangeNotifierProvider(create: (_) => EstablishmentsProvider()),
          ChangeNotifierProvider(create: (_) => PartnerDashboardProvider()),
          ChangeNotifierProvider(create: (_) => NotificationProvider()),
          ChangeNotifierProvider(create: (_) => PromotionProvider()),
          ChangeNotifierProvider(create: (_) => PartnerMenuProvider()),
          ChangeNotifierProvider(create: (_) => BookingSettingsProvider()),
          ChangeNotifierProvider(create: (_) => BookingProvider()),
          ChangeNotifierProvider(
              create: (_) => NotificationPreferencesProvider()),
          ChangeNotifierProvider(create: (_) => SmartSearchProvider()),
        ],
        child: const MaterialApp(home: MainNavigationScreen()),
      ),
    );
    await settlePush(tester);
    final establishments = Provider.of<EstablishmentsProvider>(
      tester.element(find.byType(MainNavigationScreen)),
      listen: false,
    );
    return home = _Home(adapter, auth, authService, establishments);
  }

  Future<void> signIn(WidgetTester tester, User user) async {
    home.authService.nextLoginUser = user;
    await home.auth.login(emailOrPhone: '${user.id}@example.com', password: 's');
    await settlePush(tester);
  }

  /// Число под подписью «В избранном» в карточке профиля — то, что видит
  /// человек: вкладка «Профиль» → «Показать профиль». Вызывать один раз за
  /// тест, в конце.
  Future<String> profileCount(WidgetTester tester) async {
    await tester.tap(find.descendant(
      of: find.byType(BottomNavigationBar),
      matching: find.text('Профиль'),
    ));
    await tester.pump();
    await tester.tap(find.text('Показать профиль'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    final stats = find
        .ancestor(
          of: find.text('В избранном'),
          matching: find.byType(Column),
        )
        .first;
    final texts = tester
        .widgetList<Text>(
            find.descendant(of: stats, matching: find.byType(Text)))
        .map((t) => t.data)
        .toList();
    // Столбец: «<отзывов>», «Отзывов», «<в избранном>», «В избранном».
    return texts[texts.indexOf('В избранном') - 1]!;
  }

  testWidgets('гость: ни одного запроса избранного', (tester) async {
    await pumpHome(tester);

    expect(home.favoritesReads(), 0,
        reason: 'гость избранного не имеет, сервер ответил бы 401');
    expect(home.establishments.favoriteIds, isEmpty);

    await unmountPushHome(tester);
  });

  testWidgets('вход при уже открытой главной: избранное загружено один раз, '
      'профиль и сердечки верны без захода на вкладку', (tester) async {
    await pumpHome(tester);

    await signIn(tester, userA);

    expect(home.favoritesReads(), 1,
        reason: 'вход, а не каждое открытие профиля, — один запрос');
    expect(home.establishments.favoriteIds, {'p1', 'p2'},
        reason: 'сердечки в выдаче и карточке смотрят в это множество');
    expect(home.establishments.isFavorite('p1'), isTrue);
    expect(await profileCount(tester), '2',
        reason: 'вкладку «Избранное» никто не открывал');

    await unmountPushHome(tester);
  });

  testWidgets('холодный старт с сохранённым входом: избранное загружено один '
      'раз — вместе с первым кадром «Избранного»', (tester) async {
    await pumpHome(tester, storedUser: userA);

    expect(home.favoritesReads(), 1,
        reason: 'главная и экран «Избранного» просят избранное в один кадр — '
            'на сервер уходит один запрос');
    expect(home.establishments.favoriteIds, {'p1', 'p2'});
    expect(home.establishments.favoriteEstablishments, hasLength(2),
        reason: 'счёт профиля — длина этого списка');

    await unmountPushHome(tester);
  });

  testWidgets('сессия восстановлена с ответом 429 на профиль: профиль, дошедший '
      'позже, не вызывает второго чтения', (tester) async {
    await pumpHome(tester, storedUser: userA, rateLimitedProfile: true);
    expect(home.auth.currentUser, isNull, reason: 'предпосылка: профиля нет');
    expect(home.favoritesReads(), 1, reason: 'предпосылка: вошёл по токену');

    home.authService.profileRateLimited = false;
    await home.auth.refreshUser();
    await settlePush(tester);

    expect(home.auth.currentUser?.id, 'u-a', reason: 'предпосылка: профиль пришёл');
    expect(home.favoritesReads(), 1,
        reason: 'ключ аккаунта сменился с пустого на id, но аккаунт тот же и '
            'избранное уже прочитано');
    expect(home.establishments.favoriteIds, {'p1', 'p2'});

    await unmountPushHome(tester);
  });

  testWidgets('сессия восстановлена с ответом 429, чтение сорвалось: профиль, '
      'дошедший позже, читает избранное заново', (tester) async {
    failFavorites = true;
    await pumpHome(tester, storedUser: userA, rateLimitedProfile: true);
    expect(home.establishments.favoriteIds, isEmpty,
        reason: 'предпосылка: чтение сорвалось (лимит запросов бьёт и сюда)');

    failFavorites = false;
    home.authService.profileRateLimited = false;
    await home.auth.refreshUser();
    await settlePush(tester);

    expect(home.establishments.favoriteIds, {'p1', 'p2'},
        reason: 'пока избранное не прочитано, каждое уведомление о смене '
            'аккаунта — повод прочитать его снова');
    expect(home.establishments.favoriteEstablishments, hasLength(2),
        reason: 'счёт профиля — длина этого списка');

    await unmountPushHome(tester);
  });

  testWidgets('выход: избранное пусто и не читается заново', (tester) async {
    await pumpHome(tester, storedUser: userA);
    expect(home.establishments.favoriteIds, {'p1', 'p2'}, reason: 'предпосылка');

    await home.auth.logout();
    await settlePush(tester);

    expect(home.establishments.favoriteIds, isEmpty);
    expect(home.establishments.favoriteEstablishments, isEmpty);
    expect(home.favoritesReads(), 1, reason: 'гость избранного не запрашивает');

    await unmountPushHome(tester);
  });

  testWidgets('выход и вход другим аккаунтом: чужих мест нет, читается заново',
      (tester) async {
    await pumpHome(tester, storedUser: userA);

    await home.auth.logout();
    await settlePush(tester);
    await signIn(tester, userB);

    expect(home.establishments.favoriteIds, {'p3'},
        reason: 'места прежнего аккаунта не должны появиться');
    expect(home.favoritesReads(), 2);
    expect(home.establishments.favoriteEstablishments, hasLength(1),
        reason: 'счёт профиля — длина этого списка');

    await unmountPushHome(tester);
  });

  testWidgets('смена аккаунта без выхода, ответ прежнего пришёл позже: его '
      'места не появляются', (tester) async {
    final gateA = Completer<void>();
    heldReads['u-a'] = gateA;
    await pumpHome(tester, storedUser: userA);
    expect(home.establishments.favoriteIds, isEmpty,
        reason: 'предпосылка: ответ для аккаунта A придержан');

    await signIn(tester, userB);
    expect(home.establishments.favoriteIds, {'p3'}, reason: 'предпосылка');

    gateA.complete();
    await settlePush(tester);

    expect(home.establishments.favoriteIds, {'p3'},
        reason: 'запоздавший ответ прежнего аккаунта не попадает в нового');
    expect(home.establishments.favoriteEstablishments, hasLength(1),
        reason: 'счёт профиля — длина этого списка');
    expect(home.favoritesReads(), 2, reason: 'по одному чтению на аккаунт');

    await unmountPushHome(tester);
  });

  // ── Возврат в приложение (хвост 3, 17.10.2026) ──
  //
  // Чтение при входе или запуске могло сорваться (не было сети). До правки
  // его повторяли только заход на вкладку «Избранное» и смена аккаунта, а
  // до того в профиле 0 и сердечки пустые.

  /// Приложение ушло в фон и вернулось.
  Future<void> leaveAndReturn(WidgetTester tester) async {
    for (final state in [
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused,
      AppLifecycleState.hidden,
      AppLifecycleState.inactive,
      AppLifecycleState.resumed,
    ]) {
      tester.binding.handleAppLifecycleStateChanged(state);
    }
    await settlePush(tester);
  }

  testWidgets('чтение при запуске сорвалось: возврат в приложение — один '
      'запрос, избранное прочитано', (tester) async {
    failFavorites = true;
    await pumpHome(tester, storedUser: userA);
    expect(home.favoritesReads(), 1, reason: 'предпосылка: читали при запуске');
    expect(home.establishments.favoriteIds, isEmpty,
        reason: 'предпосылка: чтение сорвалось');

    failFavorites = false;
    await leaveAndReturn(tester);

    expect(home.favoritesReads(), 2, reason: 'возврат — одно новое чтение');
    expect(home.establishments.favoriteIds, {'p1', 'p2'});
    expect(home.establishments.favoriteEstablishments, hasLength(2),
        reason: 'счёт профиля — длина этого списка');

    await unmountPushHome(tester);
  });

  testWidgets('чтение ещё идёт: возврат в приложение второго запроса не шлёт',
      (tester) async {
    final gate = Completer<void>();
    heldReads['u-a'] = gate;
    await pumpHome(tester, storedUser: userA);
    expect(home.favoritesReads(), 1, reason: 'предпосылка: ответ придержан');

    await leaveAndReturn(tester);
    expect(home.favoritesReads(), 1, reason: 'идущее чтение не повторяется');

    gate.complete();
    await settlePush(tester);
    expect(home.establishments.favoriteIds, {'p1', 'p2'});

    await unmountPushHome(tester);
  });

  testWidgets('избранное прочитано: возврат в приложение — ни одного запроса',
      (tester) async {
    await pumpHome(tester, storedUser: userA);
    expect(home.establishments.favoriteIds, {'p1', 'p2'}, reason: 'предпосылка');
    final before = home.favoritesReads();

    await leaveAndReturn(tester);
    await leaveAndReturn(tester);

    expect(home.favoritesReads(), before);

    await unmountPushHome(tester);
  });

  testWidgets('гость: возврат в приложение — ни одного запроса избранного',
      (tester) async {
    await pumpHome(tester);

    await leaveAndReturn(tester);

    expect(home.favoritesReads(), 0);

    await unmountPushHome(tester);
  });

  // Прогулка «Избранного» различает «вкладку накрыла карточка» и «выбрали
  // другую вкладку» по этому признаку (хвост 2, 17.10.2026); тесты экрана
  // ставят его сами, а здесь — что его ставит главная.
  testWidgets('«Избранное» знает, выбрана ли его вкладка', (tester) async {
    await pumpHome(tester);
    bool selected() => SelectedTabScope.of(
        tester.element(find.byType(FavoritesScreen, skipOffstage: false)));
    Future<void> tapTab(String label) async {
      await tester.tap(find.descendant(
        of: find.byType(BottomNavigationBar),
        matching: find.text(label),
      ));
      await tester.pump();
    }

    expect(selected(), isFalse, reason: 'на старте выбран «Поиск»');
    await tapTab('Избранное');
    expect(selected(), isTrue);
    await tapTab('Профиль');
    expect(selected(), isFalse);

    await unmountPushHome(tester);
  });
}

/// Сессия без сервера авторизации; ответ 429 на профиль — по слову теста.
class _RateLimitedAuthService extends FakeSessionAuthService {
  _RateLimitedAuthService({super.storedUser});

  bool profileRateLimited = false;

  @override
  Future<User> getCurrentUser() async {
    if (profileRateLimited) {
      throw Exception("DioException: status code 429 Too Many Requests");
    }
    return super.getCurrentUser();
  }
}

class _Home {
  _Home(this.adapter, this.auth, this.authService, this.establishments);

  final StubAdapter adapter;
  final AuthProvider auth;
  final _RateLimitedAuthService authService;
  final EstablishmentsProvider establishments;

  /// Сколько раз сервер спросили про избранное: `GET /api/v1/favorites`.
  int favoritesReads() => adapter.requests
      .where((r) => r.method == 'GET' && r.uri.path == '/api/v1/favorites')
      .length;
}
