import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/auth/login_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/method_selection_screen.dart';

import '../support/wire_stand.dart';

/// Вход успешен без сервера: экран смотрит только на результат `login`.
class _Auth extends AuthProvider {
  bool signedIn = false;

  @override
  bool get isAuthenticated => signedIn;

  @override
  Future<bool> login({
    required String emailOrPhone,
    required String password,
  }) async {
    signedIn = true;
    return true;
  }

  int googleCalls = 0;
  int yandexCalls = 0;

  /// Ответ сервисов входа: `false` — сервис отказал.
  bool socialResult = true;

  @override
  Future<bool> loginWithGoogle() async {
    googleCalls++;
    if (socialResult) signedIn = true;
    return socialResult;
  }

  @override
  Future<bool> loginWithYandex() async {
    yandexCalls++;
    if (socialResult) signedIn = true;
    return socialResult;
  }
}

_Auth _auth(WidgetTester tester) => Provider.of<AuthProvider>(
      tester.element(find.byType(MaterialApp)),
      listen: false,
    ) as _Auth;

/// Главный экран-заглушка; считает, сколько раз его создавали заново.
class _Home extends StatefulWidget {
  const _Home();
  static int created = 0;

  @override
  State<_Home> createState() => _HomeState();
}

class _HomeState extends State<_Home> {
  @override
  void initState() {
    super.initState();
    _Home.created++;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: TextButton(
            onPressed: () => Navigator.of(context).pushNamed('/auth/login'),
            child: const Text('Главный экран'),
          ),
        ),
      );
}

