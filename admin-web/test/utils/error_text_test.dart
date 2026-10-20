import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';

// Общий разбор отказа для модератора (проход по панели модератора, 20.10,
// пункты A3-01, A1-05, A2-02).
//
// Сторож двух свойств сразу: ни одна фраза, которую видит модератор, не
// английская, и неизвестный статус даёт русскую общую фразу. Плюс порядок
// источников: русский текст сервера → код отказа → статус → транспорт.

/// Латинское слово из трёх букв и длиннее. «email» — единственное, что
/// модератор видит латиницей намеренно: так подписано поле входа.
final RegExp _latinWord = RegExp(r'[A-Za-z]{3,}');

void _expectRussian(String text, String where) {
  expect(RegExp('[А-Яа-яЁё]').hasMatch(text), isTrue,
      reason: '$where: «$text» — не русская фраза');
  final latin = _latinWord
      .allMatches(text)
      .map((m) => m.group(0)!)
      .where((w) => w.toLowerCase() != 'email')
      .toList();
  expect(latin, isEmpty, reason: '$where: «$text» — латиница $latin');
}

DioException _refusal(int? status, {Object? body, DioExceptionType? type, Object? error}) {
  final options = RequestOptions(path: '/api/v1/admin/x');
  return DioException(
    requestOptions: options,
    response: status == null
        ? null
        : Response<dynamic>(
            requestOptions: options,
            statusCode: status,
            data: body,
          ),
    type: type ?? DioExceptionType.badResponse,
    error: error,
  );
}

