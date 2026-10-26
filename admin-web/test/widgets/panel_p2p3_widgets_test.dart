import 'dart:convert';
import 'dart:io';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:restaurant_guide_admin_web/config/audit_change_text.dart';
import 'package:restaurant_guide_admin_web/config/quality_signals.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_badges.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/services/badges_service.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/canon_bar_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/chart_scale.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/share_bar.dart';

// Проход по панели модератора, 20.10, пакеты П2+П3: виджеты и словари,
// которые общие у главной, аналитики, журнала и «Здоровья данных».

Future<void> _pump(WidgetTester tester, Widget child,
    {double width = 500}) async {
  tester.view.physicalSize = Size(width, 600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.lightTheme,
    home: Scaffold(body: Center(child: SizedBox(width: width, child: child))),
  ));
}

class _CountingBadgesService implements BadgesService {
  int calls = 0;

  @override
  Future<AdminBadges> getBadges() async {
    calls++;
    return AdminBadges.fromJson(const <String, dynamic>{
      'pending': 1,
      'menu_flags': 2,
      'menu_flags_aged_over_7d': 0,
    });
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('Графики: столбцы, подсказка с датой, без дёрганья', () {
    const week = <TimelinePoint>[
      TimelinePoint(date: '2026-10-13', count: 3),
      TimelinePoint(date: '2026-10-20', count: 5),
    ];

    testWidgets('«по дням» — столбцы, а не линия (Р6в)', (tester) async {
      await _pump(
        tester,
        const SizedBox(
          height: 200,
          child: CanonBarChart(data: <TimelinePoint>[
            TimelinePoint(date: '2026-10-01', count: 2),
            TimelinePoint(date: '2026-10-02', count: 5),
          ]),
        ),
      );
      expect(find.byType(BarChart), findsOneWidget);
      expect(find.byType(LineChart), findsNothing);
    });

    testWidgets('подсказка: дата столбца и число словами, на плашке с рамкой',
        (tester) async {
      await _pump(
        tester,
        const SizedBox(
          height: 200,
          child: CanonBarChart(data: week, aggregation: 'week'),
        ),
      );
      final chart = tester.widget<BarChart>(find.byType(BarChart));
      final tooltip = chart.data.barTouchData.touchTooltipData;
      final rod = BarChartRodData(toY: 0);
      final group = BarChartGroupData(x: 0, barRods: <BarChartRodData>[rod]);

      expect(tooltip.getTooltipItem(group, 0, rod, 0)?.text,
          '13 — 19 октября\n3 регистрации');
      expect(tooltip.tooltipBorder.color, AppTheme.strokeGrey);
      expect(tooltip.fitInsideHorizontally, isTrue);
      expect(tooltip.fitInsideVertically, isTrue);
    });

    testWidgets('наведение ловит всю колонку, анимации подмены нет (К-2, F-14)',
        (tester) async {
      await _pump(
        tester,
        const SizedBox(height: 200, child: CanonBarChart(data: week)),
      );
      final chart = tester.widget<BarChart>(find.byType(BarChart));

      expect(chart.duration, Duration.zero);
      expect(chart.data.barTouchData.allowTouchBarBackDraw, isTrue);
      final rod = chart.data.barGroups.first.barRods.first;
      expect(rod.backDrawRodData.show, isTrue);
      expect(rod.backDrawRodData.toY, chart.data.maxY);
    });

    test('подпись столбца — по шагу (A3-15, Ч6)', () {
      expect(perBucketLabel('day'), 'в день');
      expect(perBucketLabel('week'), 'в неделю');
      expect(perBucketLabel('month'), 'в месяц');
      expect(bucketLabel('2026-10-14', 'day'), '14 октября');
      expect(bucketLabel('2026-09-29', 'week'), '29 сентября — 5 октября');
      expect(bucketLabel('2026-10-01', 'month'), 'октябрь 2026');
    });

    test('подписи оси не слипаются: на подпись — от 48 пикселей (Ч5)', () {
      // 90 дней — 13 недельных столбцов на графике шириной 380.
      final stride = labelStride(13, 380);
      final labels = (13 / stride).ceil();
      expect(380 / labels, greaterThanOrEqualTo(48));
      // Широкий график недели не прореживает.
      expect(labelStride(7, 900), 1);
    });
  });

  testWidgets('полоса долей рисуется: у отрезков есть высота (F-17)',
      (tester) async {
    await _pump(
      tester,
      const ShareBar(segments: <ShareSegment>[
        ShareSegment(color: Colors.green, value: 3),
        ShareSegment(color: Colors.red, value: 1),
      ]),
    );
    final boxes = tester.widgetList<DecoratedBox>(find.descendant(
      of: find.byType(ShareBar),
      matching: find.byType(DecoratedBox),
    ));
    expect(boxes, isNotEmpty);
    for (final box in find
        .descendant(
            of: find.byType(ShareBar), matching: find.byType(DecoratedBox))
        .evaluate()) {
      expect((box.renderObject! as RenderBox).size.height, ShareBar.height);
    }
  });

  testWidgets('«Период»: окно посреди экрана и «Применить» (Ч8)',
      (tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      locale: const Locale('ru'),
      supportedLocales: const <Locale>[Locale('ru')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: Scaffold(
        body: PeriodSelector(currentPeriod: '30d', onPeriodChanged: (_) {}),
      ),
    ));

    await tester.tap(find.text('Период'));
    await tester.pumpAndSettle();

    expect(find.text('Применить'), findsOneWidget);
    expect(find.text('Сохранить'), findsNothing);
    final picker = tester.getSize(find.byType(DateRangePickerDialog));
    expect(picker.width, lessThanOrEqualTo(420));
    expect(picker.height, lessThanOrEqualTo(620));
  });

