/// Состояние распознавания меню заведения — поле `recognition` ответа
/// `GET /api/v1/partner/establishments/:id/menu-items` (рядом с `data`).
///
/// Сервер собирает его из последнего задания каждого файла меню и отдаёт
/// худшее: идёт распознавание → не удалось → распознано → ничего
/// (`partnerMenuItemService.recognitionState`). До 24.10.2026 (находка 3
/// инцидента Railway) поля не было, и экран «Меню» показывал один пустой
/// экран и для «не загружено», и для «распознаём», и для «не удалось».
enum MenuRecognitionStatus { none, processing, failed, done }

/// Почему не удалось — по ней экран выбирает совет: перезапуск помогает при
/// сбое сервиса, а не когда сам файл не читается.
enum MenuRecognitionCause { unreadable, overLimit, serviceFailure }

class MenuRecognition {
  final MenuRecognitionStatus status;

  /// Причина отказа — готовая фраза для партнёра из словаря сервера
  /// (`MENU_RECOGNITION_FAILURES`), только при [MenuRecognitionStatus.failed].
  final String? reason;

  /// Код причины (`cause`), только при отказе; `null` — сервер его не прислал
  /// или код незнаком: экран советует как при сбое сервиса.
  final MenuRecognitionCause? cause;

  const MenuRecognition({required this.status, this.reason, this.cause});

  bool get isFailed => status == MenuRecognitionStatus.failed;

  /// Перезапуск этот же файл не прочтёт: файл пуст или вышел за предел.
  bool get fileCannotBeRead =>
      cause == MenuRecognitionCause.unreadable ||
      cause == MenuRecognitionCause.overLimit;

  /// `null` — поля нет (сервер до этой правки) или оно непонятно (статус,
  /// которого эта сборка не знает): экран ведёт себя как прежде.
  static MenuRecognition? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final status = switch (json['status']) {
      'none' => MenuRecognitionStatus.none,
      'processing' => MenuRecognitionStatus.processing,
      'failed' => MenuRecognitionStatus.failed,
      'done' => MenuRecognitionStatus.done,
      _ => null,
    };
    if (status == null) return null;
    final failed = status == MenuRecognitionStatus.failed;
    final reason = json['reason'];
    return MenuRecognition(
      status: status,
      reason: failed && reason is String && reason.trim().isNotEmpty
          ? reason
          : null,
      cause: failed
          ? switch (json['cause']) {
              'unreadable' => MenuRecognitionCause.unreadable,
              'over_limit' => MenuRecognitionCause.overLimit,
              'service_failure' => MenuRecognitionCause.serviceFailure,
              _ => null,
            }
          : null,
    );
  }
}
