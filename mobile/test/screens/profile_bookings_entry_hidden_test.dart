import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/profile_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Вход задаётся признаком и пользователем: экран профиля больше ничего
/// у провайдера не спрашивает.
class _SignedIn extends AuthProvider {
  @override
  bool get isAuthenticated => true;

  @override
  User? get currentUser =>
      const User(id: 'u-1', name: 'Иван', email: 'ivan@example.com');
}

/// «Мои бронирования» скрыты, пока брони не включены (решение Координатора
/// В6, 17.10.2026). Сверка документов с продуктом 01.11.2026 (П6): строка
/// была видна любому вошедшему на экране «Показать профиль» и вела к броням,
/// которых у гостя быть не может.
void main() {
  setUp(() {
    AccountScope.debugReset();
    // Отзывы пользователя и кабинет партнёра экран грузит сам — провод
    // подставной, отказ любого запроса экрану не мешает.
    installWireStand((_) => jsonBody(<String, dynamic>{}, status: 404));
  });

  testWidgets('вошедший пользователь не видит «Мои бронирования»',
      (tester) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(create: (_) => _SignedIn()),
          ChangeNotifierProvider(create: (_) => PartnerDashboardProvider()),
          ChangeNotifierProvider(create: (_) => NotificationProvider()),
          ChangeNotifierProvider(create: (_) => BookingProvider()),
          ChangeNotifierProvider(create: (_) => EstablishmentsProvider()),
        ],
        child: const MaterialApp(home: ProfileScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Иван'));
    await tester.pumpAndSettle();

    // Экран «Показать профиль» открыт: соседняя строка на месте.
    expect(find.text('Мои данные'), findsOneWidget);
    expect(find.text('Мои бронирования'), findsNothing);
  });
}
