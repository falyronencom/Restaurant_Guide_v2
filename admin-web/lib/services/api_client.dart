import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:restaurant_guide_admin_web/config/environment.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

/// Итог попытки обновить токен.
///
/// [rejected] — сервер отверг обновление (просроченный или повторно
/// использованный refresh, отключённый аккаунт): сессия мертва, хранилище
/// чистится, провайдер уводит на вход. [transient] — обновление не дошло
/// (сеть, 5xx в окно деплоя Railway): сессия жива, токены остаются, следующий
/// запрос попробует снова. Смешивать их нельзя: стирание по 502 выбрасывало
/// бы ещё действующий refresh-токен и уводило оператора на вход посреди
/// работы (ревью Phase 3.5, 09.09.2026).
enum _RefreshOutcome { refreshed, rejected, transient }

/// HTTP API client with authentication and error handling
/// Built on Dio with custom interceptors for token management
class ApiClient {
  final Dio _dio;
  final FlutterSecureStorage _storage;

  /// Замок обновления токена: параллельные 401 делят ОДНО обновление.
  ///
  /// Refresh-токен на бэкенде одноразовый: второе обновление тем же токеном
  /// сервер считает повторным использованием и отзывает все токены
  /// пользователя. Без замка четыре запроса дашборда, получив 401 разом
  /// после четырёх часов простоя, запускали бы четыре обновления — первое
  /// проходило, остальные три выжигали сессию. Образец — mobile.
  Completer<_RefreshOutcome>? _refreshCompleter;

  // Singleton pattern
  static final ApiClient _instance = ApiClient.withDio(_defaultDio());
  factory ApiClient() => _instance;

