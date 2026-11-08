/// Хвост строки «Открыто · до 22:00» — как на сайте
/// (`web/src/components/catalog/OpenStatusBadge.tsx`). Один источник для
/// карточки выдачи, карточки заведения и превью партнёра.
///
/// Пробел перед точкой неразрывный: при крупном шрифте строка переносится
/// после точки, а не начинается с неё.
String openUntilSuffix(String closingTime) => ' · до $closingTime';

final RegExp _clockTime = RegExp(r'^(\d{1,2}):(\d{2})(?::[0-5]\d)?$');

/// Минуты от полуночи для времени «ЧЧ:ММ» (сервер хранит и «9:00», а база может
/// вернуть секунды). `null` — всё, что временем не является: пустая строка,
/// «abc», «25:99», не строка. Часы работы приходят с сервера и сайта как есть,
/// и падать на них нельзя: `int.parse('')` при отрисовке одной карточки ронял
/// весь список и карту (06.11.2026).
int? clockMinutes(Object? value) {
  if (value is! String) return null;
  final match = _clockTime.firstMatch(value.trim());
  if (match == null) return null;
  final hours = int.parse(match[1]!);
  final minutes = int.parse(match[2]!);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/// «09:05» для минут от полуночи.
String clockLabel(int minutes) => '${(minutes ~/ 60).toString().padLeft(2, '0')}:'
    '${(minutes % 60).toString().padLeft(2, '0')}';

/// Подпись гостю, когда часов на сегодня нет. Решение Координатора 06.11.2026:
/// неизвестные часы — не повод писать зелёное «Открыто».
const String hoursNotSpecifiedLabel = 'Часы не указаны';

/// Три ответа на вопрос «работает ли место сейчас».
enum OpenState { open, closed, unknown }

/// Что известно о заведении в конкретный момент: ответ и, если открыто, до
/// какого времени. Считается один раз на момент: подпись и время закрытия не
/// могут разойтись на смене минуты.
class OpenStatus {
  const OpenStatus.open(String this.closesAt) : state = OpenState.open;

  const OpenStatus.closed()
      : state = OpenState.closed,
        closesAt = null;

  const OpenStatus.unknown()
      : state = OpenState.unknown,
        closesAt = null;

  final OpenState state;
  final String? closesAt;

  bool get isOpen => state == OpenState.open;

  /// Подпись статуса: «Открыто», «Закрыто» или [hoursNotSpecifiedLabel].
  String get label => switch (state) {
        OpenState.open => 'Открыто',
        OpenState.closed => 'Закрыто',
        OpenState.unknown => hoursNotSpecifiedLabel,
      };
}
