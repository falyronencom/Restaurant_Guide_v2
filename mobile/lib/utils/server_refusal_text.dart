// Русский текст отказа из тела ответа сервера — одно место для транспорта
// (`ApiClient`), провайдера входа (`AuthProvider`) и экранов, которые читают
// отказ сами (отзыв, ответ владельца).
//
// Сервер знает про случай больше клиента (правило имени, мат в отзыве, лимит
// попыток, блокировка), и когда он объясняет по-русски, человек должен
// прочесть это объяснение, а не общую фразу экрана.

final RegExp _cyrillic = RegExp('[А-Яа-яЁёІіЎў]');

/// Есть ли в строке кириллица: русский текст сервера отличается от
/// английского именно так.
bool hasCyrillic(String text) => _cyrillic.hasMatch(text);

/// Пары «поле — фраза» из `error.details`, в какой бы форме сервер их ни
/// прислал.
///
/// Форм две, обе боевые:
/// - список `{field, message}` — общий `validate` (`errorHandler.js`: отзывы,
///   ответ владельца, заведения, брони, акции, медиа);
/// - объект «поле → список фраз» — `handleValidationErrors` входа и
///   регистрации (`authValidation.js`), там же 400 правки профиля.
///
/// У отказа лимитера (429) в `details` служебные поля — окно лимита строкой,
/// срок: это не текст для человека, поэтому в объекте берутся только списки
/// фраз. Поле у фразы из списка может быть пустым.
List<({String field, String message})> refusalDetails(Object? data) {
  if (data is! Map) return const [];
  final error = data['error'];
  if (error is! Map) return const [];
  final details = error['details'];
  final pairs = <({String field, String message})>[];

  if (details is Map) {
    details.forEach((field, messages) {
      if (messages is! List) return;
      for (final message in messages.whereType<String>()) {
        pairs.add((field: '$field', message: message));
      }
    });
  } else if (details is List) {
    for (final item in details) {
      if (item is Map) {
        final message = item['message'];
        if (message is String) {
          final field = item['field'];
          pairs.add((field: field is String ? field : '', message: message));
        }
      } else if (item is String) {
        pairs.add((field: '', message: item));
      }
    }
  }
  return pairs;
}

/// Русский текст отказа из тела ответа сервера, или `null`.
///
/// Берётся то, что написано по-русски, как есть и без имени поля: по одной
/// фразе на поле из `details`, затем русский `error.message`, затем верхний
/// `message`. Английская фраза сюда не проходит — её переводит таблица
/// (`ApiClient._validationMessages`, `AuthProvider._knownErrorMessage`).
String? russianServerText(Object? data) {
  if (data is! Map) return null;
  final error = data['error'];
  final found = <String>[];

  void addRussian(String message) {
    final text = message.trim();
    if (_cyrillic.hasMatch(text) && !found.contains(text)) found.add(text);
  }

  // В объекте «поле → список фраз» берётся первая русская фраза поля, в
  // списке — каждая.
  final byField = error is Map && error['details'] is Map;
  final seenFields = <String>{};
  for (final pair in refusalDetails(data)) {
    if (!_cyrillic.hasMatch(pair.message)) continue;
    if (byField && !seenFields.add(pair.field)) continue;
    addRussian(pair.message);
  }
  if (found.isNotEmpty) return found.join('\n');

  if (error is Map) {
    final message = error['message'];
    if (message is String && _cyrillic.hasMatch(message)) {
      return message.trim();
    }
  } else if (error is String && _cyrillic.hasMatch(error)) {
    return error.trim();
  }

  final message = data['message'];
  if (message is String && _cyrillic.hasMatch(message)) {
    return message.trim();
  }
  return null;
}
