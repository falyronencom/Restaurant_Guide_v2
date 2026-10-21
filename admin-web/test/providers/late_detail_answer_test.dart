import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/admin_badges.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/analytics_totals_provider.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';
import 'package:restaurant_guide_admin_web/services/badges_service.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

// Панель действует над тем, что показывает; поздние ответы не переживают
// смену аккаунта (пакет 2, пункт 4; Codex, заход 2А — CL-4).
//
// Сервер решает, что скрыть, по роли того, кто спросил: ответ на запрос
// администратора несёт контакты и документ партнёра. Провайдеры панели
// записывали пришедшую деталь, не сверяя, что выбор — всё ещё та карточка и
// что аккаунт не сменился. Отсюда три дефекта, которые здесь и проверяются:
//   - поздняя деталь карточки A ложилась в панель, где выбрана B;
//   - действие уходило к выбранной B, а диалог называл показанную A;
//   - после выхода и входа просмотрщиком поздний ответ администратору
//     показывался просмотрщику.
//
// Сервер-подставка отвечает только тогда, когда тест открывает ворота:
// порядок ответов задаёт тест, а не планировщик.

class _GatedServer implements ModerationService {
  final Map<String, List<Completer<EstablishmentDetail>>> details =
      <String, List<Completer<EstablishmentDetail>>>{};
  final List<String> calls = <String>[];
  Completer<void>? suspendGate;
  Completer<void>? claimGate;
  Completer<void>? moderateGate;
  Completer<void>? unsuspendGate;

  /// Ответить на [index]-й запрос детали карточки [id].
  void answer(String id, EstablishmentDetail detail, {int index = 0}) =>
      details[id]![index].complete(detail);

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) {
    calls.add('detail:$id');
    final gate = Completer<EstablishmentDetail>();
    details.putIfAbsent(id, () => <Completer<EstablishmentDetail>>[]).add(gate);
    return gate.future;
  }

  @override
  Future<void> suspendEstablishment({
    required String id,
    required String reason,
  }) async {
    calls.add('suspend:$id');
    if (suspendGate != null) await suspendGate!.future;
  }

  @override
  Future<void> unsuspendEstablishment({required String id}) async {
    calls.add('unsuspend:$id');
    if (unsuspendGate != null) await unsuspendGate!.future;
  }

  @override
  Future<void> claimEstablishment({
    required String id,
    required String userId,
  }) async {
    calls.add('claim:$id');
    if (claimGate != null) await claimGate!.future;
  }

  @override
  Future<void> moderateEstablishment({
    required String id,
    required String action,
    Map<String, String>? moderationNotes,
  }) async {
    calls.add('$action:$id');
    if (moderateGate != null) await moderateGate!.future;
  }

  @override
  Future<void> updateCoordinates({
    required String id,
    required double latitude,
    required double longitude,
  }) async {
    calls.add('coordinates:$id');
  }

  @override
  Future<ActiveListResponse> getActiveEstablishments({
    int page = 1,
    int perPage = 20,
    String? sort,
    String? city,
    String? search,
  }) async =>
      const ActiveListResponse(establishments: [], total: 0, page: 1, pages: 1);

  @override
  Future<SuspendedListResponse> getSuspendedEstablishments({
    int page = 1,
    int perPage = 20,
  }) async =>
      const SuspendedListResponse(
          establishments: [], total: 0, page: 1, pages: 1);

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'подставка не обслуживает ${invocation.memberName}',
      );
}

/// Деталь, какой её отдаёт сервер: администратору — с контактом партнёра,
/// просмотрщику — без него и с пометкой «скрыто».
EstablishmentDetail _detail(
  String id, {
  bool forAdmin = true,
  String partnerId = 'p-1',
}) =>
    EstablishmentDetail(
      id: id,
      partnerId: partnerId,
      name: 'Кафе $id',
      status: 'active',
      contactPerson: forAdmin ? 'Иван Контактов' : null,
      contactEmail: forAdmin ? 'ivan@partner.by' : null,
      partnerDataRedacted: !forAdmin,
    );

/// Один провайдер панели с деталью — в общем виде, чтобы одни и те же
/// проверки прошли по всем четырём.
class _Subject {
  final String name;
  final dynamic Function(_GatedServer) build;
  final void Function(dynamic provider, String id) select;

