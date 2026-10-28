import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Сторож: список, по которому клиент обновляет сеанс и повторяет запрос
/// (`ApiClient.sessionRefusalCodes`), равен 401-кодам проверки входа
/// сервера — ни больше, ни меньше.
///
/// Список — ручная копия: общего пакета у приложения и сервера нет. Код,
/// который сервер добавит в `authenticate`, а приложение не узнает, —
/// вошедший человек, чей доступ отвергнут так, получит ошибку вместо тихого
/// обновления. Код, который приложение держит после того, как сервер его
/// снял, сегодня безвреден, но повторил бы собственный 401 будущего адреса
/// с тем же именем. Зеркало сторожа сайта из PR #137
/// (`web/__tests__/session-refusal-codes-guard.test.ts`).
///
/// Коды читаются из исходника сервера так, как сервер их пишет: каждый
/// `code: '…'` и `errorCode = '…'` внутри `authenticate`
/// (`backend/src/middleware/auth.js`) и каждый позиционный
/// `AppError(…, 401, '…')` там же (его 503 под образец не подходит), а также
/// запасные 401 `errorHandler.js` (`statusCode = 401; errorCode = '…'`) —
/// они обязаны быть среди них. CI вынимает репозиторий целиком, `../backend`
/// рядом есть всегда (так же читает канон `vocabulary_canon_guard_test.dart`).
void main() {
  const middleware = '../backend/src/middleware';

  Set<String> codesIn(String text, RegExp pattern) =>
      pattern.allMatches(text).map((m) => m.group(1)!).toSet();

  String authenticateBody() {
    final source = File('$middleware/auth.js').readAsStringSync();
    final start = source.indexOf('export const authenticate =');
    expect(start, isNonNegative, reason: 'в auth.js нет authenticate');
    // До следующего объявления или doc-комментария верхнего уровня, чтобы
    // примеры из JSDoc соседней функции не читались как коды authenticate.
    final ends = ['\nexport ', '\n/**']
        .map((marker) => source.indexOf(marker, start + 1))
        .where((at) => at != -1)
        .toList()
      ..sort();
    return source.substring(start, ends.isEmpty ? null : ends.first);
  }

  test('список приложения равен 401-кодам authenticate сервера', () {
    final body = authenticateBody();
    final backendCodes = {
      ...codesIn(body, RegExp(r"\bcode:\s*'([A-Z_]+)'")),
      ...codesIn(body, RegExp(r"\berrorCode\s*=\s*'([A-Z_]+)'")),
      // Позиционный 401: next(new AppError('…', 401, 'КОД')).
      ...codesIn(body, RegExp(r"AppError\([^;]*?,\s*401,\s*'([A-Z_]+)'")),
    };
    // Разбор, который ничего не нашёл, сделал бы равенство ниже пустым.
    expect(backendCodes.length, greaterThanOrEqualTo(5),
        reason: 'разбор auth.js ослеп');

    expect(ApiClient.sessionRefusalCodes, backendCodes);
  });

  test('запасные 401 errorHandler.js — в списке', () {
    final source = File('$middleware/errorHandler.js').readAsStringSync();
    final fallbacks = codesIn(
        source, RegExp(r"statusCode\s*=\s*401;\s*errorCode\s*=\s*'([A-Z_]+)'"));
    expect(fallbacks, isNotEmpty, reason: 'разбор errorHandler.js ослеп');

    for (final code in fallbacks) {
      expect(ApiClient.sessionRefusalCodes, contains(code),
          reason: 'запасной 401 $code сервера не обновляет сеанс');
    }
  });
}
