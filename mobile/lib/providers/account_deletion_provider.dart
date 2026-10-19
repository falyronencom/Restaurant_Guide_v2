import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/services/account_service.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';
import 'package:restaurant_guide_mobile/utils/error_helpers.dart';

/// Где сейчас экран удаления учётки.
enum AccountDeletionStage {
  /// Спрашиваем сервер, можно ли удалить.
  checking,

  /// Спросить не удалось (нет сети, сбой) — экран предлагает «Повторить».
  checkFailed,

  /// Сервер отказал: владелец карточек, учётка оператора. Текст — его.
  refused,

  /// Можно: предупреждение и поле для слова.
  ready,

  /// Запрос удаления в пути.
  deleting,

  /// Учётка удалена, вход на телефоне завершён.
  deleted,
}

/// Шаги удаления учётки (бриф В1, 18.10.2026): проверка, затем удаление
/// по слову УДАЛИТЬ (решение 4).
///
/// Живёт, пока открыт экран удаления, — в общий список провайдеров
/// приложения не входит: состояние нужно только этому экрану.
///
/// После удаления на сервере зовёт [onDeleted] — выход на этом телефоне
/// (экран удаления: хранилище очищено, сигнал `SessionEvents`). Зовёт сам, а
/// не оставляет экрану: экран могут закрыть, пока запрос в пути, а телефон не
/// должен остаться «вошедшим» в учётку, которой больше нет.
class AccountDeletionProvider extends ChangeNotifier {
  AccountDeletionProvider({
    required Future<void> Function() onDeleted,
    AccountService? service,
    Future<bool> Function()? sessionAlive,
  })  : _onDeleted = onDeleted,
        _service = service ?? AccountService(),
        _sessionAlive = sessionAlive ?? (() => AuthService().isAuthenticated());

  final Future<void> Function() _onDeleted;
  final AccountService _service;

  /// Остался ли у телефона сеанс — токен в хранилище. Транспорт стирает его,
  /// когда сервер отказал в продлении сеанса.
  final Future<bool> Function() _sessionAlive;

  /// Отказ сервера пришёл без текста — такого быть не должно, но человек
  /// всё равно должен понять, куда идти.
  static const String fallbackRefusal =
      'Сейчас учётку удалить нельзя. Напишите в поддержку: support@nirivio.by';

  /// Удаление сорвалось без текста от сервера (нет сети, сбой).
  static const String fallbackDeleteError =
      'Не удалось удалить учётку. Проверьте интернет и попробуйте ещё раз.';

  AccountDeletionStage _stage = AccountDeletionStage.checking;
  String? _refusalMessage;
  String? _deleteError;
  bool _deletionConfirmed = false;
  bool _disposed = false;

  AccountDeletionStage get stage => _stage;

  /// Сервер ответил «удалена». `false` в шаге [AccountDeletionStage.deleted] —
  /// сеанс кончился по дороге: ответ на первую попытку потерялся, а повтор
  /// нашёл сеансы учётки погашенными. Экран говорит тогда «Сеанс завершён».
  bool get deletionConfirmed => _deletionConfirmed;

  /// Текст отказа сервера — для [AccountDeletionStage.refused].
  String? get refusalMessage => _refusalMessage;

  /// Почему не удалось удалить — под кнопкой; `null`, пока не пробовали.
  String? get deleteError => _deleteError;

  /// Введено ли слово: регистр и пробелы по краям не важны — так же
  /// сверяет сервер.
  static bool isConfirmation(String typed) =>
      typed.trim().toUpperCase() == AccountService.confirmationWord;

  /// Спросить сервер, можно ли удалить учётку.
  Future<void> check() async {
    _stage = AccountDeletionStage.checking;
    _refusalMessage = null;
    _deleteError = null;
    _notify();
    try {
      final result = await _service.getDeletionCheck();
      if (result.allowed) {
        _stage = AccountDeletionStage.ready;
      } else {
        _stage = AccountDeletionStage.refused;
        _refusalMessage = result.refusalMessage ?? fallbackRefusal;
      }
    } catch (_) {
      _stage = AccountDeletionStage.checkFailed;
    }
    _notify();
  }

  /// Удалить учётку словом [typed]. `true` — удалена и вход завершён.
  ///
  /// Без слова и не из готового шага ничего не отправляет: кнопка на экране
  /// и так недоступна, это вторая защита от случайного нажатия.
  Future<bool> delete(String typed) async {
    if (_stage != AccountDeletionStage.ready || !isConfirmation(typed)) {
      return false;
    }
    _stage = AccountDeletionStage.deleting;
    _deleteError = null;
    _notify();

    try {
      // Слово уходит, как его набрали: сервер сверяет его сам (регистр и
      // пробелы по краям не в счёт) — второй рубеж против случайного вызова,
      // и он работает, только если сверяет набранное, а не подставленное.
      await _service.deleteAccount(confirmation: typed);
    } catch (error) {
      // Сеанса больше нет: сервер отказал транспорту в продлении, и тот стёр
      // токены. Так бывает, когда первая попытка удалила учётку, а её ответ
      // потерялся: повтор приходит к погашенным сеансам. Оставаться на форме
      // с ошибкой незачем — войти в эту учётку с телефона уже нельзя.
      if (!await _sessionAlive()) {
        await _endSession(confirmed: false);
        return true;
      }
      _deleteError = russianFailureText(error, fallback: fallbackDeleteError);
      _stage = AccountDeletionStage.ready;
      _notify();
      return false;
    }

    await _endSession(confirmed: true);
    return true;
  }

  /// Выход на телефоне и шаг «удалена».
  Future<void> _endSession({required bool confirmed}) async {
    try {
      await _onDeleted();
    } catch (_) {
      // Остаток сеанса доберёт транспорт: с погашенными токенами первый же
      // запрос получит отказ и сотрёт их.
    }
    _deletionConfirmed = confirmed;
    _stage = AccountDeletionStage.deleted;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