  const _Subject(this.name, this.build, this.select);
}

final List<_Subject> _subjects = <_Subject>[
  _Subject(
    'Одобренные',
    (s) => ApprovedProvider(service: s),
    (p, id) => (p as ApprovedProvider).selectEstablishment(id),
  ),
  _Subject(
    'Отклонённые',
    (s) => RejectedProvider(service: s),
    (p, id) => (p as RejectedProvider).selectEstablishment(
      RejectedEstablishmentItem(auditId: 'au-$id', establishmentId: id, name: 'Кафе $id'),
    ),
  ),
  _Subject(
    'Приостановленные',
    (s) => SuspendedProvider(service: s),
    (p, id) => (p as SuspendedProvider).selectEstablishment(id),
  ),
  _Subject(
    'На модерации',
    (s) => ModerationProvider(service: s),
    (p, id) => (p as ModerationProvider).selectEstablishment(id),
  ),
];

void main() {
  for (final subject in _subjects) {
    group(subject.name, () {
      late _GatedServer server;
      late dynamic provider;

      setUp(() {
        server = _GatedServer();
        provider = subject.build(server);
      });
      tearDown(() => provider.dispose());

      test('поздняя деталь другой карточки не подменяет открытую', () async {
        subject.select(provider, 'a');
        subject.select(provider, 'b');
        server.answer('b', _detail('b'));
        await pumpEventQueue();
        server.answer('a', _detail('a')); // опоздавший ответ о прежнем выборе
        await pumpEventQueue();

        expect(provider.selectedId, 'b');
        expect((provider.selectedDetail as EstablishmentDetail?)?.id, 'b');
      });

      test('пока грузится новая карточка, деталь прежней наружу не отдаётся',
          () async {
        subject.select(provider, 'a');
        server.answer('a', _detail('a'));
        await pumpEventQueue();
        subject.select(provider, 'b'); // ответ о «b» ещё в пути

        expect(provider.selectedId, 'b');
        expect(provider.selectedDetail, isNull);
      });

      test('после смены аккаунта поздний ответ прежней роли не показывается',
          () async {
        subject.select(provider, 'a'); // администратор открыл карточку
        provider.resetAccountScope(); // выход; вошёл просмотрщик
        subject.select(provider, 'a'); // и открыл ту же карточку

        server.answer('a', _detail('a', forAdmin: true), index: 0);
        await pumpEventQueue();
        // Ответ на запрос администратора — с контактами — не показан.
        expect(
          (provider.selectedDetail as EstablishmentDetail?)?.contactEmail,
          isNull,
        );

        server.answer('a', _detail('a', forAdmin: false), index: 1);
        await pumpEventQueue();
        final shown = provider.selectedDetail as EstablishmentDetail?;
        expect(shown?.id, 'a');
        expect(shown?.partnerDataRedacted, isTrue);
        expect(shown?.contactEmail, isNull);
      });

      test('ответ, пришедший после выхода, не кладёт деталь в пустую панель',
          () async {
        subject.select(provider, 'a');
        provider.resetAccountScope();

        server.answer('a', _detail('a'));
        await pumpEventQueue();

        expect(provider.selectedId, isNull);
        expect(provider.selectedDetail, isNull);

        // Просмотрщик открывает ту же карточку; его ответ ещё в пути. Ответ
        // администратору не должен был осесть даже в памяти провайдера —
        // иначе он всплывёт здесь под совпавшим id.
        subject.select(provider, 'a');
        expect(provider.selectedDetail, isNull);
      });
    });
  }

  group('Действие — над показанной карточкой', () {
    late _GatedServer server;
    setUp(() => server = _GatedServer());

    Future<void> lateAfterSwitch(dynamic provider, void Function(String) select) async {
      select('a');
      select('b');
      server.answer('b', _detail('b'));
      await pumpEventQueue();
      server.answer('a', _detail('a'));
      await pumpEventQueue();
    }

    test('Одобренные: «Приостановить» уходит к той карточке, что показана',
        () async {
      final provider = ApprovedProvider(service: server);
      addTearDown(provider.dispose);
      await lateAfterSwitch(provider, provider.selectEstablishment);
      final shown = provider.selectedDetail!.id;

      await provider.suspendEstablishment('Жалобы посетителей');

      expect(server.calls.where((c) => c.startsWith('suspend:')),
          <String>['suspend:$shown']);
    });

    test('Приостановленные: «Возобновить» уходит к той карточке, что показана',
        () async {
      final provider = SuspendedProvider(service: server);
      addTearDown(provider.dispose);
      await lateAfterSwitch(provider, provider.selectEstablishment);
      final shown = provider.selectedDetail!.id;

      final done = provider.unsuspendEstablishment();
      await pumpEventQueue();
      // Перечитывание после действия — ответ на него.
      server.answer(shown, _detail(shown), index: 1);
      await done;

      expect(server.calls.where((c) => c.startsWith('unsuspend:')),
          <String>['unsuspend:$shown']);
    });

    test('На модерации: «Одобрить» уходит к той карточке, что показана',
        () async {
      final provider = ModerationProvider(service: server);
      addTearDown(provider.dispose);
      await lateAfterSwitch(provider, provider.selectEstablishment);
      final shown = provider.selectedDetail!.id;

      await provider.approveEstablishment();

      expect(server.calls.where((c) => c.startsWith('approve:')),
          <String>['approve:$shown']);
    });

    test('пока новая карточка не показана, действие не уходит никуда',
        () async {
      // Выбрана «b», на экране ещё ничего (деталь в пути) — диалогу нечего
      // назвать, и действие не должно уйти ни к «a», ни к «b».
      final approved = ApprovedProvider(service: server);
      addTearDown(approved.dispose);
      approved.selectEstablishment('a');
      server.answer('a', _detail('a'));
      await pumpEventQueue();
      approved.selectEstablishment('b');

      expect(await approved.suspendEstablishment('Жалобы посетителей'), isFalse);
      expect(await approved.unsuspendEstablishment(), isFalse);
      expect(await approved.claimEstablishment('u-1'), isFalse);

      final suspended = SuspendedProvider(service: server);
      addTearDown(suspended.dispose);
      suspended.selectEstablishment('c');
      server.answer('c', _detail('c'));
      await pumpEventQueue();
      suspended.selectEstablishment('d');
      expect(await suspended.unsuspendEstablishment(), isFalse);
      expect(await suspended.suspendEstablishment('Жалобы'), isFalse);

      final pending = ModerationProvider(service: server);
      addTearDown(pending.dispose);
      pending.selectEstablishment('e');
      server.answer('e', _detail('e'));
      await pumpEventQueue();
      pending.selectEstablishment('f');
      expect(await pending.approveEstablishment(), isFalse);
      expect(await pending.rejectEstablishment(), isFalse);
      // «Действие» — каждое, что берёт показанную карточку: правка
      // координат тоже. Без await до проверки: ушедшая правка ждала бы
      // перечитывания карточки, на которое этот стенд не отвечает.
      final coordinates = pending.updateCoordinates(53.9, 27.56);
      await pumpEventQueue();
      expect(server.calls.where((c) => c.startsWith('coordinates:')), isEmpty,
          reason: 'правка координат ушла к карточке, которой нет на экране');
      expect(await coordinates, isFalse);

      expect(
        server.calls.where((c) => !c.startsWith('detail:')),
        isEmpty,
        reason: 'ни одно действие не должно было уйти на сервер',
      );
    });

    test('Одобренные: после передачи перечитывается деталь переданной карточки',
        () async {
      final provider = ApprovedProvider(service: server);
      addTearDown(provider.dispose);
      provider.selectEstablishment('a');
      server.answer('a', _detail('a', partnerId: 'p-old'));
      await pumpEventQueue();

      final done = provider.claimEstablishment('u-new');
      await pumpEventQueue();
      expect(server.calls, contains('claim:a'));
      expect(server.calls.where((c) => c == 'detail:a').length, 2,
          reason: 'деталь обязана перечитаться — иначе панель показывает '
              'прежнего владельца');
      server.answer('a', _detail('a', partnerId: 'p-new'), index: 1);
      await done;

      expect(provider.selectedDetail!.partnerId, 'p-new');
    });

    test('ответ на действие, пришедший после смены аккаунта, не пишет ошибку '
        'в состояние нового', () async {
      final provider = ApprovedProvider(service: server);
      addTearDown(provider.dispose);
      provider.selectEstablishment('a');
      server.answer('a', _detail('a'));
      await pumpEventQueue();

      server.suspendGate = Completer<void>();
      final done = provider.suspendEstablishment('Жалобы посетителей');
      await pumpEventQueue();
      provider.resetAccountScope();
      // Вошедший открыл ту же карточку — ошибка чужого действия не о нём.
      // Без этого после сброса выбранной карточки нет, и ошибку отсёк бы уже
      // «выбрана другая», а не смена аккаунта (так же, как у очереди и
      // приостановленных ниже).
      provider.selectEstablishment('a');
      server.answer('a', _detail('a', forAdmin: false), index: 1);
      await pumpEventQueue();
      server.suspendGate!.completeError(Exception('HTTP 500'));
      final ok = await done;

      expect(ok, isFalse);
      expect(provider.submitError, isNull);
      expect(provider.isSubmitting, isFalse);
    });
  });

  group('Правки по ревью Phase 3.5', () {
    late _GatedServer server;
    setUp(() => server = _GatedServer());

    Future<void> open(dynamic provider, String id) async {
      provider.selectEstablishment(id);
      server.answer(id, _detail(id));
      await pumpEventQueue();
    }

    test('передача: если во время неё открыта другая карточка, её загрузка '
        'не выбрасывается, и переданная не перечитывается', () async {
      final provider = ApprovedProvider(service: server);
      addTearDown(provider.dispose);
      await open(provider, 'a');

      server.claimGate = Completer<void>();
      final done = provider.claimEstablishment('u-new');
      await pumpEventQueue();
      provider.selectEstablishment('c'); // модератор открыл другую
      server.claimGate!.complete();
      await done;
      server.answer('c', _detail('c'));
      await pumpEventQueue();

      expect(server.calls.where((c) => c == 'detail:a').length, 1);
      expect(provider.selectedDetail?.id, 'c');
    });

    test('ошибка перечитывания после передачи не запирает карточку: '
        'повторный тап перечитывает', () async {
      final provider = ApprovedProvider(service: server);
      addTearDown(provider.dispose);
      await open(provider, 'a');

      final done = provider.claimEstablishment('u-new');
      await pumpEventQueue();
      server.details['a']![1].completeError(Exception('HTTP 500'));
      await done;
      expect(provider.detailError, isNotNull);

      provider.selectEstablishment('a'); // повторный тап
      await pumpEventQueue();
      expect(server.calls.where((c) => c == 'detail:a').length, 3);
    });

    test('ошибка действия над «a» не показывается под открытой позже «b»',
        () async {
      final approved = ApprovedProvider(service: server);
      addTearDown(approved.dispose);
      await open(approved, 'a');
      server.suspendGate = Completer<void>();
      final suspend = approved.suspendEstablishment('Жалобы');
      await pumpEventQueue();
      await open(approved, 'b');
      server.suspendGate!.completeError(Exception('HTTP 500'));
      expect(await suspend, isFalse);
      expect(approved.submitError, isNull);
      expect(approved.isSubmitting, isFalse);

      final pending = ModerationProvider(service: server);
      addTearDown(pending.dispose);
      await open(pending, 'c');
      server.moderateGate = Completer<void>();
      final approve = pending.approveEstablishment();
      await pumpEventQueue();
      await open(pending, 'd');
      server.moderateGate!.completeError(Exception('HTTP 500'));
      expect(await approve, isFalse);
      expect(pending.submitError, isNull);
      expect(pending.isSubmitting, isFalse);
    });

    test('ответ на действие после смены аккаунта: очередь и приостановленные '
        'не пишут ошибку в состояние нового', () async {
      final pending = ModerationProvider(service: server);
      addTearDown(pending.dispose);
      await open(pending, 'a');
      server.moderateGate = Completer<void>();
      final approve = pending.approveEstablishment();
      await pumpEventQueue();
      pending.resetAccountScope();
      // Вошедший открыл ту же заявку — ошибка чужого действия не о нём.
      pending.selectEstablishment('a');
      server.answer('a', _detail('a', forAdmin: false), index: 1);
      await pumpEventQueue();
      server.moderateGate!.completeError(Exception('HTTP 500'));
      expect(await approve, isFalse);
      expect(pending.submitError, isNull);

      final suspended = SuspendedProvider(service: server);
      addTearDown(suspended.dispose);
      await open(suspended, 'b');
      server.unsuspendGate = Completer<void>();
      final unsuspend = suspended.unsuspendEstablishment();
      await pumpEventQueue();
      suspended.resetAccountScope();
      suspended.selectEstablishment('b');
      server.answer('b', _detail('b', forAdmin: false), index: 1);
      await pumpEventQueue();
      server.unsuspendGate!.completeError(Exception('HTTP 500'));
      expect(await unsuspend, isFalse);
      expect(suspended.submitError, isNull);
    });

    group('Отзывы: откат действия после смены аккаунта', () {
      for (final action in <String>['delete', 'hide']) {
        test('$action: откат не возвращает в список просмотрщика копию, '
            'полученную администратором', () async {
          final service = _GatedReviewService();
          final provider = AdminReviewsProvider(service: service);
          addTearDown(provider.dispose);

          // Администратор: отзыв с автором и почтой.
          service.next = <AdminReviewItem>[_adminCopy()];
          await provider.loadReviews();
          provider.selectReview('r1');
          service.actionGate = Completer<void>();
          final done = action == 'delete'
              ? provider.deleteReview('спам')
              : provider.setVisibility(visible: false);
          await pumpEventQueue();

          // Выход; вошёл просмотрщик — тот же отзыв без людей.
          provider.resetAccountScope();
          service.next = <AdminReviewItem>[_viewerCopy()];
          await provider.loadReviews();

          service.actionGate!.completeError(Exception('HTTP 500'));
          expect(await done, isFalse);

          final row = provider.reviews.single;
          expect(row.authorEmail, isNull);
          expect(row.authorName, isNull);
          expect(row.viewerRedacted, isTrue);
          expect(provider.selectedReview, isNull);
          expect(provider.submitError, isNull);
        });
      }
    });
  });

  group('Счётчики рейла и итоги аналитики (решение Координатора 12.10)', () {
    // Числа одинаковы для обеих ролей — утечки здесь нет. Метка нужна, чтобы
    // охрана держалась у каждого провайдера реестра, а не по списку; и
    // заодно опоздавший ответ прежнего аккаунта не перекрывает свежий и не
    // снимает флаг загрузки, пока новый запрос ещё в пути.
    test('счётчики: опоздавший ответ прежнего аккаунта не перекрывает свежий',
        () async {
      final service = _GatedBadgesService();
      final provider = BadgesProvider(service: service);
      addTearDown(provider.dispose);

      provider.load(); // прежний аккаунт
      provider.resetAccountScope();
      provider.load(); // вошедший
      expect(service.gates.length, 2,
          reason: 'запрос вошедшего обязан уйти, а не упереться в флаг '
              'загрузки прежнего');

      service.gates[1].complete(const AdminBadges(establishmentsPending: 2));
      await pumpEventQueue();
      service.gates[0].complete(const AdminBadges(establishmentsPending: 9));
      await pumpEventQueue();

      expect(provider.badges?.establishmentsPending, 2);
    });

    test('итоги аналитики: опоздавший ответ прежнего аккаунта не перекрывает '
        'свежий', () async {
      final service = _GatedAnalyticsService();
      final provider = AnalyticsTotalsProvider(service: service);
      addTearDown(provider.dispose);

      provider.loadOnce(); // прежний аккаунт
      provider.resetAccountScope();
      provider.loadOnce(); // вошедший
      expect(service.gates.length, 2);

      service.gates[1].complete(_overview(establishments: 46));
      await pumpEventQueue();
      service.gates[0].complete(_overview(establishments: 999));
      await pumpEventQueue();

      expect(provider.establishments, 46);
    });

    test('опоздавший ответ прежнего аккаунта не снимает флаг загрузки '
        'нового запроса', () async {
      final service = _GatedBadgesService();
      final provider = BadgesProvider(service: service);
      addTearDown(provider.dispose);

      provider.load();
      provider.resetAccountScope();
      provider.load();
      service.gates[0].complete(const AdminBadges(establishmentsPending: 9));
      await pumpEventQueue();

      expect(provider.isLoading, isTrue,
          reason: 'запрос вошедшего ещё в пути');
      expect(provider.badges, isNull);
    });
  });

  group('Журнал', () {
    test('ответ администратору, опоздавший к входу просмотрщика, не ложится '
        'в его журнал', () async {
      final service = _GatedAuditService();
      final provider = AuditLogProvider(service: service);
      addTearDown(provider.dispose);

      provider.loadEntries(); // администратор
      provider.resetAccountScope(); // вошёл просмотрщик
      provider.loadEntries();

      service.gates[1].complete(_auditPage(adminName: null)); // просмотрщику
      await pumpEventQueue();
      service.gates[0].complete(_auditPage(adminName: 'Всеволод')); // опоздал
      await pumpEventQueue();

      expect(provider.entries.single.adminName, isNull);
    });
  });
}

