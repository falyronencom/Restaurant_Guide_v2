import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/utils/server_refusal_text.dart';

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

/// Текст отказа запроса для человека — или [fallback], если готового нет.
///
/// `ApiClient` пересобирает каждый отказ и кладёт в `DioException.error`
/// готовую фразу для человека: текст сервера как есть («Одно из фото или
/// файлов меню загружено не с этой учётной записи…»; по-русски пока не все —
/// общие тексты бэкенда английские) или свою, русскую («Нет связи…»). Её и
/// показывать: сервер знает про случай больше клиента. `toString()`
/// исключения на экран не годится никогда — это текст для программиста:
/// `DioException [bad response]: null`, перевод строки, `Error:` и лишь потом
/// фраза. До 07.10.2026 партнёр читал его при каждой неудачной правке
/// карточки.
///
/// Готовой фразы нет у сбоя сервера: исчерпав повторы 5xx, транспорт отдаёт
/// наверх исходный отказ dio — `error` пуст, а в `toString()` четыре строки
/// английского. Нет её и у исключений не из транспорта. Для них — [fallback];
/// параметр обязательный, чтобы ни у одного вызова не было пути к
/// `toString()`.
///
/// Не путать с [getHumanErrorMessage]: та берёт русский текст сервера, а без
/// него переводит отказ по коду статуса фразами экрана входа (401 —
/// «Неверный email или пароль.»); английский текст сервера пропускает только
/// для 400 и 422.
String userMessageOf(Object error, {required String fallback}) {
  if (error is DioException && error.error is String) {
    return error.error as String;
  }
  return fallback;
}

/// Русский текст отказа или сбоя для человека — или [fallback].
///
/// Сначала русский текст сервера из тела ответа (общий разбор
/// [russianServerText]: мат, лимит, блокировка), затем русская фраза, которую
/// `ApiClient` положил в `DioException.error` («Нет связи…», «Необходима
/// авторизация…», фраза по коду статуса). Английское на экран не идёт: часть
/// отказов бэкенда ещё английская — там [fallback]. Отказы удаления и правки
/// отзыва и ответа владельца сервер отдаёт по-русски с 18.10.2026.
///
/// Отличие от [userMessageOf]: та пропускает и английский текст сервера.
String russianFailureText(Object error, {required String fallback}) {
  if (error is DioException) {
    final fromServer = russianServerText(error.response?.data);
    if (fromServer != null) return fromServer;
    final prepared = error.error;
    if (prepared is String && hasCyrillic(prepared)) return prepared.trim();
  }
  return fallback;
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

  // Русский текст сервера — первым: отказы входа и регистрации сервер пишет
  // по-русски (backend/src/constants/authRefusals.js), и он знает про случай
  // больше, чем код статуса.
  final fromServer = russianServerText(e.response?.data);
  if (fromServer != null) return fromServer;

  // Auth errors
  if (statusCode == 401) {
    return 'Неверный email или пароль.';
  }

  // 409 без русского текста — общая фраза. Прежде здесь стояло «Аккаунт с
  // таким email уже существует.» на любой 409 — неверно для всякого
  // конфликта, кроме занятой почты, и словом, которое в приложении больше
  // не пишут (слово Координатора 29.10.2026: «учётная запись»).
  if (statusCode == 409) {
    return _fallbackMessage;
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
