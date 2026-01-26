import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:restaurant_guide_mobile/config/environment.dart';

/// HTTP API client with authentication and error handling
/// Built on Dio with custom interceptors for token management
class ApiClient {
  late final Dio _dio;
  final FlutterSecureStorage _storage;

  // Singleton pattern
  static final ApiClient _instance = ApiClient._internal();
  factory ApiClient() => _instance;

  ApiClient._internal() : _storage = const FlutterSecureStorage() {
    _dio = Dio(
      BaseOptions(
        baseUrl: Environment.apiBaseUrl,
        connectTimeout: const Duration(seconds: Environment.apiConnectTimeout),
        receiveTimeout: const Duration(seconds: Environment.apiTimeout),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        // Format arrays as repeated keys: categories=A&categories=B
        // This matches Express query parser expectations
        listFormat: ListFormat.multiCompatible,
      ),
    );

    // Add interceptors
    _dio.interceptors.add(_createRequestInterceptor());
    _dio.interceptors.add(_createResponseInterceptor());
    _dio.interceptors.add(_createErrorInterceptor());

    // Add logging in development
    if (Environment.enableApiLogging) {
      _dio.interceptors.add(LogInterceptor(
        request: true,
        requestHeader: true,
        requestBody: true,
        responseHeader: false,
        responseBody: true,
        error: true,
        logPrint: (obj) => print('[API] $obj'),
      ));
    }
  }

  /// Get Dio instance for direct use
  Dio get dio => _dio;

  // ============================================================================
  // Request Interceptor - Adds authentication token
  // ============================================================================

