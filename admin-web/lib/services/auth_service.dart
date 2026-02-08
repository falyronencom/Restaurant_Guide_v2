import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:restaurant_guide_admin_web/models/auth_response.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// Authentication service for admin panel
/// Handles admin login, logout, and token management
class AuthService {
  final ApiClient _apiClient;
  final FlutterSecureStorage _storage;

  // Singleton pattern
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;

  AuthService._internal()
      : _apiClient = ApiClient(),
        _storage = const FlutterSecureStorage();

  // ============================================================================
  // Authentication Operations
  // ============================================================================

  /// Login with admin credentials
  ///
  /// Uses the admin-specific endpoint that verifies role === 'admin'
  Future<AuthResponse> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await _apiClient.post(
        '/api/v1/admin/auth/login',
        data: {
          'email': email,
          'password': password,
        },
      );

      if (response.statusCode == 200 &&
          response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;

        final authResponse = AuthResponse.fromJson(responseData);
        await _storeAuthData(authResponse);
        return authResponse;
      } else {
        throw Exception('Login failed');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Logout current admin
  ///
  /// Clears stored tokens and notifies backend to invalidate refresh token
  Future<void> logout() async {
    try {
      final refreshToken = await _storage.read(key: 'refresh_token');

      // Best-effort backend notification
      if (refreshToken != null) {
        try {
          await _apiClient.post(
            '/api/v1/auth/logout',
            data: {'refresh_token': refreshToken},
          );
        } catch (e) {
          // Ignore logout endpoint errors
        }
      }

      await clearAuthData();
    } catch (e) {
      await clearAuthData();
      rethrow;
    }
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /// Check if admin is authenticated (has stored token)
  Future<bool> isAuthenticated() async {
    final accessToken = await _storage.read(key: 'access_token');
    return accessToken != null && accessToken.isNotEmpty;
  }

  // ============================================================================
  // User Profile
  // ============================================================================

  /// Get current admin user profile
  Future<User> getCurrentUser() async {
    try {
      final response = await _apiClient.get('/api/v1/auth/me');

      if (response.statusCode == 200 &&
          response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final userData = data['data'] as Map<String, dynamic>? ??
            data['user'] as Map<String, dynamic>? ??
            data;
        return User.fromJson(userData);
      } else {
        throw Exception('Failed to get user profile');
      }
    } catch (e) {
      rethrow;
    }
  }

  // ============================================================================
  // Storage Helpers
  // ============================================================================

  Future<void> _storeAuthData(AuthResponse authResponse) async {
    await _storage.write(
        key: 'access_token', value: authResponse.accessToken);
    await _storage.write(
        key: 'refresh_token', value: authResponse.refreshToken);
  }

  /// Clear all authentication data
  Future<void> clearAuthData() async {
    await _storage.delete(key: 'access_token');
    await _storage.delete(key: 'refresh_token');
  }
}
