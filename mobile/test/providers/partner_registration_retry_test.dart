import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';

import '../support/wire_stand.dart';

/// Повторное «Отправить на верификацию» после того, как отправка новой
/// карточки не прошла.
///
/// Отправка — два запроса: создать черновик (POST, 201) и отправить его на
/// модерацию (POST /:id/submit). До 13.10.2026, если второй не доходил,
/// карточка оставалась черновиком, а повтор создавал её заново — и сервер
/// отказывал по-английски: заведение с таким названием у партнёра уже есть.
///
/// Сервер здесь — маленькая модель production: создание отказывает 409
/// DUPLICATE_ESTABLISHMENT, если карточка уже создана, правка — если новое
/// название занято другим заведением партнёра; отправка отказывает 400
/// INVALID_STATUS_FOR_SUBMISSION, если карточка уже не черновик. Ответ на
/// создание — с полями, без которых приложение не разберёт карточку
/// (`created_at`, `updated_at`). Тексты и коды — из `establishmentService.js`
/// и `rateLimiter.js`, конверт — `errorHandler` в production. Остальные
/// проверки сервера (точка в городе, лимиты фото) модель не повторяет.
/// Сбои подкладываются под запрос нужного вида: «нет связи» — запрос не
/// дошёл; «ответ потерялся» — сервер запрос выполнил, а ответа нет; «сбой
/// сервера» — 500 на исходный запрос и все повторы транспорта.
///
/// Тексты партнёра — точным равенством, литералами решения Координатора
/// 13.10.2026.
const _id = '11111111-2222-3333-4444-555555555555';
const _base = '/api/v1/partner/establishments';

const _draftTail = 'Заведение сохранено как черновик — '
    'нажмите «Отправить на верификацию» ещё раз.';

const _alreadyCreatedHint =
    'Заведение с таким названием уже есть в вашем профиле — возможно, оно '
    'создалось при прошлой попытке. Откройте его в профиле и нажмите '
    '«Отправить на модерацию».';

const _duplicateText = 'You already have an establishment with this name';

/// Текст `validateCityCoordinates` бэкенда: точка за рамкой города.
const _cityMismatchText = 'Coordinates (53.6, 27.9) are outside Минск city '
    'bounds. Expected: lat 53.75-54.1, lon 27.3-27.85. Please verify the '
    'address and coordinates match the selected city.';

/// Ответ лимитера запросов (`middleware/rateLimiter.js`).
const _rateLimitText = 'Rate limit exceeded. Please try again later.';

enum _Fault { noConnection, answerLost, serverDown, cityMismatch, rateLimited }

Map<String, dynamic> _refusal(String message, String code) => {
      'success': false,
      'message': message,
      'error': {'code': code},
      'timestamp': '2026-10-13T10:00:00.000Z',
    };

const _pdf = MenuPdf(
  url: 'https://res.cloudinary.com/demo/image/upload/menu_pdf/m.pdf',
  thumbnailUrl: 'https://res.cloudinary.com/demo/image/upload/pg_1/menu_pdf/m.jpg',
  previewUrl: 'https://res.cloudinary.com/demo/image/upload/pg_1/menu_pdf/m.jpg',
  fileName: 'Меню.pdf',
);

/// Карточка, которая проходит проверку итогового шага мастера, — с PDF-меню.
const _completeCard = PartnerRegistration(
  categories: ['restaurant'],
  cuisineTypes: ['european'],
  name: 'Кофейня у моста',
  priceRange: r'$$',
  interiorPhotos: ['https://res.cloudinary.com/demo/image/upload/a.jpg'],
  menuPhotos: ['https://res.cloudinary.com/demo/image/upload/b.jpg'],
  menuPdfs: [_pdf],
  primaryPhotoUrl: 'https://res.cloudinary.com/demo/image/upload/a.jpg',
  city: 'Минск',
  street: 'Немига',
  building: '1',
  legalName: 'ООО «Мост»',
  unp: '123456789',
  contactPerson: 'Анна',
  contactEmail: 'anna@example.com',
);