  group('Счётчики меню слева живут (A3-21, F-20)', () {
    testWidgets('обновляются сами по таймеру', (tester) async {
      // Поддельное время `testWidgets`, а не настоящее: на настоящих 75 мс
      // под нагрузкой машины таймер успевал сработать один раз, и тест
      // краснел без всякой поломки (25.10.2026, прогоны мутаций).
      final service = _CountingBadgesService();
      final badges = BadgesProvider(service: service);
      addTearDown(badges.dispose);
      badges.startAutoRefresh(every: const Duration(milliseconds: 20));
      await tester.pump(const Duration(milliseconds: 75));
      badges.stopAutoRefresh();

      // 20, 40 и 60 мс — три срабатывания; после остановки — ни одного.
      expect(service.calls, 3);
      await tester.pump(const Duration(milliseconds: 100));
      expect(service.calls, 3);
    });

    test('при переходе — свежие, если нынешние старше 15 секунд', () async {
      final service = _CountingBadgesService();
      var now = DateTime(2026, 10, 21, 12);
      final badges = BadgesProvider(service: service)..clock = () => now;

      await badges.load();
      await badges.refreshIfOlderThan(BadgesProvider.refreshOnNavigationAfter);
      expect(service.calls, 1, reason: 'свежие — второй запрос не нужен');

      now = now.add(const Duration(seconds: 16));
      await badges.refreshIfOlderThan(BadgesProvider.refreshOnNavigationAfter);
      expect(service.calls, 2);
    });
  });

  group('Расшифровка записи журнала', () {
    test('каждый ключ, который пишет сервер, переведён', () {
      final json = jsonDecode(
        File('../backend/src/constants/auditLogActions.json')
            .readAsStringSync(),
      ) as Map<String, dynamic>;
      final fields = (json['fields'] as List<dynamic>).cast<String>();

      expect(fields, isNotEmpty);
      final missing = fields
          .where((f) =>
              !kAuditFieldLabels.containsKey(f) &&
              !kAuditHiddenFields.contains(f))
          .toList();
      expect(missing, isEmpty);
      for (final label in kAuditFieldLabels.values) {
        expect(label.replaceAll('E-mail', '').replaceAll('Google', ''),
            isNot(contains(RegExp(r'[A-Za-z]'))),
            reason: 'подпись поля латиницей: $label');
      }
    });

    test('пакетное скрытие (П7): «в пачке из N», id пачки не на экране', () {
      final lines = describeAuditChange(
        <String, dynamic>{'is_visible': true},
        <String, dynamic>{
          'is_visible': false,
          'reason': 'тестовые отзывы',
          'batch_id': '5d1f0000-0000-4000-8000-000000000000',
          'batch_size': 3,
        },
      ).map((l) => l.toString()).toList();

      expect(lines, <String>[
        'Виден в приложении: да → нет',
        'Причина: тестовые отзывы',
        'В пачке: 3 отзыва',
      ]);
    });

    test('значения — словами', () {
      final lines = describeAuditChange(
        <String, dynamic>{'status': 'pending', 'is_active': true},
        <String, dynamic>{
          'status': 'rejected',
          'is_active': false,
          'hidden_review_ids': <String>['a', 'b', 'c'],
          'actor': 'operator_script:change-account-email',
        },
      ).map((l) => l.toString()).toList();

      expect(lines, <String>[
        'Статус: на модерации → отклонена',
        'Учётная запись: включена → отключена',
        'Скрыто отзывов: 3',
        'Кто действовал: скрипт оператора (change-account-email)',
      ]);
    });
  });

  group('«Здоровье данных» по-русски (Ч39, К-5)', () {
    test('названия и подписи проверок — без жаргона и латиницы', () {
      const jargon = <String>['sitemap', 'канон', 'битый', 'OCR', 'не объект'];
      for (final signal in kQualitySignals) {
        final texts = <String>[
          signal.title,
          signal.subtitle,
          signal.cleanLabel,
          signal.note(2),
        ];
        for (final text in texts) {
          expect(
              text.replaceAll('PDF', ''), isNot(contains(RegExp(r'[A-Za-z]'))),
              reason: '${signal.id}: латиница в «$text»');
          for (final word in jargon) {
            expect(text.toLowerCase(), isNot(contains(word.toLowerCase())),
                reason: '${signal.id}: «$word» в «$text»');
          }
        }
      }
    });

    test('«Флаги без реакции» ведут к позициям меню (К-6)', () {
      final flags = kQualitySignals.firstWhere((s) => s.id == 'hanging_flags');
      expect(flags.listRoute, '/moderation/menu-items');
    });
  });

  testWidgets('переход между страницами без просвечивания (Р6б, F-30)',
      (tester) async {
    final router = GoRouter(routes: <RouteBase>[
      GoRoute(path: '/', builder: (_, __) => const Text('страница А')),
      GoRoute(path: '/b', builder: (_, __) => const Text('страница Б')),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(
      MaterialApp.router(theme: AppTheme.lightTheme, routerConfig: router),
    );

    router.go('/b');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    // Посреди прежнего перехода новая страница стояла под затуханием или
    // сдвигом — обе были видны полупрозрачными одна сквозь другую.
    for (final type in <Type>[FadeTransition, SlideTransition, ScaleTransition]) {
      expect(
        find.ancestor(of: find.text('страница Б'), matching: find.byType(type)),
        findsNothing,
        reason: 'у новой страницы переход $type',
      );
    }
  });
}
