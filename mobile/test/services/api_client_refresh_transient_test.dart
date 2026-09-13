import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/environment.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Провал обновления токена — не всегда конец сессии.
///
/// Перехватчик по 401 идёт обновлять токен, и до этой правки ЛЮБОЙ отказ
/// обновления означал одно: стереть токены и объявить сессию истёкшей.
/// Отказов же два разных рода.
///
///  * Сервер отверг сам токен — 401 просроченного refresh, 403
///    `TOKEN_REUSE_DETECTED`, отключённый аккаунт. Сессии больше нет,
///    хранилище чистится, провайдер уводит на вход.
///  * Обновление не дошло — нет связи, таймаут, 429 лимитера, 5xx в окно
///    деплоя Railway (drain 0 с: 502 держится дольше трёх штатных повторов).
///    Refresh-токен цел и на сервере ещё действителен. Стирать его — значит
///    выбрасывать живую сессию: пользователь выходил из аккаунта из-за
///    секундного обрыва связи и войти обратно без пароля уже не мог.
///
/// Та же правка сделана в панели (`admin-web`, `6a632e6`); здесь — mobile.
///
/// **Прежняя граница честности снята 13.09.2026.** Классификация отказов
/// спасала только те из них, что случились ДО ротации: если запрос дошёл,
/// сервер выдал новую пару, а ответ потерялся, старый токен уже погашен.
/// Автоповтора обновления здесь не было намеренно — при строгой одноразовой
/// ротации повтор погашенным токеном равнялся отзыву всех сессий. Бэкенд
/// `5ede30c` ввёл льготное окно (`REFRESH_REUSE_GRACE_SECONDS`): повтор
/// внутри окна возвращает ТОГО ЖЕ преемника. Запрет снят — владелец замка
/// делает ровно одну повторную попытку по итогу «не дошло», и она лечит обе
/// формы: не дошло (токен жив) и дошло, но ответ потерян (окно отдаёт
/// преемника). Группа «Повтор обновления» ниже — про её границы.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Map<String, String> storage;
  var expired = 0;

  setUp(() {
    storage = installSecureStorageStand({
      'access_token': 'stale',
      'refresh_token': 'alive-r',
    });
    expired = 0;
    SessionEvents.debugReset();
    SessionEvents.expired.listen((_) => expired++);
  });

  ApiClient client(StubAdapter adapter) {
    final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    return ApiClient.withDio(dio);
  }

  bool isRefresh(RequestOptions options) =>
      options.uri.path.endsWith('/auth/refresh');

  /// Ответ защищённого эндпоинта на истёкший access-токен.
  ResponseBody expiredAccess() => jsonBody({
        'success': false,
        'message': 'Access token has expired',
        'error': {'code': 'TOKEN_EXPIRED'},
      }, status: 401);

  /// Лимитер маршрута: 50 запросов в минуту на IP, тело английское.
  ResponseBody rateLimited() => jsonBody({
        'success': false,
        'message': 'Rate limit exceeded, please try again later.',
        'error': {'code': 'RATE_LIMIT_EXCEEDED'},
      }, status: 429);

  List<String> paths(StubAdapter adapter) =>
      adapter.requests.map((r) => r.uri.path).toList();

  int refreshCount(StubAdapter adapter) =>
      paths(adapter).where((p) => p.endsWith('/auth/refresh')).length;

  /// Латиница в сообщении. Пустой список — текст русский. Тот же приём, что
  /// в стороже языка `test/providers/error_language_guard_test.dart`.
  List<String> latinChunks(String message) => RegExp(r'[A-Za-z]{2,}')
      .allMatches(message)
      .map((m) => m.group(0)!)
      .toList();

  /// Ошибка запроса как значение. Таймаут — ограничитель против зависания:
  /// незакрытый замок обновления заставляет следующий 401 ждать вечно, и без
  /// предела тест не падал бы, а висел.
  Future<Object?> failure(
    Future<Response<dynamic>> request, {
    Duration limit = const Duration(seconds: 3),
  }) =>
      request
          .timeout(
            limit,
            onTimeout: () => throw StateError(
              'запрос не завершился за $limit: замок обновления не снят',
            ),
          )
          .then<Object?>((_) => null, onError: (Object e) => e);

  DioException asDio(Object? error) {
    expect(error, isA<DioException>(),
        reason: 'запрос завис или зациклился, а не завершился отказом: $error');
    return error as DioException;
  }

  /// Токены на месте — то есть сессия не похоронена.
  void expectSessionKept() {
    expect(storage['access_token'], 'stale',
        reason: 'временный отказ — не повод стирать access-токен');
    expect(storage['refresh_token'], 'alive-r',
        reason: 'refresh-токен на сервере ещё действителен');
    expect(expired, 0, reason: 'провайдеру нечего сообщать: сессия жива');
  }

  group('Обновление не дошло — сессия жива', () {
    test('429 лимитера: токены целы, текст русский, тело не приложено',
        () async {
      final adapter = StubAdapter(
        (options) => isRefresh(options) ? rateLimited() : expiredAccess(),
        maxRequests: 8,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.get('/api/v1/favorites')));

      expect(error.error, ApiClient.refreshUnavailableMessage);
      expect(latinChunks('${error.error}'), isEmpty,
          reason: 'английское тело лимитера наружу не выходит: ${error.error}');
      expect(error.response, isNull,
          reason: 'booking_provider и media_service предпочитают текст из '
              'response.data — приложенное тело показало бы английскую фразу');
      expect(
          paths(adapter),
          [
            '/api/v1/favorites',
            '/api/v1/auth/refresh',
            '/api/v1/auth/refresh',
          ],
          reason: 'одна повторная попытка — и стоп; исходный запрос не '
              'повторяется, обновлять его нечем');
      expectSessionKept();
    });

    test('обрыв связи: наружу уходит точный текст отказа и его тип', () async {
      final adapter = StubAdapter(
        (options) {
          if (isRefresh(options)) {
            throw DioException(
              requestOptions: options,
              type: DioExceptionType.connectionError,
            );
          }
          return expiredAccess();
        },
        maxRequests: 8,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.get('/api/v1/favorites')));

      expect(error.error, 'Нет связи. Проверьте подключение к интернету.',
          reason: 'у обрыва связи есть свой точный текст — он полезнее общей '
              'фразы про недоступный сервер');
      expect(error.type, DioExceptionType.connectionError,
          reason: 'тип отказа сохраняется: по нему различают ветки выше');
      expect(latinChunks('${error.error}'), isEmpty);
      expectSessionKept();
    });

    test('5xx окна деплоя: после штатных повторов — временный отказ', () async {
      // Единственный тест с реальными паузами: перехватчик повторяет 5xx
      // трижды с 0,5 / 1 / 1,5 с. Railway при drain 0 с держит 502 дольше —
      // именно этот случай выбрасывал оператора панели на экран входа.
      //
      // Счётчик стережёт ПРОИЗВЕДЕНИЕ двух независимых механизмов: штатная
      // ветка 5xx повторяет сам запрос обновления (её путь `/auth/refresh`
      // не исключает — так и задумано, льготное окно бэкенда покрывает и
      // эти предъявления), а поверх неё владелец замка делает одну повторную
      // попытку цикла. Четыре на четыре — восемь; расползание любого из
      // множителей красит этот тест.
      final adapter = StubAdapter(
        (options) => isRefresh(options)
            ? jsonBody({'success': false, 'message': 'Bad Gateway'},
                status: 502)
            : expiredAccess(),
        maxRequests: 12,
      );
      final api = client(adapter);

      final error = asDio(await failure(
        api.get('/api/v1/favorites'),
        limit: const Duration(seconds: 20),
      ));

      expect(error.error, ApiClient.refreshUnavailableMessage);
      expect(latinChunks('${error.error}'), isEmpty);
      expect(refreshCount(adapter), 2 * (Environment.maxRetryAttempts + 1),
          reason: 'два цикла обновления, в каждом — исходный запрос и три '
              'штатных повтора 5xx; и только потом «не дошло»');
      expectSessionKept();
    });

    test('два параллельных 401 при 429: один цикл обновления на двоих',
        () async {
      // Замок обязан остаться и на этом пути. Льготное окно бэкенда его не
      // отменяет: при `REFRESH_REUSE_GRACE_SECONDS=0` сервер по-прежнему
      // считает второе предъявление кражей и гасит все сессии пользователя,
      // а длину окна клиент не знает и знать не должен. Повторная попытка
      // принадлежит ВЛАДЕЛЬЦУ замка — ждавший запрос своей не получает,
      // иначе два 401 дали бы четыре обращения вместо двух.
      final adapter = StubAdapter(
        (options) => isRefresh(options) ? rateLimited() : expiredAccess(),
        maxRequests: 8,
      );
      final api = client(adapter);

      final errors = await Future.wait([
        failure(api.get('/api/v1/favorites')),
        failure(api.get('/api/v1/notifications')),
      ]);

      for (final error in errors) {
        expect(asDio(error).error, ApiClient.refreshUnavailableMessage,
            reason: 'ожидающие замка получают тот же итог, что и владелец');
      }
      expect(refreshCount(adapter), 2,
          reason: 'один цикл на двоих: попытка и её единственный повтор — '
              'второй 401 ждёт чужое обновление, а не запускает своё');
      expect(paths(adapter).length, 4);
      expectSessionKept();
    });
  });

  group('Повтор обновления', () {
    test('первая попытка не дошла, вторая прошла: запрос доводится до ответа',
        () async {
      // Ради этого правка и делалась. Раньше временный отказ обновления был
      // отказом и самому запросу: при живой сессии пользователь видел
      // «Сервер временно недоступен» и ждал, пока сам не повторит действие.
      //
      // Обе формы временного отказа лечит одна и та же попытка, и с провода
      // они неотличимы. Здесь разыгран обрыв связи: запрос не дошёл, ротации
      // не было, токен жив, вторая попытка идёт как первая. Вторая форма —
      // дошёл, ротация случилась, ответ потерялся — на клиенте выглядит так
      // же; там повтор предъявляет уже погашенный токен и получает ТОГО ЖЕ
      // преемника, пока не истекло `REFRESH_REUSE_GRACE_SECONDS`. Это
      // поведение сервера, и стережёт его бэкенд
      // (`integration/auth-refresh-rotation.test.js`): здесь подделать его
      // значило бы проверять собственную заглушку.
      var refreshes = 0;
      final adapter = StubAdapter(
        (options) {
          if (isRefresh(options)) {
            refreshes++;
            if (refreshes == 1) {
              throw DioException(
                requestOptions: options,
                type: DioExceptionType.connectionError,
              );
            }
            return jsonBody({
              'success': true,
              'data': {'accessToken': 'fresh', 'refreshToken': 'fresh-r'},
            });
          }
          return options.headers['Authorization'] == 'Bearer fresh'
              ? jsonBody({
                  'success': true,
                  'data': {'ok': true},
                })
              : expiredAccess();
        },
        maxRequests: 8,
      );
      final api = client(adapter);

      final response = await api
          .get('/api/v1/favorites')
          .timeout(const Duration(seconds: 3));

      expect(response.statusCode, 200,
          reason: 'вторая попытка удалась — исходный запрос обязан дойти до '
              'ответа в том же действии пользователя, а не отказать');
      expect(paths(adapter), [
        '/api/v1/favorites',
        '/api/v1/auth/refresh',
        '/api/v1/auth/refresh',
        '/api/v1/favorites',
      ]);
      expect(adapter.requests.last.headers['Authorization'], 'Bearer fresh',
          reason: 'повтор запроса идёт с токеном второй попытки');
      expect(storage['access_token'], 'fresh');
      expect(storage['refresh_token'], 'fresh-r');
      expect(expired, 0, reason: 'сессия жива — сообщать провайдеру нечего');
    });

    test('сервер отверг токен: повторной попытки нет', () async {
      // Граница повтора. `rejected` — это вердикт о самом токене, и второе
      // предъявление его не изменит. На 403 `TOKEN_REUSE_DETECTED` повтор
      // ещё и вреден по существу: сервер уже объявил цепочку скомпрометиро-
      // ванной и отозвал все сессии — предъявлять ей тот же токен значит
      // писать в лог вторую «SECURITY ALERT» без единого шанса на успех.
      final adapter = StubAdapter(
        (options) => isRefresh(options)
            ? jsonBody({
                'success': false,
                'error': {
                  'code': 'TOKEN_REUSE_DETECTED',
                  'message': 'Token reuse detected. All sessions revoked.',
                },
              }, status: 403)
            : expiredAccess(),
        maxRequests: 8,
      );
      final api = client(adapter);

      // `asDio` здесь — страж против зависания и зацикливания, а не про текст.
      asDio(await failure(api.get('/api/v1/favorites')));

      // Последствия вердикта (стёртое хранилище, единственный сигнал
      // провайдеру, русский текст) стережёт «403 TOKEN_REUSE_DETECTED» в
      // соседней группе — здесь проверяется только число попыток.
      expect(paths(adapter), ['/api/v1/favorites', '/api/v1/auth/refresh'],
          reason: 'ровно одно обращение к обновлению: вердикт окончателен');
    });

    test('не дошло, потом отказ: хоронит вердикт ВТОРОЙ попытки', () async {
      // Переход, которого до этой правки не существовало вовсе: цикл
      // начинается «не дошло», а заканчивается приговором. Ровно так выглядит
      // потерянный после ротации ответ, когда повтор не успел в окно: первая
      // попытка молчит, вторая приносит 403 и отзыв всех сессий.
      //
      // Решение о захоронении обязано приниматься по ПОСЛЕДНЕМУ итогу.
      // Останься в силе первый — хранилище осталось бы с мёртвым токеном, а
      // провайдер «вошедшим»: каждый следующий 401 гонял бы обновление
      // впустую, и выйти на экран входа было бы нечем.
      var refreshes = 0;
      final adapter = StubAdapter(
        (options) {
          if (isRefresh(options)) {
            refreshes++;
            if (refreshes == 1) return rateLimited();
            return jsonBody({
              'success': false,
              'error': {
                'code': 'TOKEN_REUSE_DETECTED',
                'message': 'Token reuse detected. All sessions revoked.',
              },
            }, status: 403);
          }
          return expiredAccess();
        },
        maxRequests: 8,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.get('/api/v1/favorites')));

      expect(error.error, ApiClient.sessionExpiredMessage,
          reason: 'вердикт второй попытки — «войдите заново», а не временный '
              'отказ первой');
      expect(refreshCount(adapter), 2,
          reason: 'приговор пришёл на повторе — третьей попытки не будет');
      expect(storage, isEmpty, reason: 'сессии нет — хранить нечего');
      expect(expired, 1,
          reason: 'провайдер узнаёт об истёкшей сессии ровно один раз');
    });

    test('вторая попытка тоже не дошла: третьей нет, наружу — её отказ',
        () async {
      // Потолок жёсткий: попытка и повтор, дальше запрос отказывает. И итог
      // второй попытки замещает первый целиком — вместе с отказом. Сначала
      // 429 лимитера (у него общая фраза без тела), затем обрыв связи (у
      // него свой точный текст): наружу обязан выйти второй.
      var refreshes = 0;
      final adapter = StubAdapter(
        (options) {
          if (isRefresh(options)) {
            refreshes++;
            if (refreshes == 1) return rateLimited();
            throw DioException(
              requestOptions: options,
              type: DioExceptionType.connectionError,
            );
          }
          return expiredAccess();
        },
        maxRequests: 8,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.get('/api/v1/favorites')));

      expect(error.error, 'Нет связи. Проверьте подключение к интернету.',
          reason: 'наружу уходит отказ ПОСЛЕДНЕЙ попытки: первый уже неверно '
              'описывает положение дел');
      expect(error.type, DioExceptionType.connectionError);
      expect(refreshCount(adapter), 2,
          reason: 'попытка и ровно один повтор — лестницы попыток нет');
      expectSessionKept();
    });
  });

  group('Сервер отверг токен — сессия мертва', () {
    test('403 TOKEN_REUSE_DETECTED: токены стёрты, сигнал один', () async {
      // Граница классификации: 4xx, кроме 429, — приговор токену. Отзыв всех
      // сессий уже случился на бэкенде, держаться за стёртый токен незачем.
      final adapter = StubAdapter(
        (options) => isRefresh(options)
            ? jsonBody({
                'success': false,
                'error': {
                  'code': 'TOKEN_REUSE_DETECTED',
                  'message': 'Token reuse detected. All sessions revoked.',
                },
              }, status: 403)
            : expiredAccess(),
        maxRequests: 8,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.get('/api/v1/favorites')));

      expect(error.error, ApiClient.sessionExpiredMessage);
      expect(latinChunks('${error.error}'), isEmpty);
      expect(storage, isEmpty, reason: 'сессии нет — хранить нечего');
      expect(expired, 1,
          reason: 'провайдер узнаёт об истёкшей сессии ровно один раз');
    });

    test('200 с токеном не той формы: контракт нарушен — сессия мертва',
        () async {
      // Сервер провернул ротацию и погасил старый токен, а нового у нас нет:
      // распорядиться ответом не удалось. «Временный» отказ здесь означал бы
      // вечное «Сервер временно недоступен» с мёртвым токеном в хранилище —
      // выход на экран входа честнее.
      final adapter = StubAdapter(
        (options) => isRefresh(options)
            ? jsonBody({
                'success': true,
                'data': {'accessToken': 42},
              })
            : expiredAccess(),
        maxRequests: 8,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.get('/api/v1/favorites')));

      expect(error.error, ApiClient.sessionExpiredMessage);
      expect(storage, isEmpty, reason: 'обновлять больше нечем');
      expect(expired, 1);
    });
  });

  group('Отказ хранилища', () {
    test('падение на стирании не отменяет приговор сервера', () async {
      // Keystore может отказать на стирании — но сервер к этому моменту уже
      // сказал, что токен мёртв. Проглотить отказ хранилища и оставить
      // пользователя «вошедшим» над мёртвой сессией хуже, чем оставить в
      // хранилище мусор: каждый следующий 401 гонял бы обновление впустую,
      // а провайдер так и не узнал бы, что входить надо заново.
      installFailingStorage(storage, onDelete: true);
      final adapter = StubAdapter(
        (options) => isRefresh(options)
            ? jsonBody({
                'success': false,
                'error': {'code': 'TOKEN_EXPIRED', 'message': 'expired'},
              }, status: 401)
            : expiredAccess(),
        maxRequests: 12,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.get('/api/v1/favorites')));

      expect(error.error, ApiClient.sessionExpiredMessage,
          reason: 'вердикт выносит сервер, а не защищённое хранилище');
      expect(expired, 1, reason: 'провайдер обязан узнать об истёкшей сессии');
      expect(storage['refresh_token'], 'alive-r',
          reason: 'стереть не удалось — токен остался мусором в хранилище');
    });

    test('падение на чтении токена: итог временный, замок снят', () async {
      // Отказ ДО запроса: погашен ли refresh-токен на сервере, отсюда не
      // видно, и хоронить сессию не по чему. Это же единственный путь, где
      // исключение проходит через владельца замка: пройди снятие замка мимо
      // `finally`, второй запрос ждал бы обновление, которого уже не будет,
      // — приложение замирает без единого сообщения.
      installFailingStorage(storage, onRefreshTokenRead: true);
      final adapter = StubAdapter((_) => expiredAccess(), maxRequests: 12);
      final api = client(adapter);

      final first = asDio(await failure(api.get('/api/v1/favorites')));
      final second = asDio(await failure(api.get('/api/v1/notifications')));

      expect(first.error, ApiClient.refreshUnavailableMessage);
      expect(second.error, ApiClient.refreshUnavailableMessage,
          reason: 'замок снят — второй запрос дошёл до отказа, а не завис');
      expect(refreshCount(adapter), 0,
          reason: 'токен прочитать не удалось — обновлять было нечем');
      expect(expired, 0, reason: 'сессия не объявлена мёртвой');
    });
  });
}

