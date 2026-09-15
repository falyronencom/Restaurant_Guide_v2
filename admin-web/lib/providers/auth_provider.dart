import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

/// Authentication status for admin panel
enum AuthStatus { unauthenticated, authenticating, authenticated }

/// Auth state management for admin panel
/// Simplified from mobile — no registration, no verification, no phone auth
///
/// Источник события смены аккаунта для [AccountScope]: выход, истёкшая
/// сессия и вход под другим аккаунтом сбрасывают состояние всех
/// зарегистрированных провайдеров. Сам он в реестре не состоит.
class AuthProvider with ChangeNotifier {
  final AuthService _authService;

  AuthStatus _status = AuthStatus.unauthenticated;
  User? _currentUser;
  bool _isLoading = true; // Start as loading during initialization
  String? _errorMessage;

  /// Кто входил последним за этот запуск: вход под другим id — смена
  /// аккаунта, даже если выхода между ними не было (истёкшая сессия).
  String? _lastUserId;

  StreamSubscription<void>? _sessionExpiredSubscription;

  AuthProvider({AuthService? authService})
      : _authService = authService ?? AuthService() {
    _sessionExpiredSubscription =
        SessionEvents.expired.listen((_) => _onSessionExpired());
    _initialize();
  }

  @override
  void dispose() {
    _sessionExpiredSubscription?.cancel();
    super.dispose();
  }

  // ============================================================================
  // Getters
  // ============================================================================

  AuthStatus get status => _status;
  bool get isAuthenticated => _status == AuthStatus.authenticated;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  User? get currentUser => _currentUser;

  /// Может ли вошедший действовать. Считается от [currentUser], а не от поля:
  /// тестовые заглушки подменяют именно геттер.
  bool get canModerate => canModerateRole(currentUser?.role);

  /// Вошедший — роль «только просмотр».
  bool get isViewer => isViewerRole(currentUser?.role);

  // ============================================================================
  // Initialization
  // ============================================================================

  /// Потолок ожидания ответа об авторизации на старте.
  ///
  /// Таймауты Dio — 30 с на соединение и 30 с на приём, и до 14.09.2026 это
  /// никого не держало: пока шла инициализация, роутер уже строил дашборд.
  /// Теперь до ответа виден кадр инициализации, и его длительность равна
  /// этому ожиданию — на спящем Railway полминуты вордмарка читались бы как
  /// зависание. Двенадцать секунд заведомо больше обычного ответа `/auth/me`
  /// и заведомо меньше порога, за которым экран выглядит мёртвым.
  static const Duration initializationTimeout = Duration(seconds: 12);

  Future<void> _initialize() async {
    try {
      final hasToken = await _authService.isAuthenticated();
      if (hasToken) {
        try {
          final user =
              await _authService.getCurrentUser().timeout(initializationTimeout);
          // Verify the stored session belongs to a panel role
          if (isPanelRole(user.role)) {
            _currentUser = user;
            _lastUserId = user.id;
            _status = AuthStatus.authenticated;
          } else {
            await _authService.clearAuthData();
            _status = AuthStatus.unauthenticated;
          }
        } catch (e) {
          // Сессию здесь не хороним и хранилище НЕ чистим.
          //
          // Приговор сессии выносит транспорт: когда обновление токена
          // отвергнуто, `ApiClient` сам очистил хранилище и сообщил об
          // истёкшей сессии (OSB-M I5). До этого `catch` доходит почти
          // исключительно «не дошло» — таймаут ожидания, нет сети, 5xx в
          // окно деплоя, временная недоступность от самого транспорта. До
          // 15.09.2026 здесь стояло «стереть на любой ошибке», и короткий
          // обрыв сети на старте выкидывал оператора из ЖИВОЙ сессии; в
          // единственном случае, ради которого строка писалась, она уже не
          // нужна — транспорт сделал это раньше.
          //
          // Разобрать ошибку по коду ответа здесь нельзя: ветки 401
          // пересобирают `DioException` без `response`, и «отвергнуто» с
          // «не дошло» по статусу неразличимы. Поэтому правило, а не
          // разбор: хоронит тот, кто получил приговор.
          //
          // Мусор в хранилище самолечится: следующий старт получит на него
          // честный отказ, и транспорт вычистит сам. Ветка чужой роли выше
          // чистит по-прежнему — там приговор выносится именно здесь.
          _status = AuthStatus.unauthenticated;
          _errorMessage = 'Не удалось проверить сессию — войдите снова';
        }
      }
    } catch (e) {
      _status = AuthStatus.unauthenticated;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // ============================================================================
  // Login
  // ============================================================================

  Future<bool> login({
    required String email,
    required String password,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _status = AuthStatus.authenticating;
    notifyListeners();

    try {
      final authResponse = await _authService.login(
        email: email,
        password: password,
      );
      final user = authResponse.user;
      // Другой аккаунт после истёкшей сессии — выхода не было, а состояние
      // прежнего оператора в провайдерах есть.
      if (_lastUserId != null && _lastUserId != user.id) {
        AccountScope.resetAll();
      }
      _lastUserId = user.id;
      _currentUser = user;
      _status = AuthStatus.authenticated;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _errorMessage = _extractErrorMessage(e);
      _status = AuthStatus.unauthenticated;
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  // ============================================================================
  // Logout
  // ============================================================================

  Future<void> logout() async {
    _isLoading = true;
    notifyListeners();

    try {
      await _authService.logout();
    } catch (e) {
      // Continue with local logout even if API call fails
    }

    _currentUser = null;
    _status = AuthStatus.unauthenticated;
    _errorMessage = null;
    _isLoading = false;
    // Состояние провайдеров принадлежало вышедшему. Сброс идёт до
    // уведомления: роутер уводит на вход по нему же, и экраны за ним уже не
    // должны нести ни очереди, ни вердиктов прежнего оператора.
    AccountScope.resetAll();
    notifyListeners();
  }

  // ============================================================================
  // Session expiry (OSB-M I5)
  // ============================================================================

  /// Транспорт не смог обновить токен и очистил хранилище. До этого
  /// сигнала провайдер оставался «вошедшим» с пустым хранилищем: экран
  /// показывал данные, за которыми уже нельзя сходить, а кнопки отвечали
  /// ошибкой. Теперь — на вход, с объяснением и со сброшенными провайдерами.
  void _onSessionExpired() {
    if (_status != AuthStatus.authenticated) return;
    _currentUser = null;
    _status = AuthStatus.unauthenticated;
    _errorMessage = 'Сессия истекла — войдите снова';
    _isLoading = false;
    AccountScope.resetAll();
    notifyListeners();
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  String _extractErrorMessage(Object error) {
    final message = error.toString();
    // DioException wraps user-friendly messages in the error field
    if (message.contains('Admin access required')) {
      return 'Доступ только для администраторов';
    }
    if (message.contains('Invalid email/phone or password')) {
      return 'Неверный email или пароль';
    }
    if (message.contains('No internet connection')) {
      return 'Нет подключения к серверу';
    }
    if (message.contains('Connection timeout')) {
      return 'Превышено время ожидания';
    }
    // Fallback
    return 'Ошибка входа. Попробуйте снова.';
  }
}
