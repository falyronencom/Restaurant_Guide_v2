import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/widgets/average_check_line.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Карточка заведения пишет средний чек словами, как сайт: «Средний чек: до
/// 50 руб» под часами работы; значки «$$» остаются под квадратом оценки, где
/// места на слова нет (слово Координатора 29.10.2026).
const _id = '77777777-7777-4777-8777-777777777777';

class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> refreshUserLocationSilently() async => false;
}

class _Guest extends AuthProvider {
  @override
  bool get isAuthenticated => false;
}

void main() {
  for (final (width, scale) in [(390.0, 1.0), (320.0, 2.0), (320.0, 3.1)]) {
    testWidgets('$width dp, шрифт ×$scale: «Средний чек: до 50 руб» без '
        'переполнения', (tester) async {
      final row = establishmentRow(id: _id)
        ..['price_range'] = r'$$'
        ..['primary_image_url'] = null
        ..['latitude'] = null
        ..['longitude'] = null;
      installWireStand((options) {
        final path = options.uri.path;
        if (path == '/api/v1/search/establishments/$_id') {
          return jsonBody({'success': true, 'data': row});
        }
        if (path == '/api/v1/establishments/$_id/reviews') {
          return jsonBody(reviewsEnvelope(reviews: [reviewRow()], total: 1));
        }
        return jsonBody({'success': false}, status: 404);
      });
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = Size(width, 900);
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      final overflows = <String>[];
      final previous = FlutterError.onError;
      FlutterError.onError = (details) {
        final text = details.exceptionAsString();
        if (text.contains('overflowed')) {
          overflows.add(text.split('\n').first);
        } else {
          previous?.call(details);
        }
      };
      addTearDown(() => FlutterError.onError = previous);

      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(create: (_) => _Guest()),
          ChangeNotifierProvider<EstablishmentsProvider>(
              create: (_) => _NoLocation()),
          ChangeNotifierProvider<BookingProvider>(
              create: (_) => BookingProvider()),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const EstablishmentDetailScreen(establishmentId: _id),
        ),
      ));
      await tester.pumpAndSettle();

      final line = find.byKey(AverageCheckLine.lineKey);
      await tester.dragUntilVisible(
          line, find.byType(Scrollable).first, const Offset(0, -300));
      await tester.pumpAndSettle();

      FlutterError.onError = previous;
      expect(overflows, isEmpty);
      expect(find.text('Средний чек: до 50 руб', findRichText: true),
          findsOneWidget);
      expect(tester.getRect(line).right, lessThanOrEqualTo(width - 16));
      // Под квадратом оценки — по-прежнему значки: слова туда не помещаются.
      expect(find.text(r'$$'), findsOneWidget);
    });
  }
}
