import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';

/// Authentication status enum
enum AuthenticationStatus {
  /// User is not authenticated
  unauthenticated,

  /// Authentication operation in progress
  authenticating,

  /// User is authenticated
  authenticated,

  /// User is in verification process (SMS/email)
  verifying,
}

/// Authentication state provider
/// Manages user authentication status and profile data
class AuthProvider with ChangeNotifier {
  final AuthService _authService;

  // ============================================================================
  // State
  // ============================================================================

  AuthenticationStatus _status = AuthenticationStatus.unauthenticated;
  User? _currentUser;
  bool _isLoading = false;
  String? _errorMessage;

  // Registration state
  String? _verificationToken;
  String? _pendingEmail;
  String? _pendingPhone;
  String? _authMethod; // 'email' or 'phone'

  AuthProvider({AuthService? authService})
      : _authService = authService ?? AuthService() {
    _initialize();
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

  /// Current error message
  String? get errorMessage => _errorMessage;

  /// Current authenticated user
  User? get currentUser => _currentUser;

  /// Verification token from registration
  String? get verificationToken => _verificationToken;

  /// Pending email awaiting verification
  String? get pendingEmail => _pendingEmail;

  /// Pending phone awaiting verification
  String? get pendingPhone => _pendingPhone;

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
        // Try to get current user to validate token
        try {
          final user = await _authService.getCurrentUser();
          _currentUser = user;
          _status = AuthenticationStatus.authenticated;
        } catch (e) {
          final errorStr = e.toString();
          // Only clear auth data if token is actually invalid (401)
          // Don't clear on rate limit (429) or network errors
          if (errorStr.contains('401') || errorStr.contains('Unauthorized')) {
            _status = AuthenticationStatus.unauthenticated;
            _currentUser = null;
            await _authService.clearAuthData();
          } else if (errorStr.contains('429')) {
            // Rate limited - keep token, assume authenticated
            // User can refresh later
            _status = AuthenticationStatus.authenticated;
          } else {
            // Network or other error - keep token but mark as unauthenticated
            // Don't clear data, allow retry
            _status = AuthenticationStatus.unauthenticated;
          }
        }
      }
    } catch (e) {
      _setError('Failed to initialize authentication');
      _status = AuthenticationStatus.unauthenticated;
    } finally {
      _setLoading(false);
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
        _currentUser = User.fromJson(response.user!);
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

  /// Register new user with phone
  Future<bool> registerWithPhone({
    required String phone,
    required String password,
    String? name,
  }) async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final response = await _authService.register(
        phone: phone,
        password: password,
        authMethod: 'phone',
        name: name,
      );

      // Check if backend returned direct auth tokens (no verification needed)
      if (response.hasDirectAuth && response.user != null) {
        _currentUser = User.fromJson(response.user!);
        _status = AuthenticationStatus.authenticated;
        _setLoading(false);
        return true;
      }

      // Otherwise, store verification token and details
      _verificationToken = response.verificationToken;
      _pendingPhone = phone;
      _authMethod = 'phone';
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

  /// Verify SMS code
  Future<bool> verifyCode({required String code}) async {
    if (_verificationToken == null) {
      _setError('No verification token available');
      return false;
    }

    _setLoading(true);
    _clearError();

    try {
      final authResponse = await _authService.verifyCode(
        code: code,
        verificationToken: _verificationToken!,
      );

      _currentUser = authResponse.user;
      _status = AuthenticationStatus.authenticated;
      _clearVerificationState();
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Verify email with token
  Future<bool> verifyEmail({required String emailToken}) async {
    _setLoading(true);
    _clearError();

    try {
      final authResponse = await _authService.verifyEmail(
        emailToken: emailToken,
      );

      _currentUser = authResponse.user;
      _status = AuthenticationStatus.authenticated;
      _clearVerificationState();
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
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
          _currentUser = user;
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

  /// Resend verification code
  Future<bool> resendVerification() async {
    if (_authMethod == null) {
      _setError('No authentication method set');
      return false;
    }

    _setLoading(true);
    _clearError();

    try {
      final response = await _authService.resendVerification(
        email: _pendingEmail,
        phone: _pendingPhone,
        authMethod: _authMethod!,
      );

      // Update verification token if phone method
      if (_authMethod == 'phone') {
        _verificationToken = response.verificationToken;
      }

      _setLoading(false);
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

  /// Login with email or phone and password
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

      _currentUser = authResponse.user;
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

  /// Logout current user
  Future<void> logout() async {
    _setLoading(true);

    try {
      await _authService.logout();
    } catch (e) {
      // Continue with local logout even if API call fails
    }

    _currentUser = null;
    _status = AuthenticationStatus.unauthenticated;
    _clearError();
    _clearVerificationState();
    _setLoading(false);

    notifyListeners();
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /// Refresh current user data
  Future<void> refreshUser() async {
    if (!isAuthenticated) return;

    try {
      final user = await _authService.getCurrentUser();
      _currentUser = user;
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

      _currentUser = user;
      _setLoading(false);

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
    if (!isAuthenticated) return false;

    _setLoading(true);
    _clearError();

    try {
      await _authService.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );

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
    _verificationToken = null;
    _pendingEmail = null;
    _pendingPhone = null;
    _authMethod = null;
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
      return 'Invalid credentials. Please check your email/phone and password.';
    }
    if (errorStr.contains('Email already registered') ||
        errorStr.contains('EMAIL_TAKEN')) {
      return 'This email is already registered. Please login instead.';
    }
    if (errorStr.contains('Phone already registered') ||
        errorStr.contains('PHONE_TAKEN')) {
      return 'This phone number is already registered. Please login instead.';
    }
    if (errorStr.contains('Invalid verification code') ||
        errorStr.contains('INVALID_CODE')) {
      return 'Invalid verification code. Please check and try again.';
    }
    if (errorStr.contains('Code expired') || errorStr.contains('CODE_EXPIRED')) {
      return 'Verification code has expired. Please request a new code.';
    }
    if (errorStr.contains('404')) {
      return 'Service not found. Please try again later.';
    }
    if (errorStr.contains('429') || errorStr.contains('Too many requests')) {
      return 'Too many attempts. Please wait a moment and try again.';
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
