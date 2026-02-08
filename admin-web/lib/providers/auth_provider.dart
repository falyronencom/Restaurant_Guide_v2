import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';

/// Authentication status for admin panel
enum AuthStatus { unauthenticated, authenticating, authenticated }

/// Auth state management for admin panel
/// Simplified from mobile — no registration, no verification, no phone auth
class AuthProvider with ChangeNotifier {
  final AuthService _authService;

  AuthStatus _status = AuthStatus.unauthenticated;
  User? _currentUser;
  bool _isLoading = true; // Start as loading during initialization
  String? _errorMessage;

  AuthProvider({AuthService? authService})
      : _authService = authService ?? AuthService() {
    _initialize();
  }

  // ============================================================================
  // Getters
  // ============================================================================

  AuthStatus get status => _status;
  bool get isAuthenticated => _status == AuthStatus.authenticated;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  User? get currentUser => _currentUser;

  // ============================================================================
  // Initialization
  // ============================================================================

  Future<void> _initialize() async {
    try {
      final hasToken = await _authService.isAuthenticated();
      if (hasToken) {
        try {
          final user = await _authService.getCurrentUser();
          // Verify the stored session belongs to an admin
          if (user.role == 'admin') {
            _currentUser = user;
            _status = AuthStatus.authenticated;
          } else {
            await _authService.clearAuthData();
            _status = AuthStatus.unauthenticated;
          }
        } catch (e) {
          // Token invalid or network error — clear and require re-login
          _status = AuthStatus.unauthenticated;
          await _authService.clearAuthData();
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
      _currentUser = authResponse.user;
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
