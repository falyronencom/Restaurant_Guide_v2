import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/utils/error_helpers.dart';

/// `getHumanErrorMessage` — запасная фраза экранов входа и регистрации.
///
/// До 29.10.2026 она отвечала «Аккаунт с таким email уже существует.» на
/// любой 409 — неверно для всякого конфликта, кроме занятой почты, и словом,
/// которое приложение больше не пишет (слово Координатора 29.10.2026:
/// «учётная запись»; находка сверки Trunk). Теперь — русский текст сервера,
/// а без него на 409 — общая фраза.
///
/// Сегодня до неё 409 с экранов не доходит: `AuthProvider` сам ловит отказ
/// входа и регистрации и возвращает `false`, экраны зовут её лишь на
/// исключение вне провайдера. Тест держит фразу верной на случай, когда
/// дойдёт.
void main() {
  DioException refusal(int status, Map<String, dynamic> body) => DioException(
        requestOptions: RequestOptions(path: '/api/v1/auth/register'),
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(
          requestOptions: RequestOptions(path: '/api/v1/auth/register'),
          statusCode: status,
          data: body,
        ),
      );

  test('409 с русским текстом сервера — его слова', () {
    final text = getHumanErrorMessage(refusal(409, {
      'success': false,
      'error': {
        'code': 'EMAIL_EXISTS',
        'message': 'Этот email уже зарегистрирован. Попробуйте войти.',
      },
    }));

    expect(text, 'Этот email уже зарегистрирован. Попробуйте войти.');
  });

  test('409 без русского текста — общая фраза, без «аккаунта» и без '
      'выдумки про почту', () {
    final text = getHumanErrorMessage(refusal(409, {
      'success': false,
      'error': {'code': 'MODERATION_CONFLICT', 'message': 'Conflict'},
    }));

    expect(text, 'Произошла ошибка. Попробуйте ещё раз.');
    expect(text, isNot(contains('ккаунт')));
  });

  test('401 с русским текстом сервера — его слова, а не своя фраза', () {
    final text = getHumanErrorMessage(refusal(401, {
      'success': false,
      'error': {
        'code': 'INVALID_TOKEN',
        'message': 'Не удалось войти через Google. Попробуйте ещё раз или '
            'войдите другим способом.',
      },
    }));

    expect(text, startsWith('Не удалось войти через Google'));
  });
}