void main() {
  group('Ни одной английской фразы', () {
    test('любой код статуса 100–599 без тела — русская фраза', () {
      for (var status = 100; status < 600; status++) {
        _expectRussian(describeError(_refusal(status)), 'статус $status');
      }
    });

    test('английский текст сервера не показывается ни при каком статусе', () {
      for (final status in <int>[400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 418]) {
        final text = describeError(_refusal(status, body: <String, dynamic>{
          'success': false,
          'message': 'Something went wrong on the server',
          'error': <String, dynamic>{
            'code': 'SOME_NEW_CODE',
            'message': 'Internal details',
          },
        }));
        _expectRussian(text, 'статус $status с английским телом');
      }
    });

    test('каждый вид сбоя без ответа — русская фраза', () {
      for (final type in DioExceptionType.values) {
        _expectRussian(
            describeError(_refusal(null, type: type)), 'вид сбоя $type');
      }
      _expectRussian(describeError(TimeoutException('x')), 'TimeoutException');
      _expectRussian(describeError(const FormatException('bad json')),
          'не DioException');
      _expectRussian(describeError(StateError('boom')), 'StateError');
    });

    test('словарь кодов и общие фразы — русские', () {
      kRefusalCodePhrases.forEach((code, phrase) {
        _expectRussian(phrase, 'код $code');
      });
      for (final phrase in <String>[
        kGenericFailurePhrase,
        kServerFailurePhrase,
        kNoConnectionPhrase,
        kTimeoutPhrase,
        kSessionExpiredPhrase,
        kServiceUnavailablePhrase,
        kEstablishmentNotFoundPhrase,
        kReviewNotFoundPhrase,
        kUserNotFoundPhrase,
      ]) {
        _expectRussian(phrase, 'общая фраза');
      }
    });

    test('коды «уже не так» — все со своей фразой', () {
      for (final code in kStaleStateCodes) {
        expect(kRefusalCodePhrases.containsKey(code), isTrue,
            reason: 'код $code перечитывает экран, но фразы для него нет');
      }
    });
  });

  group('Порядок источников', () {
    test('русский текст сервера — как есть, раньше кода и статуса', () {
      expect(
        describeError(_refusal(429, body: <String, dynamic>{
          'success': false,
          'message': 'Слишком много запросов. Попробуйте позже.',
          'error': <String, dynamic>{'code': 'RATE_LIMIT_EXCEEDED'},
        })),
        'Слишком много запросов. Попробуйте позже.',
      );
      expect(
        describeError(_refusal(409, body: <String, dynamic>{
          'success': false,
          'error': <String, dynamic>{
            'code': 'INVALID_STATUS_FOR_SUSPEND',
            'message': 'Партнёр уже снял карточку с показа',
          },
        })),
        'Партнёр уже снял карточку с показа',
        reason: '`error.message` читается, как и верхний `message`',
      );
    });

    test('русская фраза поля формы из error.details', () {
      expect(
        describeError(_refusal(422, body: <String, dynamic>{
          'success': false,
          'message': 'Validation failed',
          'error': <String, dynamic>{
            'code': 'VALIDATION_ERROR',
            'details': <Map<String, dynamic>>[
              <String, dynamic>{'field': 'x', 'message': 'Invalid value'},
              <String, dynamic>{'field': 'reason', 'message': 'Укажите причину'},
            ],
          },
        })),
        'Укажите причину',
      );
    });

    test('английский текст с известным кодом — фраза по коду', () {
      expect(
        describeError(_refusal(400, body: <String, dynamic>{
          'success': false,
          'message': 'Menu item is already hidden',
          'error': <String, dynamic>{'code': 'MENU_ITEM_ALREADY_HIDDEN'},
        })),
        'Позиция уже скрыта.',
      );
    });

    test('код экрана перекрывает общий словарь', () {
      expect(
        describeError(
          _refusal(400, body: <String, dynamic>{
            'error': <String, dynamic>{'code': 'REASON_REQUIRED'},
          }),
          codes: const <String, String>{'REASON_REQUIRED': 'Напишите, почему скрываете.'},
        ),
        'Напишите, почему скрываете.',
      );
    });

    test('статус берётся из response.statusCode, а не из текста', () {
      // Транспорт пересобирает DioException без `message`: в toString()
      // статуса нет, и прежние contains('403') не срабатывали никогда.
      final refusal = _refusal(403, body: <String, dynamic>{'message': 'Forbidden'});
      expect(refusal.toString(), isNot(contains('403')),
          reason: 'предпосылка: статуса в строке нет');
      expect(describeError(refusal), 'Недостаточно прав для этого действия.');
    });

    test('404 — словами экрана', () {
      expect(describeError(_refusal(404), notFound: kReviewNotFoundPhrase),
          kReviewNotFoundPhrase);
      expect(describeError(_refusal(404)),
          'Не найдено — возможно, это уже удалили или изменили.');
    });

    test('5xx — «сервер не ответил», 409 — «уже изменили»', () {
      expect(describeError(_refusal(502)), kServerFailurePhrase);
      expect(describeError(_refusal(409)), startsWith('Это уже изменили'));
    });

    test('без ответа: русский текст транспорта, иначе вид сбоя', () {
      expect(
          describeError(_refusal(null, error: kSessionExpiredPhrase)),
          kSessionExpiredPhrase);
      expect(
          describeError(_refusal(null,
              type: DioExceptionType.connectionError, error: 'XMLHttpRequest onError')),
          kNoConnectionPhrase);
      expect(
          describeError(_refusal(null,
              type: DioExceptionType.unknown,
              error: const SocketException('Connection reset by peer'))),
          kNoConnectionPhrase,
          reason: 'dio 5.9 выпускает обрыв после соединения как unknown');
      expect(
          describeError(_refusal(null, type: DioExceptionType.receiveTimeout)),
          kTimeoutPhrase);
    });
  });

  group('refusalMeansStaleData', () {
    test('404, 409 и коды «уже не так» — да; сбой сервера и сеть — нет', () {
      expect(refusalMeansStaleData(_refusal(404)), isTrue);
      expect(refusalMeansStaleData(_refusal(409)), isTrue);
      expect(
          refusalMeansStaleData(_refusal(400, body: <String, dynamic>{
            'error': <String, dynamic>{'code': 'INVALID_STATUS_FOR_MODERATION'},
          })),
          isTrue);
      expect(
          refusalMeansStaleData(_refusal(400, body: <String, dynamic>{
            'error': <String, dynamic>{'code': 'REASON_REQUIRED'},
          })),
          isFalse,
          reason: 'причину не ввели — данные на экране не устарели');
      expect(refusalMeansStaleData(_refusal(503)), isFalse);
      expect(
          refusalMeansStaleData(
              _refusal(null, type: DioExceptionType.connectionError)),
          isFalse);
    });
  });

  test('asSentence: одна точка, без двух подряд', () {
    expect(asSentence('Произошла ошибка'), 'Произошла ошибка.');
    expect(asSentence('Попробуйте снова.'), 'Попробуйте снова.');
    expect(asSentence('Что дальше?'), 'Что дальше?');
    expect(asSentence('Загружаем…'), 'Загружаем…');
  });

  group('Сторож источников', () {
    // Разбор по `toString()` вернуться не должен: статуса там нет, и ветки
    // вида contains('403') — мёртвый код, который проходит ревью.
    test('в lib/ нет поиска статуса или сети подстрокой текста ошибки', () {
      final offenders = <String>[];
      final pattern = RegExp(
          r'''contains\(\s*'(?:\d{3}|SocketException|Connection[^']*|No internet[^']*|Admin access required|Invalid email[^']*)'\s*\)''');
      for (final file in Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))) {
        final source = file.readAsStringSync();
        for (final m in pattern.allMatches(source)) {
          offenders.add('${file.path}: ${m.group(0)}');
        }
      }
      expect(offenders, isEmpty);
    });

    test('в lib/ нет прежних английских фраз транспорта и «Произошла ошибка»',
        () {
      final offenders = <String>[];
      final phrases = <String>[
        'Connection timeout.',
        'No internet connection',
        'An unexpected error',
        'Server error',
        'Please try again',
        'Please log in again',
        'Request cancelled',
        'Произошла ошибка',
      ];
      for (final file in Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))) {
        final source = file.readAsStringSync();
        for (final phrase in phrases) {
          if (source.contains(phrase)) offenders.add('${file.path}: «$phrase»');
        }
      }
      expect(offenders, isEmpty);
    });
  });
}