/// Первый запуск гостем: заставка открывает «Регистрацию» корнем стека.
/// Найдено 10.10.2026 на Galaxy A72: «Уже есть профиль? → Войти», вход
/// проходит — и приложение возвращается на «Регистрацию», а «Назад» там
/// закрывает приложение.
void main() {
  setUp(() {
    installWireStand((_) => jsonBody({'success': false}, status: 404));
    _Home.created = 0;
  });

  Future<void> pumpApp(WidgetTester tester, {required String start}) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 900);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>(
      create: (_) => _Auth(),
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        // Как заставка: стек сбрасывается на стартовый экран.
        home: Builder(builder: (context) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            Navigator.of(context).pushNamedAndRemoveUntil(start, (_) => false);
          });
          return const SizedBox();
        }),
        routes: {
          '/home': (_) => const _Home(),
          '/auth/method-selection': (_) => const MethodSelectionScreen(),
          '/auth/login': (_) => const LoginScreen(),
          '/establishment/1': (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () =>
                        Navigator.of(context).pushNamed('/auth/login'),
                    child: const Text('Карточка заведения'),
                  ),
                ),
              ),
        },
      ),
    ));
    await tester.pumpAndSettle();
  }

  Future<void> signIn(WidgetTester tester) async {
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'guest@example.com');
    await tester.enterText(fields.at(1), 'Secret123!');
    final submit = find.widgetWithText(ElevatedButton, 'Войти');
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    await tester.pumpAndSettle();
  }

  NavigatorState rootNavigator(WidgetTester tester) =>
      tester.state<NavigatorState>(find.byType(Navigator).first);

  testWidgets('вход с «Регистрации» первого запуска ведёт на главный экран',
      (tester) async {
    await pumpApp(tester, start: '/auth/method-selection');
    await tester.tap(find.text('Войти'));
    await tester.pumpAndSettle();
    expect(find.byType(LoginScreen), findsOneWidget);

    await signIn(tester);

    expect(find.text('Главный экран'), findsOneWidget);
    expect(find.byType(MethodSelectionScreen), findsNothing);
    expect(rootNavigator(tester).canPop(), isFalse,
        reason: '«Назад» с главного экрана не должен вернуть «Регистрацию»');
  });

  testWidgets('вход с главного экрана возвращает на тот же главный экран',
      (tester) async {
    await pumpApp(tester, start: '/home');
    await tester.tap(find.text('Главный экран'));
    await tester.pumpAndSettle();

    await signIn(tester);

    expect(find.text('Главный экран'), findsOneWidget);
    expect(_Home.created, 1,
        reason: 'главный экран не пересоздаётся — '
            'вкладка «Профиль», с которой пришли на вход, остаётся открытой');
  });

  testWidgets('вход из карточки заведения возвращает в карточку — к брони',
      (tester) async {
    await pumpApp(tester, start: '/home');
    rootNavigator(tester).pushNamed('/establishment/1');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Карточка заведения'));
    await tester.pumpAndSettle();

    await signIn(tester);

    expect(find.text('Карточка заведения'), findsOneWidget);
    expect(rootNavigator(tester).canPop(), isTrue,
        reason: 'под карточкой остался главный экран');
  });

  testWidgets(
      'системное «Назад» на «Регистрации» первого запуска — '
      'на главный экран, а не выход', (tester) async {
    await pumpApp(tester, start: '/auth/method-selection');

    final handled = await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(handled, isTrue,
        reason: 'необработанное «Назад» закрыло бы приложение');
    expect(find.text('Главный экран'), findsOneWidget);
  });

  testWidgets('«Регистрация», открытая со «Входа», — обычный шаг назад',
      (tester) async {
    await pumpApp(tester, start: '/auth/login');
    await tester.tap(find.byWidgetPredicate((w) =>
        w is RichText && w.text.toPlainText().contains('Еще нету профиля')));
    await tester.pumpAndSettle();
    expect(find.byType(MethodSelectionScreen), findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.text('Главный экран'), findsNothing);
  });

  // Вход через сервисы: каждая кнопка зовёт свой сервис, и успех уводит с
  // экрана входа так же, как вход паролем. До 25.10.2026 кнопки «Продолжить
  // с Google / Яндекс» в наборе только находили: перестановку обработчиков
  // или потерю перехода после успеха не видел ни один тест.
  Future<void> tapSocial(WidgetTester tester, String label) async {
    final button = find.widgetWithText(OutlinedButton, label);
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  for (final (label, google, yandex) in [
    ('Продолжить с Google', 1, 0),
    ('Продолжить с Яндекс', 0, 1),
  ]) {
    testWidgets('«Вход»: «$label» входит через свой сервис и возвращает на '
        'главный экран', (tester) async {
      await pumpApp(tester, start: '/home');
      await tester.tap(find.text('Главный экран'));
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);

      await tapSocial(tester, label);

      final auth = _auth(tester);
      expect([auth.googleCalls, auth.yandexCalls], [google, yandex],
          reason: 'кнопка вызвала не свой сервис входа');
      expect(find.byType(LoginScreen), findsNothing);
      expect(find.text('Главный экран'), findsOneWidget);
      expect(_Home.created, 1);
    });

    testWidgets('«Регистрация» первого запуска: «$label» входит через свой '
        'сервис и ведёт на главный экран', (tester) async {
      await pumpApp(tester, start: '/auth/method-selection');

      await tapSocial(tester, label);

      final auth = _auth(tester);
      expect([auth.googleCalls, auth.yandexCalls], [google, yandex],
          reason: 'кнопка вызвала не свой сервис входа');
      expect(find.byType(MethodSelectionScreen), findsNothing);
      expect(find.text('Главный экран'), findsOneWidget);
      expect(rootNavigator(tester).canPop(), isFalse);
    });
  }

  testWidgets('«Регистрация» первого запуска → «Войти» → «Продолжить с Google» '
      '— на главный экран, «Регистрации» под ним нет', (tester) async {
    // Тот же путь, что у входа паролем выше: стек — одни экраны входа, и
    // уход после успеха обязан заменить их главным, а не просто закрыть
    // «Вход».
    await pumpApp(tester, start: '/auth/method-selection');
    await tester.tap(find.text('Войти'));
    await tester.pumpAndSettle();
    expect(find.byType(LoginScreen), findsOneWidget);

    await tapSocial(tester, 'Продолжить с Google');

    expect(_auth(tester).googleCalls, 1);
    expect(find.text('Главный экран'), findsOneWidget);
    expect(find.byType(MethodSelectionScreen), findsNothing);
    expect(rootNavigator(tester).canPop(), isFalse,
        reason: '«Назад» с главного экрана не должен вернуть «Регистрацию»');
  });

  testWidgets('«Регистрация»: отказ сервиса — плашка на месте, перехода нет',
      (tester) async {
    await pumpApp(tester, start: '/auth/method-selection');
    _auth(tester).socialResult = false;

    await tapSocial(tester, 'Продолжить с Яндекс');

    expect(find.byType(MethodSelectionScreen), findsOneWidget);
    expect(find.text('Главный экран'), findsNothing);
    expect(find.text('Ошибка входа через Яндекс'), findsOneWidget);
  });
}
