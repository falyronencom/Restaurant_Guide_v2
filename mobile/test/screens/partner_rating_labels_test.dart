import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/establishment_preview_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_statistics_screen.dart';

import '../support/wire_stand.dart';

/// Оценка и цена в кабинете партнёра — теми же словами, что у гостя
/// (`venue_labels.dart`), находки Н2 и Н4 (19.10.2026).
///
///  - Н2: превью карточки рисовало зелёный квадрат «—» и цену «$$», если цену
///    не выбрали; гость в таком случае не видит ни квадрата, ни цены.
///  - Н4: статистика у карточки без отзывов писала среднюю «0,0★» — сервер
///    шлёт `average_rating: 0`; ниже при этом «Пока нет оценок».
void main() {
  group('Н2 — превью карточки в кабинете', () {
    Future<void> pumpPreview(WidgetTester tester, {String? price}) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 900);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: EstablishmentPreviewScreen(
          registrationData: PartnerRegistration(
            name: 'Васильки',
            categories: const ['Ресторан'],
            priceRange: price,
          ),
        ),
      ));
      await tester.pump();
    }

    testWidgets(r'цену не выбрали — ни «$$», ни квадрата «—»', (tester) async {
      await pumpPreview(tester);

      // Предпосылка: превью построено.
      expect(find.text('Васильки'), findsWidgets);
      expect(find.text(r'$$'), findsNothing);
      expect(find.text('—'), findsNothing);
    });

    testWidgets(r'выбрали «$» — «$», как у гостя, без квадрата оценки',
        (tester) async {
      await pumpPreview(tester, price: r'$');

      expect(find.text(r'$'), findsOneWidget);
      expect(find.text(r'$$'), findsNothing);
      expect(find.text('—'), findsNothing);
    });
  });

  group('Н4 — средняя оценка в статистике', () {
    const id = '44444444-4444-4444-8444-444444444444';
    late Map<String, dynamic> row;

    setUp(() {
      row = {
        'id': id,
        'name': 'Васильки',
        'status': 'active',
        'categories': ['Ресторан'],
        'cuisines': ['Народная'],
        'address': 'пр. Независимости, 43',
        'city': 'Минск',
        'view_count': 3,
        'favorite_count': 0,
        'review_count': 0,
        'average_rating': 0,
        'primary_image_url': null,
      };
      installWireStand((options) {
        final path = options.uri.path;
        if (path == '/api/v1/partner/establishments/$id') {
          return jsonBody({
            'success': true,
            'data': {'establishment': row},
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
                  'views': zero,
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
              'views_trend': <dynamic>[],
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

    Future<void> pumpStats(WidgetTester tester) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(390, 1600);
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

    /// Ячейка «Средняя оценка» вверху экрана.
    Finder averageCell() => find
        .ancestor(
          of: find.text('Средняя\nоценка'),
          matching: find.byType(Column),
        )
        .first;

    testWidgets('отзывов нет — «—» без звезды, не «0,0★»', (tester) async {
      await pumpStats(tester);

      // Предпосылка: экран загрузился, и это место без оценок.
      expect(find.text('Пока нет оценок'), findsOneWidget);
      expect(find.text('0,0'), findsNothing);
      expect(
          find.descendant(of: averageCell(), matching: find.text('—')),
          findsOneWidget);
      expect(
          find.descendant(of: averageCell(), matching: find.byIcon(Icons.star)),
          findsNothing);
    });

    testWidgets('оценки есть — «4,5★» вверху и «4,5» в разделе оценок',
        (tester) async {
      row = {
        ...row,
        'review_count': 2,
        'average_rating': 4.5,
        'rating_distribution': {'5': 1, '4': 1},
      };
      await pumpStats(tester);

      expect(
          find.descendant(of: averageCell(), matching: find.text('4,5')),
          findsOneWidget);
      expect(
          find.descendant(of: averageCell(), matching: find.byIcon(Icons.star)),
          findsOneWidget);
      expect(find.text('4,5'), findsNWidgets(2));
      expect(find.text('Пока нет оценок'), findsNothing);
    });
  });
}
