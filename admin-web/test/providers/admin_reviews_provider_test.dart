import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';

// Отзывы: что провайдер знает о выборке и что делает после действия.
//
// Главное обещание — экран после скрытия или удаления показывает НОВОЕ
// состояние целиком, а не один переключённый флаг. Оптимистичная правка
// касается только `is_visible`, но действие меняет и число скрытых в подписи
// экрана, и рейтинг заведения в панели: их считает бэкенд, и получить их
// можно только перечиткой.

class _FakeAdminReviewService implements AdminReviewService {
  final List<int> listCalls = <int>[];
  int toggleCalls = 0;
  final List<bool> visibilityTargets = <bool>[];
  int deleteCalls = 0;
  String? lastDeleteReason;

  List<AdminReviewItem> reviews = <AdminReviewItem>[];
  int total = 0;
  int hidden = 0;
  double? averageRating;

  String? lastQuery;
  Object? failActionWith;

  /// Задержать следующий ответ, чтобы воспроизвести перехлёст запросов.
  bool gateNextResponse = false;
  Completer<AdminReviewListResponse>? _gate;

  /// Задержанный ответ оказался отказом.
  void failGate(Object error) => _gate!.completeError(error);

  void releaseGate(List<AdminReviewItem> items, int totalCount) {
    _gate!.complete(AdminReviewListResponse(
      reviews: items,
      total: totalCount,
      page: 3,
      pages: 5,
    ));
  }

  @override
  Future<AdminReviewListResponse> getReviews({
    int page = 1,
    int perPage = 20,
    String? status,
    int? rating,
    String? search,
    String? sort,
    DateTime? from,
    DateTime? to,
  }) async {
    listCalls.add(page);
    lastQuery = search;
    if (gateNextResponse) {
      _gate = Completer<AdminReviewListResponse>();
      return _gate!.future;
    }
    return AdminReviewListResponse(
      reviews: reviews,
      total: total,
      hidden: hidden,
      averageRating: averageRating,
      page: page,
      pages: 1,
    );
  }

  @override
  Future<void> setVisibility(String id, {required bool isVisible}) async {
    toggleCalls++;
    visibilityTargets.add(isVisible);
    final failure = failActionWith;
    if (failure != null) throw failure;
  }

