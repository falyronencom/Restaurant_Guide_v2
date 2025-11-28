import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';

/// Authentication state provider
/// Manages user authentication status and profile data
class AuthProvider with ChangeNotifier {
  final AuthService _authService;

  // Authentication state
  bool _isAuthenticated = false;
  bool _isLoading = false;
  String? _error;
  Map<String, dynamic>? _user;

  AuthProvider({AuthService? authService})
      : _authService = authService ?? AuthService() {
    // Check authentication status on initialization
    _initialize();
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /// Whether user is currently authenticated
  bool get isAuthenticated => _isAuthenticated;

  /// Whether an authentication operation is in progress
  bool get isLoading => _isLoading;

  /// Current error message, if any
  String? get error => _error;

  /// Current user data
  Map<String, dynamic>? get user => _user;

  /// User's display name
  String? get userName => _user?['name'] as String?;

  /// User's email
  String? get userEmail => _user?['email'] as String?;

  /// User's phone number
  String? get userPhone => _user?['phone'] as String?;

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
        // Try to get current user to validate token
        try {
          final userData = await _authService.getCurrentUser();
          _user = userData;
          _isAuthenticated = true;
        } catch (e) {
          // Token is invalid, clear authentication
          _isAuthenticated = false;
          _user = null;
        }
      }
    } catch (e) {
      _setError('Failed to initialize authentication');
    } finally {
      _setLoading(false);
    }
  }

  // ============================================================================
  // Authentication Operations
  // ============================================================================

  /// Login with email and password
  Future<bool> login({
    required String email,
    required String password,
  }) async {
    _setLoading(true);
    _clearError();

    try {
      final userData = await _authService.login(
        email: email,
        password: password,
      );

      _user = userData;
      _isAuthenticated = true;
      _setLoading(false);

      notifyListeners();
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Register new user
  Future<bool> register({
    required String email,
    required String password,
    required String name,
    String? phone,
  }) async {
    _setLoading(true);
    _clearError();

    try {
      final userData = await _authService.register(
        email: email,
        password: password,
        name: name,
        phone: phone,
      );

      _user = userData;
      _isAuthenticated = true;
      _setLoading(false);

      notifyListeners();
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Logout current user
  Future<void> logout() async {
    _setLoading(true);

    try {
      await _authService.logout();
    } catch (e) {
      // Continue with local logout even if API call fails
    }

    _isAuthenticated = false;
    _user = null;
    _clearError();
    _setLoading(false);

    notifyListeners();
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /// Refresh current user data
  Future<void> refreshUser() async {
    if (!_isAuthenticated) return;

    try {
      final userData = await _authService.getCurrentUser();
      _user = userData;
      notifyListeners();
    } catch (e) {
      // If refresh fails, user might be logged out
      if (e.toString().contains('401') ||
          e.toString().contains('Authentication')) {
        await logout();
      }
    }
  }

  /// Update user profile
  Future<bool> updateProfile({
    String? name,
    String? phone,
    String? email,
  }) async {
    if (!_isAuthenticated) return false;

    _setLoading(true);
    _clearError();

    try {
      final userData = await _authService.updateProfile(
        name: name,
        phone: phone,
        email: email,
      );

      _user = userData;
      _setLoading(false);

      notifyListeners();
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Change password
  Future<bool> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    if (!_isAuthenticated) return false;

    _setLoading(true);
    _clearError();

    try {
      await _authService.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );

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
  // Helper Methods
  // ============================================================================

  /// Set loading state
  void _setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }

  /// Set error message
  void _setError(String message) {
    _error = message;
    notifyListeners();
  }

  /// Clear error message
  void _clearError() {
    _error = null;
    // Don't notify here, will be notified by caller
  }

  /// Extract user-friendly error message from exception
  String _extractErrorMessage(Object error) {
    final errorStr = error.toString();

    // Extract message from DioException format
    if (errorStr.contains('DioException')) {
      // Try to extract the actual error message
      final match = RegExp(r'error:\s*(.+?)(?:\n|$)').firstMatch(errorStr);
      if (match != null) {
        return match.group(1) ?? 'Authentication failed';
      }
    }

    // Common error patterns
    if (errorStr.contains('401') || errorStr.contains('Unauthorized')) {
      return 'Invalid credentials. Please check your email and password.';
    }
    if (errorStr.contains('404')) {
      return 'Service not found. Please try again later.';
    }
    if (errorStr.contains('500')) {
      return 'Server error. Please try again later.';
    }
    if (errorStr.contains('Network') || errorStr.contains('Connection')) {
      return 'Network error. Please check your internet connection.';
    }

    return 'An error occurred. Please try again.';
  }
}
