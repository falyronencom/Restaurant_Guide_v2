import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:restaurant_guide_mobile/screens/partner/partner_reviews_screen.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// «Отзывы» заведения в кабинете владельца: сортировка относится ко всем
/// отзывам за период, а не к загруженным (проход тестировщика 17.10, Х39 —
/// тот же дефект, что Х31 на «Все отзывы», и тот же способ, что в PR #73).
///
/// До 18.10.2026 «По дате (старые)» разворачивал только первую страницу
/// «сначала новые», а следующие дописывал в конец в порядке «сначала новые»;
/// ответ на прежнюю сортировку, пришедший поздно, ложился в новый список.
/// Поверх настоящих `ApiClient` и `ReviewsService`; подменён только провод,
/// за ним — сервер, который сортирует и режет на страницы, как
/// `reviewModel.findReviewsByEstablishment` (период сервер-заглушка не
/// смотрит: все отзывы — «за период»).

const _placeId = '11111111-1111-4111-8111-111111111111';

/// Отзывы заведения: номер — порядок написания (1 — самый старый).
/// Лучший (5★) — самый старый, худший (1★) — второй: оба далеко за первой
/// страницей «сначала новые».
/// Тесты «сначала старые» ставят и 13 — две страницы; [setUp] возвращает 23.
var _count = 23;

int _rating(int n) => n == 1 ? 5 : (n == 2 ? 1 : 2 + n % 3);
DateTime _createdAt(int n) => DateTime.utc(2026, 1, 1).add(Duration(days: n));

/// Отзывы, написанные, пока человек листает: номера после [_count].
var _arrived = 0;

List<int> get _all => [for (var n = 1; n <= _count + _arrived; n++) n];

/// Порядок сервера: `newest` — created_at DESC; `highest` — rating DESC,
/// затем новые; `lowest` — rating ASC, затем новые; без `sort` — `newest`.
/// Незнакомое значение до порядка не доходит — см. [_server].
List<int> _serverOrder(String? sort) {
  int newer(int a, int b) => _createdAt(b).compareTo(_createdAt(a));
  final rows = [..._all];
  switch (sort) {
    case 'highest':
      rows.sort((a, b) {
        final byRating = _rating(b).compareTo(_rating(a));
        return byRating != 0 ? byRating : newer(a, b);
      });
    case 'lowest':
      rows.sort((a, b) {
        final byRating = _rating(a).compareTo(_rating(b));
        return byRating != 0 ? byRating : newer(a, b);
      });
    default:
      rows.sort(newer);
  }
  return rows;
}

/// Порядки, которые знает сервер (`reviewValidation.js`, `query('sort')`).
const _serverSorts = {'newest', 'highest', 'lowest'};

ResponseBody _server(RequestOptions options) {
  final q = options.queryParameters;
  final sort = q['sort'] as String?;
  // Незнакомый порядок сервер не подменяет «новыми», а отвергает — `validate`
  // бэкенда, 422. Заглушка, отвечавшая на него «новыми», не видела, что экран
  // просит порядок, которого у сервера нет.
  if (sort != null && !_serverSorts.contains(sort)) {
    return jsonBody(<String, dynamic>{
      'success': false,
      'message': 'Validation failed',
      'error': <String, dynamic>{
        'code': 'VALIDATION_ERROR',
        'details': [
          <String, dynamic>{
            'field': 'sort',
            'message': 'Sort must be one of: newest, highest, lowest',
            'value': sort,
          },
        ],
      },
      'timestamp': '2026-10-17T10:00:00.000Z',
    }, status: 422);
  }
  final page = q['page'] as int;
  final limit = q['limit'] as int;
  final rows = _serverOrder(q['sort'] as String?)
      .skip((page - 1) * limit)
      .take(limit);
  return jsonBody(reviewsEnvelope(
    reviews: [
      for (final n in rows)
        reviewRow(
          id: '33333333-3333-4333-8333-${n.toString().padLeft(12, '0')}',
          rating: _rating(n),
          content: 'Отзыв $n',
        )..['created_at'] = _createdAt(n).toIso8601String(),
    ],
    page: page,
    limit: limit,
    total: _all.length,
    pages: (_all.length / limit).ceil(),
  ));
}

/// Провод, который придерживает выбранные ответы, пока тест их не отпустит:
/// так ответ на прежнюю сортировку приходит после ответа на новую.
class _HeldWire implements HttpClientAdapter {
  final List<RequestOptions> requests = [];
  final Map<String, Completer<void>> held = {};

  static String key(String sort, int page) => '$sort:$page';

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    final q = options.queryParameters;
    final gate = held[key(q['sort'] as String? ?? 'newest', q['page'] as int)];
    if (gate != null) await gate.future;
    return _server(options);
  }

  @override
  void close({bool force = false}) {}
}

final _reviewText = RegExp(r'^Отзыв (\d+)$');

/// Номера отзывов на экране сверху вниз.
List<int> _visible(WidgetTester tester) {
  final texts = find.byWidgetPredicate(
      (w) => w is Text && _reviewText.hasMatch(w.data ?? ''));
  final shown = texts.evaluate().toList()
    ..sort((a, b) => tester
        .getRect(find.byWidget(a.widget))
        .top
        .compareTo(tester.getRect(find.byWidget(b.widget)).top));
  return [
    for (final e in shown)
      int.parse(_reviewText.firstMatch((e.widget as Text).data!)!.group(1)!)
  ];
}

