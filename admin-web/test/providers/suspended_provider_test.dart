import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

// Раздел «Приостановленные» после действия модератора (две независимые
// паузы, 07.10.2026). Куда уходит карточка, решает сервер: «Возобновить»
// возвращает её туда, где она была, — на сайт (из раздела уходит) или на
// паузу партнёра (остаётся, уже как пауза партнёра). «Приостановить» поверх
// паузы партнёра оставляет её в разделе приостановкой модератора. Провайдер
// не угадывает исход, а перечитывает раздел — фейк здесь играет сервер.

class _Card {
  String status;
  String? reason;
  final String returnTo;

  /// Время изменения — раздел упорядочен по нему, свежие первыми.
  int updated;

  _Card({
    required this.status,
    this.reason,
    this.returnTo = 'active',
    this.updated = 0,
  });
}

class _FakeServer implements ModerationService {
  final Map<String, _Card> cards = <String, _Card>{};
  final List<String> calls = <String>[];
  Object? failActionWith;

  /// Размер страницы раздела — у сервера 20; меньше, чтобы проверить вторую.
  int pageSize = 20;
  int _clock = 100;

  Map<String, dynamic>? _notes(_Card card) => card.reason == null
      ? null
      : <String, dynamic>{'suspend_reason': card.reason};

  @override
  Future<SuspendedListResponse> getSuspendedEstablishments({
    int page = 1,
    int perPage = 20,
  }) async {
    calls.add('list:$page');
    final suspended = cards.entries
        .where((e) => e.value.status == 'suspended')
        .toList()
      ..sort((a, b) {
        final byTime = b.value.updated.compareTo(a.value.updated);
        return byTime != 0 ? byTime : a.key.compareTo(b.key);
      });
    final pages = suspended.isEmpty ? 1 : (suspended.length + pageSize - 1) ~/ pageSize;
    final items = suspended
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .map((e) => SuspendedEstablishmentItem.fromJson(<String, dynamic>{
              'id': e.key,
              'name': 'Заведение ${e.key}',
              'moderation_notes': _notes(e.value),
            }))
        .toList();
    return SuspendedListResponse(
      establishments: items,
      total: suspended.length,
      page: page,
      pages: pages,
    );
  }

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async {
    calls.add('detail:$id');
    final card = cards[id]!;
    return EstablishmentDetail(
      id: id,
      partnerId: 'p-1',
      name: 'Заведение $id',
      status: card.status,
      moderationNotes: _notes(card),
    );
  }

  @override
  Future<void> suspendEstablishment({
    required String id,
    required String reason,
  }) async {
    calls.add('suspend:$id:$reason');
    final failure = failActionWith;
    if (failure != null) throw failure;
    cards[id]!
      ..status = 'suspended'
      ..reason = reason
      ..updated = ++_clock;
  }

  @override
  Future<void> unsuspendEstablishment({required String id}) async {
    calls.add('unsuspend:$id');
    final failure = failActionWith;
    if (failure != null) throw failure;
    final card = cards[id]!;
    card
      ..status = card.returnTo
      ..reason = null
      ..updated = ++_clock;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'фейк не обслуживает ${invocation.memberName}',
      );
}

void main() {
  late _FakeServer server;
  late SuspendedProvider provider;

  setUp(() {
    server = _FakeServer();
    provider = SuspendedProvider(service: server);
    addTearDown(provider.dispose);
  });

  Future<void> open(String id) async {
    await provider.loadSuspendedEstablishments();
    await provider.selectEstablishment(id);
  }

  test('пауза партнёра → «Приостановить»: причина уходит на сервер, карточка остаётся приостановкой модератора',
      () async {
    server.cards['a'] = _Card(status: 'suspended');
    await open('a');
    expect(provider.selectedDetail!.isPausedByPartner, isTrue);

    final ok = await provider.suspendEstablishment('Жалобы гостей');

    expect(ok, isTrue);
    expect(server.calls, contains('suspend:a:Жалобы гостей'));
    expect(provider.establishments.map((e) => e.id), <String>['a']);
    expect(provider.selectedId, 'a');
    expect(provider.selectedDetail!.isSuspendedByModerator, isTrue);
    expect(provider.isSubmitting, isFalse);
  });

  test('«Возобновить» с возвратом на паузу партнёра: карточка остаётся выбранной, уже как пауза партнёра',
      () async {
    server.cards['a'] = _Card(status: 'suspended', reason: 'Проверка', returnTo: 'suspended');
    await open('a');

    final ok = await provider.unsuspendEstablishment();

    expect(ok, isTrue);
    expect(provider.establishments.map((e) => e.id), <String>['a']);
    expect(provider.establishments.single.isPausedByPartner, isTrue);
    expect(provider.selectedId, 'a');
    expect(provider.selectedDetail!.isPausedByPartner, isTrue);
  });

  test('«Возобновить» с возвратом на сайт: карточка уходит из раздела, выбор снят', () async {
    server.cards['a'] = _Card(status: 'suspended', reason: 'Проверка', returnTo: 'active');
    server.cards['b'] = _Card(status: 'suspended');
    await open('a');

    final ok = await provider.unsuspendEstablishment();

    expect(ok, isTrue);
    expect(provider.establishments.map((e) => e.id), <String>['b']);
    expect(provider.selectedId, isNull);
    expect(provider.selectedDetail, isNull);
  });

  test('отказ сервера: ошибка у действия, раздел и выбор не тронуты', () async {
    server.cards['a'] = _Card(status: 'suspended', reason: 'Проверка');
    await open('a');
    server.failActionWith = Exception('400 SUSPENDED_BY_PARTNER');

    final ok = await provider.unsuspendEstablishment();

    expect(ok, isFalse);
    expect(provider.submitError, isNotNull);
    expect(provider.selectedId, 'a');
    expect(provider.establishments.map((e) => e.id), <String>['a']);
    expect(server.calls.where((c) => c.startsWith('list')), hasLength(1));
  });

  test('на второй странице: карточка, оставшаяся в разделе, открывается на первой — выбранной', () async {
    // Раздел упорядочен по времени изменения; действие освежает карточку,
    // и она уходит с открытой второй страницы на первую.
    server.pageSize = 1;
    server.cards['a'] = _Card(status: 'suspended', reason: 'Проверка', returnTo: 'suspended', updated: 1);
    server.cards['b'] = _Card(status: 'suspended', updated: 2);
    await provider.loadSuspendedEstablishments(page: 2);
    expect(provider.establishments.map((e) => e.id), <String>['a']);
    await provider.selectEstablishment('a');

    final ok = await provider.unsuspendEstablishment();

    expect(ok, isTrue);
    expect(provider.currentPage, 1);
    expect(provider.establishments.map((e) => e.id), <String>['a']);
    expect(provider.selectedId, 'a');
    expect(provider.selectedDetail!.isPausedByPartner, isTrue);
  });
}
