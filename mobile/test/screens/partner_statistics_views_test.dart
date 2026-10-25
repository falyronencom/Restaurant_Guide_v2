import 'package:cached_network_image/cached_network_image.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_statistics_screen.dart';

import '../support/wire_stand.dart';

/// Кабинет → Статистика, найдено 10.10.2026 на Galaxy A72:
///  - в режимах «1 месяц» и «3 месяца» даты под графиком сливались
///    («29.0930.0902.10») — подписывался каждый день с данными;
///  - в режиме «1 неделя» стояли рядом «Просмотры −100 %», число 10 и пустой
///    график: число было «за всё время», процент — к прошлой неделе, график —
///    за неделю.
void main() {
  const id = '33333333-3333-4333-8333-333333333333';
  const totalViews = 10; // establishments.view_count — за всё время

  late int allTimeViews;
  late Map<String, dynamic> overviewViews;
  late List<Map<String, dynamic>> viewsTrend;
  late StubAdapter wire;
  String? primaryImage;

  /// Ряд по дням, заканчивая вчерашним 10.10: [counts] по порядку.
  List<Map<String, dynamic>> daily(List<int> counts) {
    final last = DateTime.utc(2026, 10, 10);
    return [
      for (var i = 0; i < counts.length; i++)
        {
          'date': last
              .subtract(Duration(days: counts.length - 1 - i))
              .toIso8601String()
              .substring(0, 10),
          'count': counts[i],
        },
    ];
  }

  setUp(() {
    allTimeViews = totalViews;
    primaryImage = null;
    overviewViews = {
      'total': totalViews,
      'in_period': 0,
      'change_percent': -100
    };
    viewsTrend = daily(List.filled(7, 0));
    wire = installWireStand((options) {
      final path = options.uri.path;
      if (path == '/api/v1/partner/establishments/$id') {
        return jsonBody({
          'success': true,
          'data': {
            'establishment': {
              'id': id,
              'name': 'Васильки',
              'status': 'active',
              'categories': ['Ресторан'],
              'cuisines': ['Народная'],
              'address': 'пр. Независимости, 43',
              'city': 'Минск',
              'view_count': allTimeViews,
              'favorite_count': 1,
              'review_count': 0,
              'average_rating': 0,
              'primary_image_url': primaryImage,
            },
          },
        });
      }
      if (path == '/api/v1/partner/analytics/overview') {
        const zero = {'total': 0, 'in_period': 0, 'change_percent': null};
        return jsonBody({
          'success': true,
          'data': {
            'establishments': [
              {
                'establishment_id': id,
                'establishment_name': 'Васильки',
                'period': {'aggregation': 'day'},
                'views': overviewViews,
                'favorites': zero,
                'calls': zero,
                'reviews': {...zero, 'average_rating': 0},
              },
            ],
          },
        });
      }
      if (path == '/api/v1/partner/analytics/trends') {
        return jsonBody({
          'success': true,
          'data': {
            'views_trend': viewsTrend,
            'favorites_trend': <dynamic>[],
            'calls_trend': <dynamic>[],
            'reviews_trend': <dynamic>[],
            'aggregation': 'day',
          },
        });
      }
      return jsonBody({'success': false}, status: 404);
    });
  });

  Future<void> pumpStats(WidgetTester tester, {double width = 360}) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = Size(width, 900);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ChangeNotifierProvider(
      create: (_) => PartnerDashboardProvider(),
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const PartnerStatisticsScreen(establishmentId: id),
      ),
    ));
    await tester.pumpAndSettle();
  }

  /// Подписи дат под графиком просмотров, слева направо.
  List<Rect> axisLabels(WidgetTester tester) {
    final labels = find.descendant(
      of: find.byType(BarChart),
      matching: find.byWidgetPredicate(
          (w) => w is Text && RegExp(r'^\d\d\.\d\d$').hasMatch(w.data ?? '')),
    );
    return labels
        .evaluate()
        .map((e) => tester.getRect(find.byWidget(e.widget)))
        .toList()
      ..sort((a, b) => a.left.compareTo(b.left));
  }

  group('подписи дат под графиком', () {
    for (final (mode, days) in [('1 месяц', 30), ('3 месяца', 13)]) {
      for (final width in [320.0, 360.0]) {
        testWidgets(
            '$mode, данные каждый день, ширина $width — даты не наезжают',
            (tester) async {
          // Худший случай для прежнего правила: данные в КАЖДОМ дне.
          viewsTrend = daily(List.generate(days, (i) => 1 + i % 4));
          overviewViews = {'total': 200, 'in_period': 75, 'change_percent': 12};
          await pumpStats(tester, width: width);

          final rects = axisLabels(tester);
          expect(rects.length, greaterThanOrEqualTo(3),
              reason: 'подписей почти нет — проверять нечего');
          final touching = <String>[];
          for (var i = 1; i < rects.length; i++) {
            if (rects[i].left < rects[i - 1].right + 2) {
              touching.add('${rects[i - 1]} / ${rects[i]}');
            }
          }
          expect(touching, isEmpty);
          // Сегодняшний край подписан всегда.
          expect(find.text('10.10'), findsOneWidget);
        });
      }
    }

    testWidgets('неделя подписана целиком', (tester) async {
      viewsTrend = daily([1, 2, 3, 4, 5, 6, 7]);
      await pumpStats(tester);

      expect(axisLabels(tester), hasLength(7));
    });
  });

  group('число, процент и график — за один период', () {
    testWidgets('за неделю 0 просмотров: число 0, «всего 10», графика нет',
        (tester) async {
      await pumpStats(tester);

      final views = find
          .ancestor(
            of: find.text('Просмотры'),
            matching: find.byType(Padding),
          )
          .first;
      Iterable<String> texts() => find
          .descendant(of: views, matching: find.byType(Text))
          .evaluate()
          .map((e) => (e.widget as Text).data ?? '');

      expect(texts(), contains('0'), reason: 'число — за период');
      expect(texts(), isNot(contains('$totalViews')),
          reason: 'итог за всё время не выдаётся за число периода');
      expect(texts(), contains('за период · всего $totalViews'));
      expect(texts(), contains('-100%'));
      expect(find.text('Нет данных за выбранный период'), findsOneWidget);
      expect(find.byType(BarChart), findsNothing);
    });

    testWidgets('за месяц 10 из 25 за всё время: крупно 10, как столбики',
        (tester) async {
      // Итог за всё время ОТЛИЧАЕТСЯ от периода — иначе проверка числа
      // прошла бы и на прежнем экране, показывавшем итог.
      allTimeViews = 25;
      viewsTrend = daily([
        ...List.filled(26, 0),
        3,
        0,
        5,
        2,
      ]);
      overviewViews = {'total': 25, 'in_period': 10, 'change_percent': null};
      await pumpStats(tester);

      // Предпосылка: сервер считает число и столбики по одной таблице и
      // одному окну — в данных стенда их сумма та же, что in_period.
      final chart = tester.widget<BarChart>(find.byType(BarChart));
      final sum = chart.data.barGroups
          .map((g) => g.barRods.single.toY)
          .fold<double>(0, (a, b) => a + b);
      expect(sum, 10);

      expect(find.text('10'), findsOneWidget);
      expect(find.text('25'), findsNothing);
      expect(find.text('за период · всего 25'), findsOneWidget);
    });
  });

  // Стенд отвечает на любой период одинаково и `period` не читает, поэтому
  // ни один тест выше не видит, что ушло на сервер при смене периода: экран,
  // всегда просящий неделю, показывал бы недельные цифры под «1 месяц».
  // Коды — partnerAnalyticsController (`?period=7d|30d|90d`).
  group('выбор периода', () {
    testWidgets('«1 месяц» и «3 месяца» уходят в запросы своими кодами',
        (tester) async {
      List<String?> periods(String path) => wire.requests
          .where((r) => r.uri.path == path)
          .map((r) => r.uri.queryParameters['period'])
          .toList();

      await pumpStats(tester);
      expect(periods('/api/v1/partner/analytics/overview').last, '7d',
          reason: 'предпосылка: по умолчанию — неделя');

      var current = '1 неделя';
      for (final choice in const {'1 месяц': '30d', '3 месяца': '90d'}.entries) {
        await tester.tap(find.text(current).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text(choice.key).last);
        await tester.pumpAndSettle();
        current = choice.key;

        expect(periods('/api/v1/partner/analytics/overview').last, choice.value,
            reason: '«${choice.key}» — обзор');
        expect(periods('/api/v1/partner/analytics/trends').last, choice.value,
            reason: '«${choice.key}» — график');
      }
    });
  });

  // Фото заведения в карточке — рамка 107 × 116 в несколько раз мельче фото:
  // декодируется под рамку, а не целиком (решение Координатора 25.10.2026,
  // `FrameCachedImage`). Полный размер в кабинете — 1920 × 2560 (≈ 19,7 МБ).
  testWidgets('фото заведения в карточке — ужато под рамку', (tester) async {
    primaryImage = 'https://res.cloudinary.com/davrzdre8/image/upload/'
        'c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/e1/'
        'interior/photo';
    await pumpStats(tester);

    final image =
        tester.widget<CachedNetworkImage>(find.byType(CachedNetworkImage));
    expect(image.imageUrl, primaryImage);
    // Экран ×1: рамка 107 × 116 точек — выше, чем шире, задаётся высота
    // 2 × 107 + 1 (фото 1 : 2 закрывает и ширину).
    expect(image.memCacheWidth, isNull);
    expect(image.memCacheHeight, 215);
  });
}
