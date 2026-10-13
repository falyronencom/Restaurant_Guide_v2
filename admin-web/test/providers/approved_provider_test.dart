import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

// «Одобренные» в режиме поиска (две независимые паузы, 07.10.2026). Поиск
// находит карточки любого статуса, и «Приостановить» теперь можно и на
// карточке из очереди, отклонённой или на паузе партнёра. Приостановленная
// карточка поиску по-прежнему соответствует — она остаётся в выдаче с новым
// статусом, поэтому выдача перечитывается, а не правится на месте. В обычном
// списке одобренных приостановленная карточка из него уходит — как раньше.

class _FakeServer implements ModerationService {
  final Map<String, String> statuses = <String, String>{};
  final List<String> calls = <String>[];

  @override
  Future<SearchListResponse> searchEstablishments({
    required String search,
    String? status,
    String? city,
    int page = 1,
    int perPage = 20,
  }) async {
    calls.add('search:$search');
    final items = statuses.entries
        .map((e) => SearchResultItem.fromJson(<String, dynamic>{
              'id': e.key,
              'name': 'Кафе ${e.key}',
              'status': e.value,
            }))
        .toList();
    return SearchListResponse(
      establishments: items,
      total: items.length,
      page: page,
      pages: 1,
    );
  }

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async =>
      EstablishmentDetail(
        id: id,
        partnerId: 'p-1',
        name: 'Кафе $id',
        status: statuses[id]!,
      );

  @override
  Future<void> suspendEstablishment({
    required String id,
    required String reason,
  }) async {
    calls.add('suspend:$id');
    statuses[id] = 'suspended';
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'фейк не обслуживает ${invocation.memberName}',
      );
}

void main() {
  test('поиск: после «Приостановить» карточка остаётся в выдаче, уже приостановленной', () async {
    final server = _FakeServer()..statuses['a'] = 'pending';
    final provider = ApprovedProvider(service: server);
    addTearDown(provider.dispose);

    await provider.searchEstablishments('Кафе');
    await provider.selectEstablishment('a');

    final ok = await provider.suspendEstablishment('Подозрение на чужие фото');
    await pumpEventQueue();

    expect(ok, isTrue);
    expect(server.calls, <String>['search:Кафе', 'suspend:a', 'search:Кафе']);
    expect(provider.isSearchMode, isTrue);
    final found = provider.establishments.single as SearchResultItem;
    expect(found.id, 'a');
    expect(found.status, 'suspended');
    expect(provider.selectedId, isNull);
  });
}
