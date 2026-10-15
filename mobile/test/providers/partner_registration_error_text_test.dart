import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';

import '../support/wire_stand.dart';

/// Что читает партнёр, когда карточка не сохранилась или не отправилась.
///
/// До 07.10.2026 правка карточки показывала в красной плашке
/// `Ошибка при сохранении: DioException [bad response]: null`, перевод
/// строки, `Error:` — и только потом фразу сервера: провайдер печатал
/// `toString()` исключения. Создание карточки брало фразу из
/// `DioException.error`, но при сбое сервера и оно печатало `toString()` —
/// четыре строки английского: исчерпав повторы 5xx, транспорт отдаёт исходный
/// отказ dio без готовой фразы.
///
/// Проверки — точным равенством. Утверждение «текст содержит фразу сервера»
/// зеленеет вместе с мусором вокруг неё, на этом и держался дефект.
///
/// Ответы — в форме `errorHandler` бэкенда в production
/// (`{success, message, error: {code}, timestamp}`, без `stack`), через стенд
/// провода: исполняется весь `ApiClient`, включая повторы и пересборку отказа.
const _id = '11111111-2222-3333-4444-555555555555';

/// Литерал решения Координатора 06.10.2026 — `MEDIA_URL_NOT_OWNED_MESSAGE`
/// бэкенда.
const _mediaRefusal = 'Одно из фото или файлов меню загружено не с этого '
    'аккаунта. Удалите его и загрузите заново.';

Map<String, dynamic> _refusal(String message, String code) => {
      'success': false,
      'message': message,
      'error': {'code': code},
      'timestamp': '2026-10-07T10:00:00.000Z',
    };

/// Сбой сервера. Для программной ошибки бэкенд отдаёт в `message` текст
/// исключения как есть — английский и внутренний; партнёру он не годится.
ResponseBody _serverFailure(RequestOptions _) => jsonBody(
      _refusal("Cannot read properties of undefined (reading 'id')",
          'INTERNAL_ERROR'),
      status: 500,
    );

/// Карточка, которая проходит проверку итогового шага мастера: иначе
/// `submit()` не дойдёт до сети.
const _completeCard = PartnerRegistration(
  categories: ['restaurant'],
  cuisineTypes: ['european'],
  name: 'Кофейня у моста',
  priceRange: r'$$',
  interiorPhotos: ['https://res.cloudinary.com/demo/image/upload/a.jpg'],
  menuPhotos: ['https://res.cloudinary.com/demo/image/upload/b.jpg'],
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
  late ResponseBody Function(RequestOptions options) respond;
  late StubAdapter wire;

  setUp(() {
    respond = (options) =>
        throw StateError('ответ не задан: ${options.method} ${options.path}');
    wire = installWireStand((options) => respond(options));
  });

  PartnerRegistrationProvider editor() {
    final p = PartnerRegistrationProvider(editMode: true, establishmentId: _id);
    addTearDown(p.dispose);
    return p;
  }

  PartnerRegistrationProvider wizard() {
    final p = PartnerRegistrationProvider(initialData: _completeCard);
    addTearDown(p.dispose);
    return p;
  }

  group('Сохранение правки карточки', () {
    test('чужое фото: фраза сервера целиком, без приставки', () async {
      respond = (_) => jsonBody(
            _refusal(_mediaRefusal, 'MEDIA_URL_NOT_OWNED'),
            status: 422,
          );
      final p = editor();

      final saved = await p.saveChanges();

      expect(saved, isFalse);
      expect(p.error, _mediaRefusal);
      // Ответ выше — именно на сохранение, а не на какой-то другой запрос.
      expect(wire.requests.single.method, 'PUT');
      expect(wire.requests.single.path, '/api/v1/partner/establishments/$_id');
    });

    test('нет связи: фраза транспорта как есть', () async {
      respond = (options) => throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          );
      final p = editor();

      final saved = await p.saveChanges();

      expect(saved, isFalse);
      expect(p.error, 'Нет связи. Проверьте подключение к интернету.');
    });

    test('сбой сервера: русская фраза вместо текста исключения', () async {
      respond = _serverFailure;
      final p = editor();

      final saved = await p.saveChanges();

      expect(saved, isFalse);
      expect(p.error, 'Не удалось сохранить изменения. Попробуйте ещё раз.',
          reason: 'у отказа после повторов 5xx нет готовой фразы; если '
              'транспорт начнёт отдавать `message` сервера, партнёр прочтёт '
              'внутренний английский текст бэкенда');
      // Исходный запрос и три повтора: отказ пришёл с того самого пути, где
      // транспорт не пересобирает ошибку.
      expect(wire.requests, hasLength(4));
    });

    test('ответ 2xx, но не 200: исключение сервиса — русская фраза', () async {
      // Сервис сам бросает обычное `Exception('Failed to update
      // establishment')`, когда код ответа не 200: отказ не из транспорта,
      // готовой фразы у него нет вовсе.
      respond = (_) => jsonBody(<String, dynamic>{'success': true}, status: 202);
      final p = editor();

      final saved = await p.saveChanges();

      expect(saved, isFalse);
      expect(p.error, 'Не удалось сохранить изменения. Попробуйте ещё раз.');
      expect(wire.requests.single.method, 'PUT');
    });
  });

  group('Отправка новой карточки', () {
    test('сбой сервера: русская фраза вместо текста исключения', () async {
      respond = _serverFailure;
      final p = wizard();

      final sent = await p.submit();

      expect(sent, isFalse);
      expect(
        p.error,
        'Не удалось отправить на верификацию. Попробуйте ещё раз.',
      );
      expect(wire.requests.first.method, 'POST');
      expect(wire.requests, hasLength(4));
    });

    test('чужое фото: фраза сервера целиком', () async {
      respond = (_) => jsonBody(
            _refusal(_mediaRefusal, 'MEDIA_URL_NOT_OWNED'),
            status: 422,
          );
      final p = wizard();

      final sent = await p.submit();

      expect(sent, isFalse);
      expect(p.error, _mediaRefusal);
      expect(wire.requests.single.method, 'POST');
    });
  });
}