  Interceptor _createRequestInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) async {
        // Add authentication token if available
        final accessToken = await _storage.read(key: 'access_token');
        if (accessToken != null && accessToken.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $accessToken';
        }

        // Log request in development (without token)
        if (Environment.enableApiLogging) {
          print('[API Request] ${options.method} ${options.path}');
        }

        handler.next(options);
      },
    );
  }

  // ============================================================================
  // Response Interceptor - Handles token refresh
  // ============================================================================

  Interceptor _createResponseInterceptor() {
    return InterceptorsWrapper(
      onResponse: (response, handler) async {
        // Check if response contains new tokens
        if (response.data is Map<String, dynamic>) {
          final data = response.data as Map<String, dynamic>;

          if (data.containsKey('accessToken')) {
            await _storage.write(
              key: 'access_token',
              value: data['accessToken'],
            );
          }

          if (data.containsKey('refreshToken')) {
            await _storage.write(
              key: 'refresh_token',
              value: data['refreshToken'],
            );
          }
        }

        handler.next(response);
      },
    );
  }

  // ============================================================================
  // Error Interceptor - Handles errors and retries
  // ============================================================================

  Interceptor _createErrorInterceptor() {
    return InterceptorsWrapper(
      onError: (error, handler) async {
        if (Environment.enableApiLogging) {
          print('[API Error] ${error.requestOptions.path}: ${error.message}');
        }

        // Handle 401 Unauthorized - try to refresh token
        if (error.response?.statusCode == 401) {
          final refreshed = await _attemptTokenRefresh();
          if (refreshed) {
            // Retry original request with new token
            try {
              final response = await _retry(error.requestOptions);
              return handler.resolve(response);
            } catch (e) {
              // Refresh succeeded but retry failed
              return handler.reject(error);
            }
          } else {
            // Refresh failed - clear tokens and return error
            await clearTokens();
            return handler.reject(
              DioException(
                requestOptions: error.requestOptions,
                error: 'Authentication failed. Please log in again.',
                type: DioExceptionType.badResponse,
              ),
            );
          }
        }

        // Handle 5xx server errors - retry with exponential backoff
        if (error.response != null &&
            error.response!.statusCode! >= 500 &&
            error.response!.statusCode! < 600) {
          final retryCount = error.requestOptions.extra['retryCount'] ?? 0;
          if (retryCount < Environment.maxRetryAttempts) {
            // Wait before retry (exponential backoff)
            final retryCountInt = retryCount as int;
            await Future.delayed(
                Duration(milliseconds: 500 * (retryCountInt + 1)));

            error.requestOptions.extra['retryCount'] = retryCount + 1;
            try {
              final response = await _retry(error.requestOptions);
              return handler.resolve(response);
            } catch (e) {
              return handler.reject(error);
            }
          }
        }

        // Enhance error message for user
        final enhancedError = _enhanceError(error);
        handler.reject(enhancedError);
      },
    );
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /// Attempt to refresh access token using refresh token
  Future<bool> _attemptTokenRefresh() async {
    try {
      final refreshToken = await _storage.read(key: 'refresh_token');
      if (refreshToken == null || refreshToken.isEmpty) {
        return false;
      }

      final response = await _dio.post(
        '/api/v1/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(
          headers: {'Authorization': null}, // Don't send old access token
        ),
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        if (data.containsKey('accessToken')) {
          await _storage.write(
            key: 'access_token',
            value: data['accessToken'],
          );
          return true;
        }
      }
      return false;
    } catch (e) {
      if (Environment.enableApiLogging) {
        print('[API] Token refresh failed: $e');
      }
      return false;
    }
  }

  /// Clear all stored tokens
  Future<void> clearTokens() async {
    await _storage.delete(key: 'access_token');
    await _storage.delete(key: 'refresh_token');
  }

  /// Check if user has valid token
  Future<bool> hasValidToken() async {
    final accessToken = await _storage.read(key: 'access_token');
    return accessToken != null && accessToken.isNotEmpty;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /// Retry a request with updated configuration
  Future<Response> _retry(RequestOptions requestOptions) async {
    final options = Options(
      method: requestOptions.method,
      headers: requestOptions.headers,
    );

    return _dio.request(
      requestOptions.path,
      data: requestOptions.data,
      queryParameters: requestOptions.queryParameters,
      options: options,
    );
  }

  /// Enhance error with user-friendly message
  DioException _enhanceError(DioException error) {
    String userMessage;

    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        userMessage =
            'Connection timeout. Please check your internet connection.';
        break;

      case DioExceptionType.badResponse:
        userMessage = _extractErrorMessage(error.response);
        break;

      case DioExceptionType.cancel:
        userMessage = 'Request cancelled.';
        break;

      case DioExceptionType.connectionError:
        userMessage = 'No internet connection. Please check your network.';
        break;

      case DioExceptionType.unknown:
      default:
        userMessage = 'An unexpected error occurred. Please try again.';
    }

    return DioException(
      requestOptions: error.requestOptions,
      response: error.response,
      type: error.type,
      error: userMessage,
    );
  }

  /// Extract error message from response
  String _extractErrorMessage(Response? response) {
    if (response == null) {
      return 'Server error occurred. Please try again later.';
    }

    // Try to extract message from standardized error format
    if (response.data is Map<String, dynamic>) {
      final data = response.data as Map<String, dynamic>;

      // Check for backend standardized format
      if (data.containsKey('error')) {
        final error = data['error'];
        if (error is Map<String, dynamic> && error.containsKey('message')) {
          return error['message'] as String;
        }
        if (error is String) {
          return error;
        }
      }

      // Check for message field
      if (data.containsKey('message')) {
        return data['message'] as String;
      }
    }

    // Fallback to status code message
    switch (response.statusCode) {
      case 400:
        return 'Invalid request. Please check your input.';
      case 401:
        return 'Authentication required. Please log in.';
      case 403:
        return 'Access denied.';
      case 404:
        return 'Resource not found.';
      case 409:
        return 'Conflict. Resource already exists.';
      case 422:
        return 'Validation error. Please check your input.';
      case 500:
      case 502:
      case 503:
        return 'Server error. Please try again later.';
      default:
        return 'Error occurred (${response.statusCode}).';
    }
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /// GET request
  Future<Response> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.get(path, queryParameters: queryParameters, options: options);
  }

  /// POST request
  Future<Response> post(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.post(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }

  /// PUT request
  Future<Response> put(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.put(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }

  /// PATCH request
  Future<Response> patch(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.patch(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }

  /// DELETE request
  Future<Response> delete(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.delete(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }
}
