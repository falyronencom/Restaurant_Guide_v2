// Basic Flutter widget test for Restaurant Guide Belarus app
// Validates that the application launches successfully

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:restaurant_guide_mobile/main.dart';

void main() {
  testWidgets('App launches successfully smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame
    await tester.pumpWidget(const RestaurantGuideApp());

    // Verify that the app title is displayed
    expect(find.text('Restaurant Guide Belarus'), findsWidgets);

    // Verify that the app launched and rendered without errors
    expect(find.byType(Scaffold), findsOneWidget);
  });
}
