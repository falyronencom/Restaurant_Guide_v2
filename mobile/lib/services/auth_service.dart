import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/models/auth_response.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Service for authentication operations
/// Handles login, registration, verification, logout, and token management
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
  // Registration and Verification
  // ============================================================================

  /// Register new user with email or phone
  ///
  /// Returns RegisterResponse containing verification_token for SMS,
  /// emailSent confirmation for email verification, or direct auth tokens
  Future<RegisterResponse> register({
    String? email,
    String? phone,
    required String password,
    required String authMethod, // 'email' or 'phone'
    String? name,
  }) async {
    try {
      final response = await _apiClient.post(
        '/api/v1/auth/register',
        data: {
          if (email != null) 'email': email,
          if (phone != null) 'phone': phone,
          if (name != null) 'name': name,
          'password': password,
          'auth_method': authMethod,
        },
      );

      if (response.statusCode == 201 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;

        // Extract data from 'data' field if present, otherwise use root
        final responseData = data['data'] as Map<String, dynamic>? ?? data;

        final registerResponse = RegisterResponse.fromJson(responseData);

        // If backend returned direct auth tokens, store them immediately
        if (registerResponse.hasDirectAuth) {
          final authResponse = AuthResponse.fromJson(responseData);
          await _storeAuthData(authResponse);
        }

        return registerResponse;
      } else {
        throw Exception('Registration failed');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Verify SMS code for phone registration
  ///
  /// Returns AuthResponse with tokens and user data
  Future<AuthResponse> verifyCode({
    required String code,
    required String verificationToken,
  }) async {
    try {
      final response = await _apiClient.post(
        '/api/v1/auth/verify',
        data: {
          'code': code,
          'verification_token': verificationToken,
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;

        final authResponse = AuthResponse.fromJson(responseData);

        // Store tokens and user
        await _storeAuthData(authResponse);

        return authResponse;
      } else {
        throw Exception('Verification failed');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Verify email token from email confirmation link
  ///
  /// Returns AuthResponse with tokens and user data
  Future<AuthResponse> verifyEmail({
    required String emailToken,
  }) async {
    try {
      final response = await _apiClient.post(
        '/api/v1/auth/verify',
        data: {
          'email_token': emailToken,
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;

        final authResponse = AuthResponse.fromJson(responseData);

        // Store tokens and user
        await _storeAuthData(authResponse);

        return authResponse;
      } else {
        throw Exception('Email verification failed');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Resend verification code (for SMS or email)
  ///
  /// Returns new verification token
  Future<RegisterResponse> resendVerification({
    String? email,
    String? phone,
    required String authMethod,
  }) async {
    try {
      final response = await _apiClient.post(
        '/api/v1/auth/resend-verification',
        data: {
          if (email != null) 'email': email,
          if (phone != null) 'phone': phone,
          'auth_method': authMethod,
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;

        return RegisterResponse.fromJson(responseData);
      } else {
        throw Exception('Failed to resend verification');
      }
    } catch (e) {
      rethrow;
    }
  }

  // ============================================================================
  // Authentication Operations
  // ============================================================================

  /// Login with email/phone and password
  ///
  /// Returns AuthResponse with tokens and user data
  /// Tokens are stored automatically
  Future<AuthResponse> login({
    required String emailOrPhone,
    required String password,
  }) async {
    try {
      final response = await _apiClient.post(
        '/api/v1/auth/login',
        data: {
          'email': emailOrPhone, // Backend accepts email or phone in 'email' field
          'password': password,
        },
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;

        final authResponse = AuthResponse.fromJson(responseData);

        // Store tokens and user
        await _storeAuthData(authResponse);

        return authResponse;
      } else {
        throw Exception('Login failed');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Logout current user
  ///
  /// Clears stored tokens and notifies backend to invalidate refresh token
  Future<void> logout() async {
    try {
      // Get refresh token to send to backend
      final refreshToken = await _storage.read(key: 'refresh_token');

      // Attempt to notify backend (best effort)
      if (refreshToken != null) {
        try {
          await _apiClient.post(
            '/api/v1/auth/logout',
            data: {'refresh_token': refreshToken},
          );
        } catch (e) {
          // Ignore logout endpoint errors - proceed with local cleanup
        }
      }

      // Clear all stored authentication data
      await clearAuthData();
    } catch (e) {
      // Even if there's an error, clear local data
      await clearAuthData();
      rethrow;
    }
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /// Check if user is authenticated
  Future<bool> isAuthenticated() async {
    final accessToken = await _storage.read(key: 'access_token');
    return accessToken != null && accessToken.isNotEmpty;
  }

  /// Refresh access token using refresh token
  ///
  /// Handled automatically by API client interceptor
  /// This method is provided for manual refresh if needed
  Future<void> refreshToken() async {
    try {
      final refreshToken = await _storage.read(key: 'refresh_token');
      if (refreshToken == null) {
        throw Exception('No refresh token available');
      }

      final response = await _apiClient.post(
        '/api/v1/auth/refresh',
        data: {'refresh_token': refreshToken},
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;

        // Store new tokens
        if (responseData.containsKey('access_token')) {
          await _storage.write(
            key: 'access_token',
            value: responseData['access_token'] as String,
          );
        }
        if (responseData.containsKey('refresh_token')) {
          await _storage.write(
            key: 'refresh_token',
            value: responseData['refresh_token'] as String,
          );
        }
      }
    } catch (e) {
      // If refresh fails, clear tokens
      await clearAuthData();
      rethrow;
    }
  }

  // ============================================================================
  // User Profile Operations
  // ============================================================================

  /// Get current user profile
  ///
  /// Returns User object
  Future<User> getCurrentUser() async {
    try {
      final response = await _apiClient.get('/api/v1/auth/me');

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
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

  /// Update user profile
  ///
  /// Returns updated User object
  Future<User> updateProfile({
    String? name,
    String? avatarUrl,
  }) async {
    try {
      final data = <String, dynamic>{};
      if (name != null) data['name'] = name;
      if (avatarUrl != null) data['avatar_url'] = avatarUrl;

      final response = await _apiClient.put(
        '/api/v1/auth/profile',
        data: data,
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final responseData = response.data as Map<String, dynamic>;
        final userData = responseData['data']?['user'] as Map<String, dynamic>? ??
                        responseData['data'] as Map<String, dynamic>? ??
                        responseData['user'] as Map<String, dynamic>? ??
                        responseData;

        final user = User.fromJson(userData);

        // Update stored user data
        await _storage.write(key: 'user_data', value: user.toJson().toString());

        return user;
      } else {
        throw Exception('Failed to update profile');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Upload avatar image file
  ///
  /// Returns updated User object with new avatar URL
  Future<User> uploadAvatar(String filePath) async {
    try {
      final formData = FormData.fromMap({
        'avatar': await MultipartFile.fromFile(
          filePath,
          filename: filePath.split('/').last,
        ),
      });

      final response = await _apiClient.post(
        '/api/v1/auth/avatar',
        data: formData,
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final responseData = response.data as Map<String, dynamic>;
        final userData = responseData['data']?['user'] as Map<String, dynamic>? ??
                        responseData['data'] as Map<String, dynamic>? ??
                        responseData;

        final user = User.fromJson(userData);
        await _storage.write(key: 'user_data', value: user.toJson().toString());

        return user;
      } else {
        throw Exception('Failed to upload avatar');
      }
    } catch (e) {
      rethrow;
    }
  }

  /// Change password
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

  /// Request password reset email
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

  /// Reset password with token from email
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

  // ============================================================================
  // Storage Helper Methods
  // ============================================================================

  /// Store authentication data (tokens and user)
  Future<void> _storeAuthData(AuthResponse authResponse) async {
    await _storage.write(key: 'access_token', value: authResponse.accessToken);
    await _storage.write(key: 'refresh_token', value: authResponse.refreshToken);
    await _storage.write(key: 'user_data', value: authResponse.user.toJson().toString());
  }

  /// Get stored user data
  Future<User?> getStoredUser() async {
    try {
      final userDataString = await _storage.read(key: 'user_data');
      if (userDataString == null) return null;

      // Parse stored user data
      // Note: This is a simplified version - in production you might use json.decode
      // For now, we'll just return null and rely on getCurrentUser API call
      return null;
    } catch (e) {
      return null;
    }
  }

  /// Clear all authentication data
  Future<void> clearAuthData() async {
    await _storage.delete(key: 'access_token');
    await _storage.delete(key: 'refresh_token');
    await _storage.delete(key: 'user_data');
  }

  /// Update tokens (e.g., after role upgrade from user to partner)
  Future<void> updateTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: 'access_token', value: accessToken);
    await _storage.write(key: 'refresh_token', value: refreshToken);
  }
}
