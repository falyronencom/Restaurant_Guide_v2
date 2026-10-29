/// Можно ли удалить учётную запись сейчас — ответ `GET /api/v1/auth/account/deletion`.
///
/// Сервер решает сам и пишет причину отказа по-русски: у владельца карточек
/// заведений — «напишите в поддержку» (решение Координатора 18.10.2026, бриф
/// В1, вопрос 3), у учётной записи панели — «удаляет оператор». Экран показывает
/// текст как есть, поэтому здесь только разбор, без своих фраз.
class AccountDeletionCheck {
  /// Удалить можно — экран показывает предупреждение и поле для слова.
  final bool allowed;

  /// Код отказа сервера (`ACCOUNT_OWNS_ESTABLISHMENTS`, …) или `null`.
  final String? refusalCode;

  /// Текст отказа для человека или `null`.
  final String? refusalMessage;

  const AccountDeletionCheck({
    required this.allowed,
    this.refusalCode,
    this.refusalMessage,
  });

  /// Разбор `data` ответа: `{ allowed, refusal: { code, message } | null }`.
  ///
  /// Без `allowed: true` удаления нет: ответ, в котором поле пропало, —
  /// поломка контракта, а не разрешение.
  factory AccountDeletionCheck.fromJson(Map<String, dynamic> json) {
    final refusal = json['refusal'];
    return AccountDeletionCheck(
      allowed: json['allowed'] == true,
      refusalCode: refusal is Map ? refusal['code'] as String? : null,
      refusalMessage: refusal is Map ? refusal['message'] as String? : null,
    );
  }
}
