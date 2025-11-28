// Basic Flutter widget test for Restaurant Guide Belarus app
// Validates that the application launches successfully with navigation

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:restaurant_guide_mobile/main.dart';

void main() {
  testWidgets('App launches successfully with navigation', (WidgetTester tester) async {
    // Build our app and trigger a frame
    await tester.pumpWidget(const RestaurantGuideApp());

    // Wait for app to settle
    await tester.pumpAndSettle();

    // Verify that bottom navigation bar is displayed
    expect(find.byType(BottomNavigationBar), findsOneWidget);

    // Verify that all 5 navigation tabs are present
    expect(find.text('Поиск'), findsOneWidget);
    expect(find.text('Новости'), findsOneWidget);
    expect(find.text('Карта'), findsOneWidget);
    expect(find.text('Избранное'), findsOneWidget);
    expect(find.text('Профиль'), findsOneWidget);

    // Verify that the app launched and rendered without errors
    expect(find.byType(Scaffold), findsWidgets);
  });

  testWidgets('Tab switching works', (WidgetTester tester) async {
    // Build our app
    await tester.pumpWidget(const RestaurantGuideApp());
    await tester.pumpAndSettle();

    // Tap on News tab
    await tester.tap(find.text('Новости'));
    await tester.pumpAndSettle();

    // Verify news screen is displayed
    expect(find.text('Новости и акции'), findsOneWidget);

    // Tap on Profile tab
    await tester.tap(find.text('Профиль'));
    await tester.pumpAndSettle();

    // Verify profile screen is displayed
    expect(find.text('Профиль пользователя'), findsOneWidget);
  });
}
