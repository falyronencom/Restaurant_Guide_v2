import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/providers/admin_users_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/users/users_screen.dart';
import 'package:restaurant_guide_admin_web/services/admin_user_service.dart';

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

  _FakeUserService(this.users, {Map<String, AdminUser>? cards})
      : cards = cards ?? {for (final u in users) u.id: u};

  @override
  Future<AdminUserListResponse> getUsers({
    int page = 1,
    int perPage = 20,
    String? search,
    String? status,
  }) async {
    calls.add('list search=${search ?? ''} status=${status ?? ''}');
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
    return cards[id]!;
  }

  Future<void> _act(String what, String id, String reason) async {
    calls.add('$what $id «$reason»');
    final error = failWith;
    if (error != null) throw error;
  }

  @override
  Future<void> block(String id, {required String reason}) =>
      _act('block', id, reason);

  @override
  Future<void> unblock(String id, {required String reason}) =>
      _act('unblock', id, reason);

  @override
  Future<void> resetName(String id, {required String reason}) =>
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
      isServiceAccount: isServiceAccount,
      viewerRedacted: viewerRedacted,
      lastBlockAction: lastBlockAction,
      createdAt: DateTime.utc(2026, 10, 1, 9),
    );

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

    expect(find.text('Злой Комментатор'), findsOneWidget);
    expect(find.textContaining('angry@example.com'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('users-search')), findsOneWidget);

    await openRow(tester, 'Злой Комментатор');
    expect(find.text('Активен'), findsOneWidget);
    expect(find.text('3 отзыва'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey<String>('user-block')));
    await settle(tester);
    expect(find.text('Заблокировать пользователя?'), findsOneWidget);
    expect(find.text(kBlockConsequences), findsOneWidget);

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
    expect(find.text('Пользователь заблокирован, его отзывы скрыты'),
        findsOneWidget);
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
    await tester.enterText(
        find.byKey(const ValueKey<String>('user-reason')), 'извинился');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('user-reason-confirm')));
    await settle(tester);
    await settle(tester);
    expect(fake.calls, contains('unblock u1 «извинился»'));
  });

  testWidgets('отказ сервера показан его словами, без кода', (tester) async {
    final fake = await pumpScreen(tester, [_user()]);
    const refusal = 'У этого партнёра есть карточки заведений. Его блокировка '
        'решает и их судьбу — это отдельное решение, этой кнопкой его не '
        'заблокировать';
    fake.failWith = DioException(
      requestOptions: RequestOptions(path: '/api/v1/admin/users/u1/block'),
      response: Response<dynamic>(
        requestOptions: RequestOptions(path: '/api/v1/admin/users/u1/block'),
        statusCode: 409,
      ),
      type: DioExceptionType.badResponse,
      error: refusal,
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
      'Это учётка панели',
    ),
    (
      'служебная учётка',
      _user(name: 'Дом каталога', role: 'partner', isServiceAccount: true),
      'Это служебная учётка платформы',
    ),
    (
      'партнёр с карточкой',
      _user(name: 'Владелец Кафе', role: 'partner', establishmentCount: 2),
      'У этого партнёра есть карточки заведений',
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
    final author = _user(id: 'author-9', name: 'Автор Отзыва');
    final fake = await pumpScreen(
      tester,
      [_user()],
      initialUserId: 'author-9',
      cards: {'author-9': author},
    );
    await settle(tester);

    expect(fake.calls, contains('get author-9'));
    expect(find.text('Автор Отзыва'), findsOneWidget);
  });

  test('userCardLocation ведёт на экран с id в запросе', () {
    expect(userCardLocation('abc'), '/settings/users?user=abc');
  });

  group('describeUserActionError', () {
    DioException dio({int? status, Object? error, DioExceptionType? type}) =>
        DioException(
          requestOptions: RequestOptions(path: '/x'),
          response: status == null
              ? null
              : Response<dynamic>(
                  requestOptions: RequestOptions(path: '/x'),
                  statusCode: status,
                ),
          type: type ?? DioExceptionType.badResponse,
          error: error,
        );

    test('английский текст сервера не доходит до модератора', () {
      expect(describeUserActionError(dio(status: 403, error: 'Forbidden')),
          'Доступ запрещён');
      expect(describeUserActionError(dio(status: 500, error: 'Boom')),
          'Произошла ошибка');
    });

    test('русский текст сервера — как есть', () {
      expect(describeUserActionError(dio(status: 422, error: 'Укажите причину')),
          'Укажите причину');
    });

    test('сеть', () {
      expect(
        describeUserActionError(
            dio(type: DioExceptionType.connectionError, error: 'No internet')),
        'Ошибка соединения с сервером',
      );
    });
  });
}
