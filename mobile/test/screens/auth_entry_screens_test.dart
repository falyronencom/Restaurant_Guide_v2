import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/auth/email_registration_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/login_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/method_selection_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/phone_registration_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/edit_profile_screen.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';
import 'package:restaurant_guide_mobile/widgets/forms/social_sign_in_buttons.dart';

import '../support/wire_stand.dart';

/// Провайдер без сервера: регистрация отказывает текстом [refusal], правка
/// профиля записывает, что ушло бы на сервер.
class _Auth extends AuthProvider {
  static const refusal = 'Этот email уже зарегистрирован. Попробуйте войти.';

  String? _error;
  int registerCalls = 0;
  final List<String?> savedNames = [];
  User? user;

  @override
  String? get errorMessage => _error;

  @override
  User? get currentUser => user;

  @override
  bool get isAuthenticated => user != null;

  @override
  Future<bool> registerWithEmail({
    required String email,
    required String password,
    String? name,
  }) async {
    registerCalls++;
    _error = refusal;
    return false;
  }

  @override
  Future<bool> registerWithPhone({
    required String phone,
    required String password,
    String? name,
  }) async {
    registerCalls++;
    _error = refusal;
    return false;
  }

  @override
  Future<bool> updateProfile({String? name, String? avatarUrl}) async {
    savedNames.add(name);
    return true;
  }
}