class _GatedAuditService implements AuditLogService {
  final List<Completer<AuditLogListResponse>> gates =
      <Completer<AuditLogListResponse>>[];

  @override
  Future<AuditLogListResponse> getAuditLog({
    int page = 1,
    int perPage = 20,
    String? action,
    String? entityType,
    DateTime? from,
    DateTime? to,
  }) {
    final gate = Completer<AuditLogListResponse>();
    gates.add(gate);
    return gate.future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'подставка не обслуживает ${invocation.memberName}',
      );
}

class _GatedReviewService implements AdminReviewService {
  List<AdminReviewItem> next = <AdminReviewItem>[];
  Completer<void>? actionGate;

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
  }) async =>
      AdminReviewListResponse(reviews: next, total: next.length, page: 1, pages: 1);

  @override
  Future<void> setVisibility(String id, {required bool isVisible, String? reason}) =>
      actionGate!.future;

  @override
  Future<void> deleteReview(String id, {String? reason}) => actionGate!.future;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'подставка не обслуживает ${invocation.memberName}',
      );
}

class _GatedBadgesService implements BadgesService {
  final List<Completer<AdminBadges>> gates = <Completer<AdminBadges>>[];

  @override
  Future<AdminBadges> getBadges() {
    final gate = Completer<AdminBadges>();
    gates.add(gate);
    return gate.future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'подставка не обслуживает ${invocation.memberName}',
      );
}

