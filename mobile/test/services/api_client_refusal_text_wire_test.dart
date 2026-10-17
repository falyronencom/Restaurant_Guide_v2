import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/utils/server_refusal_text.dart';

import '../support/wire_stand.dart';

/// Общий разбор отказа проверки полей в `ApiClient`: русский текст сервера
/// доходит до `DioException.error` как есть (проход тестировщика 17.10, Х17 и
/// Х22).
///
/// Форм у сервера две, обе боевые: список `{field, message}` из общего
/// `validate` (отзывы, ответ владельца, партнёрские формы) и объект «поле →
/// фразы» из `authValidation` рядом с английским «Invalid input data».
/// Транспорт настоящий, подменён только провод.
const _profane = 'Текст содержит нецензурные выражения — уберите их, '
    'пожалуйста';

void main() {
  /// Текст, который транспорт кладёт в `DioException.error` на отказ.
  Future<String> refusedWith(
    Map<String, dynamic> body, {
    int status = 422,
  }) async {
    installWireStand((_) => jsonBody(body, status: status));
    try {
      await ApiClient().post('/api/v1/anything', data: {'x': 1});
    } on DioException catch (e) {
      return e.error as String;
    }
    fail('отказ не дошёл до вызывающего');
  }

  /// Ответ общего `validate`.
  Map<String, dynamic> listForm(List<Map<String, dynamic>> details) => {
        'success': false,
        'message': 'Validation failed',
        'error': {'code': 'VALIDATION_ERROR', 'details': details},
        'timestamp': '2026-10-17T10:00:00.000Z',
      };

  /// Ответ `handleValidationErrors` входа и регистрации.
  Map<String, dynamic> objectForm(Map<String, dynamic> details,
          {String message = 'Invalid input data'}) =>
      {
        'success': false,
        'error': {
          'code': 'VALIDATION_ERROR',
          'message': message,
          'details': details,
        },
      };

  group('details списком', () {
    test('мат в отзыве: текст сервера без имени поля', () async {
      final text = await refusedWith(listForm([
        {'field': 'content', 'message': _profane, 'value': 'текст'},
      ]));

      expect(text, _profane);
    });

    test('русский текст по полю name не получает приставку «Название:»',
        () async {
      // `_fieldNames['name']` — «Название»: у заведения это верно, у имени
      // человека и у любой русской фразы сервера приставка лишняя.
      final text = await refusedWith(listForm([
        {'field': 'name', 'message': 'Имя — от 2 до 50 символов'},
      ]));

      expect(text, 'Имя — от 2 до 50 символов');
    });

    test('русский текст побеждает английский рядом', () async {
      final text = await refusedWith(listForm([
        {'field': 'content', 'message': 'Review content is required'},
        {'field': 'content', 'message': _profane},
      ]));

      expect(text, _profane);
    });

    test('известная английская проверка — по таблице, с именем поля',
        () async {
      final text = await refusedWith(listForm([
        {
          'field': 'working_hours',
          'message': 'Working hours must be a valid JSON object',
        },
      ]));

      expect(text, 'Время работы: Некорректный формат времени работы');
    });

    test('неизвестная английская фраза на экран не идёт', () async {
      final text = await refusedWith(listForm([
        {'field': 'rating', 'message': 'Rating must be an integer'},
      ]));

      expect(text, 'Ошибка валидации. Проверьте введённые данные.');
    });
  });

  group('details объектом', () {
    test('русская фраза поля; английское «Invalid input data» не показано',
        () async {
      final text = await refusedWith(objectForm({
        'name': ['Имя может содержать только буквы, пробел, дефис и апостроф'],
      }));

      expect(text,
          'Имя может содержать только буквы, пробел, дефис и апостроф');
    });

    test('одна русская фраза на поле, английские того же поля отброшены',
        () async {
      final text = await refusedWith(objectForm({
        'response': ['Response is required', _profane, 'ещё одна фраза'],
      }));

      expect(text, _profane);
    });

    test('только английское: русская фраза по статусу, не «Invalid input data»',
        () async {
      final text = await refusedWith(objectForm({
        'email': ['Invalid email format'],
      }));

      expect(text, 'Ошибка валидации. Проверьте введённые данные.');
    });

    test('служебные поля лимитера не становятся текстом', () async {
      final text = await refusedWith({
        'success': false,
        'error': {
          'code': 'RATE_LIMIT_EXCEEDED',
          'message': 'Слишком много запросов. Подождите немного.',
          'details': {'window': '15 minutes', 'retryAfter': 900},
        },
      }, status: 429);

      expect(text, 'Слишком много запросов. Подождите немного.');
    });
  });

  group('другие формы', () {
    test('400 с русским error.message (правка профиля) — как есть', () async {
      final text = await refusedWith({
        'success': false,
        'error': {
          'code': 'VALIDATION_ERROR',
          'message': 'Имя — от 2 до 50 символов',
        },
      }, status: 400);

      expect(text, 'Имя — от 2 до 50 символов');
    });

    test('английский «Validation failed» без details — фраза по статусу',
        () async {
      final text = await refusedWith({
        'success': false,
        'message': 'Validation failed',
        'error': {'code': 'VALIDATION_ERROR'},
      });

      expect(text, 'Ошибка валидации. Проверьте введённые данные.');
    });

    test('прочий русский message сервера (не проверка полей) — как есть',
        () async {
      final text = await refusedWith({
        'success': false,
        'message': 'Акция не найдена — возможно, её уже удалили.',
        'error': {'code': 'PROMOTION_NOT_FOUND'},
      }, status: 404);

      expect(text, 'Акция не найдена — возможно, её уже удалили.');
    });
  });

  group('russianServerText', () {
    test('не русский ответ — null', () {
      expect(russianServerText(null), isNull);
      expect(russianServerText('строка'), isNull);
      expect(
        russianServerText(objectForm({
          'email': ['Invalid email format'],
        })),
        isNull,
      );
    });
  });
}