/// Экраны входа и регистрации — проход тестировщика 17.10: пп. 2, 43
/// («Пропустить» на первом запуске), 18 («Назад» туда, откуда пришёл),
/// 17 и 37 (один вид, без Apple), 21 (требования к паролю сразу), Х1
/// (регистрация при отказе сервера остаётся на форме), 32 и 49 (правило
/// имени в правке профиля).
void main() {
  late _Auth auth;

  setUp(() {
    installWireStand((_) => jsonBody({'success': false}, status: 404));
    auth = _Auth();
  });

  Future<void> pumpApp(WidgetTester tester, {required String start}) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 900);
    addTearDown(tester.view.reset);

    Widget page(String title, String next) => Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).pushNamed(next),
                child: Text(title),
              ),
            ),
          ),
        );

    await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: Builder(builder: (context) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            Navigator.of(context).pushNamedAndRemoveUntil(start, (_) => false);
          });
          return const SizedBox();
        }),
        routes: {
          '/home': (_) => page('Главный экран', '/auth/login'),
          '/start-email': (_) =>
              page('Начало', '/auth/email-registration'),
          '/start-phone': (_) =>
              page('Начало', '/auth/phone-registration'),
          '/start-profile': (_) => page('Профиль', '/profile/edit'),
          '/auth/method-selection': (_) => const MethodSelectionScreen(),
          '/auth/login': (_) => const LoginScreen(),
          '/auth/email-registration': (_) => const EmailRegistrationScreen(),
          '/auth/phone-registration': (_) => const PhoneRegistrationScreen(),
          '/auth/email-verification': (_) =>
              const Scaffold(body: Text('Ввод кода из письма')),
          '/auth/phone-verification': (_) =>
              const Scaffold(body: Text('Ввод кода из СМС')),
          '/profile/edit': (_) => const EditProfileScreen(),
        },
      ),
    ));
    await tester.pumpAndSettle();
  }

  Future<void> tapText(WidgetTester tester, String text) async {
    final target = find.text(text);
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
    await tester.tap(target);
    await tester.pumpAndSettle();
  }

  group('«Регистрация»: шапка', () {
    testWidgets('первый запуск: «Пропустить» вместо стрелки, ведёт на главный',
        (tester) async {
      await pumpApp(tester, start: '/auth/method-selection');

      expect(find.byIcon(Icons.arrow_back), findsNothing,
          reason: 'назад некуда — стрелки быть не должно');
      expect(find.text('Пропустить'), findsOneWidget);

      await tapText(tester, 'Пропустить');

      expect(find.text('Главный экран'), findsOneWidget);
    });

    testWidgets('первый запуск: системное «Назад» — на главный, не закрывает',
        (tester) async {
      await pumpApp(tester, start: '/auth/method-selection');

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.text('Главный экран'), findsOneWidget);
    });

    testWidgets('открыта со «Входа»: стрелка возвращает на «Вход»',
        (tester) async {
      await pumpApp(tester, start: '/home');
      await tapText(tester, 'Главный экран');
      expect(find.byType(LoginScreen), findsOneWidget);
      final registrationLink = find.byWidgetPredicate((w) =>
          w is RichText && w.text.toPlainText().contains('Еще нету профиля'));
      await tester.ensureVisible(registrationLink);
      await tester.pumpAndSettle();
      await tester.tap(registrationLink);
      await tester.pumpAndSettle();
      expect(find.byType(MethodSelectionScreen), findsOneWidget);
      expect(find.text('Пропустить'), findsNothing,
          reason: 'не первый запуск — есть куда вернуться');

      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();

      expect(find.byType(LoginScreen), findsOneWidget,
          reason: 'п. 18: стрелка вела на «Поиск», сбрасывая стек');
      expect(find.byType(MethodSelectionScreen), findsNothing);
    });
  });

  testWidgets('Apple нет; кнопки сервисов — общий блок на обоих экранах',
      (tester) async {
    await pumpApp(tester, start: '/auth/method-selection');
    expect(find.textContaining('Apple'), findsNothing);
    expect(find.byType(SocialSignInButtons), findsOneWidget);

    await tapText(tester, 'Войти');
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.textContaining('Apple'), findsNothing);
    expect(find.byType(SocialSignInButtons), findsOneWidget);
  });

  group('Регистрация: отказ сервера', () {
    Future<void> fillAndSubmit(WidgetTester tester, String contact) async {
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'Анна');
      await tester.enterText(fields.at(1), contact);
      await tester.enterText(fields.at(2), 'Secret123');
      await tester.enterText(fields.at(3), 'Secret123');
      await tapText(tester, 'Продолжить');
    }

    testWidgets('по почте: остаёмся на форме и видим текст сервера',
        (tester) async {
      await pumpApp(tester, start: '/start-email');
      await tapText(tester, 'Начало');

      await fillAndSubmit(tester, 'taken@example.com');

      expect(auth.registerCalls, 1, reason: 'предусловие: форма отправлена');
      expect(find.text('Ввод кода из письма'), findsNothing,
          reason: 'Х1: при отказе открывался ввод кода от несуществующего письма');
      expect(find.byType(EmailRegistrationScreen), findsOneWidget);
      expect(find.text(_Auth.refusal), findsOneWidget);
    });

    testWidgets('по телефону: остаёмся на форме и видим текст сервера',
        (tester) async {
      await pumpApp(tester, start: '/start-phone');
      await tapText(tester, 'Начало');

      await fillAndSubmit(tester, '+375291234567');

      expect(auth.registerCalls, 1, reason: 'предусловие: форма отправлена');
      expect(find.text('Ввод кода из СМС'), findsNothing);
      expect(find.byType(PhoneRegistrationScreen), findsOneWidget);
      expect(find.text(_Auth.refusal), findsOneWidget);
    });
  });

  testWidgets('требования к паролю видны с пустого поля и отмечаются',
      (tester) async {
    await pumpApp(tester, start: '/start-email');
    await tapText(tester, 'Начало');

    for (final requirement in passwordRequirements) {
      expect(find.text(requirement.label), findsOneWidget,
          reason: 'п. 21: до первого символа требований не было видно');
    }
    expect(find.byIcon(Icons.check_circle), findsNothing);

    await tester.enterText(find.byType(TextFormField).at(2), 'abc1');
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.check_circle), findsNWidgets(2),
        reason: 'строчная и цифра выполнены');
    expect(find.byIcon(Icons.radio_button_unchecked), findsNWidgets(2));
  });

  group('Правка профиля: правило имени', () {
    testWidgets('запятая в имени — отказ под полем, на сервер не уходит',
        (tester) async {
      auth.user = const User(id: 'u-1', email: 'guest@example.com', name: 'Гость');
      await pumpApp(tester, start: '/start-profile');
      await tapText(tester, 'Профиль');

      await tester.enterText(find.byType(TextFormField).first, 'Анна, К.');
      await tapText(tester, 'Сохранить');

      expect(find.text(nameCharactersMessage), findsOneWidget);
      expect(auth.savedNames, isEmpty,
          reason: 'пп. 32, 49: правка пропускала любые знаки');
    });

    testWidgets('апостроф iPhone уходит на сервер прямым', (tester) async {
      auth.user = const User(id: 'u-1', email: 'guest@example.com', name: 'Гость');
      await pumpApp(tester, start: '/start-profile');
      await tapText(tester, 'Профиль');

      await tester.enterText(find.byType(TextFormField).first, ' O’Brien ');
      await tapText(tester, 'Сохранить');

      expect(auth.savedNames, ["O'Brien"]);
    });
  });
}
