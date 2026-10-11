import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Что приложение знает о push на этом телефоне.
enum PushState {
  /// Регистрации не было: гость или вход ещё не случился.
  idle,

  /// Регистрация идёт.
  registering,

  /// Сервер принял адрес телефона, уведомления разрешены.
  registered,

  /// Сервер принял адрес телефона, но уведомления запрещены в настройках
  /// телефона: появятся, как только человек их разрешит.
  denied,

  /// Регистрация не удалась; почему — [PushStatus.problem].
  failed,
}

/// Почему push на этом телефоне не работают.
enum PushProblem {
  /// Firebase не поднялся при запуске приложения.
  firebaseUnavailable,

  /// iPhone: Apple не выдал телефону адрес для push. Без него Firebase свой
  /// адрес не выдаёт. Так бывает, когда сборка подписана без права push
  /// (`aps-environment`).
  appleAddressMissing,

  /// Firebase не выдал адрес телефона: нет связи с сервисами Google, или
  /// энергосбережение не пускает приложение в сеть.
  addressUnavailable,

  /// Наш сервер не принял адрес.
  serverRejected,
}

/// Состояние push на этом телефоне — для строки в «Настройках уведомлений».
@immutable
class PushStatus {
  const PushStatus(this.state, {this.problem});

  final PushState state;

  /// Только для [PushState.failed].
  final PushProblem? problem;

  @override
  bool operator ==(Object other) =>
      other is PushStatus && other.state == state && other.problem == problem;

  @override
  int get hashCode => Object.hash(state, problem);
}

/// Регистрация адреса телефона для push и разводка входящих push.
///
/// **Когда регистрироваться.** При каждом входе, каким бы путём он ни
/// случился, — это решает главный экран, который слушает авторизацию
/// (`main_navigation.dart`). До 08.10.2026 адрес уходил только на первом
/// кадре главного экрана, если человек к этому моменту уже вошёл: вход из
/// «Профиля», «Избранного» или карточки возвращал на уже открытую главную,
/// и адрес не уходил до полного перезапуска приложения.
///
/// **Сбои не молчат.** Каждый исход регистрации виден в [status], а оттуда —
/// строкой в «Настройках уведомлений». До 08.10.2026 все сбои на этом пути
/// уходили только в отладочный журнал. С июля 2026 ни один телефон не
/// присылал серверу адрес, и снаружи это не было видно.
///
/// К Firebase сервис обращается только внутри регистрации и только если
/// Firebase поднялся. Иначе выход из аккаунта падал бы на создании сервиса:
/// «Выйти» зовёт [deregisterToken] до выхода.
class PushNotificationService {
  static final PushNotificationService _instance =
      PushNotificationService._internal();
  factory PushNotificationService() => _instance;
  PushNotificationService._internal();

  final ApiClient _apiClient = ApiClient();

  /// Сколько раз спросить у Apple его адрес и с каким шагом.
  ///
  /// Apple выдаёт адрес асинхронно, обычно в первую секунду после запуска.
  /// Firebase же на iPhone отказывает в своём адресе, пока адреса Apple нет
  /// (`apns-token-not-set`), — поэтому сначала ждём адрес Apple.
  static const int _appleAddressAttempts = 10;
  static const Duration _appleAddressInterval = Duration(seconds: 1);

  /// Сколько выход из аккаунта ждёт идущую регистрацию, прежде чем отвязать
  /// адрес: дольше выход не задерживается, даже если сеть зависла.
  static const Duration _deregisterWait = Duration(seconds: 5);

  /// Состояние push на этом телефоне.
  final ValueNotifier<PushStatus> status =
      ValueNotifier(const PushStatus(PushState.idle));

  /// Адрес, полученный от Firebase последним.
  String? _currentToken;

  /// Адрес, который принял сервер для текущего аккаунта.
  String? _sentToken;

  /// Есть вошедший аккаунт, к которому привязывать адрес.
  bool _accountBound = false;

  bool _messagingWired = false;
  Future<void>? _running;
  bool _rerun = false;
  Object? _firebaseInitError;

  /// Push пришёл, пока приложение открыто, — задаёт главный экран.
  void Function(RemoteMessage)? onForegroundMessage;

  /// Нажатие на push (приложение было в фоне или закрыто) — задаёт главный
  /// экран.
  void Function(RemoteMessage)? onMessageTap;

  bool get _isApple => defaultTargetPlatform == TargetPlatform.iOS;

  /// Firebase не поднялся при запуске (`main.dart`). Push на этом телефоне
  /// не будет; человек увидит это в настройках уведомлений после входа.
  void reportFirebaseInitFailure(Object error) {
    _firebaseInitError = error;
    debugPrint('Push: Firebase не запустился, push на этом телефоне не будет: '
        '$error');
  }

