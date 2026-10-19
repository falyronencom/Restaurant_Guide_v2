import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Заголовки разделов карточки при крупном системном шрифте (Н9, 19.10.2026).
///
/// Заголовки «Описание» и «Отзывы» — 30 пт в строке рядом со стрелкой и
/// счётчиком отзывов. При шрифте ×2 на 390 dp строка не помещалась —
/// переполнение на 23–85 dp (найдено тестом PR #84, было и на `main`), край
/// заголовка срезался. Теперь кегль заголовка подбирается по ширине, как у
/// названия (`AdaptiveTitle`, одна строка): строка не переполняется, слово
/// целое.
const _id = '66666666-6666-4666-8666-666666666666';

class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> refreshUserLocationSilently() async => false;
}

class _Guest extends AuthProvider {
  @override
  bool get isAuthenticated => false;
}

void main() {
  for (final width in [360.0, 390.0]) {
    for (final scale in [1.0, 2.0, 3.1]) {
      testWidgets('$width dp, шрифт ×$scale: заголовки разделов без '
          'переполнения', (tester) async {
        final row = establishmentRow(id: _id)
          ..['primary_image_url'] = null
          ..['latitude'] = null
          ..['longitude'] = null;
        installWireStand((options) {
          final path = options.uri.path;
          if (path == '/api/v1/search/establishments/$_id') {
            return jsonBody({'success': true, 'data': row});
          }
          if (path == '/api/v1/establishments/$_id/reviews') {
            return jsonBody(
                reviewsEnvelope(reviews: [reviewRow()], total: 24));
          }
          return jsonBody({'success': false}, status: 404);
        });
        tester.view.devicePixelRatio = 1.0;
        tester.view.physicalSize = Size(width, 900);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.view.reset);
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

        // Все отказы раскладки за прогон — не только первый.
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

        // Предпосылка: оба раздела построены — описание и отзывы пришли.
        expect(find.text('Описание'), findsOneWidget);
        expect(find.text('Отзывы'), findsOneWidget);

        // Раскладка всей длинной карточки — прокруткой до низа.
        await tester.dragUntilVisible(find.text('Отзывы'),
            find.byType(Scrollable).first, const Offset(0, -300));
        await tester.pumpAndSettle();

        FlutterError.onError = previous;
        expect(overflows, isEmpty);
        // Заголовок целиком в пределах экрана.
        for (final title in ['Описание', 'Отзывы']) {
          final rect = tester.getRect(find.text(title));
          expect(rect.right, lessThanOrEqualTo(width), reason: title);
          // Слово целиком — кегль уменьшается, а не обрывается многоточием.
          final paragraph =
              tester.renderObject<RenderParagraph>(find.text(title));
          expect(paragraph.didExceedMaxLines, isFalse,
              reason: '$title оборван многоточием');
        }
        // При обычном шрифте — как в макете: счётчик справа, в строке
        // заголовка, а не под ним.
        if (scale == 1.0) {
          final header = tester.getRect(find.text('Отзывы'));
          final counter = tester.getRect(find.text('24 отзыва'));
          expect(counter.center.dy, inInclusiveRange(header.top, header.bottom));
          expect(counter.left, greaterThan(header.right));
          expect(counter.right, greaterThan(width - 16 - 30));
        }
      });
    }
  }
}
