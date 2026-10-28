import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';

/// Authentication status enum
enum AuthenticationStatus {
  /// User is not authenticated
  unauthenticated,

  /// Authentication operation in progress
  authenticating,

  /// User is authenticated
  authenticated,

  /// User is in verification process (email)
  verifying,
}

/// Authentication state provider
/// Manages user authentication status and profile data
class AuthProvider with ChangeNotifier, WidgetsBindingObserver {
  final AuthService _authService;

  // ============================================================================
  // State
  // ============================================================================

  AuthenticationStatus _status = AuthenticationStatus.unauthenticated;
  User? _currentUser;

  /// Last account id bound in this app run; guards account-switch resets.
  String? _lastAccountId;
  bool _isLoading = false;
  String? _errorMessage;

  /// Токены в хранилище прочитаны, ответа сервера о сессии ещё нет.
  bool _restoringSession = false;

  /// Вошёл по сохранённой сессии, а сервер её ещё не подтвердил: старт без
  /// связи. Возврат приложения на экран — повод сверить ещё раз.
  bool _sessionUnconfirmed = false;

  /// Идёт такая сверка — второй возврат на экран её не дублирует.
  bool _confirmingSession = false;

  /// Поколение аккаунта: растёт при каждом входе, выходе и конце сессии.
  /// Сверка сессии, начатая в одном поколении, ответ, пришедший в другом,
  /// отбрасывает: профиль прежнего аккаунта не должен показаться у того, кто
  /// успел войти, пока сервер молчал (ревью 18.10.2026, линза).
  int _accountGeneration = 0;

  // Registration state
  String? _pendingEmail;
  String? _authMethod; // 'email'

  StreamSubscription<void>? _sessionExpiredSubscription;

