import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/admin_users_provider.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';
import 'package:restaurant_guide_admin_web/services/admin_user_service.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

// Что именно стирает сброс при смене аккаунта.
//
// Сторож реестра (`test/config/account_scope_guard_test.dart`) доказывает, что
// каждый провайдер зарегистрирован. Здесь — что сброс делает то, ради чего
// заведён: вердикты, выбор, фильтры и раскрытая строка исчезают, а ответ,
// летевший для прежнего аккаунта, в состояние нового не ложится.

class _FakeModerationService implements ModerationService {
  /// Кому сервер отдаёт деталь: администратору — с контактом партнёра,
  /// просмотрщику — без него (`partner_data_redacted`).
  bool forAdmin = true;

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async =>
      EstablishmentDetail(
        id: id,
        partnerId: 'p-1',
        name: 'Кафе $id',
        status: 'pending',
        contactPerson: forAdmin ? 'Иван Контактов' : null,
        partnerDataRedacted: !forAdmin,
      );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeReviewService implements AdminReviewService {
  Completer<AdminReviewListResponse> response =
      Completer<AdminReviewListResponse>();

  @override
  Future<AdminReviewListResponse> getReviews({
    int page = 1,
    int perPage = 20,
    String? status,
    int? rating,
    int? ratingMin,
    int? ratingMax,
    String? authorId,
    String? search,
    String? sort,
    DateTime? from,
    DateTime? to,
  }) =>
      response.future;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeMenuItemService implements AdminMenuItemService {
  @override
  Future<FlaggedMenuItemsResponse> getFlaggedItems({
    int page = 1,
    int perPage = 20,
    String? reason,
    String? visibility,
    String? city,
    String? search,
  }) async =>
      FlaggedMenuItemsResponse(
        items: const <FlaggedMenuItem>[],
        total: 0,
        page: 1,
        pages: 1,
        perPage: 20,
        visibleCount: 0,
        hiddenCount: 0,
        cities: const <String>[],
        reasons: const <String>['price_below_threshold'],
      );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeAuditLogService implements AuditLogService {
  /// Ответ не приходит: проверяется состояние фильтров, а не выборка.
  final Completer<AuditLogListResponse> _never =
      Completer<AuditLogListResponse>();

  @override
  Future<AuditLogListResponse> getAuditLog({
    int page = 1,
    int perPage = 20,
    String? action,
    String? entityType,
    DateTime? from,
    DateTime? to,
  }) =>
      _never.future;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _person = AdminUser(
  id: 'u-1',
  name: 'Марына К.',
  email: 'maryna@example.by',
  phone: '+375291112233',
  role: 'user',
);

class _FakeUserService implements AdminUserService {
  @override
  Future<AdminUserListResponse> getUsers({
    int page = 1,
    int perPage = 20,
    String? search,
    String? status,
    String? role,
  }) async =>
      const AdminUserListResponse(
          users: <AdminUser>[_person], total: 1, page: 1, pages: 1);

  @override
  Future<AdminUser> getUser(String id) async => _person;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AdminReviewItem _review(String id) => AdminReviewItem(
      id: id,
      rating: 4,
      content: 'Смачна',
      authorName: 'Марына К.',
      establishmentName: 'Кухмістр',
      isVisible: true,
      isDeleted: false,
      createdAt: DateTime(2026, 8, 12),
    );

void main() {
  setUp(AccountScope.debugReset);
  tearDown(AccountScope.debugReset);

  test('модерация: вердикты по полям и выбор принадлежат вошедшему', () {
    final provider = ModerationProvider(service: _FakeModerationService());
    addTearDown(provider.dispose);

    provider.approveField('unp');
    provider.rejectField('name', comment: 'опечатка');
    expect(provider.checkedFieldCount, 2);
    expect(provider.canApprove, isFalse);

    AccountScope.resetAll();

    expect(provider.checkedFieldCount, 0);
    expect(provider.canApprove, isTrue);
    expect(provider.selectedId, isNull);
    expect(provider.selectedDetail, isNull);
  });

  test('модерация: отложенные отметки по другим заявкам тоже стираются',
      () async {
    // Отметки не открытой заявки откладываются до её следующего открытия
    // (A1-13). Прежнего модератора они касаются так же, как отметки
    // открытой: у следующего вошедшего всплыли бы ✓/✗ и причины, которых он
    // не ставил, и ушли бы с его решением.
    final provider = ModerationProvider(service: _FakeModerationService());
    addTearDown(provider.dispose);

    await provider.selectEstablishment('est-1');
    provider.rejectField('name', comment: 'опечатка');
    await provider.selectEstablishment('est-2');
    expect(provider.checkedFieldCount, 0, reason: 'предпосылка');
    expect(provider.hasUnsavedVerdicts, isTrue,
        reason: 'предпосылка: отметка по est-1 отложена');

    AccountScope.resetAll();

    expect(provider.hasUnsavedVerdicts, isFalse);
    await provider.selectEstablishment('est-1');
    expect(provider.fieldReviews, isEmpty);
    expect(provider.checkedFieldCount, 0);
  });

  test('модерация: деталь прежней роли не отдаётся при повторном открытии',
      () async {
    // Геттер сам прячет деталь, пока выбора нет, — но повторное открытие
    // ТОЙ ЖЕ карточки сразу после смены аккаунта снова её выбирает, и до
    // ответа сервера наружу ушла бы деталь, полученная администратором.
    final service = _FakeModerationService();
    final provider = ModerationProvider(service: service);
    addTearDown(provider.dispose);
    await provider.selectEstablishment('est-1');
    expect(provider.selectedDetail?.contactPerson, 'Иван Контактов',
        reason: 'предпосылка: деталь администратора загружена');

    AccountScope.resetAll();
    service.forAdmin = false;

    final reopened = provider.selectEstablishment('est-1');
    expect(provider.isLoadingDetail, isTrue, reason: 'предпосылка');
    expect(provider.selectedDetail, isNull,
        reason: 'пока ответ для вошедшего не пришёл, детали нет');
    await reopened;
    expect(provider.selectedDetail?.partnerDataRedacted, isTrue);
    expect(provider.selectedDetail?.contactPerson, isNull);
  });

  test('отзывы: фильтры снимаются, а обогнанный ответ выбрасывается',
      () async {
    final service = _FakeReviewService();
    final provider = AdminReviewsProvider(service: service);
    addTearDown(provider.dispose);

    // Каждое поле выборки — не только статус: в поиске нередко почта или
    // имя человека, и они принадлежат прежнему оператору.
    provider.setStatusFilter('hidden');
    provider.setRatingRange(1, 2);
    provider.setAuthor('u-9', name: 'Марына К.');
    provider.setSort('oldest');
    provider.setDateRange(DateTime(2026, 8, 1), DateTime(2026, 8, 20));
    provider.search('maryna@example.by');
    expect(provider.hasActiveFilters, isTrue);
    expect(provider.isLoadingList, isTrue);

    AccountScope.resetAll();

    expect(provider.hasActiveFilters, isFalse);
    expect(provider.statusFilter, isNull);
    expect(provider.ratingMin, isNull);
    expect(provider.ratingMax, isNull);
    expect(provider.authorId, isNull);
    expect(provider.authorName, isNull);
    expect(provider.sort, 'newest');
    expect(provider.searchQuery, '');
    expect(provider.dateFrom, isNull);
    expect(provider.dateTo, isNull);
    expect(provider.isLoadingList, isFalse);

    // Ответ на запрос прежнего аккаунта доезжает после сброса — и не
    // должен стать списком нового.
    service.response.complete(AdminReviewListResponse(
      reviews: <AdminReviewItem>[_review('r1')],
      total: 1,
      hidden: 0,
      averageRating: 4,
      page: 1,
      pages: 1,
    ));
    await pumpEventQueue();

    expect(provider.reviews, isEmpty);
    expect(provider.totalCount, 0);
  });

  test('позиции меню: выбор снимается, первая загрузка начинается заново', () {
    final provider = MenuItemsModerationProvider(service: _FakeMenuItemService());
    addTearDown(provider.dispose);

    provider.selectItem('1');
    expect(provider.selectedId, '1');

    AccountScope.resetAll();

    expect(provider.selectedId, isNull);
    expect(provider.isFirstLoad, isTrue);
    expect(provider.hasLoaded, isFalse);
  });

  test('позиции меню: загруженная очередь снова ждёт первой загрузки',
      () async {
    // Тест выше сбрасывает провайдер, который не загружался, — там «первая
    // загрузка» верна и без сброса. Здесь очередь уже загружена: без сброса
    // флага вошедший увидел бы «Очередь разобрана» вместо скелетона.
    final provider = MenuItemsModerationProvider(service: _FakeMenuItemService());
    addTearDown(provider.dispose);
    await provider.loadFlaggedItems();
    expect(provider.hasLoaded, isTrue, reason: 'предпосылка');

    AccountScope.resetAll();

    expect(provider.hasLoaded, isFalse);
    expect(provider.isFirstLoad, isTrue);
  });

  test('журнал: раскрытая строка закрывается, период возвращается к 30 дням',
      () {
    final provider = AuditLogProvider(service: _FakeAuditLogService());
    addTearDown(provider.dispose);

    provider.toggleExpanded('e1');
    expect(provider.expandedEntryId, 'e1');

    AccountScope.resetAll();

    expect(provider.expandedEntryId, isNull);
    expect(provider.period, AuditLogProvider.defaultPeriod);
    expect(provider.hasActiveFilters, isFalse);
  });

  test('журнал: тип действия, объект и свой период прежнего аккаунта снимаются',
      () {
    final provider = AuditLogProvider(service: _FakeAuditLogService());
    addTearDown(provider.dispose);

    provider.setActionFilter('suspend');
    provider.setEntityTypeFilter('review');
    provider.setPeriod('custom',
        from: DateTime(2026, 8, 1), to: DateTime(2026, 8, 25));
    expect(provider.hasActiveFilters, isTrue, reason: 'предпосылка');

    AccountScope.resetAll();

    expect(provider.actionFilter, isNull);
    expect(provider.entityTypeFilter, isNull);
    expect(provider.period, '30d');
    expect(provider.customFrom, isNull);
    expect(provider.customTo, isNull);
    expect(provider.hasActiveFilters, isFalse);
  });

  test('люди: список и открытая карточка прежнего аккаунта стираются',
      () async {
    // Самое чувствительное в панели — почты и телефоны людей. Сторож реестра
    // видит, что сброс зарегистрирован, но не то, что он их стирает.
    final provider = AdminUsersProvider(service: _FakeUserService());
    addTearDown(provider.dispose);
    await provider.loadUsers();
    await provider.openUser('u-1');
    expect(provider.users, isNotEmpty, reason: 'предпосылка');
    expect(provider.selectedUser, isNotNull, reason: 'предпосылка');

    AccountScope.resetAll();

    expect(provider.users, isEmpty);
    expect(provider.selectedUser, isNull);
  });
}