  /// Регистрирует адрес этого телефона на сервере для вошедшего аккаунта.
  ///
  /// Зовётся при каждом входе, при смене аккаунта, по кнопке «Повторить»,
  /// при возврате в приложение после сбоя и при смене адреса в Firebase.
  /// Вызов во время идущей регистрации не теряется и не множит запросы:
  /// по её окончании регистрация повторяется один раз.
  Future<void> registerDevice() {
    _accountBound = true;
    final running = _running;
    if (running != null) {
      _rerun = true;
      return running;
    }
    return _running = _registerLoop();
  }

  /// Возврат приложения на экран.
  ///
  /// Сорвавшаяся регистрация повторяется. При запуске сети могло не быть:
  /// метро, страница входа Wi-Fi или энергосбережение, которое не пускает
  /// приложение в сеть, пока оно не на экране (A72, 08.10.2026). До
  /// следующего входа приложение больше не пробовало бы.
  ///
  /// Разрешение на уведомления перечитывается без нового запроса: человек мог
  /// включить уведомления в настройках телефона по подсказке из строки
  /// состояния — или выключить их там. Адрес сервер уже принял, повторно
  /// его слать незачем.
  void refreshOnResume() {
    if (!_accountBound) return;
    switch (status.value.state) {
      case PushState.failed:
        unawaited(registerDevice());
      case PushState.registered:
      case PushState.denied:
        unawaited(_recheckPermission());
      case PushState.idle:
      case PushState.registering:
        break;
    }
  }

  /// Аккаунт вышел: сам, по истечении сессии или перед входом в другой.
  /// Адрес больше ни к кому не привязан, строка состояния пустая.
  void onSignedOut() {
    _accountBound = false;
    _sentToken = null;
    status.value = const PushStatus(PushState.idle);
  }

  /// Отвязать адрес телефона от аккаунта на сервере — перед выходом, пока
  /// сессия ещё действует. Не бросает: выход из аккаунта не должен зависеть
  /// ни от сети, ни от Firebase.
  Future<void> deregisterToken() async {
    // Сначала отвязать, потом дождаться идущей регистрации. Иначе она
    // отправила бы адрес уже после выхода — с ключом сессии, который до
    // конца выхода ещё лежит в хранилище, — и push прежнего аккаунта
    // продолжали бы приходить на этот телефон.
    _accountBound = false;
    final running = _running;
    if (running != null) {
      await running.timeout(_deregisterWait, onTimeout: () {});
    }
    final token = _currentToken;
    _currentToken = null;
    _sentToken = null;
    if (token == null) return;
    try {
      await _apiClient.delete(
        '/api/v1/notifications/device-token',
        data: {'fcm_token': token},
      );
      debugPrint('Push: адрес телефона отвязан от аккаунта');
    } catch (e) {
      debugPrint('Push: не удалось отвязать адрес телефона: $e');
    }
  }

  /// Адрес, полученный от Firebase последним (для отладки).
  String? get currentToken => _currentToken;

  Future<void> _registerLoop() async {
    try {
      do {
        _rerun = false;
        await _registerOnce();
      } while (_rerun && _accountBound);
    } finally {
      _running = null;
    }
  }

  Future<void> _registerOnce() async {
    if (Firebase.apps.isEmpty) {
      _fail(
        PushProblem.firebaseUnavailable,
        _firebaseInitError ?? 'Firebase не инициализирован',
      );
      return;
    }
    final messaging = FirebaseMessaging.instance;
    _wireMessaging(messaging);
    status.value = const PushStatus(PushState.registering);

    final allowed = await _requestPermission(messaging);
    if (!_accountBound) return;

    if (_isApple) {
      final appleAddress = await _waitForAppleAddress(messaging);
      if (!_accountBound) return;
      if (appleAddress == null) {
        _fail(
          PushProblem.appleAddressMissing,
          'адрес Apple (APNs) не пришёл за $_appleAddressAttempts попыток — '
          'проверить право push (aps-environment) в подписи сборки',
        );
        return;
      }
    }

    final String? token;
    try {
      token = await messaging.getToken();
    } catch (e) {
      _fail(PushProblem.addressUnavailable, e);
      return;
    }
    if (!_accountBound) return;
    if (token == null || token.isEmpty) {
      _fail(PushProblem.addressUnavailable, 'Firebase вернул пустой адрес');
      return;
    }
    _currentToken = token;

    try {
      await _apiClient.put(
        '/api/v1/notifications/device-token',
        data: {
          'fcm_token': token,
          'platform': _isApple ? 'ios' : 'android',
        },
      );
    } catch (e) {
      _fail(PushProblem.serverRejected, e);
      return;
    }
    if (!_accountBound) return;
    _sentToken = token;
    status.value = PushStatus(
      allowed == false ? PushState.denied : PushState.registered,
    );
    debugPrint(allowed == false
        ? 'Push: адрес телефона принят сервером; уведомления запрещены в '
            'настройках телефона'
        : 'Push: адрес телефона принят сервером');
  }