  @override
  Future<void> deleteReview(String id, {String? reason}) async {
    deleteCalls++;
    lastDeleteReason = reason;
    final failure = failActionWith;
    if (failure != null) throw failure;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AdminReviewItem _review({
  String id = 'r1',
  int rating = 2,
  bool isVisible = true,
  bool isDeleted = false,
  double? establishmentAverageRating,
}) =>
    AdminReviewItem(
      id: id,
      rating: rating,
      isVisible: isVisible,
      isDeleted: isDeleted,
      createdAt: DateTime.utc(2026, 8, 12, 16, 24),
      establishmentAverageRating: establishmentAverageRating,
      establishmentReviewCount: establishmentAverageRating == null ? null : 10,
    );

void main() {
  late _FakeAdminReviewService fake;
  late AdminReviewsProvider provider;

  setUp(() {
    fake = _FakeAdminReviewService();
    provider = AdminReviewsProvider(service: fake);
  });

  group('Агрегаты выборки', () {
    test('число скрытых и средняя доезжают до провайдера', () async {
      fake
        ..reviews = <AdminReviewItem>[_review()]
        ..total = 1240
        ..hidden = 12
        ..averageRating = 4.3;

      await provider.loadReviews();

      expect(provider.totalCount, 1240);
      expect(provider.hiddenCount, 12);
      expect(provider.averageRating, 4.3);
    });

    test('порядок фильтром не считается, остальное считается', () {
      expect(provider.hasActiveFilters, isFalse);

      provider.setSort('rating_low');
      expect(provider.hasActiveFilters, isFalse);

      provider.setStatusFilter('hidden');
      expect(provider.hasActiveFilters, isTrue);

      provider.setStatusFilter(null);
      provider.setRatingFilter(1);
      expect(provider.hasActiveFilters, isTrue);

      provider.setRatingFilter(null);
      provider.search('холодный');
      expect(provider.hasActiveFilters, isTrue);
    });
  });

  group('После действия', () {
    setUp(() {
      fake
        ..reviews = <AdminReviewItem>[_review(establishmentAverageRating: 4.1)]
        ..total = 1
        ..hidden = 0
        ..averageRating = 2.0;
    });

    test('скрытие перечитывает страницу — иначе агрегаты остаются прежними',
        () async {
      await provider.loadReviews();
      provider.selectReview('r1');
      expect(fake.listCalls.length, 1);

      // Новое состояние выборки после скрытия.
      fake
        ..reviews = <AdminReviewItem>[
          _review(isVisible: false, establishmentAverageRating: 4.4),
        ]
        ..hidden = 1;

      final ok = await provider.setVisibility(visible: false);

      expect(ok, isTrue);
      expect(fake.toggleCalls, 1);
      expect(fake.visibilityTargets, <bool>[false]);
      expect(fake.listCalls, <int>[1, 1]);
      expect(provider.hiddenCount, 1);
      // Выбранный отзыв переопределён по свежему списку: `selectReview` на тот
      // же id выходит ранним возвратом и панель обновить бы не смог.
      expect(provider.selectedReview?.isVisible, isFalse);
      expect(provider.selectedReview?.establishmentAverageRating, 4.4);
    });

    test('удаление перечитывает страницу и передаёт причину', () async {
      await provider.loadReviews();
      provider.selectReview('r1');

      fake.reviews = <AdminReviewItem>[
        _review(isDeleted: true, establishmentAverageRating: 5.0),
      ];

      final ok = await provider.deleteReview('оскорбления');

      expect(ok, isTrue);
      expect(fake.lastDeleteReason, 'оскорбления');
      expect(fake.listCalls, <int>[1, 1]);
      expect(provider.selectedReview?.isDeleted, isTrue);
      expect(provider.selectedReview?.establishmentAverageRating, 5.0);
    });

    test('цель явная: повтор того же действия просит то же состояние', () async {
      // Повтор «скрыть» после уже скрытого (оптимистично) отзыва — всё равно
      // «скрыть», а не переключение назад: именно так клиент повторяет
      // запрос при 5xx (пакет 1 находок критиков, пункт 2 — Codex C-10).
      await provider.loadReviews();
      provider.selectReview('r1');

      await provider.setVisibility(visible: false);
      // Выборка после первого действия — скрытый отзыв (а не след
      // оптимистичной правки в общем списке фейка): второе действие
      // принимает решение на уже скрытом.
      fake.reviews = <AdminReviewItem>[
        _review(isVisible: false, establishmentAverageRating: 4.4),
      ];
      await provider.setVisibility(visible: false);

      expect(fake.visibilityTargets, <bool>[false, false]);
      expect(provider.selectedReview?.isVisible, isFalse);
    });

    test('неудача действия откатывает и не перечитывает', () async {
      await provider.loadReviews();
      provider.selectReview('r1');
      fake.failActionWith = Exception('403');

      final ok = await provider.setVisibility(visible: false);

      expect(ok, isFalse);
      // Перечитка после провала подменила бы сообщение об ошибке молчаливым
      // возвратом к прежнему виду.
      expect(fake.listCalls, <int>[1]);
      expect(provider.selectedReview?.isVisible, isTrue);
      expect(provider.submitError, isNotNull);
    });

    // «Неудача действия» выше — только скрытие; у удаления свой откат.
    test('неудача удаления тоже откатывает и не перечитывает', () async {
      await provider.loadReviews();
      provider.selectReview('r1');
      fake.failActionWith = Exception('403');

      final ok = await provider.deleteReview('оскорбления');

      expect(ok, isFalse);
      expect(fake.listCalls, <int>[1]);
      expect(provider.selectedReview?.isDeleted, isFalse,
          reason: 'отзыв, который сервер не удалил, не может остаться '
              'помеченным удалённым');
      expect(provider.reviews.single.isDeleted, isFalse);
      expect(provider.submitError, isNotNull);
    });

    // «Цель явная» выше проверена только для скрытия: клиент, всегда
    // просящий `false`, прошёл бы его, а «Показать» прятало бы отзыв.
    test('«Показать» просит видимость, а не скрытие', () async {
      fake.reviews = <AdminReviewItem>[
        _review(isVisible: false, establishmentAverageRating: 4.1),
      ];
      await provider.loadReviews();
      provider.selectReview('r1');
      fake.reviews = <AdminReviewItem>[_review(establishmentAverageRating: 4.0)];

      final ok = await provider.setVisibility(visible: true);

      expect(ok, isTrue);
      expect(fake.visibilityTargets, <bool>[true]);
      expect(provider.selectedReview?.isVisible, isTrue);
    });
  });

  group('Сброс фильтров', () {
    test('один запрос, а не три — и все три фильтра сняты', () async {
      fake
        ..reviews = <AdminReviewItem>[_review()]
        ..total = 1;
      provider.setStatusFilter('hidden');
      provider.setRatingFilter(1);
      provider.search('холодный');
      await Future<void>.delayed(Duration.zero);
      final before = fake.listCalls.length;

      provider.resetFilters();
      await Future<void>.delayed(Duration.zero);

      // Три отдельных сеттера дали бы три запроса, и два первых ушли бы ещё
      // со старым поиском: победил бы ответивший последним, а не отправленный
      // последним.
      expect(fake.listCalls.length - before, 1);
      expect(provider.hasActiveFilters, isFalse);
      expect(fake.lastQuery, isNull);
    });
  });

  group('Устаревшие ответы', () {
    test('обогнанный ответ свой результат уже не пишет', () async {
      fake
        ..reviews = <AdminReviewItem>[_review()]
        ..total = 1
        ..gateNextResponse = true;

      final slow = provider.loadReviews(page: 3);

      // Пока первый в полёте, уходит второй — и отвечает раньше.
      fake
        ..gateNextResponse = false
        ..reviews = <AdminReviewItem>[_review(id: 'fresh')]
        ..total = 7;
      await provider.loadReviews();

      fake.releaseGate(<AdminReviewItem>[_review(id: 'stale')], 99);
      await slow;

      // Иначе на экране оказалась бы страница, которую уже никто не просил.
      expect(provider.reviews.single.id, 'fresh');
      expect(provider.totalCount, 7);
    });

    test('обогнанный ОТКАЗ свою ошибку уже не пишет', () async {
      // Выше — поздний успех. Поздний отказ опаснее: свежий список на месте,
      // а поверх него экран сообщает об ошибке запроса, которого никто не ждёт.
      fake
        ..reviews = <AdminReviewItem>[_review()]
        ..total = 1
        ..gateNextResponse = true;

      final slow = provider.loadReviews(page: 3);

      fake
        ..gateNextResponse = false
        ..reviews = <AdminReviewItem>[_review(id: 'fresh')]
        ..total = 7;
      await provider.loadReviews();

      fake.failGate(Exception('timeout'));
      await slow;

      expect(provider.listError, isNull);
      expect(provider.reviews.single.id, 'fresh');
      expect(provider.isLoadingList, isFalse);
    });
  });

  group('Выбранный отзыв', () {
    test('исчезнувший из выборки перестаёт быть выбранным', () async {
      fake
        ..reviews = <AdminReviewItem>[_review(), _review(id: 'r2')]
        ..total = 2;
      await provider.loadReviews();
      provider.selectReview('r2');
      expect(provider.selectedReview, isNotNull);

      // Фильтр отсёк выбранный отзыв.
      fake.reviews = <AdminReviewItem>[_review()];
      await provider.loadReviews();

      // Панель, оставшаяся на отсутствующем в списке отзыве, показывала бы
      // то, чего под курсором уже нет.
      expect(provider.selectedReview, isNull);
      // И сам выбор снят: иначе при возврате на прежнюю страницу панель
      // открылась бы сама, без клика.
      expect(provider.selectedId, isNull);
    });
  });
}