class _GatedAnalyticsService implements AnalyticsService {
  final List<Completer<OverviewData>> gates = <Completer<OverviewData>>[];

  @override
  Future<OverviewData> getOverview({
    String period = '30d',
    String? from,
    String? to,
  }) {
    final gate = Completer<OverviewData>();
    gates.add(gate);
    return gate.future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'подставка не обслуживает ${invocation.memberName}',
      );
}

OverviewData _overview({required int establishments}) =>
    OverviewData.fromJson(<String, dynamic>{
      'users': <String, dynamic>{'total': 1},
      'establishments': <String, dynamic>{'total': establishments},
      'reviews': <String, dynamic>{'total': 1},
      'moderation': <String, dynamic>{},
    });

AdminReviewItem _adminCopy() => AdminReviewItem(
      id: 'r1',
      rating: 1,
      content: 'Текст скрытого отзыва',
      authorName: 'Марына К.',
      authorEmail: 'marina.k@gmail.com',
      isVisible: false,
      createdAt: DateTime.utc(2026, 10, 12, 9),
    );

AdminReviewItem _viewerCopy() => AdminReviewItem(
      id: 'r1',
      rating: 1,
      isVisible: false,
      viewerRedacted: true,
      createdAt: DateTime.utc(2026, 10, 12, 9),
    );

AuditLogListResponse _auditPage({required String? adminName}) =>
    AuditLogListResponse(
      entries: <AuditLogEntry>[
        AuditLogEntry(
          id: 'e1',
          action: 'suspend',
          summary: 'Приостановлено заведение',
          entityType: 'establishment',
          adminName: adminName,
          actorRole: 'admin',
          createdAt: DateTime.utc(2026, 10, 12, 9),
        ),
      ],
      total: 1,
      page: 1,
      pages: 1,
    );
