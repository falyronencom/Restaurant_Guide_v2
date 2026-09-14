import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/splash/painters/cockade_painter.dart';
import 'package:restaurant_guide_mobile/screens/splash/splash_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

/// Стенд заставки.
///
/// Заставка — функциональный гейт: она ждёт, пока [AuthProvider] прочитает
/// сохранённую сессию. Стенд поднимает НАСТОЯЩИЙ провайдер поверх фейкового
/// [AuthService], у которого чтение хранилища можно держать открытым
/// ([FakeAuthService.gate]): провайдер честно остаётся «в загрузке», и гейт
/// ждёт по-настоящему, а не по флагу стаба. Маршруты назначения подставные —
/// по ключу видно, куда увела заставка, а настоящие экраны со своими
/// провайдерами и сетью здесь не нужны. Переходы навигатора считаются
/// наблюдателем ([NavigationLog]): «переход один» проверяется числом, а не
/// отсутствием второго стуба.
class FakeAuthService implements AuthService {
  FakeAuthService({this.storedSession = false, this.storedUser});

  /// Есть ли в «хранилище» токены.
  final bool storedSession;

  /// Профиль, который вернёт запрос текущего пользователя.
  final User? storedUser;

  /// Пока не завершён — чтение хранилища не отвечает, провайдер в загрузке.
  Completer<bool>? gate;

  @override
  Future<bool> isAuthenticated() {
    final held = gate;
    if (held != null) return held.future;
    return Future<bool>.value(storedSession);
  }

  @override
  Future<User> getCurrentUser() async {
    final user = storedUser;
    if (user == null) throw Exception('no session');
    return user;
  }

  @override
  Future<void> clearAuthData() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Журнал переходов корневого навигатора: имена маршрутов в порядке push.
/// Первый push — сам `home` (имя `/`).
class NavigationLog extends NavigatorObserver {
  final List<String?> pushes = <String?>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushes.add(route.settings.name);
  }
}

const Key homeStubKey = Key('splash-stand-home');
const Key guestStubKey = Key('splash-stand-guest');
const User stubUser = User(id: 'u-1', email: 'guest@example.com');

class SplashStand {
  SplashStand(this.service, this.auth, this.reduceMotion, this.navigation);

  final FakeAuthService service;
  final AuthProvider auth;

  /// Системная настройка «уменьшить движение» — единственная зависимость
  /// заставки от MediaQuery; переключение на лету даёт ей настоящий
  /// `didChangeDependencies`.
  final ValueNotifier<bool> reduceMotion;

  final NavigationLog navigation;

  /// Отпускает хранилище: провайдер дочитывает сессию и выходит из загрузки
  /// (после `tester.pump(...)` — продолжение идёт микрозадачами).
  void release() => service.gate?.complete(service.storedSession);
}

/// Общий `setUp` тестов заставки: шины и кэши аккаунта в исходном состоянии,
/// шрифты только вшитые.
void resetSplashStand() {
  SessionEvents.debugReset();
  AccountScope.debugReset();
  GoogleFonts.config.allowRuntimeFetching = false;
}

/// Поднимает заставку под `MaterialApp` с подставными маршрутами.
///
/// [held] — держать чтение хранилища (сессия «ещё грузится»);
/// [authenticated] — в хранилище живая сессия, профиль отвечает;
/// [reduceMotion] — начальное значение системной настройки «уменьшить
/// движение» (дальше переключается через [SplashStand.reduceMotion]).
Future<SplashStand> pumpSplash(
  WidgetTester tester, {
  bool held = true,
  bool authenticated = false,
  bool reduceMotion = false,
}) async {
  final service = FakeAuthService(
    storedSession: authenticated,
    storedUser: authenticated ? stubUser : null,
  );
  if (held) service.gate = Completer<bool>();
  final auth = AuthProvider(authService: service);
  // Дерево к моменту tearDown уже размонтировано (flutter_test делает это
  // в конце тела теста), слушатель заставки снят — провайдер можно гасить.
  addTearDown(auth.dispose);
  final reduce = ValueNotifier<bool>(reduceMotion);
  addTearDown(reduce.dispose);
  final navigation = NavigationLog();

  await tester.pumpWidget(
    ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        builder: (context, child) => ValueListenableBuilder<bool>(
          valueListenable: reduce,
          builder: (context, rm, _) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: rm),
            child: child!,
          ),
        ),
        navigatorObservers: [navigation],
        home: const SplashScreen(),
        routes: {
          '/home': (_) => const SizedBox(key: homeStubKey),
          '/auth/method-selection': (_) => const SizedBox(key: guestStubKey),
        },
      ),
    ),
  );
  return SplashStand(service, auth, reduce, navigation);
}

/// Painter знака в текущем кадре — его поля и есть «что нарисовано».
CockadePainter cockadeOf(WidgetTester tester) {
  final paint = tester.widget<CustomPaint>(
    find.byWidgetPredicate(
      (w) => w is CustomPaint && w.painter is CockadePainter,
    ),
  );
  return paint.painter! as CockadePainter;
}
