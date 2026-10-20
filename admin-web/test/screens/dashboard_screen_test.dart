import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/providers/dashboard_provider.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';
import 'package:restaurant_guide_admin_web/screens/dashboard/dashboard_screen.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';
import 'package:restaurant_guide_admin_web/widgets/dashboard/attention_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';

/// Подставной сервис — руками, без mockito.
///
/// Ответы держатся на `Completer`, а не на готовых значениях: загрузку нужно
/// уметь остановить на середине, иначе скелетон не увидеть — он живёт ровно
/// столько, сколько летит запрос.
class _FakeAnalyticsService implements AnalyticsService {
  Completer<OverviewData> overview = Completer<OverviewData>();
  Completer<UsersAnalyticsData> users = Completer<UsersAnalyticsData>();

  int overviewCalls = 0;
  String? lastPeriod;

  @override
  Future<OverviewData> getOverview({
    String period = '30d',
    String? from,
    String? to,
  }) {
    overviewCalls++;
    lastPeriod = period;
    return overview.future;
  }

  @override
  Future<UsersAnalyticsData> getUsersAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) =>
      users.future;

  // Дашборд этих двух не зовёт. Если позовёт — тест обязан упасть, а не
  // молча получить пустоту.
  @override
  Future<EstablishmentsAnalyticsData> getEstablishmentsAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) =>
      throw UnimplementedError('дашборд не запрашивает заведения');

  @override
  Future<ReviewsAnalyticsData> getReviewsAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) =>
      throw UnimplementedError('дашборд не запрашивает отзывы');
}

OverviewData _overview() => const OverviewData(
      users: OverviewUsers(total: 742, newInPeriod: 96, changePercent: 12.4),
      establishments: OverviewEstablishments(
        total: 140,
        active: 128,
        pending: 3,
        suspended: 9,
        newInPeriod: 11,
        changePercent: -2.3,
      ),
      reviews: OverviewReviews(
        total: 906,
        newInPeriod: 74,
        changePercent: 4.0,
        averageRating: 4.4,
      ),
      moderation: OverviewModeration(pendingCount: 5, actionsInPeriod: 23),
    );

UsersAnalyticsData _users({List<TimelinePoint>? timeline}) =>
    UsersAnalyticsData(
      registrationTimeline: timeline ??
          const [
            TimelinePoint(date: '2026-08-01', count: 12),
            TimelinePoint(date: '2026-08-02', count: 19),
            TimelinePoint(date: '2026-08-03', count: 7),
          ],
      roleDistribution: const [],
      total: 742,
      newInPeriod: 96,
      changePercent: 12.4,
      aggregation: 'day',
    );

/// Счётчики очередей в этих тестах не участвуют — сеть трогать незачем.
class _IdleBadgesProvider extends BadgesProvider {
  @override
  Future<void> load() async {}
}

/// Снимок здоровья данных подаётся готовым: строку «Сигналов здоровья данных»
/// считает клиент, и сеть для этого не нужна. `null` — снимок ещё не пришёл.
class _StubHealthProvider extends QualityHealthProvider {
  final QualityHealthData? _seed;

  _StubHealthProvider(this._seed);

  @override
  QualityHealthData? get data => _seed;

  @override
  Future<void> load({bool force = false}) async {}
}

QualityHealthData _health({
  int unreachable = 0,
  int hangingFlags = 0,
  int emptyMenus = 0,
}) =>
    QualityHealthData(
      scope: 'active',
      generatedAt: '2026-08-27T09:41:00.000Z',
      unreachableCount: unreachable,
      categoryOffCanonCount: 0,
      cuisineOffCanonCount: 0,
      emptyMenusCount: emptyMenus,
      ocrFailedCount: 0,
      ocrStuckCount: 0,
      outOfBoundsCount: 0,
      hoursMalformedCount: 0,
      hoursAllClosedCount: 0,
      attributeKeys: const <AttributeKeyCount>[],
      nonObjectAttributesCount: 0,
      hangingFlagsCount: hangingFlags,
      hangingAgedOver7d: 0,
      hangingAgedOver30d: 0,
      priceDistributionStatus: 'deferred',
    );