void main() {
  // Состояние сервера.
  late bool created;
  late String status;
  // Названия других заведений этого партнёра: правка в такое название —
  // 409, как и создание.
  late Set<String> namesakes;
  // Сбой под очередной запрос вида 'create' / 'submit' / 'update'.
  late Map<String, _Fault> faults;
  late StubAdapter wire;

  String kindOf(RequestOptions o) {
    if (o.method == 'POST' && o.path == _base) return 'create';
    if (o.method == 'POST' && o.path == '$_base/$_id/submit') return 'submit';
    if (o.method == 'PUT' && o.path == '$_base/$_id') return 'update';
    throw StateError('неожиданный запрос: ${o.method} ${o.path}');
  }

  ResponseBody serve(RequestOptions o) {
    switch (kindOf(o)) {
      case 'create':
        if (created) {
          return jsonBody(
            _refusal(_duplicateText, 'DUPLICATE_ESTABLISHMENT'),
            status: 409,
          );
        }
        created = true;
        return jsonBody({
          'success': true,
          'data': {
            'establishment': {
              'id': _id,
              'name': 'Кофейня у моста',
              'city': 'Минск',
              'address': 'Немига, 1',
              'status': 'draft',
              'created_at': '2026-10-13T10:00:00.000Z',
              'updated_at': '2026-10-13T10:00:00.000Z',
            },
            // Первая карточка делает пользователя партнёром — сервер выдаёт
            // ключи с новой ролью.
            'tokens': {
              'accessToken': 'partner-access',
              'refreshToken': 'partner-refresh',
            },
          },
          'message': 'Establishment created successfully in draft status',
        }, status: 201);
      case 'submit':
        if (status != 'draft') {
          return jsonBody(
            _refusal(
              "Cannot submit establishment with status '$status'. Only draft, "
              'rejected, or suspended establishments can be submitted.',
              'INVALID_STATUS_FOR_SUBMISSION',
            ),
            status: 400,
          );
        }
        status = 'pending';
        return jsonBody({
          'success': true,
          'data': {
            'establishment': {'id': _id, 'status': 'pending'},
          },
          'message': 'Establishment submitted for moderation review',
        });
      default: // update
        final name = (o.data as Map<String, dynamic>)['name'];
        if (namesakes.contains(name)) {
          return jsonBody(
            _refusal(_duplicateText, 'DUPLICATE_ESTABLISHMENT'),
            status: 409,
          );
        }
        return jsonBody({
          'success': true,
          'data': {
            'establishment': {'id': _id, 'status': status},
          },
        });
    }
  }

  setUp(() {
    created = false;
    status = 'draft';
    namesakes = {};
    faults = {};
    wire = installWireStand((o) {
      switch (faults[kindOf(o)]) {
        case _Fault.noConnection:
          throw DioException(
            requestOptions: o,
            type: DioExceptionType.connectionError,
          );
        case _Fault.answerLost:
          serve(o);
          throw DioException(
            requestOptions: o,
            type: DioExceptionType.receiveTimeout,
          );
        case _Fault.serverDown:
          return jsonBody(
            _refusal("Cannot read properties of undefined (reading 'id')",
                'INTERNAL_ERROR'),
            status: 500,
          );
        case _Fault.cityMismatch:
          return jsonBody(
            _refusal(_cityMismatchText, 'COORDINATES_CITY_MISMATCH'),
            status: 422,
          );
        case _Fault.rateLimited:
          return jsonBody({
            'success': false,
            'message': _rateLimitText,
            'error': {
              'code': 'RATE_LIMIT_EXCEEDED',
              'details': {'limit': 100, 'window': '1 minute', 'retry_after': 30},
            },
            'timestamp': '2026-10-13T10:00:00.000Z',
          }, status: 429);
        case null:
          return serve(o);
      }
    });
  });

  PartnerRegistrationProvider wizard() {
    final p = PartnerRegistrationProvider(initialData: _completeCard);
    addTearDown(p.dispose);
    return p;
  }

  /// Запросы, ушедшие после отметки [from], — «метод путь».
  List<String> requestsSince(int from) => wire.requests
      .skip(from)
      .map((o) => '${o.method} ${o.path}')
      .toList();

  group('Карточка создана, отправка не дошла', () {
    test(
        'нет связи: причина и что карточка сохранена; повтор только '
        'отправляет её', () async {
      final p = wizard();
      faults['submit'] = _Fault.noConnection;

      expect(await p.submit(), isFalse);
      expect(
        p.error,
        'Нет связи. Проверьте подключение к интернету. $_draftTail',
      );

      faults.clear();
      final mark = wire.requests.length;

      expect(await p.submit(), isTrue);
      expect(p.error, isNull);
      expect(requestsSince(mark), ['POST $_base/$_id/submit'],
          reason: 'повтор не создаёт карточку заново');
      expect(status, 'pending');
    });

    test('сбой сервера при отправке: своя причина и что карточка сохранена',
        () async {
      final p = wizard();
      faults['submit'] = _Fault.serverDown;

      expect(await p.submit(), isFalse);
      expect(p.error, 'Не удалось отправить на верификацию. $_draftTail');
      // Создание и отправка с тремя повторами транспорта.
      expect(wire.requests, hasLength(5));
    });

    test(
        'правки между попытками сохраняются в созданную карточку, PDF-меню '
        'остаётся в ней', () async {
      final p = wizard();
      faults['submit'] = _Fault.noConnection;
      expect(await p.submit(), isFalse);

      p.updateBasicInfo(name: 'Кофейня у реки');
      faults.clear();
      final mark = wire.requests.length;

      expect(await p.submit(), isTrue);
      expect(requestsSince(mark), [
        'PUT $_base/$_id',
        'POST $_base/$_id/submit',
      ]);
      final body = wire.requests[mark].data as Map<String, dynamic>;
      expect(body['name'], 'Кофейня у реки');
      // Правка оставляет в корзине меню ровно присланные ссылки: без ссылки
      // на PDF сервер удалил бы его.
      expect(body['menu_photos'], [
        'https://res.cloudinary.com/demo/image/upload/b.jpg',
        'https://res.cloudinary.com/demo/image/upload/menu_pdf/m.pdf',
      ]);
      expect(body.containsKey('menu_pdfs'), isFalse,
          reason: 'поле только создания; правка его не читает');
    });

    test(
        'правку между попытками сервер отклонил (тёзка): причина без '
        '«нажмите ещё раз»; после другой правки карточка уходит', () async {
      namesakes = {'Кофейня у реки'};
      final p = wizard();
      faults['submit'] = _Fault.noConnection;
      expect(await p.submit(), isFalse);

      p.updateBasicInfo(name: 'Кофейня у реки');
      faults.clear();
      var mark = wire.requests.length;

      expect(await p.submit(), isFalse);
      expect(p.error, _duplicateText,
          reason: 'повтор получил бы тот же отказ — совет повторить ложный');
      expect(requestsSince(mark), ['PUT $_base/$_id']);

      p.updateBasicInfo(name: 'Кофейня у реки, Немига');
      mark = wire.requests.length;

      expect(await p.submit(), isTrue);
      expect(requestsSince(mark), [
        'PUT $_base/$_id',
        'POST $_base/$_id/submit',
      ]);
    });

    test('лимит запросов при отправке: причина и что карточка сохранена',
        () async {
      final p = wizard();
      faults['submit'] = _Fault.rateLimited;

      expect(await p.submit(), isFalse);
      expect(p.error, '$_rateLimitText $_draftTail',
          reason: 'лимит проходит — повтор поможет');
    });

    test('без правок повтор не сохраняет карточку заново', () async {
      final p = wizard();
      faults['submit'] = _Fault.serverDown;
      expect(await p.submit(), isFalse);

      faults.clear();
      final mark = wire.requests.length;

      expect(await p.submit(), isTrue);
      expect(requestsSince(mark), ['POST $_base/$_id/submit']);
    });

    test(
        'прошлая отправка дошла, а ответ потерялся: повтор — успех, а не '
        'отказ «статус не тот»', () async {
      final p = wizard();
      faults['submit'] = _Fault.answerLost;

      expect(await p.submit(), isFalse);
      expect(
        p.error,
        'Сервер не отвечает. Проверьте подключение. $_draftTail',
      );
      expect(status, 'pending', reason: 'сервер отправку выполнил');

      faults.clear();
      final mark = wire.requests.length;

      expect(await p.submit(), isTrue);
      expect(p.error, isNull);
      expect(requestsSince(mark), ['POST $_base/$_id/submit']);
    });
  });

  group('Создание без ответа', () {
    test(
        'карточка создалась, ответ потерялся; повтор упёрся в название — '
        'подсказка, где карточка', () async {
      final p = wizard();
      faults['create'] = _Fault.answerLost;

      expect(await p.submit(), isFalse);
      expect(p.error, 'Сервер не отвечает. Проверьте подключение.',
          reason: 'о созданной карточке приложение не знает — без хвоста');
      expect(created, isTrue);

      faults.clear();
      expect(await p.submit(), isFalse);
      expect(p.error, _alreadyCreatedHint);

      // И третья попытка — та же подсказка, а не текст сервера.
      expect(await p.submit(), isFalse);
      expect(p.error, _alreadyCreatedHint);
    });

    test('настоящий тёзка с первой попытки: текст сервера как есть',
        () async {
      created = true; // заведение с этим названием у партнёра уже есть
      final p = wizard();

      expect(await p.submit(), isFalse);
      expect(p.error, _duplicateText);
    });

    test(
        'отказ 4xx при создании — не потерянный ответ: следующий 409 — текст '
        'сервера', () async {
      final p = wizard();
      // Отказ сервиса: запрос разобран и отклонён, карточка не создана.
      faults['create'] = _Fault.cityMismatch;

      expect(await p.submit(), isFalse);
      expect(p.error, _cityMismatchText);
      expect(created, isFalse);

      // Тем временем заведение с этим названием появилось — например, его
      // создали с сайта.
      faults.clear();
      created = true;

      expect(await p.submit(), isFalse);
      expect(p.error, _duplicateText);
    });
  });

  test('двойное нажатие: карточка создаётся один раз', () async {
    final p = wizard();

    final first = p.submit();
    final second = p.submit();

    expect(await second, isFalse);
    expect(await first, isTrue);
    expect(
      wire.requests.where((o) => o.method == 'POST' && o.path == _base),
      hasLength(1),
    );
  });

  test('reset(): новая карточка создаётся заново, а не отправляет прежнюю',
      () async {
    final p = wizard();
    faults['submit'] = _Fault.noConnection;
    expect(await p.submit(), isFalse);

    p.reset();
    created = false; // другая карточка — сервер её примет
    faults.clear();
    p.updateCategories(['cafe']);
    p.updateCuisineTypes(['european']);
    p.updateBasicInfo(name: 'Вторая', priceRange: r'$');
    for (final url in _completeCard.interiorPhotos) {
      p.addInteriorPhoto(url);
    }
    p.addMenuPhoto(_completeCard.menuPhotos.single);
    p.updateAddress(city: 'Минск', street: 'Немига', building: '2');
    p.updateLegalInfo(
      legalName: 'ООО «Вторая»',
      unp: '987654321',
      contactPerson: 'Борис',
      contactEmail: 'boris@example.com',
    );
    final mark = wire.requests.length;

    expect(await p.submit(), isTrue);
    expect(requestsSince(mark), ['POST $_base', 'POST $_base/$_id/submit']);
  });
}
