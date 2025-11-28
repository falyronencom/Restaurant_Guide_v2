import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Service for authentication operations
/// Handles login, registration, logout, and token management
/// Full implementation will be completed in Phase Two
class AuthService {
  final ApiClient _apiClient;

  // Singleton pattern
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;

  AuthService._internal() : _apiClient = ApiClient();

  // ============================================================================
  // Authentication Operations
  // ============================================================================

  /// Login with email and password
  ///
  /// Returns user data and stores tokens automatically via interceptor
  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await _apiClient.post(
        '/api/v1/auth/login',
        data: {
          'email': email,
          'password': password,
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;

        // Tokens are stored automatically by response interceptor
        // Return user data
        return data['user'] as Map<String, dynamic>? ?? data;
      } else {
        throw Exception('Login failed');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Register new user
  ///
  /// Full implementation in Phase Two
  Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    required String name,
    String? phone,
  }) async {
    try {
      final response = await _apiClient.post(
        '/api/v1/auth/register',
        data: {
          'email': email,
          'password': password,
          'name': name,
          if (phone != null) 'phone': phone,
        },
      );

      if (response.statusCode == 201 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        return data['user'] as Map<String, dynamic>? ?? data;
      } else {
        throw Exception('Registration failed');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Logout current user
  ///
  /// Clears stored tokens and notifies backend
  Future<void> logout() async {
    try {
      // Attempt to notify backend (best effort)
      try {
        await _apiClient.post('/api/v1/auth/logout');
      } catch (e) {
        // Ignore logout endpoint errors
      }

      // Clear local tokens
      await _apiClient.clearTokens();
    } catch (e) {
      rethrow;
    }
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /// Check if user is authenticated
  Future<bool> isAuthenticated() async {
    return await _apiClient.hasValidToken();
  }

  /// Refresh access token
  ///
  /// Handled automatically by API client interceptor
  /// This method is provided for manual refresh if needed
  Future<void> refreshToken() async {
    try {
      await _apiClient.post('/api/v1/auth/refresh');
    } catch (e) {
      // If refresh fails, clear tokens
      await _apiClient.clearTokens();
      rethrow;
    }
  }

  // ============================================================================
  // User Profile Operations
  // ============================================================================

  /// Get current user profile
  Future<Map<String, dynamic>> getCurrentUser() async {
    try {
      final response = await _apiClient.get('/api/v1/auth/me');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        return data['user'] as Map<String, dynamic>? ?? data;
      } else {
        throw Exception('Failed to get user profile');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Update user profile
  ///
  /// Full implementation in Phase Two
  Future<Map<String, dynamic>> updateProfile({
    String? name,
    String? phone,
    String? email,
  }) async {
    try {
      final data = <String, dynamic>{};
      if (name != null) data['name'] = name;
      if (phone != null) data['phone'] = phone;
      if (email != null) data['email'] = email;

      final response = await _apiClient.patch(
        '/api/v1/auth/profile',
        data: data,
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final responseData = response.data as Map<String, dynamic>;
        return responseData['user'] as Map<String, dynamic>? ?? responseData;
      } else {
        throw Exception('Failed to update profile');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Change password
  ///
  /// Full implementation in Phase Two
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      await _apiClient.post(
        '/api/v1/auth/change-password',
        data: {
          'current_password': currentPassword,
          'new_password': newPassword,
        },
      );
    } catch (e) {
      rethrow;
    }
  }

  /// Request password reset
  ///
  /// Full implementation in Phase Two
  Future<void> requestPasswordReset(String email) async {
    try {
      await _apiClient.post(
        '/api/v1/auth/forgot-password',
        data: {'email': email},
      );
    } catch (e) {
      rethrow;
    }
  }

  /// Reset password with token
  ///
  /// Full implementation in Phase Two
  Future<void> resetPassword({
    required String token,
    required String newPassword,
  }) async {
    try {
      await _apiClient.post(
        '/api/v1/auth/reset-password',
        data: {
          'token': token,
          'password': newPassword,
        },
      );
    } catch (e) {
      rethrow;
    }
  }
}