  /// true — уведомления разрешены, false — запрещены, null — неизвестно.
  ///
  /// Запрет регистрацию не останавливает: адрес уходит всё равно, и стоит
  /// человеку разрешить уведомления в настройках телефона, push начнут
  /// приходить без повторного входа.
  Future<bool?> _requestPermission(FirebaseMessaging messaging) async {
    try {
      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );
      debugPrint('Push permission: ${settings.authorizationStatus}');
      return switch (settings.authorizationStatus) {
        AuthorizationStatus.authorized => true,
        AuthorizationStatus.provisional => true,
        AuthorizationStatus.denied => false,
        AuthorizationStatus.notDetermined => null,
      };
    } catch (e) {
      debugPrint('Push: запрос разрешения на уведомления не удался: $e');
      return null;
    }
  }

  /// Перечитать разрешение на уведомления — без запроса, диалога не будет.
  Future<void> _recheckPermission() async {
    if (Firebase.apps.isEmpty) return;
    try {
      final settings =
          await FirebaseMessaging.instance.getNotificationSettings();
      final allowed = switch (settings.authorizationStatus) {
        AuthorizationStatus.authorized => true,
        AuthorizationStatus.provisional => true,
        AuthorizationStatus.denied => false,
        AuthorizationStatus.notDetermined => null,
      };
      if (allowed == null || !_accountBound) return;
      final state = status.value.state;
      if (state != PushState.registered && state != PushState.denied) return;
      final next = allowed ? PushState.registered : PushState.denied;
      if (next == state) return;
      status.value = PushStatus(next);
      debugPrint(allowed
          ? 'Push: уведомления разрешены в настройках телефона'
          : 'Push: уведомления запрещены в настройках телефона');
    } catch (e) {
      debugPrint('Push: не удалось перечитать разрешение на уведомления: $e');
    }
  }

  Future<String?> _waitForAppleAddress(FirebaseMessaging messaging) async {
    for (var attempt = 1; attempt <= _appleAddressAttempts; attempt++) {
      try {
        final address = await messaging.getAPNSToken();
        if (address != null && address.isNotEmpty) return address;
      } catch (e) {
        debugPrint('Push: запрос адреса Apple не удался: $e');
      }
      if (!_accountBound || attempt == _appleAddressAttempts) break;
      await Future<void>.delayed(_appleAddressInterval);
    }
    return null;
  }

  /// Подписки на Firebase — один раз за запуск, при первой регистрации.
  ///
  /// На смену адреса подписываемся ДО запроса адреса: на iPhone Firebase
  /// может выдать адрес позже, событием, — и он не должен потеряться.
  void _wireMessaging(FirebaseMessaging messaging) {
    if (_messagingWired) return;
    _messagingWired = true;

    messaging.onTokenRefresh.listen((token) {
      _currentToken = token;
      if (_accountBound && token != _sentToken) {
        unawaited(registerDevice());
      }
    });

    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      if (kDebugMode) {
        debugPrint(
            'Push received in foreground: ${message.notification?.title}');
      }
      onForegroundMessage?.call(message);
    });

    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      if (kDebugMode) {
        debugPrint('Push tapped (background): ${message.data}');
      }
      onMessageTap?.call(message);
    });

    unawaited(_deliverInitialMessage(messaging));
  }

  /// Приложение открыли нажатием на push, когда оно было закрыто.
  Future<void> _deliverInitialMessage(FirebaseMessaging messaging) async {
    try {
      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage == null) return;
      if (kDebugMode) {
        debugPrint('Push tapped (terminated): ${initialMessage.data}');
      }
      // Небольшая пауза: экран, на который ведёт push, открывается поверх
      // главной, а она к этому моменту должна успеть встать.
      Future.delayed(const Duration(milliseconds: 500), () {
        onMessageTap?.call(initialMessage);
      });
    } catch (e) {
      debugPrint('Push: не удалось прочитать push, открывший приложение: $e');
    }
  }

  void _fail(PushProblem problem, Object detail) {
    // В журнал — техническая причина: в сборке для магазина его читают
    // logcat на Android и консоль устройства на Mac. Адрес телефона сюда не
    // попадает.
    debugPrint('Push: регистрация не удалась (${problem.name}): $detail');
    // Сбой, случившийся уже после выхода, — не о вошедшем аккаунте: строка
    // состояния остаётся пустой, и «Повторить» гостю не показывается.
    if (!_accountBound) return;
    status.value = PushStatus(PushState.failed, problem: problem);
  }
}
