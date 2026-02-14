import 'package:dio/dio.dart';

/// Maps exceptions to user-friendly Russian error messages.
/// Reference pattern: write_review_screen.dart _getErrorMessage()
String getHumanErrorMessage(dynamic error) {
  if (error is DioException) {
    return _mapDioError(error);
  }

  if (error is String) {
    return _fallbackMessage;
  }

  return _fallbackMessage;
}

String _mapDioError(DioException e) {
  // Network / connection errors
  if (e.type == DioExceptionType.connectionTimeout ||
      e.type == DioExceptionType.receiveTimeout ||
      e.type == DioExceptionType.sendTimeout ||
      e.type == DioExceptionType.connectionError) {
    return 'Не удалось подключиться к серверу. Проверьте интернет-соединение.';
  }

  final statusCode = e.response?.statusCode;
  if (statusCode == null) {
    return _fallbackMessage;
  }

  // Auth errors
  if (statusCode == 401) {
    return 'Неверный email или пароль.';
  }

  // Conflict (duplicate account, etc.)
  if (statusCode == 409) {
    return 'Аккаунт с таким email уже существует.';
  }

  // Validation errors — try to extract message from response
  if (statusCode == 400 || statusCode == 422) {
    final message = _extractServerMessage(e.response?.data);
    return message ?? 'Проверьте введённые данные.';
  }

  // Rate limiting
  if (statusCode == 429) {
    return 'Слишком много запросов. Попробуйте позже.';
  }

  // Server errors
  if (statusCode >= 500) {
    return 'Ошибка сервера. Попробуйте позже.';
  }

  return _fallbackMessage;
}

/// Try to extract a human-readable message from the API error response.
String? _extractServerMessage(dynamic data) {
  if (data is Map) {
    // Format: { "error": { "message": "..." } }
    final error = data['error'];
    if (error is Map) {
      final message = error['message'];
      if (message is String && message.isNotEmpty) {
        return message;
      }
    }
    // Format: { "message": "..." }
    final message = data['message'];
    if (message is String && message.isNotEmpty) {
      return message;
    }
  }
  return null;
}

const _fallbackMessage = 'Произошла ошибка. Попробуйте ещё раз.';
