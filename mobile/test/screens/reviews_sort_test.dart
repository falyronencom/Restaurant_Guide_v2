import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/screens/reviews/reviews_list_screen.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Сортировка на «Все отзывы» относится ко всем отзывам заведения, а не к
/// загруженным (проход тестировщика 17.10, Х31).
///
/// До 17.10.2026 экран переставлял уже загруженную первую страницу, а
/// следующие страницы просил без `sort` и дописывал в конец: «Высокий
/// рейтинг» показывал лучшие из первых десяти. Поверх настоящих `ApiClient`
/// и `ReviewsService`; подменён только провод, за ним — сервер, который
/// сортирует и режет на страницы, как `reviewModel.findReviewsByEstablishment`.
const _placeId = '11111111-1111-4111-8111-111111111111';

/// Отзывы заведения: номер — порядок написания (1 — самый старый).
/// Лучший (5★) — самый старый, худший (1★) — второй: оба далеко за первой
/// страницей «сначала новые».
const _count = 23;

int _rating(int n) => n == 1 ? 5 : (n == 2 ? 1 : 2 + n % 3);
DateTime _createdAt(int n) => DateTime.utc(2026, 1, 1).add(Duration(days: n));

/// Отзывы, написанные, пока человек листает: номера после [_count].
var _arrived = 0;

List<int> get _all => [for (var n = 1; n <= _count + _arrived; n++) n];

/// Порядок сервера: `newest` — created_at DESC; `highest` — rating DESC,
/// затем новые; `lowest` — rating ASC, затем новые; незнакомое — `newest`.
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

ResponseBody _server(RequestOptions options) {
  final q = options.queryParameters;
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

final _establishment = Establishment(
  id: _placeId,
  name: 'Тестовое место',
  category: 'Ресторан',
  address: 'ул. Тестовая, 1',
  city: 'Минск',
  status: 'active',
  createdAt: DateTime(2026, 10, 1),
  updatedAt: DateTime(2026, 10, 1),
);

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
  await tester.pumpWidget(MaterialApp(
    home: ReviewsListScreen(establishment: _establishment),
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
  group('Порядок — на всех отзывах', () {
    late StubAdapter wire;
    setUp(() {
      _arrived = 0;
      wire = installWireStand(_server);
    });

    testWidgets('«Высокий рейтинг»: первым — лучший из всех, не из первых 10',
        (tester) async {
      await _pump(tester);
      expect(_visible(tester).first, 23, reason: 'сначала — новые');

      await _choose(tester, 'Высокий рейтинг');
      await tester.pumpAndSettle();

      expect(_visible(tester).first, 1,
          reason: 'отзыв на 5★ самый старый — на третьей странице '
              '«сначала новые»; первым он стоит, только если порядок '
              'задал сервер');
      expect(
          wire.requests.last.queryParameters,
          containsPair('sort', 'highest'));
      expect(await _wholeList(tester), _serverOrder('highest'),
          reason: 'подгрузка — в том же порядке, без повторов и пропусков');
      final afterChoice = wire.requests.skipWhile(
          (r) => r.queryParameters['sort'] != 'highest');
      expect(afterChoice.map((r) => r.queryParameters['page']), [1, 2, 3]);
      expect(afterChoice.map((r) => r.queryParameters['sort']).toSet(),
          {'highest'},
          reason: 'следующие страницы просятся с тем же sort');
    });

    testWidgets('«Низкий рейтинг»: первым — худший из всех', (tester) async {
      await _pump(tester);
      await _choose(tester, 'Низкий рейтинг');
      await tester.pumpAndSettle();

      expect(_visible(tester).first, 2);
      expect(await _wholeList(tester), _serverOrder('lowest'));
    });

    testWidgets('«Сначала старые»: от самого старого через все страницы',
        (tester) async {
      await _pump(tester);
      await _choose(tester, 'Сначала старые');
      await tester.pumpAndSettle();

      expect(_visible(tester).first, 1,
          reason: 'самый старый отзыв — на последней странице сервера');
      expect(await _wholeList(tester), _all,
          reason: 'все 23 по возрастанию даты, ни одного дважды');
    });

    testWidgets('«Сначала новые» после другой сортировки — снова все новые',
        (tester) async {
      await _pump(tester);
      await _choose(tester, 'Высокий рейтинг');
      await tester.pumpAndSettle();
      await _choose(tester, 'Сначала новые');
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

      await _choose(tester, 'Высокий рейтинг');
      await tester.pumpAndSettle();
      stale.complete();
      await tester.pumpAndSettle();

      expect(await _wholeList(tester), _serverOrder('highest'));
    });

    testWidgets('поздний ответ прежней сортировки не заменяет новый',
        (tester) async {
      await _pump(tester);
      final stale = wire.held[_HeldWire.key('lowest', 1)] = Completer();

      await _choose(tester, 'Низкий рейтинг');
      await _choose(tester, 'Высокий рейтинг');
      await tester.pumpAndSettle();
      expect(_visible(tester).first, 1);

      stale.complete();
      await tester.pumpAndSettle();

      expect(await _wholeList(tester), _serverOrder('highest'));
    });
  });
}
