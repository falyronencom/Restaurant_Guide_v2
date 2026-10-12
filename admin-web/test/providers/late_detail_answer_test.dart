import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';
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
  }

  @override
  Future<void> claimEstablishment({
    required String id,
    required String userId,
  }) async {
    calls.add('claim:$id');
  }

  @override
  Future<void> moderateEstablishment({
    required String id,
    required String action,
    Map<String, String>? moderationNotes,
  }) async {
    calls.add('$action:$id');
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
      server.suspendGate!.completeError(Exception('HTTP 500'));
      final ok = await done;

      expect(ok, isFalse);
      expect(provider.submitError, isNull);
      expect(provider.isSubmitting, isFalse);
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