void main() {
  /// Поднимает экран на подставном сервисе и отдаёт этот сервис тесту.
  ///
  /// Сервис создаётся отсюда, из вызова внутри теста, а не в `setUp`. Это не
  /// стиль: `Completer` привязывает свой future к зоне, в которой создан, а
  /// `setUp` выполняется вне `FakeAsync`-зоны `testWidgets`. Созданный в
  /// `setUp` `Completer` доставлял бы результат в настоящую зону, и
  /// `tester.pump()` его микрозадачи не разгребал бы — экран навсегда
  /// оставался бы в первичной загрузке.
  ///
  /// Окно 1180x820: раскладка дашборда рассчитана на рабочий стол, в
  /// дефолтные 800x600 ряд метрик и график не помещаются.
  Future<_FakeAnalyticsService> pumpDashboard(
    WidgetTester tester, {
    QualityHealthData? health,
    double width = 1180,
  }) async {
    final fake = _FakeAnalyticsService();

    tester.view.physicalSize = Size(width, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => DashboardProvider(service: fake)),
          // Панель «Требует внимания» читает счётчики очередей. Здесь они не
          // нужны: провайдер отдаёт null, и панель показывает только те
          // строки, что собираются из overview.
          ChangeNotifierProvider<BadgesProvider>(
            create: (_) => _IdleBadgesProvider(),
          ),
          ChangeNotifierProvider<QualityHealthProvider>(
            create: (_) => _StubHealthProvider(health),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: DashboardScreen()),
        ),
      ),
    );
    // Загрузка стартует из postFrameCallback — один кадр, чтобы она ушла.
    await tester.pump();

    return fake;
  }

  /// Доводит экран до состояния, в которое его привёл завершённый запрос.
  ///
  /// Кадра нужно два, и это не перестраховка. Первый разгребает микрозадачи:
  /// `Future.wait` в провайдере отдаёт результат и зовёт `notifyListeners`,
  /// но происходит это уже после того, как кадр построен. Второй кадр —
  /// собственно перерисовка. На одном `pump` провайдер уже в новом
  /// состоянии, а дерево всё ещё показывает скелетон.
  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    // fl_chart анимирует появление линии — 300 мс с запасом.
    await tester.pump(const Duration(milliseconds: 300));
  }

  testWidgets('первичная загрузка: скелетон вместо содержимого',
      (tester) async {
    final fake = await pumpDashboard(tester);

    expect(fake.overviewCalls, 1);
    expect(fake.lastPeriod, '30d');
    expect(find.byType(SkeletonBlock), findsWidgets);
    expect(find.byType(MetricCard), findsNothing);
    expect(find.byType(AdminErrorCard), findsNothing);
    // Шапка в скелетон не входит: она уже нарисована и мигать ей незачем.
    expect(find.text('Панель управления'), findsOneWidget);
  });

  testWidgets('ошибка загрузки: AdminErrorCard с человеческой причиной',
      (tester) async {
    final fake = await pumpDashboard(tester);

    fake.overview.completeError(DioException(requestOptions: RequestOptions(path: '/'), type: DioExceptionType.connectionTimeout));
    // Future.wait ждёт все ветки, а не только упавшую: пока вторая висит,
    // ошибка до провайдера не доходит.
    fake.users.complete(_users());
    await settle(tester);

    expect(find.byType(AdminErrorCard), findsOneWidget);
    expect(find.text('Обзор не загрузился'), findsOneWidget);
    expect(find.text(kTimeoutPhrase), findsOneWidget);
    expect(find.byType(SkeletonBlock), findsNothing);
    expect(find.byType(MetricCard), findsNothing);
  });

  testWidgets('повтор из карточки ошибки уходит в сервис заново',
      (tester) async {
    final fake = await pumpDashboard(tester);

    fake.overview.completeError(Exception('boom'));
    fake.users.complete(_users());
    await settle(tester);

    fake.overview = Completer<OverviewData>();
    fake.users = Completer<UsersAnalyticsData>();

    await tester.tap(find.text('Повторить'));
    await settle(tester);

    expect(fake.overviewCalls, 2);
    // Повтор возвращает экран в загрузку, а не оставляет карточку ошибки.
    expect(find.byType(AdminErrorCard), findsNothing);
    expect(find.byType(SkeletonBlock), findsWidgets);
  });

  testWidgets('успех: четыре метрики, график и панель внимания',
      (tester) async {
    final fake = await pumpDashboard(tester);

    fake.overview.complete(_overview());
    fake.users.complete(_users());
    await settle(tester);

    expect(find.byType(SkeletonBlock), findsNothing);
    expect(find.byType(AdminErrorCard), findsNothing);

    expect(find.byType(MetricCard), findsNWidgets(4));
    expect(find.text('ПОЛЬЗОВАТЕЛИ'), findsOneWidget);
    expect(find.text('742'), findsOneWidget);
    // Процента на плитках нет (решение Координатора 20.10, В): под итогом —
    // «+N за период», процент живёт в аналитике у числа новых.
    expect(find.textContaining('%'), findsNothing);
    expect(find.text('+96 за период'), findsOneWidget);
    // «Активные заведения» — то же слово, что в аналитике у того же числа (Ч3).
    expect(find.text('АКТИВНЫЕ ЗАВЕДЕНИЯ'), findsOneWidget);
    expect(find.text('128'), findsOneWidget);
    expect(find.text('+11 за период'), findsOneWidget);
    expect(find.text('906'), findsOneWidget);
    expect(find.text('+74 за период · средняя 4,4'), findsOneWidget);

    // Карточка «Модерация» и строка панели показывают одну очередь.
    expect(find.text('5'), findsNWidgets(2));
    expect(find.text('в очереди'), findsOneWidget);
    expect(find.text('23 решения за период'), findsOneWidget);
    // Легенда графика — по шагу столбца, а не всегда «за день».
    expect(find.text('новые в день'), findsOneWidget);

    expect(find.text('Регистрации пользователей'), findsOneWidget);
    expect(find.text('Требует внимания'), findsOneWidget);
  });

  testWidgets('пустой график: содержимое на месте, вместо линии — подпись',
      (tester) async {
    final fake = await pumpDashboard(tester);

    fake.overview.complete(_overview());
    fake.users.complete(_users(timeline: const []));
    await settle(tester);

    // Пусто именно в графике: метрики и панель остаются на месте.
    expect(find.byType(MetricCard), findsNWidgets(4));
    expect(
      find.text('За выбранный период регистраций не было'),
      findsOneWidget,
    );
  });

  // Окна 1024 и 1150 телом, без рейла 260 (решение А; Chrome с панелью).
  group('Узкое окно', () {
    for (final window in <double>[1024, 1150]) {
      testWidgets('окно ${window.toInt()}: ни подписи, ни числа не обрезаны',
          (tester) async {
        final fake = await pumpDashboard(
          tester,
          width: window - 260,
          health: _health(unreachable: 3, hangingFlags: 12),
        );
        fake.overview.complete(_overview());
        fake.users.complete(_users());
        await settle(tester);

        expect(tester.takeException(), isNull);
        final clipped = tester
            .renderObjectList<RenderParagraph>(find.descendant(
              of: find.byType(MetricCard),
              matching: find.byType(RichText),
            ))
            .where((p) => p.didExceedMaxLines)
            .map((p) => p.text.toPlainText())
            .toList();
        expect(clipped, isEmpty);
        // Панель «Требует внимания» рядом с графиком, а график не полоска.
        final chart = tester.getRect(find.text('Регистрации пользователей'));
        final attention = tester.getRect(find.text('Требует внимания'));
        expect(attention.left, greaterThan(chart.left + 300));
      });
    }
  });

  group('строка «Сигналов здоровья данных»', () {
    testWidgets('считает красные проверки и называет все по канону',
        (tester) async {
      // Недостижимых три, флагов двенадцать. Подпись называет ОБЕ красные
      // проверки в каноническом порядке: прежде она брала одну первую, и
      // главная молчала об «Ошибках распознавания 5» (Ч7).
      final fake = await pumpDashboard(
        tester,
        health: _health(unreachable: 3, hangingFlags: 12),
      );
      fake.overview.complete(_overview());
      fake.users.complete(_users());
      await settle(tester);

      expect(find.text('Сигналов здоровья данных'), findsOneWidget);
      expect(
        find.text('3 заведения без страницы на сайте · 12 флагов без реакции'),
        findsOneWidget,
      );
    });

    testWidgets('первая красная меняется вместе с данными', (tester) async {
      // Обратный расклад: недостижимых нет, флаги есть. Подпись обязана
      // переехать — иначе она сторожила бы не порядок, а один вход.
      final fake = await pumpDashboard(
        tester,
        health: _health(hangingFlags: 12, emptyMenus: 5),
      );
      fake.overview.complete(_overview());
      fake.users.complete(_users());
      await settle(tester);

      expect(
        find.text('12 флагов без реакции · 5 заведений с пустым меню'),
        findsOneWidget,
      );
    });

    testWidgets('снимок ещё не пришёл — строки нет вовсе, а не ноль',
        (tester) async {
      // Ноль в этой строке читается как «проверено, чисто». Пока снимка нет,
      // проверено ничего.
      final fake = await pumpDashboard(tester);
      fake.overview.complete(_overview());
      fake.users.complete(_users());
      await settle(tester);

      expect(find.text('Сигналов здоровья данных'), findsNothing);
      expect(find.text('Заявок на модерации'), findsOneWidget);
    });

    testWidgets('всё чисто — ноль без подписи, зелёным', (tester) async {
      final fake = await pumpDashboard(tester, health: _health());
      fake.overview.complete(_overview());
      fake.users.complete(_users());
      await settle(tester);

      final row = tester.widget<AttentionPanel>(find.byType(AttentionPanel));
      final health = row.items
          .firstWhere((i) => i.title == 'Сигналов здоровья данных');
      expect(health.count, 0);
      expect(health.note, isNull);
      // Тон запрошен красный, но ноль всегда читается как «разобрано».
      expect(health.effectiveTone, AttentionTone.clear);
    });

    testWidgets('подпись помещается в панель 320 без обрезки', (tester) async {
      // Панель узкая, подпись длинная, а `Text` в ней стоит с
      // `overflow: ellipsis` — то есть слишком длинная строка не сломает
      // вёрстку, она молча превратится в многоточие. Мерим фактическую
      // раскладку, а не смотрим глазами.
      //
      // Шрифт в тестах — Ahem, у него каждый глиф в полную ширину кегля, то
      // есть строка ЗАВЕДОМО шире настоящей. Уложились под Ahem — уложимся и
      // в бою; обратное неверно, и потому граница здесь с запасом.
      final fake = await pumpDashboard(
        tester,
        health: _health(hangingFlags: 12),
      );
      fake.overview.complete(_overview());
      fake.users.complete(_users());
      await settle(tester);

      final paragraph = tester.renderObject<RenderParagraph>(
        find.text('12 флагов без реакции'),
      );
      expect(
        paragraph.didExceedMaxLines,
        isFalse,
        reason: 'подпись строки 3 не должна уезжать в многоточие',
      );
    });
  });

  testWidgets(
      'сбой смены периода: тост «Обзор не обновился» и честная подпись',
      (tester) async {
    // До 20.10 сегмент подсвечивал «7 дней», подпись говорила «сравнение с
    // предыдущими 7 днями», а числа оставались за 30 — без единого слова
    // (пункт A3-02).
    final fake = await pumpDashboard(tester);
    fake.overview.complete(_overview());
    fake.users.complete(_users());
    await settle(tester);
    expect(find.byType(MetricCard), findsWidgets, reason: 'предпосылка');

    fake
      ..overview = Completer<OverviewData>()
      ..users = Completer<UsersAnalyticsData>();
    await tester.tap(find.text('7 дней'));
    await tester.pump();
    fake.overview.completeError(DioException(
        requestOptions: RequestOptions(path: '/'),
        type: DioExceptionType.connectionError));
    fake.users.complete(_users());
    await settle(tester);
    await tester.pump();

    expect(find.byType(AdminErrorToast), findsOneWidget);
    expect(find.text('Обзор не обновился'), findsOneWidget);
    expect(
        find.text('$kNoConnectionPhrase На экране остались числа за прежний '
            'период.'),
        findsOneWidget);
    expect(
        find.text('Обзор платформы · сравнение с предыдущими 30 днями '
            '· не удалось обновить'),
        findsOneWidget,
        reason: 'подпись описывает числа на экране, а не выбор');
    expect(find.text('Обзор платформы · сравнение с предыдущими 7 днями'),
        findsNothing);
    expect(find.byType(MetricCard), findsWidgets,
        reason: 'прежние числа не стираются — их подписали честно');
  });
}