  /// Собирает клиент поверх готового Dio.
  ///
  /// Прод по-прежнему ходит через синглтон `ApiClient()` — поведение не
  /// изменилось. Конструктор доступен потому, что класс с одним лишь
  /// приватным генеративным конструктором нельзя ни собрать поверх
  /// подставного транспорта, ни унаследовать: в тестах не остаётся ни одной
  /// точки входа.
  ApiClient.withDio(Dio dio)
      : _dio = dio,
        _storage = const FlutterSecureStorage() {
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
        logPrint: (obj) => debugPrint('[API] $obj'),
      ));
    }
  }

  /// Транспорт прод-сборки: базовый адрес и таймауты из `Environment`.
  static Dio _defaultDio() => Dio(
        BaseOptions(
          baseUrl: Environment.apiBaseUrl,
          connectTimeout:
              const Duration(seconds: Environment.apiConnectTimeout),
          receiveTimeout: const Duration(seconds: Environment.apiTimeout),
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          listFormat: ListFormat.multiCompatible,
        ),
      );

  // ============================================================================
  // Request Interceptor - Adds authentication token
  // ============================================================================

  Interceptor _createRequestInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) async {
        final accessToken = await _storage.read(key: 'access_token');
        if (accessToken != null && accessToken.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $accessToken';
        }
        handler.next(options);
      },
    );
  }

  // ============================================================================
  // Response Interceptor - Extracts and stores tokens from responses
  // ============================================================================

  Interceptor _createResponseInterceptor() {
    return InterceptorsWrapper(
      onResponse: (response, handler) async {
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
  // Error Interceptor - Handles 401 refresh and 5xx retry
  // ============================================================================

  /// Пути, чей 401 — отказ в учётных данных, а не истёкшая сессия: сам вход
  /// (панельный и общий) и само обновление токена.
  static const List<String> _credentialPaths = <String>[
    '/api/v1/admin/auth/login',
    '/api/v1/auth/login',
    '/api/v1/auth/refresh',
  ];

  static bool _isCredentialRequest(RequestOptions options) =>
      _credentialPaths.any((path) => options.uri.path.endsWith(path));

  /// Метка запроса, уже повторённого после обновления токена. Его 401 —
  /// ответ по существу (право отозвано, роль изменилась), а не истёкшая
  /// сессия: второе обновление и второй повтор дали бы цикл без дна.
  static const String _retriedAfterRefresh = 'retriedAfterRefresh';

  Interceptor _createErrorInterceptor() {
    return InterceptorsWrapper(
      onError: (error, handler) async {
        // Handle 401 Unauthorized - try to refresh token.
        //
        // Кроме запросов за учётными данными: 401 на сам вход означает
        // «пароль не принят», а не «сессия истекла», и обновлять по нему
        // токен нечем и незачем. Раньше такой 401 уходил в эту же ветку и
        // подменялся текстом про повторный вход — опечатавшийся видел общую
        // «Ошибку входа» вместо «Неверный email или пароль». А 401 на само
        // обновление возвращался сюда же и запускал обновление заново, пока
        // сервер не отвечал 429: просроченный refresh-токен превращался в
        // шторм запросов. Ответ сервера таким запросам отдаётся как есть.
        // И кроме уже повторённого запроса (см. [_retriedAfterRefresh]).
        if (error.response?.statusCode == 401 &&
            !_isCredentialRequest(error.requestOptions) &&
            error.requestOptions.extra[_retriedAfterRefresh] != true) {
          final outcome = await _attemptTokenRefresh();
          if (outcome == _RefreshOutcome.refreshed) {
            error.requestOptions.extra[_retriedAfterRefresh] = true;
            try {
              final response = await _retry(error.requestOptions);
              return handler.resolve(response);
            } on DioException catch (e) {
              // Отказ повтора — настоящий ответ сервера на свежий токен;
              // отдаём его, а не исходный 401 без текста.
              return handler.reject(e);
            } catch (_) {
              return handler.reject(error);
            }
          } else if (outcome == _RefreshOutcome.transient) {
            // Обновление не дошло: токены на месте, сессия жива — запросу
            // временная ошибка, а не «войдите снова». Обновление к этому
            // моменту уже повторено — ровно один раз и владельцем замка
            // (см. [_attemptTokenRefresh]); повторять его здесь значило бы
            // дать каждому ждавшему запросу свою попытку.
            return handler.reject(
              DioException(
                requestOptions: error.requestOptions,
                error: 'Service temporarily unavailable. Please try again.',
                type: DioExceptionType.badResponse,
              ),
            );
          } else {
            // Сервер отверг обновление: хранилище уже очищено владельцем
            // замка, провайдер уведомлён (OSB-M I5) — здесь только отказ.
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

        final enhancedError = _enhanceError(error);
        handler.reject(enhancedError);
      },
    );
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /// Обновить токен один раз на всех, кто получил 401 одновременно.
  ///
  /// Владелец замка выполняет обновление и, если оно провалилось, сам
  /// чистит хранилище и сообщает провайдеру об истёкшей сессии — ровно один
  /// раз на цикл. Ожидающие получают только результат. Запрос обновления
  /// идёт через тот же `Dio`, но его собственный 401 сюда не возвращается:
  /// путь исключён в [_isCredentialRequest], иначе замок ждал бы сам себя.
  ///
  /// **Одна повторная попытка на цикл, и только по [_RefreshOutcome.transient].**
  /// До 10.09.2026 повтора здесь не было намеренно: бэкенд считал любое второе
  /// предъявление refresh-токена кражей и отзывал все сессии пользователя.
  /// Коммит `5ede30c` ввёл льготное окно (`REFRESH_REUSE_GRACE_SECONDS`):
  /// повтор погашенного токена внутри окна возвращает ТОГО ЖЕ преемника, а не
  /// отзыв. Запрет снят, и повтор лечит обе формы временного отказа разом —
  /// запрос не дошёл (ротации не было, токен жив) и запрос дошёл, но ответ
  /// потерялся (повтор успевает в окно). Иначе оператор панели получал отказ
  /// при живой сессии и ждал собственного следующего действия.
  ///
  /// Границы. Повторная попытка одна и без паузы: лестница задержек здесь
  /// растянула бы цикл, а длину окна клиенту знать нельзя — это число
  /// сервера, оно меняется без пересборки панели.
  ///
  /// **Но цикл не равен одному запросу, и «успевает в окно» — про шанс, а не
  /// про гарантию.** 5xx С ТЕЛОМ ловит штатная ветка повторов перехватчика
  /// (`Environment.maxRetryAttempts`), и путь `/auth/refresh` она не
  /// исключает — намеренно: частый 502 от edge до приложения не доходит,
  /// ротации не было, и повтор спасает сессию. Итого худший счёт предъявлений
  /// токена за цикл — `2 * (maxRetryAttempts + 1)` = 8, на двух лестницах по
  /// 0,5 / 1 / 1,5 с. При медленном 5xx последние предъявления выпадают за
  /// окно и дают 403 с отзывом всех сессий. Ухудшением это не является: тот
  /// же погашенный токен предъявило бы следующее действие оператора — уже
  /// заведомо за окном, — но и доказательством безопасности комментарий выше
  /// считать нельзя.
  ///
  /// [_RefreshOutcome.rejected] не повторяется никогда: сервер отверг сам
  /// токен, второе предъявление лишь повторит отказ. Замок окно не отменяет:
  /// при `REFRESH_REUSE_GRACE_SECONDS=0` поведение бэкенда прежнее, строгое.
  Future<_RefreshOutcome> _attemptTokenRefresh() {
    final inFlight = _refreshCompleter;
    if (inFlight != null) return inFlight.future;

    final completer = Completer<_RefreshOutcome>();
    _refreshCompleter = completer;
    () async {
      var outcome = _RefreshOutcome.transient;
      try {
        outcome = await _doTokenRefresh();
        if (outcome == _RefreshOutcome.transient) {
          // Единственный повтор цикла: итог второй попытки замещает первый.
          outcome = await _doTokenRefresh();
        }
        if (outcome == _RefreshOutcome.rejected) {
          try {
            await clearTokens();
          } catch (_) {
            // Хранилище не отдало стирание. Вердикт сервера от этого не
            // меняется: токен мёртв, и оставить оператора «вошедшим» над
            // мёртвой сессией хуже, чем оставить в хранилище мусор — каждый
            // следующий 401 гонял бы обновление мёртвым токеном впустую, а
            // общий `catch` ниже переписал бы приговор на «временно».
          }
          // Хранилище пусто, обновить сессию больше нечем — об этом обязан
          // узнать провайдер авторизации, иначе он останется «вошедшим»
          // с пустым хранилищем (OSB-M I5). Слушатель сам отличает
          // истёкшую сессию от неудачного входа по своему состоянию.
          SessionEvents.reportExpired();
        }
      } catch (_) {
        // Исключение хранилища или транспорта: сессию не хороним, но и
        // обновлённой не считаем.
        outcome = _RefreshOutcome.transient;
      } finally {
        // Только в finally: если замок не снять, каждый следующий 401 будет
        // ждать его вечно — спиннеры без конца и без редиректа на вход
        // (ревью Phase 3.5, MEDIUM).
        _refreshCompleter = null;
        completer.complete(outcome);
      }
    }();
    return completer.future;
  }

  Future<_RefreshOutcome> _doTokenRefresh() async {
    final refreshToken = await _storage.read(key: 'refresh_token');
    if (refreshToken == null || refreshToken.isEmpty) {
      // Нечем обновлять — сессии нет.
      return _RefreshOutcome.rejected;
    }
    try {

      final response = await _dio.post(
        '/api/v1/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(
          headers: {'Authorization': null},
        ),
      );

      if (response.statusCode == 200 &&
          response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;
        if (responseData.containsKey('accessToken')) {
          await _storage.write(
            key: 'access_token',
            value: responseData['accessToken'] as String,
          );
          if (responseData.containsKey('refreshToken')) {
            await _storage.write(
              key: 'refresh_token',
              value: responseData['refreshToken'] as String,
            );
          }
          return _RefreshOutcome.refreshed;
        }
      }
      // 200 без токенов — контракт нарушен, обновлять дальше нечем.
      return _RefreshOutcome.rejected;
    } on DioException catch (e) {
      // 4xx (кроме 429) — сервер отверг сам токен: просрочен, повторно
      // использован, аккаунт отключён. Всё остальное — не дошло: сеть, 5xx
      // окна деплоя, лимит запросов.
      final status = e.response?.statusCode;
      if (status != null && status >= 400 && status < 500 && status != 429) {
        return _RefreshOutcome.rejected;
      }
      return _RefreshOutcome.transient;
    } catch (_) {
      // Ответ получен, но распорядиться им не удалось: хранилище не приняло
      // новый токен или тело 200 оказалось не той формы. Старый токен сервер
      // уже погасил, нового у нас нет — сессии нет. Вывести на вход честнее,
      // чем навсегда оставить оператора с мёртвым токеном на «временной»
      // ошибке: она держала бы его на мёртвой сессии вечно.
      return _RefreshOutcome.rejected;
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

  Future<Response> _retry(RequestOptions requestOptions) async {
    // `extra` обязан переехать в повтор: в нём метка [_retriedAfterRefresh]
    // и счётчик `retryCount` для 5xx. До 09.09.2026 повтор собирался без
    // него — метка терялась, а счётчик каждый раз начинался с нуля, и
    // упорно падающий эндпоинт повторялся бы без предела.
    final options = Options(
      method: requestOptions.method,
      headers: requestOptions.headers,
      extra: requestOptions.extra,
    );
    return _dio.request(
      requestOptions.path,
      data: requestOptions.data,
      queryParameters: requestOptions.queryParameters,
      options: options,
    );
  }

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

  String _extractErrorMessage(Response? response) {
    if (response == null) {
      return 'Server error occurred. Please try again later.';
    }

    if (response.data is Map<String, dynamic>) {
      final data = response.data as Map<String, dynamic>;
      if (data.containsKey('error')) {
        final error = data['error'];
        if (error is Map<String, dynamic> && error.containsKey('message')) {
          return error['message'] as String;
        }
        if (error is String) {
          return error;
        }
      }
      if (data.containsKey('message')) {
        return data['message'] as String;
      }
    }

    switch (response.statusCode) {
      case 400:
        return 'Invalid request. Please check your input.';
      case 401:
        return 'Authentication required. Please log in.';
      case 403:
        return 'Access denied.';
      case 404:
        return 'Resource not found.';
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

  Future<Response> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.get(path, queryParameters: queryParameters, options: options);
  }

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
