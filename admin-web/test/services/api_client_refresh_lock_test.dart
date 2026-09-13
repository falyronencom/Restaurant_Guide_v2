import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/environment.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

import '../helpers/wire_stand.dart';

/// Обновление токена: одно на всех, повтор без цикла, провал с одним
/// сигналом.
///
/// Refresh-токен на бэкенде одноразовый (`authService.js`: `used_at`,
/// `REFRESH_TOKEN_REUSE_DETECTED` отзывает все токены пользователя). Панель
/// на старте и после четырёх часов простоя получает 401 сразу на несколько
/// запросов; без замка каждый из них запускал бы своё обновление, первое
/// проходило, остальные выжигали сессию. Повторённый после обновления
/// запрос, получив 401 снова, не должен обновлять токен ещё раз — иначе
/// цикл «обновить-повторить» без дна.
void main() {
  late Map<String, String> storage;
  var expired = 0;

  setUp(() {
    storage = installSecureStorageStand(
      initial: {'access_token': 'stale', 'refresh_token': 'r1'},
    );
    expired = 0;
    SessionEvents.debugReset();
    SessionEvents.expired.listen((_) => expired++);
  });

  String? bearer(RequestOptions o) => o.headers['Authorization'] as String?;

  /// Транспорт «сессия жива, access-токен протух»: защищённый GET отвечает
  /// 401 на `stale` и 200 на `fresh`; обновление отдаёт `fresh` + `r2`.
  StubAdapter liveSession({bool retriedStillRejected = false}) =>
      StubAdapter((o) {
        if (o.uri.path == '/api/v1/auth/refresh') {
          return jsonBody({
            'success': true,
            'data': {'accessToken': 'fresh', 'refreshToken': 'r2'},
          });
        }
        if (retriedStillRejected || bearer(o) != 'Bearer fresh') {
          return jsonBody(
            rejectedBody('TOKEN_EXPIRED', 'Token expired'),
            status: 401,
          );
        }
        return jsonBody({'success': true, 'data': {'ok': o.uri.path}});
      });

  test('два параллельных 401 делят одно обновление, оба повторяются свежим',
      () async {
    final adapter = liveSession();
    final api = stubClient(adapter);

    final results = await Future.wait([
      api.get('/api/v1/admin/badges'),
      api.get('/api/v1/admin/quality/health'),
    ]);

    expect(results.map((r) => r.statusCode), [200, 200]);
    final paths = adapter.requests.map((r) => r.uri.path).toList();
    expect(paths.where((p) => p == '/api/v1/auth/refresh').length, 1,
        reason: 'второе обновление тем же токеном сервер счёл бы повторным '
            'использованием и отозвал бы все токены');
    expect(paths.length, 5, reason: 'два исходных, одно обновление, два повтора');
    expect(storage['access_token'], 'fresh');
    expect(storage['refresh_token'], 'r2');
    expect(expired, 0);
  });

  test('повторённый запрос, получив 401 снова, не обновляет токен ещё раз',
      () async {
    final adapter = liveSession(retriedStillRejected: true);
    final api = stubClient(adapter);

    final error = await api
        .get('/api/v1/admin/badges')
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<DioException>());
    expect((error as DioException).error, 'Token expired',
        reason: 'отказ повтора — настоящий ответ сервера, его и отдаём');
    expect(
      adapter.requests.map((r) => r.uri.path).toList(),
      ['/api/v1/admin/badges', '/api/v1/auth/refresh', '/api/v1/admin/badges'],
      reason: 'исходный, одно обновление, один повтор — и всё',
    );
    expect(expired, 0, reason: 'сессия не мертва: обновление прошло');
  });

  test('упорный 5xx: три повтора и отказ, а не повтор без предела', () async {
    final adapter = StubAdapter(
      (o) => jsonBody(
        rejectedBody('INTERNAL_ERROR', 'Something broke'),
        status: 503,
      ),
      maxRequests: 12,
    );
    final api = stubClient(adapter);

    final error = await api
        .get('/api/v1/admin/badges')
        .timeout(const Duration(seconds: 20))
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<DioException>());
    // Исходный запрос + `Environment.maxRetryAttempts` повторов. Без
    // переноса `extra` в повтор счётчик каждый раз начинался с нуля.
    //
    // С 13.09.2026 этот тест несёт вторую нагрузку: он единственный в базе
    // стережёт, что лестница повторов ВООБЩЕ работает. Путь обновления с неё
    // снят, и счётчики на том пути теперь доказывают обратное — их одних
    // хватило бы, чтобы удалить ветку целиком и остаться зелёными.
    expect(adapter.requests.length, Environment.maxRetryAttempts + 1,
        reason: 'счётчик повторов обязан переезжать в повторённый запрос');
    expect(Environment.maxRetryAttempts, 3,
        reason: 'потолок запинен отдельно: оба счётчика лестницы считают ТЕМ '
            'ЖЕ значением, что и боевой код, и правка 3 → 2 оставила бы их '
            'зелёными');
    expect(expired, 0);
  });

  test('вход остаётся на лестнице 5xx', () async {
    // Страж УЗОСТИ предиката. С лестницы снят только путь обновления: там
    // повтор есть предъявление погашаемого токена, и счёт решает судьбу
    // сессии. У входа погашать нечего — 502 от edge в окно деплоя обязан
    // переживаться тихим повтором, а не отказом оператору.
    final adapter = StubAdapter(
      (o) => jsonBody({'error': 'bad gateway'}, status: 502),
      maxRequests: 12,
    );
    final api = stubClient(adapter);

    await api
        .post('/api/v1/admin/auth/login',
            data: {'email': 'a@b.by', 'password': 'x'})
        .timeout(const Duration(seconds: 20))
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(adapter.requests.length, Environment.maxRetryAttempts + 1,
        reason: 'вход панели повторяется как любой другой запрос');
  });

  test('окно деплоя: 5xx на обновлении не стирает сессию и не объявляет её истёкшей',
      () async {
    var refreshCalls = 0;
    final adapter = StubAdapter(
      (o) {
        if (o.uri.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          return jsonBody({'error': 'bad gateway'}, status: 502);
        }
        return jsonBody(
          rejectedBody('TOKEN_EXPIRED', 'Token expired'),
          status: 401,
        );
      },
      maxRequests: 12,
    );
    final api = stubClient(adapter);

    final error = await api
        .get('/api/v1/admin/badges')
        .timeout(const Duration(seconds: 20))
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<DioException>());
    expect((error as DioException).error,
        'Service temporarily unavailable. Please try again.',
        reason: 'запросу — временная ошибка, а не «войдите снова»');
    // Граница, ради которой путь `/auth/refresh` снят с ветки повторов 5xx
    // (13.09.2026). Раньше лестница УМНОЖАЛАСЬ на повтор цикла: четыре
    // предъявления на два — восемь, и часть выпадала за льготное окно
    // бэкенда, а это 403 и отзыв всех сессий оператора. Теперь цикл равен
    // одному запросу, попытка с повтором — двум, оба внутри окна. Вернись
    // лестница на путь обновления — здесь станет 8.
    //
    // Лестница для ОБЫЧНЫХ запросов цела, её держит тест «упорный 5xx» выше.
    expect(refreshCalls, 2,
        reason: 'попытка и её единственный повтор — лестницы повторов 5xx на '
            'пути обновления больше нет');
    expect(expired, 0, reason: 'сессия жива — уводить на вход нельзя');
    expect(storage['refresh_token'], 'r1',
        reason: 'ещё действующий refresh-токен нельзя выбрасывать по 502');
    expect(storage['access_token'], 'stale');
  });

  test('мёртвый refresh-токен при двух параллельных 401: одно обновление, один сигнал',
      () async {
    final adapter = StubAdapter((o) => jsonBody(
          rejectedBody('REFRESH_TOKEN_EXPIRED', 'Refresh token expired'),
          status: 401,
        ));
    final api = stubClient(adapter);

    final errors = await Future.wait([
      api.get('/api/v1/admin/badges').then<Object?>((_) => null, onError: (Object e) => e),
      api.get('/api/v1/admin/quality/health').then<Object?>((_) => null, onError: (Object e) => e),
    ]);

    expect(errors, everyElement(isA<DioException>()));
    expect(
      errors.map((e) => (e! as DioException).error).toSet(),
      {'Authentication failed. Please log in again.'},
    );
    final paths = adapter.requests.map((r) => r.uri.path).toList();
    expect(paths.where((p) => p == '/api/v1/auth/refresh').length, 1);
    expect(expired, 1, reason: 'провайдер уводит на вход один раз, не дважды');
    expect(storage.containsKey('access_token'), isFalse);
    expect(storage.containsKey('refresh_token'), isFalse);
  });

  test('200 с токеном не той формы: контракт нарушен — сессия мертва',
      () async {
    // Обновление дошло, ответ 200 — но распорядиться им не удалось: сервер
    // провернул ротацию и погасил старый токен, а нового у нас нет. Классом
    // «не дошло» это было бы вечное «Service temporarily unavailable» с
    // мёртвым токеном в хранилище: оператор остался бы на мёртвой сессии
    // навсегда, и каждый его следующий 401 гонял бы обновление впустую.
    // Выход на экран входа честнее. Той же меркой меряется отказ хранилища
    // на записи нового токена — ответ получен, распорядиться нечем.
    final adapter = StubAdapter(
      (o) => o.uri.path == '/api/v1/auth/refresh'
          ? jsonBody({
              'success': true,
              'data': {'accessToken': 42},
            })
          : jsonBody(
              rejectedBody('TOKEN_EXPIRED', 'Token expired'),
              status: 401,
            ),
    );
    final api = stubClient(adapter);

    final error = await api
        .get('/api/v1/admin/badges')
        .timeout(const Duration(seconds: 5))
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<DioException>());
    expect((error! as DioException).error,
        'Authentication failed. Please log in again.',
        reason: 'ответ получен, но сессии за ним уже нет');
    expect(
      adapter.requests.map((r) => r.uri.path).toList(),
      ['/api/v1/admin/badges', '/api/v1/auth/refresh'],
      reason: 'это приговор, а не «не дошло»: повторной попытки цикла нет',
    );
    expect(storage.containsKey('access_token'), isFalse);
    expect(storage.containsKey('refresh_token'), isFalse,
        reason: 'обновлять больше нечем');
    expect(expired, 1, reason: 'провайдер обязан увести оператора на вход');
  });

  test('падение на стирании не отменяет приговор сервера', () async {
    // Хранилище может отказать на стирании — но сервер к этому моменту уже
    // сказал, что токен мёртв. Вердикт от этого не меняется: оставить
    // оператора «вошедшим» над мёртвой сессией хуже, чем оставить в
    // хранилище мусор. Иначе отказ стирания переписывал бы приговор на
    // «временно», а `SessionEvents.reportExpired()` не выполнялся бы вовсе.
    storage = installSecureStorageStand(
      initial: {'access_token': 'stale', 'refresh_token': 'r1'},
      failOnDelete: true,
    );
    final adapter = StubAdapter((o) => jsonBody(
          rejectedBody('REFRESH_TOKEN_EXPIRED', 'Refresh token expired'),
          status: 401,
        ));
    final api = stubClient(adapter);

    final error = await api
        .get('/api/v1/admin/badges')
        .timeout(const Duration(seconds: 5))
        .then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<DioException>());
    expect((error! as DioException).error,
        'Authentication failed. Please log in again.',
        reason: 'вердикт выносит сервер, а не защищённое хранилище');
    expect(expired, 1, reason: 'провайдер обязан узнать об истёкшей сессии');
    expect(storage['refresh_token'], 'r1',
        reason: 'стереть не удалось — токен остался мусором в хранилище');
  });

  group('Повтор обновления', () {
    // До 10.09.2026 повтора обновления здесь не было намеренно: бэкенд считал
    // любое второе предъявление refresh-токена кражей и отзывал все сессии
    // пользователя. Коммит бэкенда `5ede30c` ввёл льготное окно
    // (`REFRESH_REUSE_GRACE_SECONDS`): повтор погашенного токена внутри окна
    // возвращает ТОГО ЖЕ преемника. Запрет снят — владелец замка делает ровно
    // одну повторную попытку по итогу «не дошло».
    test('первая попытка не дошла, вторая прошла: запрос доводится до ответа',
        () async {
      // Ради этого правка и делалась: раньше временный отказ обновления был
      // отказом и самому запросу — оператор видел «Service temporarily
      // unavailable» при живой сессии и ждал, пока не повторит действие сам.
      //
      // Обе формы временного отказа лечит одна и та же попытка, и с провода
      // они неотличимы. Здесь разыгран обрыв связи: запрос не дошёл, ротации
      // не было, токен жив. Вторая форма — дошёл, ротация случилась, ответ
      // потерялся — выглядит так же; там повтор предъявляет погашенный токен
      // и получает того же преемника, пока не истекло окно. Это поведение
      // сервера, и стережёт его бэкенд.
      var refreshCalls = 0;
      final adapter = StubAdapter((o) {
        if (o.uri.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          if (refreshCalls == 1) {
            throw DioException(
              requestOptions: o,
              type: DioExceptionType.connectionError,
            );
          }
          return jsonBody({
            'success': true,
            'data': {'accessToken': 'fresh', 'refreshToken': 'r2'},
          });
        }
        if (bearer(o) != 'Bearer fresh') {
          return jsonBody(
            rejectedBody('TOKEN_EXPIRED', 'Token expired'),
            status: 401,
          );
        }
        return jsonBody({'success': true, 'data': {'ok': o.uri.path}});
      });
      final api = stubClient(adapter);

      final response = await api
          .get('/api/v1/admin/badges')
          .timeout(const Duration(seconds: 5));

      expect(response.statusCode, 200,
          reason: 'вторая попытка удалась — исходный запрос обязан дойти до '
              'ответа в том же действии оператора, а не отказать');
      expect(
        adapter.requests.map((r) => r.uri.path).toList(),
        [
          '/api/v1/admin/badges',
          '/api/v1/auth/refresh',
          '/api/v1/auth/refresh',
          '/api/v1/admin/badges',
        ],
      );
      expect(storage['access_token'], 'fresh');
      expect(storage['refresh_token'], 'r2');
      expect(expired, 0, reason: 'сессия жива — сообщать провайдеру нечего');
    });

    test('сервер отверг токен: повторной попытки нет', () async {
      // Граница повтора. `rejected` — вердикт о самом токене, и второе
      // предъявление его не изменит. На 403 `TOKEN_REUSE_DETECTED` повтор ещё
      // и вреден по существу: сервер уже объявил цепочку скомпрометированной
      // и отозвал все сессии — повтор лишь допишет вторую «SECURITY ALERT» в
      // лог без единого шанса на успех.
      final adapter = StubAdapter((o) => o.uri.path == '/api/v1/auth/refresh'
          ? jsonBody(
              rejectedBody(
                'TOKEN_REUSE_DETECTED',
                'Token reuse detected. All sessions revoked.',
              ),
              status: 403,
            )
          : jsonBody(
              rejectedBody('TOKEN_EXPIRED', 'Token expired'),
              status: 401,
            ));
      final api = stubClient(adapter);

      final error = await api
          .get('/api/v1/admin/badges')
          .timeout(const Duration(seconds: 5))
          .then<Object?>((_) => null, onError: (Object e) => e);

      expect(error, isA<DioException>());
      expect((error! as DioException).error,
          'Authentication failed. Please log in again.');
      expect(
        adapter.requests.map((r) => r.uri.path).toList(),
        ['/api/v1/admin/badges', '/api/v1/auth/refresh'],
        reason: 'ровно одно обращение к обновлению: вердикт окончателен',
      );
    });

    test('не дошло, потом отказ: хоронит вердикт ВТОРОЙ попытки', () async {
      // Переход, которого до этой правки не существовало вовсе: цикл
      // начинается «не дошло», а заканчивается приговором. Ровно так выглядит
      // потерянный после ротации ответ, когда повтор не успел в окно.
      // Решение о захоронении обязано приниматься по ПОСЛЕДНЕМУ итогу: останься
      // в силе первый, хранилище осталось бы с мёртвым токеном, а провайдер
      // «вошедшим», и увести оператора на вход было бы нечем.
      var refreshCalls = 0;
      final adapter = StubAdapter((o) {
        if (o.uri.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          if (refreshCalls == 1) {
            throw DioException(
              requestOptions: o,
              type: DioExceptionType.connectionError,
            );
          }
          return jsonBody(
            rejectedBody(
              'TOKEN_REUSE_DETECTED',
              'Token reuse detected. All sessions revoked.',
            ),
            status: 403,
          );
        }
        return jsonBody(
          rejectedBody('TOKEN_EXPIRED', 'Token expired'),
          status: 401,
        );
      });
      final api = stubClient(adapter);

      final error = await api
          .get('/api/v1/admin/badges')
          .timeout(const Duration(seconds: 5))
          .then<Object?>((_) => null, onError: (Object e) => e);

      expect(error, isA<DioException>());
      expect((error! as DioException).error,
          'Authentication failed. Please log in again.',
          reason: 'вердикт второй попытки, а не временный отказ первой');
      expect(refreshCalls, 2,
          reason: 'приговор пришёл на повторе — третьей попытки не будет');
      expect(storage.containsKey('access_token'), isFalse);
      expect(storage.containsKey('refresh_token'), isFalse);
      expect(expired, 1, reason: 'провайдер уводит на вход ровно один раз');
    });

    test('вторая попытка тоже не дошла: третьей нет', () async {
      // Потолок жёсткий: попытка и повтор, дальше запрос отказывает. Обрыв
      // связи взят намеренно — у него нет ответа, и штатная ветка повторов
      // 5xx не срабатывает: в счётчике остаётся только повтор цикла, без
      // множителя предыдущего теста.
      var refreshCalls = 0;
      final adapter = StubAdapter((o) {
        if (o.uri.path == '/api/v1/auth/refresh') {
          refreshCalls++;
          throw DioException(
            requestOptions: o,
            type: DioExceptionType.connectionError,
          );
        }
        return jsonBody(
          rejectedBody('TOKEN_EXPIRED', 'Token expired'),
          status: 401,
        );
      });
      final api = stubClient(adapter);

      final error = await api
          .get('/api/v1/admin/badges')
          .timeout(const Duration(seconds: 5))
          .then<Object?>((_) => null, onError: (Object e) => e);

      expect(error, isA<DioException>());
      expect((error! as DioException).error,
          'Service temporarily unavailable. Please try again.');
      expect(refreshCalls, 2,
          reason: 'попытка и ровно один повтор — лестницы попыток нет');
      expect(storage['refresh_token'], 'r1',
          reason: 'сессия жива: токен не выброшен');
      expect(expired, 0);
    });
  });
}
