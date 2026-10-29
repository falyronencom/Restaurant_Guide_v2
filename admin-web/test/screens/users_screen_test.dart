import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/config/router.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/providers/admin_users_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/users/users_screen.dart';
import 'package:restaurant_guide_admin_web/services/admin_user_service.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';

import '../helpers/stub_auth.dart';

// «Пользователи» — проход тестировщика 17.10, п. 8: модератор находит
// человека и блокирует его с причиной, разблокирует, сбрасывает имя.
// Просмотрщик видит экран без имён и без кнопок. Учётки панели, служебная
// учётка и партнёр с карточками кнопку блокировки не получают — вместо неё
// сказано почему.

class _FakeUserService implements AdminUserService {
  List<AdminUser> users;
  final Map<String, AdminUser> cards;
  final List<String> calls = <String>[];
  Object? failWith;

  /// Отказ чтения — списка и карточки.
  Object? readFailure;

  /// Что сервер ответит в `changed`.
  bool changed = true;

  /// Если задан — действие ждёт его: запрос «в полёте».
  Completer<bool>? pending;

  _FakeUserService(this.users, {Map<String, AdminUser>? cards})
      : cards = cards ?? {for (final u in users) u.id: u};

  @override
  Future<AdminUserListResponse> getUsers({
    int page = 1,
    int perPage = 20,
    String? search,
    String? status,
    String? role,
  }) async {
    calls.add('list search=${search ?? ''} status=${status ?? ''}');
    final failure = readFailure;
    if (failure != null) throw failure;
    return AdminUserListResponse(
      users: users,
      total: users.length,
      page: 1,
      pages: 1,
    );
  }

  @override
  Future<AdminUser> getUser(String id) async {
    calls.add('get $id');
    final failure = readFailure;
    if (failure != null) throw failure;
    return cards[id]!;
  }

  Future<bool> _act(String what, String id, String reason) async {
    calls.add('$what $id «$reason»');
    final error = failWith;
    if (error != null) throw error;
    final wait = pending;
    if (wait != null) return wait.future;
    return changed;
  }

  /// Сколько отзывов «скрыла» блокировка — для итоговой фразы.
  int? hiddenReviews;

  /// Что «скажет» разблокировка о снятой блокировке.
  AdminUserUnblockResult Function(bool changed)? unblockAnswer;

  @override
  Future<AdminUserBlockResult> block(String id, {required String reason}) async =>
      AdminUserBlockResult(
        changed: await _act('block', id, reason),
        hiddenReviews: hiddenReviews,
      );

  @override
  Future<AdminUserUnblockResult> unblock(
    String id, {
    required String reason,
    bool restoreReviews = true,
  }) async {
    final changed = await _act(
        'unblock', id, restoreReviews ? reason : '$reason; без отзывов');
    return unblockAnswer?.call(changed) ??
        AdminUserUnblockResult(changed: changed);
  }

  @override
  Future<bool> resetName(String id, {required String reason}) =>
      _act('reset-name', id, reason);
}

AdminUser _user({
  String id = 'u1',
  String? name = 'Злой Комментатор',
  String? email = 'angry@example.com',
  String role = 'user',
  bool isActive = true,
  int reviewCount = 3,
  int? hiddenReviewCount = 0,
  int establishmentCount = 0,
  int? liveEstablishmentCount,
  bool isServiceAccount = false,
  bool viewerRedacted = false,
  AdminUserBlockAction? lastBlockAction,
}) =>
    AdminUser(
      id: id,
      name: name,
      email: email,
      role: role,
      isActive: isActive,
      reviewCount: reviewCount,
      hiddenReviewCount: hiddenReviewCount,
      establishmentCount: establishmentCount,
      liveEstablishmentCount: liveEstablishmentCount ?? establishmentCount,
      isServiceAccount: isServiceAccount,
      viewerRedacted: viewerRedacted,
      lastBlockAction: lastBlockAction,
      createdAt: DateTime.utc(2026, 10, 1, 9),
    );

/// Номер человека в формате сервера — только такой уходит в запрос из ссылки.
const String _authorUuid = '0d9a6c1e-4b7f-4a52-9e3d-1f2a3b4c5d6e';

