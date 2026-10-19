import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/delete_account_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/my_data_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/profile_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// «Мои данные» (бриф В1, 18.10.2026): «Профиль» → «Показать профиль» →
/// «Мои данные» — имя, способ входа, почта или телефон, «Уведомления» и
/// «Удалить учётку».
class _SignedIn extends AuthProvider {
  _SignedIn(this._user);

  final User _user;

  @override
  bool get isAuthenticated => true;

  @override
  User? get currentUser => _user;
}

class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> refreshUserLocationSilently() async => false;
}

void main() {
  setUp(() {
    AccountScope.debugReset();
    installWireStand((options) {
      if (options.uri.path == '/api/v1/users/u-1/reviews') {
        return jsonBody({
          'success': true,
          'data': {
            'reviews': <dynamic>[],
            'pagination': {'page': 1, 'limit': 20, 'total': 0, 'pages': 0},
          },
        });
      }
      if (options.uri.path == '/api/v1/auth/account/deletion') {
        return jsonBody({'success': true, 'data': {'allowed': true, 'refusal': null}});
      }
      return jsonBody({'success': false}, status: 404);
    }, accessToken: 'valid');
  });

  Widget appWith(User user, Widget home) => MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>(create: (_) => _SignedIn(user)),
          ChangeNotifierProvider<EstablishmentsProvider>(create: (_) => _NoLocation()),
          ChangeNotifierProvider(create: (_) => PartnerDashboardProvider()),
          ChangeNotifierProvider(create: (_) => NotificationProvider()),
          ChangeNotifierProvider(create: (_) => BookingProvider()),
        ],
        child: MaterialApp(home: home),
      );

  Future<void> tall(WidgetTester tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(420, 2000);
    addTearDown(tester.view.reset);
  }

  testWidgets('вход из «Показать профиль»: строка «Мои данные» открывает экран', (tester) async {
    await tall(tester);
    await tester.pumpWidget(appWith(
      const User(id: 'u-1', name: 'Иван Тестов', authMethod: 'google'),
      const ProfileScreen(),
    ));
    await tester.pump();
    await tester.tap(find.text('Показать профиль'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('profile-my-data-entry')));
    await tester.pumpAndSettle();

    expect(find.byType(MyDataScreen), findsOneWidget);
    expect(find.text('Мои данные'), findsWidgets);
  });

  testWidgets('вход по почте: имя, «Почта» как способ, адрес; телефона нет', (tester) async {
    await tall(tester);
    await tester.pumpWidget(appWith(
      const User(id: 'u-1', name: 'Иван Тестов', email: 'ivan@example.com', authMethod: 'email'),
      const MyDataScreen(),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Иван Тестов'), findsOneWidget);
    expect(find.text('Способ входа'), findsOneWidget);
    expect(find.text('ivan@example.com'), findsOneWidget);
    expect(find.text('Телефон'), findsNothing);
    // «Почта» — и подпись строки адреса, и способ входа.
    expect(find.text('Почта'), findsNWidgets(2));
    expect(find.text('Уведомления'), findsOneWidget);
    expect(find.text('Удалить учётку'), findsOneWidget);
  });

  testWidgets('вход по телефону: «Телефон» как способ и номер', (tester) async {
    await tall(tester);
    await tester.pumpWidget(appWith(
      const User(id: 'u-1', name: 'Анна', phone: '+375291234567', authMethod: 'phone'),
      const MyDataScreen(),
    ));
    await tester.pumpAndSettle();

    expect(find.text('+375291234567'), findsOneWidget);
    expect(find.text('Телефон'), findsNWidgets(2));
    expect(find.text('Почта'), findsNothing);
  });

  test('способ входа словами экрана; незнакомый — без строки', () {
    expect(MyDataScreen.authMethodLabel('email'), 'Почта');
    expect(MyDataScreen.authMethodLabel('phone'), 'Телефон');
    expect(MyDataScreen.authMethodLabel('google'), 'Google');
    expect(MyDataScreen.authMethodLabel('yandex'), 'Яндекс');
    expect(MyDataScreen.authMethodLabel('apple'), isNull);
    expect(MyDataScreen.authMethodLabel(null), isNull);
  });

  testWidgets('«Удалить учётку» открывает экран удаления; партнёру — с черновиками', (tester) async {
    await tall(tester);
    await tester.pumpWidget(appWith(
      const User(
        id: 'u-1', name: 'Партнёр', email: 'p@example.com', role: 'partner', authMethod: 'google',
      ),
      const MyDataScreen(),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Google'), findsOneWidget);

    await tester.tap(find.byKey(const Key('my-data-delete-account')));
    await tester.pumpAndSettle();

    final screen = tester.widget<DeleteAccountScreen>(find.byType(DeleteAccountScreen));
    expect(screen.mentionDrafts, isTrue);
    expect(find.text('Что удалится'), findsOneWidget);
  });
}
