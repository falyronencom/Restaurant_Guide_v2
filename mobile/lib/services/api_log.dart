import 'dart:convert';

import 'package:dio/dio.dart';

// Журнал запросов к серверу для `API_LOG` и сборки `ENV=development`.
//
// Прежде журнал вёл стандартный `LogInterceptor` dio: он печатал все
// заголовки — с `Authorization: Bearer …`, который ставит перехватчик
// клиента, — и тела запросов и ответов как есть: refresh-токен в теле
// `/auth/refresh`, пару токенов в ответе входа, пароль во входе, код из
// письма. Журнал телефона читает любой, кто подключил его к компьютеру, а
// отладочная сборка стоит на телефоне Координатора (Н7, 19.10.2026).
//
// Здесь журнал тот же по смыслу — метод, адрес, заголовки, тела, ошибка, —
// но секреты заменены на [redactedMark].

/// Чем заменяется секрет в журнале.
const String redactedMark = '***';

/// Ключ — секрет: токены всех видов (`Authorization`, `accessToken`,
/// `refresh_token`, `token`, `fcm_token`, `verification_token`…), пароли
/// (`password`, `current_password`, `new_password`), куки и секреты.
///
/// Сравнение без регистра и без `_` / `-`: `refreshToken`, `refresh_token` и
/// `Refresh-Token` — один ключ.
bool _isSecretKey(String key, {required bool request}) {
  final k = key.toLowerCase().replaceAll(RegExp('[_-]'), '');
  if (k == 'authorization' || k == 'cookie' || k == 'setcookie') return true;
  if (k.contains('token') || k.contains('password') || k.contains('secret')) {
    return true;
  }
  // Код из письма уходит в теле запроса полем `code`. В ответах сервера
  // `code` — код отказа («TOKEN_REUSE_DETECTED»), он нужен для разбора и
  // секретом не является.
  return request && k == 'code';
}

/// Копия [value] для журнала: значения секретных ключей заменены на
/// [redactedMark] на любой глубине (карты и списки).
///
/// [request] — тело или заголовки запроса: там секретно ещё и поле `code`.
/// Тело-строка, похожая на JSON, разбирается и чистится так же; другое
/// тело-строка печатается только длиной — в нём может оказаться что угодно.
/// Строки внутри карт и списков печатаются как есть: секрет там узнаётся по
/// ключу.
Object? redactForLog(Object? value, {bool request = false}) {
  if (value is String) {
    final trimmed = value.trimLeft();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return _redact(jsonDecode(value), request: request);
      } on FormatException {
        // не JSON — ниже, длиной
      }
    }
    return value.isEmpty ? value : '<строка, ${value.length} симв.>';
  }
  return _redact(value, request: request);
}

Object? _redact(Object? value, {required bool request}) {
  if (value is Map) {
    return {
      for (final entry in value.entries)
        entry.key: entry.key is String &&
                _isSecretKey(entry.key as String, request: request)
            ? (entry.value == null ? null : redactedMark)
            : _redact(entry.value, request: request),
    };
  }
  if (value is List) {
    return [for (final item in value) _redact(item, request: request)];
  }
  if (value is FormData) {
    return {
      'поля': _redact(
        {for (final f in value.fields) f.key: f.value},
        request: request,
      ),
      'файлы': [for (final f in value.files) '${f.key}: ${f.value.filename}'],
    };
  }
  return value;
}

/// Адрес запроса с замаскированными секретами в строке запроса (`?token=…`).
String redactUriForLog(Uri uri) {
  if (uri.queryParametersAll.isEmpty) return uri.toString();
  final query = <String, List<String>>{
    for (final e in uri.queryParametersAll.entries)
      e.key: _isSecretKey(e.key, request: true)
          ? [redactedMark]
          : e.value,
  };
  return uri.replace(queryParameters: query).toString();
}

/// Перехватчик журнала: печатает через [logPrint] запрос, ответ и ошибку без
/// секретов.
///
/// Клиент ставит его дважды. Запросы и ответы ([errors] = false) — последним,
/// после перехватчика, который добавляет `Authorization`: журнал видит запрос
/// таким, каким он уходит на провод. Ошибки ([requests] = false) — первым:
/// перехватчик ошибок клиента отклоняет их через `handler.reject`, а dio
/// после `reject` следующим перехватчикам ошибку не передаёт — стоящий в
/// конце журнал отказов не видел бы.
class ApiLogInterceptor extends Interceptor {
  ApiLogInterceptor({
    required this.logPrint,
    this.requests = true,
    this.errors = true,
  });

  final void Function(String line) logPrint;

  /// Печатать запросы и ответы.
  final bool requests;

  /// Печатать ошибки.
  final bool errors;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (!requests) return handler.next(options);
    logPrint('→ ${options.method} ${redactUriForLog(options.uri)}');
    logPrint('  заголовки: ${redactForLog(options.headers, request: true)}');
    if (options.data != null) {
      logPrint('  тело: ${redactForLog(options.data, request: true)}');
    }
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (!requests) return handler.next(response);
    final o = response.requestOptions;
    logPrint('← ${response.statusCode} ${o.method} ${redactUriForLog(o.uri)}');
    if (response.data != null) {
      logPrint('  ответ: ${redactForLog(response.data)}');
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (!errors) return handler.next(err);
    final o = err.requestOptions;
    final status = err.response?.statusCode;
    logPrint('✗ ${o.method} ${redactUriForLog(o.uri)} — ${err.type.name}'
        '${status != null ? ' $status' : ''}');
    final data = err.response?.data;
    if (data != null) {
      logPrint('  ответ: ${redactForLog(data)}');
    }
    handler.next(err);
  }
}