void main() {
  Future<_FakeUserService> pumpScreen(
    WidgetTester tester,
    List<AdminUser> users, {
    bool viewer = false,
    String? initialUserId,
    Map<String, AdminUser>? cards,
  }) async {
    final fake = _FakeUserService(users, cards: cards);
    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AdminUsersProvider>(
            create: (_) => AdminUsersProvider(service: fake),
          ),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) =>
                viewer ? StubAuthProvider.viewer() : StubAuthProvider.admin(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(body: UsersScreen(initialUserId: initialUserId)),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    return fake;
  }

  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

  Future<void> openRow(WidgetTester tester, String name) async {
    await tester.tap(find.text(name).first);
    await settle(tester);
  }

  testWidgets('администратор: строка, карточка и блокировка с причиной',
      (tester) async {
    final fake = await pumpScreen(tester, [_user()]);
    fake.hiddenReviews = 2;

    expect(find.text('Злой Комментатор'), findsOneWidget);
    expect(find.textContaining('angry@example.com'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('users-search')), findsOneWidget);

    await openRow(tester, 'Злой Комментатор');
    expect(find.text('Активен'), findsOneWidget);
    expect(find.text('3 отзыва'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey<String>('user-block')));
    await settle(tester);
    expect(find.text('Заблокировать пользователя?'), findsOneWidget);
    // Последствия и то, что увидит сам человек (A2-22) — одним текстом.
    expect(find.text('$kBlockConsequences\n\n$kBlockWhatTheyNotice'),
        findsOneWidget);

    // Без причины подтвердить нельзя.
    final confirm = find.byKey(const ValueKey<String>('user-reason-confirm'));
    expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
    await tester.enterText(
        find.byKey(const ValueKey<String>('user-reason')), '  мат в отзывах ');
    await tester.pump();
    expect(tester.widget<FilledButton>(confirm).onPressed, isNotNull);

    await tester.tap(confirm);
    await settle(tester);
    await settle(tester);

    expect(fake.calls, contains('block u1 «мат в отзывах»'));
    // Итог — счётом сервера, а не обещанием «его отзывы скрыты» (проход по
    // панели 20.10, A2-06): фейк скрыл два.
    expect(find.text('Пользователь заблокирован, скрыто отзывов: 2'),
        findsOneWidget);
  });

  Future<void> confirmWithReason(
      WidgetTester tester, Key button, String reason) async {
    await tester.tap(find.byKey(button));
    await settle(tester);
    await tester.enterText(
        find.byKey(const ValueKey<String>('user-reason')), reason);
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('user-reason-confirm')));
    await settle(tester);
  }

  testWidgets('повтор: сервер ничего не менял — так и сказано', (tester) async {
    final fake = await pumpScreen(tester, [_user()]);
    fake.changed = false;
    await openRow(tester, 'Злой Комментатор');
    await confirmWithReason(
        tester, const ValueKey<String>('user-block'), 'мат');
    await settle(tester);

    expect(find.text(kUserActionNothingChanged), findsOneWidget);
    expect(find.text('Пользователь заблокирован, его отзывы скрыты'),
        findsNothing);
  });

  testWidgets('итог действия не встаёт под другим человеком', (tester) async {
    final first = _user(id: 'u1', name: 'Первый Человек');
    final second = _user(id: 'u2', name: 'Второй Человек');
    final fake = await pumpScreen(tester, [first, second]);
    fake.pending = Completer<bool>();

    await openRow(tester, 'Первый Человек');
    await confirmWithReason(
        tester, const ValueKey<String>('user-block'), 'мат');
    expect(fake.calls, contains('block u1 «мат»'));

    // Пока запрос в полёте, модератор открыл другого.
    await openRow(tester, 'Второй Человек');
    fake.pending!.complete(true);
    await settle(tester);
    await settle(tester);

    expect(find.text('Пользователь заблокирован, его отзывы скрыты'),
        findsNothing);
  });

  testWidgets('отмена диалога ничего не отправляет', (tester) async {
    final fake = await pumpScreen(tester, [_user()]);
    await openRow(tester, 'Злой Комментатор');
    await tester.tap(find.byKey(const ValueKey<String>('user-reset-name')));
    await settle(tester);
    expect(find.text('Сбросить имя?'), findsOneWidget);
    await tester.tap(find.text('Отмена'));
    await settle(tester);
    expect(fake.calls.where((c) => c.startsWith('reset-name')), isEmpty);
  });

  testWidgets('заблокированный: метка, причина, кнопка «Разблокировать»',
      (tester) async {
    final blocked = _user(
      isActive: false,
      hiddenReviewCount: 3,
      lastBlockAction: AdminUserBlockAction(
        action: 'user_block',
        reason: 'мат в отзывах',
        createdAt: DateTime.utc(2026, 10, 17, 12),
        adminName: 'Сергей Админов',
      ),
    );
    final fake = await pumpScreen(tester, [blocked]);
    expect(find.text('заблокирован'), findsOneWidget);

    await openRow(tester, 'Злой Комментатор');
    expect(find.text('Заблокирован'), findsOneWidget);
    expect(find.text('Причина: мат в отзывах'), findsOneWidget);
    expect(find.text('3 отзыва, из них скрыто 3'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('user-block')), findsNothing);

    await tester.tap(find.byKey(const ValueKey<String>('user-unblock')));
    await settle(tester);
    // Галочка возврата отзывов стоит по умолчанию.
    final restore = find.byKey(const ValueKey<String>('user-restore-reviews'));
    expect(tester.widget<CheckboxListTile>(restore).value, isTrue);
    await tester.enterText(
        find.byKey(const ValueKey<String>('user-reason')), 'извинился');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('user-reason-confirm')));
    await settle(tester);
    await settle(tester);
    expect(fake.calls, contains('unblock u1 «извинился»'));
  });

  testWidgets('разблокировка без возврата отзывов — галочку можно снять',
      (tester) async {
    final fake = await pumpScreen(tester, [_user(isActive: false)]);
    await openRow(tester, 'Злой Комментатор');

    await tester.tap(find.byKey(const ValueKey<String>('user-unblock')));
    await settle(tester);
    await tester.tap(find.byKey(const ValueKey<String>('user-restore-reviews')));
    await tester.pump();
    await tester.enterText(
        find.byKey(const ValueKey<String>('user-reason')), 'простили');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('user-reason-confirm')));
    await settle(tester);
    await settle(tester);

    expect(fake.calls, contains('unblock u1 «простили; без отзывов»'));
    expect(find.text('Пользователь разблокирован, его отзывы остались скрытыми'),
        findsOneWidget);
  });

  testWidgets('у блокировки галочки возврата нет', (tester) async {
    await pumpScreen(tester, [_user()]);
    await openRow(tester, 'Злой Комментатор');
    await tester.tap(find.byKey(const ValueKey<String>('user-block')));
    await settle(tester);
    expect(find.byKey(const ValueKey<String>('user-restore-reviews')),
        findsNothing);
  });

  testWidgets('отказ сервера показан его словами, без кода', (tester) async {
    final fake = await pumpScreen(tester, [_user()]);
    const refusal = 'У этого партнёра есть карточки заведений. Его блокировка '
        'решает и их судьбу — это отдельное решение, этой кнопкой его не '
        'заблокировать';
    fake.failWith = DioException(
      requestOptions: RequestOptions(path: '/api/v1/admin/users/u1/block'),
      // Как приходит с сервера: текст — в теле ответа.
      response: Response<dynamic>(
        requestOptions: RequestOptions(path: '/api/v1/admin/users/u1/block'),
        statusCode: 409,
        data: <String, dynamic>{
          'success': false,
          'message': refusal,
          'error': <String, dynamic>{'code': 'PARTNER_HAS_ESTABLISHMENTS'},
        },
      ),
      type: DioExceptionType.badResponse,
    );

    await openRow(tester, 'Злой Комментатор');
    await tester.tap(find.byKey(const ValueKey<String>('user-block')));
    await settle(tester);
    await tester.enterText(
        find.byKey(const ValueKey<String>('user-reason')), 'мусор');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('user-reason-confirm')));
    await settle(tester);

    final error = find.byKey(const ValueKey<String>('user-action-error'));
    expect(tester.widget<Text>(error).data, refusal);
  });

  for (final (label, user, text) in <(String, AdminUser, String)>[
    (
      'учётка панели',
      _user(name: 'Модератор Второй', role: 'admin'),
      'Это учётная запись панели',
    ),
    (
      'служебная учётка',
      _user(name: 'Дом каталога', role: 'partner', isServiceAccount: true),
      'Это служебная учётная запись платформы',
    ),
    (
      'партнёр с карточкой',
      _user(name: 'Владелец Кафе', role: 'partner', establishmentCount: 2),
      'У этого партнёра есть карточки заведений в каталоге или на модерации',
    ),
  ]) {
    testWidgets('$label — кнопки блокировки нет, сказано почему',
        (tester) async {
      await pumpScreen(tester, [user]);
      await openRow(tester, user.name!);

      expect(find.byKey(const ValueKey<String>('user-block')), findsNothing);
      expect(find.byKey(const ValueKey<String>('user-unblock')), findsNothing);
      final protection = find.byKey(const ValueKey<String>('user-protection'));
      expect(tester.widget<Text>(protection).data, startsWith(text));

      // Имя партнёра — его, а не карточек: сбросить можно.
      expect(
        find.byKey(const ValueKey<String>('user-reset-name')),
        user.establishmentCount > 0 ? findsOneWidget : findsNothing,
      );
    });
  }

  testWidgets('партнёр с одним черновиком — кнопка блокировки есть',
      (tester) async {
    // Черновик заводит любой пользователь одним запросом: защищай он, всякий
    // сделал бы себя неблокируемым.
    await pumpScreen(tester, [
      _user(
        name: 'Автор Черновика',
        role: 'partner',
        establishmentCount: 1,
        liveEstablishmentCount: 0,
      ),
    ]);
    await openRow(tester, 'Автор Черновика');
    expect(find.byKey(const ValueKey<String>('user-block')), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('user-protection')), findsNothing);
    expect(find.text('1, в каталоге или на модерации 0'), findsOneWidget);
  });

  testWidgets('просмотрщик: без поиска, без кнопок, без имён', (tester) async {
    final redacted = _user(
      name: null,
      email: null,
      hiddenReviewCount: null,
      viewerRedacted: true,
    );
    await pumpScreen(tester, [redacted], viewer: true);

    expect(find.byKey(const ValueKey<String>('users-search')), findsNothing);
    expect(find.text(kRedactedForViewerLabel), findsOneWidget);

    await tester.tap(find.text(kRedactedForViewerLabel).first);
    await settle(tester);
    expect(find.text('3 отзыва видно'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('user-block')), findsNothing);
    expect(find.byKey(const ValueKey<String>('user-reset-name')), findsNothing);
  });

  testWidgets('ссылка из отзыва открывает карточку автора сразу',
      (tester) async {
    // Автор не на первой странице списка — карточка читается по id.
    final author = _user(id: _authorUuid, name: 'Автор Отзыва');
    final fake = await pumpScreen(
      tester,
      [_user()],
      initialUserId: _authorUuid,
      cards: {_authorUuid: author},
    );
    await settle(tester);

    expect(fake.calls, contains('get $_authorUuid'));
    expect(find.text('Автор Отзыва'), findsOneWidget);
  });

  // Ссылку `?user=…` мог прислать кто угодно; номер из неё склеивается с
  // путём запроса (сверка меток панели 29.10, S4). Не номер человека — запроса
  // нет, справа «Пользователь не найден», список работает как обычно.
  for (final bad in <String>[
    '../reviews',
    '$_authorUuid/../../reviews',
    'author-9',
    ' $_authorUuid',
  ]) {
    testWidgets('ссылка с «$bad» — без запроса карточки, «не найден»',
        (tester) async {
      final fake = await pumpScreen(tester, [_user()], initialUserId: bad);
      await settle(tester);

      expect(fake.calls.where((c) => c.startsWith('get ')), isEmpty,
          reason: 'запрос карточки по номеру из ссылки');
      expect(find.byKey(const ValueKey<String>('user-link-rejected')),
          findsOneWidget);
      expect(find.text('Пользователь не найден'), findsOneWidget);

      // Человека из списка модератор открывает как обычно.
      await openRow(tester, 'Злой Комментатор');
      expect(fake.calls, contains('get u1'));
      expect(find.byKey(const ValueKey<String>('user-link-rejected')),
          findsNothing);
      expect(find.text('Активен'), findsOneWidget);
    });
  }

  testWidgets('после неправильной ссылки правильная открывает карточку',
      (tester) async {
    // Модератор открыл битую ссылку, затем верную — на том же экране. Номер
    // меняется в адресе, маршрут тот же: экран получает новый номер, а
    // «не найден» от прошлой ссылки не должен остаться поверх карточки.
    final author = _user(id: _authorUuid, name: 'Автор Отзыва');
    final fake = _FakeUserService([_user()], cards: {_authorUuid: author});
    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final router = GoRouter(
      initialLocation: userCardLocation('../reviews'),
      routes: <RouteBase>[
        GoRoute(
          path: kUsersPath,
          builder: (_, state) => Scaffold(
            body: UsersScreen(initialUserId: state.uri.queryParameters['user']),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AdminUsersProvider>(
            create: (_) => AdminUsersProvider(service: fake)),
        ChangeNotifierProvider<AuthProvider>(
            create: (_) => StubAuthProvider.admin()),
      ],
      child: MaterialApp.router(
          theme: AppTheme.lightTheme, routerConfig: router),
    ));
    await settle(tester);
    expect(find.byKey(const ValueKey<String>('user-link-rejected')),
        findsOneWidget);

    router.go(userCardLocation(_authorUuid));
    await settle(tester);
    await settle(tester);

    expect(fake.calls, contains('get $_authorUuid'));
    expect(find.byKey(const ValueKey<String>('user-link-rejected')),
        findsNothing);
    expect(find.text('Автор Отзыва'), findsWidgets);

    // Снова битая, затем тот же экран без ссылки (боковое меню): «не найден»
    // от прошлой ссылки не остаётся — провайдер живёт дольше экрана.
    router.go(userCardLocation('author-9'));
    await settle(tester);
    expect(find.byKey(const ValueKey<String>('user-link-rejected')),
        findsOneWidget);
    router.go(kUsersPath);
    await settle(tester);
    expect(find.byKey(const ValueKey<String>('user-link-rejected')),
        findsNothing);
    expect(find.text('Выберите человека слева'), findsOneWidget);
  });

  test('поиск и фильтры убирают «не найден» битой ссылки', () async {
    final fake = _FakeUserService([_user()]);
    final provider = AdminUsersProvider(service: fake);
    addTearDown(provider.dispose);

    for (final close in <void Function()>[
      () => provider.setStatusFilter('blocked'),
      () => provider.setRoleFilter('partner'),
      provider.resetFilters,
      provider.clearSearch,
    ]) {
      await provider.openUserFromLink('../reviews');
      expect(provider.linkRejected, isTrue);
      close();
      expect(provider.linkRejected, isFalse);
    }
    expect(fake.calls.where((c) => c.startsWith('get ')), isEmpty);
  });

  test('userCardLocation ведёт на экран с id в запросе', () {
    expect(userCardLocation('abc'), '/settings/users?user=abc');
  });

  testWidgets('маршрут панели отдаёт экрану id из запроса ссылки',
      (tester) async {
    // Слой маршрута. Тест «ссылка из отзыва…» строит экран с initialUserId
    // сам, а адрес «?user=<id>» разбирает маршрут панели — здесь исполняется
    // его настоящий построитель.
    final auth = StubAuthProvider.admin();
    addTearDown(auth.dispose);
    final router = createRouter(auth);
    addTearDown(router.dispose);
    GoRoute? usersRoute(List<RouteBase> routes) {
      for (final route in routes) {
        if (route is GoRoute && route.path == '/settings/users') return route;
        final inner = usersRoute(route.routes);
        if (inner != null) return inner;
      }
      return null;
    }

    final route = usersRoute(router.configuration.routes);
    expect(route, isNotNull, reason: 'маршрута /settings/users нет');
    await tester.pumpWidget(const SizedBox());
    final state = GoRouterState(
      router.configuration,
      uri: Uri.parse('/settings/users?user=author-9'),
      matchedLocation: '/settings/users',
      fullPath: '/settings/users',
      pathParameters: const <String, String>{},
      pageKey: const ValueKey<String>('users'),
    );

    final screen = route!.builder!(tester.element(find.byType(SizedBox)), state);

    expect(
        screen,
        isA<UsersScreen>()
            .having((s) => s.initialUserId, 'initialUserId', 'author-9'));
  });

  testWidgets('действие прошло, перечитка — нет: тосты о списке и карточке',
      (tester) async {
    // Сеть мигнула после блокировки: подпись «заблокирован» есть, а в
    // «Состоянии» — «Активен» с кнопкой «Заблокировать». До 20.10 об этом не
    // говорило ничто (пункт A2-07).
    final fake = await pumpScreen(tester, [_user()]);
    await openRow(tester, 'Злой Комментатор');
    fake.readFailure = DioException(
      requestOptions: RequestOptions(path: '/api/v1/admin/users'),
      type: DioExceptionType.connectionError,
    );

    await tester.tap(find.byKey(const ValueKey<String>('user-block')));
    await settle(tester);
    await tester.enterText(
        find.byKey(const ValueKey<String>('user-reason')), 'мусор');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('user-reason-confirm')));
    await settle(tester);
    await tester.pump();

    expect(find.text('Список не обновился'), findsOneWidget);
    expect(find.text('Карточка не обновилась'), findsOneWidget,
        reason: 'тостов два — по одному на каждую неудачу');
    expect(find.byType(AdminErrorToast), findsNWidgets(2));
  });

  testWidgets('карточка не загрузилась — «Повторить» под причиной',
      (tester) async {
    final fake = await pumpScreen(tester, [_user()], cards: <String, AdminUser>{});
    fake.readFailure = DioException(
      requestOptions: RequestOptions(path: '/api/v1/admin/users/u9'),
      response: Response<dynamic>(
        requestOptions: RequestOptions(path: '/api/v1/admin/users/u9'),
        statusCode: 404,
      ),
      type: DioExceptionType.badResponse,
    );
    final provider = tester
        .element(find.byType(UsersScreen))
        .read<AdminUsersProvider>();
    unawaited(provider.openUser('u9'));
    await settle(tester);

    expect(find.text('Карточка не загрузилась'), findsOneWidget);
    expect(find.text(kUserNotFoundPhrase), findsOneWidget);
    final calls = fake.calls.where((c) => c == 'get u9').length;

    await tester.tap(find.widgetWithText(OutlinedButton, 'Повторить'));
    await settle(tester);
    expect(fake.calls.where((c) => c == 'get u9').length, calls + 1);
  });

  group('describeUserActionError', () {
    DioException dio({int? status, Object? body, DioExceptionType? type}) =>
        DioException(
          requestOptions: RequestOptions(path: '/x'),
          response: status == null
              ? null
              : Response<dynamic>(
                  requestOptions: RequestOptions(path: '/x'),
                  statusCode: status,
                  data: body,
                ),
          type: type ?? DioExceptionType.badResponse,
        );

    test('английский текст сервера не доходит до модератора', () {
      expect(
          describeUserActionError(
              dio(status: 403, body: <String, dynamic>{'message': 'Forbidden'})),
          'Недостаточно прав для этого действия.');
      expect(
          describeUserActionError(
              dio(status: 500, body: <String, dynamic>{'message': 'Boom'})),
          kServerFailurePhrase);
    });

    test('русский текст сервера — как есть', () {
      expect(
          describeUserActionError(dio(
              status: 422,
              body: <String, dynamic>{'message': 'Укажите причину'})),
          'Укажите причину');
    });

    test('404 — о пользователе', () {
      expect(describeUserActionError(dio(status: 404)), kUserNotFoundPhrase);
    });

    test('сеть', () {
      expect(
        describeUserActionError(dio(type: DioExceptionType.connectionError)),
        kNoConnectionPhrase,
      );
    });
  });
}
