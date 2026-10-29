/// Формат номера записи на сервере — UUID, тот же шаблон, что у сервера
/// (`backend/src/services/adminUserService.js`, `UUID_PATTERN`).
final RegExp _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);

/// Похоже ли [value] на номер записи сервера.
///
/// Номер из адреса страницы (`?user=…`) — чужой ввод: ссылку мог прислать
/// кто угодно. Склеенный с путём запроса, он мог бы увести запрос с токеном
/// модератора на другой маршрут того же API (`../…`). Поэтому номер из ссылки
/// уходит в запрос, только если он UUID (сверка меток панели 29.10, S4).
bool isUuid(String value) => _uuidPattern.hasMatch(value);

/// Номер записи как ОДИН сегмент пути запроса.
///
/// `Uri.encodeComponent` прячет `/`, но не точки: номер `..` или `.` всё
/// равно вывел бы путь с маршрута (`/users/../block` → `/admin/block`).
/// Такие номера и пустой — ошибка программы, не данные: сервер их не выдаёт,
/// а ссылку с ними экран отсекает раньше ([isUuid]).
String idPathSegment(String id) {
  if (id.isEmpty || id == '.' || id == '..') {
    throw ArgumentError.value(id, 'id', 'не номер записи');
  }
  return Uri.encodeComponent(id);
}