/// Весь список сверху вниз: прокрутка шагами, подгрузка идёт сама. Каждый
/// отзыв записан по месту в списке, поэтому повтор номера попадает в
/// результат дважды — дубль в списке тоже дефект.
Future<List<int>> _wholeList(WidgetTester tester) async {
  final list = find.byType(ListView);
  final byPlace = <int, int>{};
  for (var step = 0; step < 60; step++) {
    final position =
        tester.state<ScrollableState>(find.byType(Scrollable).last).position;
    for (final e in find
        .byWidgetPredicate(
            (w) => w is Text && _reviewText.hasMatch(w.data ?? ''))
        .evaluate()) {
      final n = int.parse(
          _reviewText.firstMatch((e.widget as Text).data!)!.group(1)!);
      final place =
          (tester.getRect(find.byWidget(e.widget)).top + position.pixels)
              .round();
      byPlace[place] = n;
    }
    if (position.pixels >= position.maxScrollExtent) break;
    await tester.drag(list, const Offset(0, -300));
    await tester.pumpAndSettle();
  }
  final places = byPlace.keys.toList()..sort();
  return [for (final place in places) byPlace[place]!];
}

Future<void> _pump(WidgetTester tester, {double height = 800}) async {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = Size(400, height);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const MaterialApp(
    home: PartnerReviewsScreen(establishmentId: _placeId),
  ));
  await tester.pumpAndSettle();
}

/// Выбор сортировки без ожидания ответа. Без `pumpAndSettle`: пока ответ
/// придержан, индикатор загрузки крутится и «успокоения» не будет.
Future<void> _choose(WidgetTester tester, String option) async {
  await tester.tap(find.text('Сортировка'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await tester.tap(find.text(option));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

void main() {
  group('Порядок — на всех отзывах за период', () {
    late StubAdapter wire;
    setUp(() {
      _arrived = 0;
      _count = 23;
      wire = installWireStand(_server);
    });

    // Три страницы и две: самая старая — последняя, и при двух она же
    // вторая; граница «страниц больше одной» видна только на двух.
    for (final (count, pages) in [
      (23, [1, 3, 2, 1]),
      (13, [1, 2, 1]),
    ]) {
      testWidgets('«По дате (старые)»: от самого старого через все страницы '
          '($count отзывов)', (tester) async {
        _count = count;
        await _pump(tester);
        expect(_visible(tester).first, count, reason: 'сначала — новые');

        await _choose(tester, 'По дате (старые)');
        await tester.pumpAndSettle();

        expect(wire.requests.map((r) => r.queryParameters['sort']),
            everyElement(isIn(_serverSorts)),
            reason: 'сервер знает только newest, highest и lowest — на '
                'прочее он отвечает 422');
        expect(_visible(tester).first, 1,
            reason: 'самый старый отзыв — на последней странице сервера');
        expect(await _wholeList(tester), _all,
            reason: 'все $count по возрастанию даты, ни одного дважды');
        final afterChoice = wire.requests.skip(1);
        expect(afterChoice.map((r) => r.queryParameters['page']), pages,
            reason: 'первая страница говорит, сколько их; дальше — '
                'с последней к первой');
      });
    }

    testWidgets('«По рейтингу (высокий)»: подгрузка — в том же порядке',
        (tester) async {
      await _pump(tester);
      await _choose(tester, 'По рейтингу (высокий)');
      await tester.pumpAndSettle();

      expect(_visible(tester).first, 1);
      expect(await _wholeList(tester), _serverOrder('highest'));
      expect(
          wire.requests
              .skip(1)
              .map((r) => r.queryParameters['sort'])
              .toSet(),
          {'highest'});
    });

    testWidgets('«По дате (новые)» после «старых» — снова все новые',
        (tester) async {
      await _pump(tester);
      await _choose(tester, 'По дате (старые)');
      await tester.pumpAndSettle();
      await _choose(tester, 'По дате (новые)');
      await tester.pumpAndSettle();

      expect(await _wholeList(tester), _serverOrder('newest'));
    });

    testWidgets('новый отзыв между страницами — без повтора на стыке',
        (tester) async {
      await _pump(tester);
      // Страницы режутся по смещению: новый отзыв сдвигает их на один, и
      // последний отзыв первой страницы приходит снова первым на второй.
      _arrived = 1;

      expect(await _wholeList(tester), [for (var n = 23; n >= 1; n--) n]);
    });
  });

  group('Смена сортировки во время загрузки', () {
    late _HeldWire wire;
    setUp(() {
      _arrived = 0;
      _count = 23;
      installWireStand(_server);
      wire = _HeldWire();
      // Поверх стенда: tearDown стенда вернёт исходный транспорт.
      ApiClient().dio.httpClientAdapter = wire;
    });

    testWidgets('поздняя страница прежней сортировки не попадает в список',
        (tester) async {
      final stale = wire.held[_HeldWire.key('newest', 2)] = Completer();
      await _pump(tester);

      // Прокрутка к концу просит вторую страницу «сначала новые» — она висит.
      await tester.drag(find.byType(ListView), const Offset(0, -8000));
      await tester.pump(const Duration(milliseconds: 200));
      expect(
          wire.requests.where((r) =>
              r.queryParameters['page'] == 2 &&
              r.queryParameters['sort'] == 'newest'),
          hasLength(1));

      await _choose(tester, 'По рейтингу (низкий)');
      await tester.pumpAndSettle();
      stale.complete();
      await tester.pumpAndSettle();

      expect(await _wholeList(tester), _serverOrder('lowest'));
    });

    testWidgets('поздний ответ прежней сортировки не заменяет новый',
        (tester) async {
      await _pump(tester);
      final stale = wire.held[_HeldWire.key('lowest', 1)] = Completer();

      await _choose(tester, 'По рейтингу (низкий)');
      await _choose(tester, 'По рейтингу (высокий)');
      await tester.pumpAndSettle();
      expect(_visible(tester).first, 1);

      stale.complete();
      await tester.pumpAndSettle();

      expect(await _wholeList(tester), _serverOrder('highest'));
    });
  });
}