  AuthProvider({AuthService? authService})
      : _authService = authService ?? AuthService() {
    _sessionExpiredSubscription =
        SessionEvents.expired.listen((_) => _onSessionExpired());
    WidgetsBinding.instance.addObserver(this);
    _initialize();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sessionExpiredSubscription?.cancel();
    super.dispose();
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /// Current authentication status
  AuthenticationStatus get status => _status;

  /// Whether user is authenticated
  bool get isAuthenticated => _status == AuthenticationStatus.authenticated;

  /// Whether operation is in progress
  bool get isLoading => _isLoading;

  /// Сохранённая сессия есть и сверяется с сервером — ответа ещё нет.
  ///
  /// Это не гость: заставка, чей таймаут (10 с) короче ожидания соединения
  /// (30 с) при плохой связи, ведёт такого человека на главный экран, а не
  /// на «Регистрацию». Исход сверки дойдёт туда сам.
  bool get isRestoringSession => _restoringSession;

  /// Current error message
  String? get errorMessage => _errorMessage;

  /// Current authenticated user
  User? get currentUser => _currentUser;

  /// Pending email awaiting verification
  String? get pendingEmail => _pendingEmail;

  /// Authentication method being used
  String? get authMethod => _authMethod;

  // ============================================================================
  // Initialization
  // ============================================================================

  /// Initialize authentication state
  /// Checks for stored tokens and validates session
  Future<void> _initialize() async {
    _setLoading(true);

    try {
      final hasToken = await _authService.isAuthenticated();

      if (hasToken) {
        _restoringSession = true;
        await _verifyStoredSession();
      }
    } catch (e) {
      _setError('Failed to initialize authentication');
      _status = AuthenticationStatus.unauthenticated;
    } finally {
      _restoringSession = false;
      _setLoading(false);
    }
  }

  /// Сверяет сохранённую сессию с сервером: токены в хранилище есть.
  ///
  /// Исходов три, и путать «нет сети» с «сеанс отозван» нельзя:
  /// - сервер подтвердил — вошёл;
  /// - сервер отверг — не вошёл, остаток сессии стёрт. Отказ узнаётся по
  ///   пустому хранилищу: на 401 транспорт пробует обновить токен и, если
  ///   сервер отверг и обновление (просроченный refresh-токен, отозванная
  ///   сессия, отключённый аккаунт), сам стирает токены;
  /// - сервер не ответил (см. [_serverUnreachable]) — сессия жива: вошёл, с
  ///   последним профилем, который сервер подтверждал. Сверка — при возврате
  ///   приложения на экран. До 18.10.2026 старт без связи делал вошедшего
  ///   гостем: заставка уводила на «Регистрацию» (находка на телефоне
  ///   Координатора, авиарежим).
  /// Прочие отказы — как раньше: не вошёл, токены целы, возврат на экран
  /// проверит снова.
  ///
  /// Ответ, пришедший после входа, выхода или конца сессии (поколение
  /// аккаунта сменилось, пока сервер молчал), ни к чему не применяется.
  Future<void> _verifyStoredSession() async {
    final generation = _accountGeneration;
    try {
      final user = await _authService.getCurrentUser();
      if (generation != _accountGeneration) return;
      _bindAccount(user);
      _status = AuthenticationStatus.authenticated;
    } catch (e) {
      if (generation != _accountGeneration) return;
      final errorStr = e.toString();
      // Пустое хранилище после отказа надёжнее разбора текста: у
      // пересобранного DioException в toString() нет кода статуса.
      final tokensGone = !await _authService.isAuthenticated();
      if (generation != _accountGeneration) return;
      if (tokensGone ||
          errorStr.contains('401') ||
          errorStr.contains('Unauthorized')) {
        _status = AuthenticationStatus.unauthenticated;
        _currentUser = null;
        _sessionUnconfirmed = false;
        await _authService.clearAuthData();
      } else if (_serverUnreachable(e) || errorStr.contains('429')) {
        await _restoreUnconfirmed(generation);
      } else {
        // Keep token but mark as unauthenticated; resume retries.
        _status = AuthenticationStatus.unauthenticated;
        _sessionUnconfirmed = false;
      }
    }
  }

  /// Вошёл без ответа сервера: сессия в хранилище жива, профиль — последний,
  /// что подтверждал сервер для этой сессии. Профиля может не быть (записан
  /// прежней сборкой, принадлежит другому аккаунту) — тогда вошёл без него,
  /// как при ответе 429: экраны это переносят («Пользователь» в профиле,
  /// пустой ключ аккаунта в `MainNavigationScreen`), а профиль придёт со
  /// сверкой.
  ///
  /// Сессию старше срока refresh-токена сервер уже не продлит — её без связи
  /// не восстанавливаем, а ведём себя как до 18.10.2026: не вошёл, токены
  /// целы, слово за сервером, когда появится связь. Токены не стираются: при
  /// неверных часах телефона это стоило бы человеку входа.
  Future<void> _restoreUnconfirmed(int generation) async {
    final outlived = await _storedSessionOutlived();
    if (generation != _accountGeneration) return;
    if (outlived) {
      _status = AuthenticationStatus.unauthenticated;
      _sessionUnconfirmed = false;
      return;
    }
    User? stored;
    try {
      stored = await _authService.getStoredUser();
    } catch (_) {
      // Хранилище не отдало профиль — вошёл без него.
    }
    if (generation != _accountGeneration) return;
    if (stored != null) _bindAccount(stored);
    _status = AuthenticationStatus.authenticated;
    _sessionUnconfirmed = true;
  }

  /// Срок refresh-токена: 30 дней от выдачи пары
  /// (`backend/src/services/authService.js`, `expiresAt + 30`).
  static const Duration _refreshTokenLifetime = Duration(days: 30);

  /// Пара токенов в хранилище старше [_refreshTokenLifetime] — сервер такую
  /// сессию уже не продлит. Не узнать (токен не разбирается, хранилище
  /// отказало) — не старше.
  Future<bool> _storedSessionOutlived() async {
    try {
      final issuedAt = await _authService.storedSessionIssuedAt();
      return issuedAt != null &&
          DateTime.now().difference(issuedAt) > _refreshTokenLifetime;
    } catch (_) {
      return false;
    }
  }

  /// Сервер не ответил о сессии ничего — она жива.
  ///
  /// Ответа нет — сервер о сессии ничего не сказал: нет связи (авиарежим даёт
  /// `connectionError` — адрес сервера не находится), таймауты, сбой TLS (сеть
  /// с окном входа, неверное время на телефоне) или обрыв уже после
  /// соединения — dio отдаёт два последних как `unknown`. Единственный отказ
  /// без ответа, который говорит о сессии, — «Сеанс истёк» транспорта
  /// ([ApiClient.sessionExpiredMessage]): обновлять нечем. Его раньше ловит
  /// пустое хранилище, но и здесь он не «не ответил». Обновление, не дошедшее
  /// до сервера ([ApiClient.refreshUnavailableMessage]), — «не ответил».
  /// 429 лимитера и 5xx окна деплоя — ответ есть, но о сессии он ничего не
  /// говорит; прочие ответы (4xx) — ответ по существу. Статус — у самого
  /// исключения: в `toString()` его нет.
  static bool _serverUnreachable(Object error) {
    if (error is! DioException) return false;
    final status = error.response?.statusCode;
    if (status != null) return status == 429 || status >= 500;
    return error.error != ApiClient.sessionExpiredMessage;
  }

  /// Возврат приложения на экран — повод проверить сессию ещё раз.
  ///
  /// Два случая. Вошёл без ответа сервера (старт без связи) — сверка той же
  /// сессии: связь к возврату обычно уже есть. Не вошёл, а токены целы
  /// (прочий отказ при старте) — проверка заново, как при запуске.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    _recheckSessionOnResume();
  }