/// Хранилище с отказом Keystore на выбранной операции.
///
/// Стенд `installSecureStorageStand` держит исправную карту в памяти;
/// расширить его параметром нельзя — у него необязательный позиционный
/// аргумент, а именованный к такому в Dart не добавить. Поэтому мок канала
/// подменяется здесь, поверх стенда, и только для этого файла.
///
/// Отказы разведены намеренно: падение на СТИРАНИИ приходит уже после
/// приговора сервера, падение на ЧТЕНИИ refresh-токена — до всякого запроса.
/// Итоги у них обязаны быть разные.
void installFailingStorage(
  Map<String, String> storage, {
  bool onDelete = false,
  bool onRefreshTokenRead = false,
}) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(secureStorageChannel, (call) async {
    final args = call.arguments as Map?;
    final failure = PlatformException(
      code: 'Keystore',
      message: 'secure storage unavailable',
    );
    switch (call.method) {
      case 'read':
        final key = args!['key'] as String;
        // Падает только чтение refresh-токена: access-токен читает
        // перехватчик запросов, и его отказ не дал бы дойти до ветки 401.
        if (onRefreshTokenRead && key == 'refresh_token') throw failure;
        return storage[key];
      case 'write':
        storage[args!['key'] as String] = args['value'] as String;
        return null;
      case 'delete':
        if (onDelete) throw failure;
        storage.remove(args!['key'] as String);
        return null;
      case 'deleteAll':
        if (onDelete) throw failure;
        storage.clear();
        return null;
      case 'containsKey':
        return storage.containsKey(args!['key'] as String);
      case 'readAll':
        return Map<String, String>.of(storage);
    }
    return null;
  });
}
