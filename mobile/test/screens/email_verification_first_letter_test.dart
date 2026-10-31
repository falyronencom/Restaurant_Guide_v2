import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/auth/email_registration_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/email_verification_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/profile_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Код из первого письма работает (сводка находок, группа Б, 30.10.2026).
///
/// Было: после регистрации приложение сразу открывало главный экран, а
/// «Профиль» → «Подтвердить email» слал новое письмо — и код письма
/// регистрации гас: человек вводил его и видел «Неверный код». Стало: после
/// регистрации — экран кода с «Позже»; кнопка в профиле только открывает
/// экран; новое письмо — только по «Прислать код повторно», и двойное
/// нажатие шлёт одно.
///
/// Поверх настоящих `AuthProvider`, `AuthService` и `ApiClient`: подменён
/// только провод — тест видит, какие запросы ушли.
void main() {
  const sendCodePath = '/api/v1/auth/send-verification-code';
  const resendLabel = 'Прислать код повторно';

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
  });

  test('слова экрана — утверждены Координатором 30.10.2026 дословно', () {
    expect(EmailVerificationScreen.codeLetterHint,
        'Код подтверждения приходит письмом на вашу почту.');
    expect(EmailVerificationScreen.laterHint,
        'Подтвердить почту можно потом в профиле.');
  });

  int sendCodeCalls(StubAdapter wire) =>
      wire.requests.where((r) => r.uri.path == sendCodePath).length;

  /// Кнопка повтора — и с отсчётом в подписи («…через 00:12»), и без него.
  TextButton resendButton(WidgetTester tester) => tester.widget<TextButton>(
      find.ancestor(
          of: find.textContaining(resendLabel),
          matching: find.byType(TextButton)));

  group('после регистрации по почте', () {
    /// Сервер регистрации: ключи входа и учётка — как `authController`
    /// (поля `email_verified` в ответе нет; [verified] — на случай, если
    /// почта уже подтверждена).
    StubAdapter server({bool verified = false}) =>
        installWireStand((options) {
          final path = options.uri.path;
          if (path == '/api/v1/auth/register') {
            return jsonBody({
              'success': true,
              'data': {
                'user': {
                  'id': 'u-1',
                  'email': 'anna@example.com',
                  'name': 'Анна',
                  'role': 'user',
                  'authMethod': 'email',
                  if (verified) 'email_verified': true,
                },
                'accessToken': 'access',
                'refreshToken': 'refresh',
                'tokenType': 'Bearer',
                'expiresIn': 900,
              },
            }, status: 201);
          }
          if (path == sendCodePath) {
            return jsonBody({
              'success': true,
              'data': {'sent': true},
            });
          }
          return jsonBody({'success': false}, status: 404);
        });

    /// Гость на «Начале» → форма регистрации → «Продолжить».
    Future<void> register(WidgetTester tester) async {
      installSecureStorageStand();
      final auth = (await tester.runAsync(() async {
        final provider = AuthProvider();
        for (var i = 0; i < 200 && provider.isLoading; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 5));
        }
        return provider;
      }))!;
      addTearDown(auth.dispose);

      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 900);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
        value: auth,
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => Navigator.of(context)
                      .pushNamed('/auth/email-registration'),
                  child: const Text('Начало'),
                ),
              ),
            ),
          ),
          routes: {
            '/home': (_) => const Scaffold(body: Text('Главный экран')),
            '/auth/email-registration': (_) =>
                const EmailRegistrationScreen(),
            '/auth/email-verification': (_) =>
                const EmailVerificationScreen(),
          },
        ),
      ));
      await tester.tap(find.text('Начало'));
      await tester.pumpAndSettle();

      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'Анна');
      await tester.enterText(fields.at(1), 'anna@example.com');
      await tester.enterText(fields.at(2), 'Secret123');
      await tester.enterText(fields.at(3), 'Secret123');
      final submit = find.text('Продолжить');
      await tester.ensureVisible(submit);
      await tester.pumpAndSettle();
      await tester.tap(submit);
      // Не pumpAndSettle: на экране кода тикает отсчёт до повтора, и
      // «устояться» он даст только через 12 секунд.
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(auth.isAuthenticated, isTrue, reason: 'предусловие: вошёл');
    }

    testWidgets('сразу экран кода, с отсчётом до повтора и без нового письма',
        (tester) async {
      final wire = server();
      await register(tester);

      expect(find.byType(EmailVerificationScreen), findsOneWidget);
      expect(find.text(EmailVerificationScreen.codeLetterHint), findsOneWidget);
      expect(find.textContaining('через 00:'), findsOneWidget,
          reason: 'письмо регистрации только что ушло — повтор не сразу');
      expect(sendCodeCalls(wire), 0,
          reason: 'новое письмо погасило бы код письма регистрации');
    });

    testWidgets('«Позже» — на главный экран, регистрация позади',
        (tester) async {
      server();
      await register(tester);

      final later = find.text('Позже');
      await tester.ensureVisible(later);
      await tester.pump();
      expect(find.text(EmailVerificationScreen.laterHint), findsOneWidget);
      await tester.tap(later);
      await tester.pumpAndSettle();

      expect(find.text('Главный экран'), findsOneWidget);
      expect(find.byType(EmailVerificationScreen), findsNothing);
      expect(find.byType(EmailRegistrationScreen), findsNothing);
      expect(find.text('Начало'), findsNothing);
    });

    testWidgets('«назад» — тоже на главный, не на форму регистрации',
        (tester) async {
      server();
      await register(tester);

      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();

      expect(find.text('Главный экран'), findsOneWidget);
      expect(find.byType(EmailRegistrationScreen), findsNothing);
    });

    testWidgets('почта уже подтверждена — сразу главный, экрана кода нет',
        (tester) async {
      server(verified: true);
      await register(tester);
      await tester.pumpAndSettle();

      expect(find.text('Главный экран'), findsOneWidget);
      expect(find.byType(EmailVerificationScreen), findsNothing);
    });
  });

  group('«Профиль» → «Подтвердить email»', () {
    StubAdapter server() => installWireStand((options) {
          final path = options.uri.path;
          if (path == '/api/v1/auth/me') {
            return jsonBody({
              'success': true,
              'data': {
                'user': {
                  'id': 'u-1',
                  'email': 'anna@example.com',
                  'name': 'Анна',
                  'authMethod': 'email',
                  'email_verified': false,
                },
              },
            });
          }
          if (path == sendCodePath) {
            return jsonBody({
              'success': true,
              'data': {'sent': true},
            });
          }
          return jsonBody({'success': false}, status: 404);
        });

    /// Вошедший на «личном кабинете» (экран поверх профиля).
    Future<void> openCabinet(WidgetTester tester) async {
      installSecureStorageStand({
        'access_token': 'valid',
        'refresh_token': 'alive',
      });
      final auth = (await tester.runAsync(() async {
        final provider = AuthProvider();
        for (var i = 0;
            i < 200 && (provider.isLoading || !provider.isAuthenticated);
            i++) {
          await Future<void>.delayed(const Duration(milliseconds: 5));
        }
        return provider;
      }))!;
      addTearDown(auth.dispose);
      expect(auth.isAuthenticated, isTrue, reason: 'предусловие: вошёл');

      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(400, 900);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider(create: (_) => PartnerDashboardProvider()),
          ChangeNotifierProvider(create: (_) => NotificationProvider()),
          ChangeNotifierProvider(create: (_) => EstablishmentsProvider()),
          ChangeNotifierProvider(create: (_) => BookingProvider()),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const ProfileScreen(),
          routes: {
            '/auth/email-verification': (_) =>
                const EmailVerificationScreen(),
          },
        ),
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Анна').first);
      await tester.pumpAndSettle();
      expect(find.text('Подтвердить email'), findsOneWidget,
          reason: 'предусловие: личный кабинет, почта не подтверждена');
    }

    testWidgets('открывает экран кода без нового письма; повтор — сразу',
        (tester) async {
      final wire = server();
      await openCabinet(tester);

      await tester.tap(find.text('Подтвердить email'));
      await tester.pumpAndSettle();

      expect(find.byType(EmailVerificationScreen), findsOneWidget);
      expect(sendCodeCalls(wire), 0,
          reason: 'письмо из профиля гасило код письма регистрации');
      expect(find.textContaining('через 00:'), findsNothing,
          reason: 'письма не было — ждать перед повтором нечего');
      expect(resendButton(tester).onPressed, isNotNull);

      // Новое письмо — только по «Прислать код повторно».
      await tester.tap(find.text(resendLabel));
      await tester.pumpAndSettle();
      expect(sendCodeCalls(wire), 1);
    });

    testWidgets('двойное нажатие — один экран кода, не два друг над другом',
        (tester) async {
      server();
      await openCabinet(tester);

      // Второе нажатие — сразу за первым. Прежде между ними шёл запрос
      // письма, и каждое нажатие открывало свой экран; теперь экран
      // открывается сразу, и второе касание до кнопки не доходит.
      await tester.tap(find.text('Подтвердить email'));
      await tester.tap(find.text('Подтвердить email'), warnIfMissed: false);
      await tester.pumpAndSettle();

      expect(find.byType(EmailVerificationScreen), findsOneWidget);

      // Второе нажатие — через долю секунды, пока экран кода ещё въезжает.
      await tester.tap(find.byIcon(Icons.arrow_back).last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Подтвердить email'));
      await tester.pump(const Duration(milliseconds: 150));
      await tester.tap(find.text('Подтвердить email'), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(find.byType(EmailVerificationScreen), findsOneWidget,
          reason: 'нажатие во время въезда экрана открыло второй');

      // Закрыл экран — кнопка снова открывает его.
      await tester.tap(find.byIcon(Icons.arrow_back).last);
      await tester.pumpAndSettle();
      expect(find.byType(EmailVerificationScreen), findsNothing);
      await tester.tap(find.text('Подтвердить email'));
      await tester.pumpAndSettle();
      expect(find.byType(EmailVerificationScreen), findsOneWidget);
    });
  });

  testWidgets('«Прислать код повторно» дважды подряд — один запрос, одно письмо',
      (tester) async {
    final wire = installWireStand((options) {
      final path = options.uri.path;
      if (path == '/api/v1/auth/me') {
        return jsonBody({
          'success': true,
          'data': {
            'user': {
              'id': 'u-1',
              'email': 'anna@example.com',
              'name': 'Анна',
              'authMethod': 'email',
            },
          },
        });
      }
      if (path == sendCodePath) {
        return jsonBody({
          'success': true,
          'data': {'sent': true},
        });
      }
      return jsonBody({'success': false}, status: 404);
    });
    installSecureStorageStand({
      'access_token': 'valid',
      'refresh_token': 'alive',
    });
    final auth = (await tester.runAsync(() async {
      final provider = AuthProvider();
      for (var i = 0;
          i < 200 && (provider.isLoading || !provider.isAuthenticated);
          i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      return provider;
    }))!;
    addTearDown(auth.dispose);

    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 900);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const EmailVerificationScreen(),
      ),
    ));
    await tester.pump();

    // Два нажатия в одном кадре: кнопка ещё не перерисована выключенной.
    await tester.tap(find.text(resendLabel));
    await tester.tap(find.text(resendLabel));
    await tester.pumpAndSettle();

    expect(sendCodeCalls(wire), 1,
        reason: 'два письма с разными кодами — код одного из них «неверный»');
    expect(find.text('Код отправлен повторно'), findsOneWidget);
  });
}