  Future<void> _recheckSessionOnResume() async {
    // «Вошёл», и сервер это подтвердил, — перепроверять нечего, а запрос
    // профиля на каждом возврате из фона — трафик на ровном месте.
    if (_isLoading || _confirmingSession) return;
    if (isAuthenticated && !_sessionUnconfirmed) return;
    try {
      // Токенов нет — пользователь и правда гость, а не жертва отказа сети:
      // проверять нечем.
      if (!await _authService.isAuthenticated()) return;
      // Условия перепроверяются ПОСЛЕ чтения хранилища: за это время мог
      // завершиться вход или стартовать другая проверка, а условия выше
      // проверены до `await`. Без повторной проверки отказ сети сбросил бы
      // только что вошедшего обратно в гостя, а два возврата подряд дали бы
      // два запроса профиля: `_initialize` держит [_isLoading] поднятым всё
      // время работы, сверка — [_confirmingSession].
      if (_isLoading || _confirmingSession) return;
      if (isAuthenticated) {
        if (_sessionUnconfirmed) await _confirmStoredSession();
        return;
      }
      await _initialize();
    } catch (_) {
      // Обработчик жизненного цикла зовёт эту проверку без `await`: любое
      // исключение отсюда (чтение защищённого хранилища тоже умеет падать)
      // стало бы необработанной асинхронной ошибкой на каждом возврате
      // приложения на экран.
    }
  }

  /// Сверка сессии, с которой человек вошёл без ответа сервера.
  ///
  /// Подтвердил — свежий профиль, сверка больше не нужна. Отверг — выход уже
  /// сделан: обновить токен нечем, транспорт стёр хранилище и подал сигнал
  /// ([_onSessionExpired]), а «вошёл» по сигналу превращается в «не вошёл».
  /// Не ответил или ответил иначе — человек остаётся вошедшим до следующего
  /// возврата на экран: выводить из аккаунта посреди работы можно только по
  /// слову сервера.
  Future<void> _confirmStoredSession() async {
    _confirmingSession = true;
    final generation = _accountGeneration;
    try {
      final user = await _authService.getCurrentUser();
      // Пока шёл запрос, человек мог выйти или войти заново — тогда этот
      // ответ уже ни о чём.
      if (generation != _accountGeneration ||
          !isAuthenticated ||
          !_sessionUnconfirmed) {
        return;
      }
      _bindAccount(user);
      notifyListeners();
    } catch (_) {
      // Отказ разобран выше: выход — по сигналу транспорта, иначе ждём.
    } finally {
      _confirmingSession = false;
    }
  }

  // ============================================================================
  // Registration Flow
  // ============================================================================

  /// Register new user with email
  Future<bool> registerWithEmail({
    required String email,
    required String password,
    String? name,
  }) async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final response = await _authService.register(
        email: email,
        password: password,
        authMethod: 'email',
        name: name,
      );

      // Check if backend returned direct auth tokens (no verification needed)
      if (response.hasDirectAuth && response.user != null) {
        _bindAccount(User.fromJson(response.user!));
        _status = AuthenticationStatus.authenticated;
        _setLoading(false);
        return true;
      }

      // Otherwise, store verification details for later use
      _pendingEmail = email;
      _authMethod = 'email';
      _status = AuthenticationStatus.verifying;
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _status = AuthenticationStatus.unauthenticated;
      _setLoading(false);
      return false;
    }
  }

  /// Check verification status (for email verification polling)
  Future<bool> checkVerificationStatus() async {
    if (!isAuthenticated) {
      try {
        final user = await _authService.getCurrentUser();
        if (user.isVerified) {
          _bindAccount(user);
          _status = AuthenticationStatus.authenticated;
          _clearVerificationState();
          notifyListeners();
          return true;
        }
      } catch (e) {
        // Not verified yet or error
        return false;
      }
    }
    return false;
  }

  /// Send (or re-send) an email verification code to the authenticated user.
  /// Returns true when the email went out; false if rate-limited, on another
  /// server error, or when the server issued the code but the mail service
  /// refused the email (`sent: false` — [emailNotSentMessage]).
  /// Sets [errorMessage] with a localized message when false.
  Future<bool> sendEmailVerificationCode() async {
    _setLoading(true);
    _clearError();

    try {
      final sent = await _authService.sendEmailVerificationCode();
      if (!sent) {
        _setError(emailNotSentMessage);
        _setLoading(false);
        return false;
      }
      _setLoading(false);
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Текст, когда код выдан, а письмо не ушло: почтовая служба его не
  /// приняла (прежде экран писал «Код отправлен», и человек ждал письма,
  /// которого не будет). Кнопка повтора остаётся. Текст предложен сессией
  /// Trunk 24.10.2026; утверждён Координатором 24.10.2026 (PR #126).
  static const String emailNotSentMessage =
      'Письмо не отправилось. Попробуйте ещё раз через минуту.';

  /// Verify a 6-digit email verification code submitted by the user.
  /// On success, refreshes the stored user (email_verified=true) and returns true.
  Future<bool> verifyEmailCode({required String code}) async {
    _setLoading(true);
    _clearError();

    try {
      final user = await _authService.verifyEmailCode(code: code);
      _bindAccount(user);
      _status = AuthenticationStatus.authenticated;
      _clearVerificationState();
      _setLoading(false);
      notifyListeners();
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  // ============================================================================
  // Login Flow
  // ============================================================================

  /// Login with email and password. Входа по номеру телефона нет: сервер
  /// ищет вход по почте (решение Координатора 19.10.2026 — до появления СМС).
  Future<bool> login({
    required String emailOrPhone,
    required String password,
  }) async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final authResponse = await _authService.login(
        emailOrPhone: emailOrPhone,
        password: password,
      );

      _bindAccount(authResponse.user);
      _status = AuthenticationStatus.authenticated;
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _status = AuthenticationStatus.unauthenticated;
      _setLoading(false);
      return false;
    }
  }

  // ============================================================================
  // OAuth Login Flow
  // ============================================================================

  /// Login with Google Sign-In
  Future<bool> loginWithGoogle() async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final authResponse = await _authService.loginWithGoogle();

      _bindAccount(authResponse.user);
      _status = AuthenticationStatus.authenticated;
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _status = AuthenticationStatus.unauthenticated;
      _setLoading(false);
      return false;
    }
  }

  /// Login with Yandex OAuth
  Future<bool> loginWithYandex() async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final authResponse = await _authService.loginWithYandex();

      _bindAccount(authResponse.user);
      _status = AuthenticationStatus.authenticated;
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_yandexErrorMessage(e));
      _status = AuthenticationStatus.unauthenticated;
      _setLoading(false);
      return false;
    }
  }

  /// Текст отказа, когда ответ Яндекса так и не дошёл до сервера.
  static const String yandexNoConnectionMessage =
      'Нет связи с сервером. Проверьте интернет и нажмите '
      '«Продолжить с Яндекс» ещё раз.';

  /// Текст отказа во входе через Яндекс.
  ///
  /// Отказ соединения приходит сюда на Android уже после тихих повторов
  /// (`AuthService.completeYandexSignIn`), на iPhone — сразу; в обоих случаях
  /// текст говорит, что делать: повтором служит та же кнопка. Общая таблица [_extractErrorMessage] такой
  /// отказ не узнаёт — она ищет «Network» и «Connection» с большой буквы, а в
  /// `toString()` у `DioException` их нет, — и человек видел «Произошла
  /// ошибка». Остальные отказы — по общей таблице, как раньше.
  String _yandexErrorMessage(Object error) {
    if (error is DioException &&
        (error.type == DioExceptionType.connectionError ||
            error.type == DioExceptionType.connectionTimeout ||
            error.type == DioExceptionType.sendTimeout ||
            error.type == DioExceptionType.receiveTimeout)) {
      return yandexNoConnectionMessage;
    }
    return _extractErrorMessage(error);
  }

  /// Logout current user
  Future<void> logout() async {
    // Сразу, до запроса к серверу: сверка сессии, ответ которой придёт во
    // время выхода, уже ничего не привяжет.
    _accountGeneration++;
    _setLoading(true);

    try {
      await _authService.logout();
    } catch (e) {
      // Continue with local logout even if API call fails
    }

    _currentUser = null;
    _status = AuthenticationStatus.unauthenticated;
    _sessionUnconfirmed = false;
    _clearError();
    _clearVerificationState();

    // Wipe account-scoped provider caches (partner cards, bookings, etc.) —
    // otherwise the next signed-in user sees the previous account's data.
    AccountScope.resetAll();
    _lastAccountId = null;

    _setLoading(false);

    notifyListeners();
  }

  // ============================================================================
  // Session expiry
  // ============================================================================

  /// Транспорт не смог обновить токен и очистил хранилище. До этого сигнала
  /// провайдер оставался «вошедшим» с пустым хранилищем: профиль показывал
  /// данные, за которыми уже нельзя сходить, а каждое действие отвечало
  /// «Сеанс истёк». Теперь — «не вошёл», со сброшенными кэшами аккаунта и
  /// без локальных остатков сессии.
  ///
  /// Сигнал приходит и от запроса без входа (refresh-токена нет — обновлять
  /// нечем), и во время инициализации с мёртвой сессией; в этих состояниях
  /// менять нечего. Только «вошёл» превращается в «не вошёл».
  Future<void> _onSessionExpired() async {
    if (_status != AuthenticationStatus.authenticated) return;
    _accountGeneration++;
    _currentUser = null;
    _status = AuthenticationStatus.unauthenticated;
    _sessionUnconfirmed = false;
    _clearVerificationState();
    AccountScope.resetAll();
    _lastAccountId = null;
    notifyListeners();
    // Токены уже стёр транспорт; здесь — остаток сессии (user_data).
    await _authService.clearAuthData();
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /// Refresh current user data
  Future<void> refreshUser() async {
    if (!isAuthenticated) return;

    try {
      final user = await _authService.getCurrentUser();
      _bindAccount(user);
      notifyListeners();
    } catch (e) {
      // If refresh fails, user might be logged out
      if (e.toString().contains('401') ||
          e.toString().contains('Authentication')) {
        await logout();
      }
    }
  }

  /// Updates user role after backend role change (e.g., user → partner)
  /// Called after receiving new tokens with updated role
  /// Uses local state update without network call for speed and reliability
  Future<void> updateUserRole(String newRole) async {
    if (_currentUser != null) {
      debugPrint('AuthProvider: Updating role from ${_currentUser!.role} to $newRole');
      _currentUser = _currentUser!.copyWith(role: newRole);
      _status = AuthenticationStatus.authenticated;
      notifyListeners();
      debugPrint('AuthProvider: User role updated to $newRole');
    }
  }

  /// Update user profile
  Future<bool> updateProfile({
    String? name,
    String? avatarUrl,
  }) async {
    if (!isAuthenticated) return false;

    _setLoading(true);
    _clearError();

    try {
      final user = await _authService.updateProfile(
        name: name,
        avatarUrl: avatarUrl,
      );

      _bindAccount(user);
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Upload avatar image
  Future<bool> uploadAvatar(String filePath) async {
    if (!isAuthenticated) return false;

    _setLoading(true);
    _clearError();

    try {
      final user = await _authService.uploadAvatar(filePath);
      _bindAccount(user);
      _setLoading(false);
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Request password reset
  Future<bool> requestPasswordReset({required String email}) async {
    _setLoading(true);
    _clearError();

    try {
      await _authService.requestPasswordReset(email);
      _setLoading(false);
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /// Bind the authenticated [user] as the active account. When the account
  /// differs from the previous one in this app run, account-scoped provider
  /// state is reset first — covers logins without an explicit logout between.
  ///
  /// Профиль от сервера — сессия подтверждена; профиль из хранилища при
  /// старте без связи помечает её неподтверждённой уже после этого вызова
  /// ([_restoreUnconfirmed]).
  void _bindAccount(User user) {
    if (_lastAccountId != null && _lastAccountId != user.id) {
      AccountScope.resetAll();
    }
    _accountGeneration++;
    _lastAccountId = user.id;
    _currentUser = user;
    _sessionUnconfirmed = false;
  }

  /// Set loading state
  void _setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }

  /// Set error message
  void _setError(String message) {
    _errorMessage = message;
    notifyListeners();
  }

  /// Clear error message
  void _clearError() {
    _errorMessage = null;
  }

  /// Clear verification state
  void _clearVerificationState() {
    _pendingEmail = null;
    _authMethod = null;
  }

  /// Общая фраза — когда ни сервер, ни таблица не дали текста.
  static const String genericErrorMessage =
      'Произошла ошибка. Попробуйте снова.';

  static final RegExp _cyrillic = RegExp('[А-Яа-яЁёІіЎў]');

  /// Текст отказа для человека — на входе, регистрации, кодах, правке
  /// профиля.
  ///
  /// Порядок:
  /// 1. Русский текст сервера из тела ответа — как есть: сервер знает про
  ///    случай больше клиента (правило имени, лимит попыток, блокировка).
  /// 2. Таблица известных кодов и английских фраз сервера — русской фразой.
  /// 3. Русская фраза транспорта, если ответа не было (нет связи, таймаут).
  /// 4. Общая фраза [genericErrorMessage].
  ///
  /// До 17.10.2026 первым шагом искалось `error:` со строчной буквы, а
  /// `DioException.toString()` пишет `Error:` — текст сервера не находился
  /// никогда, и русские отказы 429/403 и правка имени доходили до экрана общей
  /// фразой (проход тестировщика 17.10, п. 32; память
  /// `feedback_server_text_visible_only_if_client_shows_it`).
  String _extractErrorMessage(Object error) {
    final response = error is DioException ? error.response : null;

    final serverText = _russianServerText(response?.data);
    if (serverText != null) return serverText;

    final known = _knownErrorMessage(error, response);
    if (known != null) return known;

    if (error is DioException &&
        error.type != DioExceptionType.badResponse &&
        error.error is String &&
        _cyrillic.hasMatch(error.error as String)) {
      return error.error as String;
    }

    return genericErrorMessage;
  }

  /// Русский текст отказа из тела ответа сервера, или `null`.
  ///
  /// Отказ проверки полей приходит в двух формах: `error.details` — объект
  /// «поле → список фраз» (express-validator, регистрация) или список
  /// `{field, message}`; рядом `error.message` — общая фраза. Берётся то,
  /// что написано по-русски: по одной фразе на поле, затем общая. Английская
  /// фраза сервера сюда не проходит — её переводит таблица
  /// [_knownErrorMessage].
  static String? _russianServerText(Object? data) {
    if (data is! Map) return null;
    final error = data['error'];
    final fieldMessages = <String>[];

    void addRussian(Object? message) {
      if (message is String &&
          _cyrillic.hasMatch(message) &&
          !fieldMessages.contains(message.trim())) {
        fieldMessages.add(message.trim());
      }
    }

    if (error is Map) {
      final details = error['details'];
      if (details is Map) {
        // Только списки фраз: у отказа лимитера (429) в `details` служебные
        // поля — окно лимита строкой, срок, — и они не текст для человека.
        for (final messages in details.values) {
          if (messages is! List) continue;
          final russian = messages.whereType<String>().where(
                (m) => _cyrillic.hasMatch(m),
              );
          if (russian.isNotEmpty) addRussian(russian.first);
        }
      } else if (details is List) {
        for (final item in details) {
          addRussian(item is Map ? item['message'] : item);
        }
      }
      if (fieldMessages.isNotEmpty) return fieldMessages.join('\n');

      final message = error['message'];
      if (message is String && _cyrillic.hasMatch(message)) {
        return message.trim();
      }
    } else if (error is String && _cyrillic.hasMatch(error)) {
      return error.trim();
    }

    final message = data['message'];
    if (message is String && _cyrillic.hasMatch(message)) {
      return message.trim();
    }
    return null;
  }

  /// Русская фраза для известного отказа, или `null`.
  ///
  /// Сервер отдаёт большинство отказов входа по-английски с кодом в теле
  /// (`INVALID_CREDENTIALS`, `EMAIL_EXISTS`). Таблица ищет код и фразы в
  /// тексте исключения, в коде и фразах из тела ответа: у `DioException`,
  /// пересобранного транспортом, в `toString()` нет ни кода статуса, ни кода
  /// из тела — только фраза из `error`.
  String? _knownErrorMessage(Object error, Response<dynamic>? response) {
    final body = response?.data;
    final bodyError = body is Map ? body['error'] : null;
    final errorStr = [
      error.toString(),
      if (bodyError is Map) ...[
        '${bodyError['code'] ?? ''}',
        '${bodyError['message'] ?? ''}',
        '${bodyError['details'] ?? ''}',
      ],
    ].join('\n');
    final status = response?.statusCode;

    // OAuth-specific errors
    if (errorStr.contains('cancelled') || errorStr.contains('CANCELED')) {
      return 'Вход отменён';
    }
    if (errorStr.contains('not configured')) {
      return 'Этот способ входа ещё не настроен';
    }

    // Common error patterns
    // Фразы сервера здесь обязательны: у DioException, пересобранного
    // транспортом, в toString() нет ни кода статуса, ни кода из тела ответа
    // (INVALID_CREDENTIALS, INVALID_CODE) — только текст из `error`.
    if (errorStr.contains('401') ||
        errorStr.contains('Unauthorized') ||
        errorStr.contains('Authentication failed') ||
        errorStr.contains('INVALID_CREDENTIALS') ||
        errorStr.contains('Invalid email/phone or password')) {
      return 'Неверный email/телефон или пароль';
    }
    if (errorStr.contains('Email already registered') ||
        errorStr.contains('EMAIL_TAKEN') ||
        errorStr.contains('EMAIL_EXISTS')) {
      return 'Этот email уже зарегистрирован. Попробуйте войти.';
    }
    if (errorStr.contains('Phone already registered') ||
        errorStr.contains('PHONE_TAKEN') ||
        errorStr.contains('PHONE_EXISTS')) {
      return 'Этот номер телефона уже зарегистрирован. Попробуйте войти.';
    }
    if (errorStr.contains('Invalid verification code') ||
        errorStr.contains('Verification code is incorrect') ||
        errorStr.contains('INVALID_CODE')) {
      return 'Неверный код подтверждения. Проверьте и попробуйте снова.';
    }
    if (errorStr.contains('INVALID_OR_EXPIRED_CODE')) {
      return 'Код истёк или недействителен. Запросите новый.';
    }
    if (errorStr.contains('TOO_MANY_ATTEMPTS')) {
      return 'Слишком много неверных попыток. Запросите новый код.';
    }
    if (errorStr.contains('EMAIL_ALREADY_VERIFIED')) {
      return 'Email уже подтверждён.';
    }
    // Отказы входа через Google и Яндекс — раньше код из тела в таблицу не
    // попадал, и все три доходили общей фразой. Стоят до `NO_EMAIL`:
    // `OAUTH_NO_EMAIL` содержит его подстрокой.
    if (errorStr.contains('OAUTH_NO_EMAIL')) {
      return 'Сервис входа не передал адрес почты. Войдите другим способом.';
    }
    if (errorStr.contains('OAUTH_EMAIL_NOT_VERIFIED')) {
      return 'Почта в этом сервисе не подтверждена. Подтвердите её там или '
          'войдите другим способом.';
    }
    if (errorStr.contains('ACCOUNT_DEACTIVATED')) {
      return 'Аккаунт отключён. Напишите в поддержку.';
    }
    if (errorStr.contains('NO_EMAIL')) {
      return 'На аккаунте нет email-адреса.';
    }
    if (errorStr.contains('Code expired') || errorStr.contains('CODE_EXPIRED')) {
      return 'Код подтверждения истёк. Запросите новый код.';
    }
    // Правило имени: английские фразы сервера до его перевода на русский.
    if (errorStr.contains('Name can only contain')) {
      return nameCharactersMessage;
    }
    if (errorStr.contains('Name must be')) {
      return 'Имя — от $nameMinLength до $nameMaxLength символов';
    }
    if (errorStr.contains('Name cannot be empty') ||
        errorStr.contains('Name is required')) {
      return 'Введите имя';
    }
    // Коды статуса — по ответу, а не по подстроке: «500» встречается и в
    // тексте («must be 500 characters or fewer»).
    if (status == 404) {
      return 'Сервис недоступен. Попробуйте позже.';
    }
    if (status == 429 || errorStr.contains('Too many requests')) {
      return 'Слишком много попыток. Подождите немного и попробуйте снова.';
    }
    if (status != null && status >= 500) {
      return 'Ошибка сервера. Попробуйте позже.';
    }
    if (errorStr.contains('VALIDATION_ERROR')) {
      return 'Проверьте введённые данные.';
    }
    if (errorStr.contains('Network') || errorStr.contains('Connection')) {
      return 'Ошибка сети. Проверьте подключение к интернету.';
    }

    return null;
  }
}
