import 'dart:async';

import 'package:dio/dio.dart';

/// Текст отказа или сбоя для модератора — один на всю панель.
///
/// До 20.10.2026 у каждого провайдера был свой разбор, и почти все искали
/// код статуса подстрокой в `error.toString()` («403», «404»). Транспорт
/// пересобирает `DioException` без `message`, и числа статуса в строке нет:
/// ветки 403/404/400 не срабатывали никогда, модератор видел «Произошла
/// ошибка» вместо русского отказа сервера (проход по панели модератора, 20.10,
/// пункты A3-01, A1-05, A2-02). Статус здесь берётся только из
/// `response.statusCode`, текст — только из тела ответа.
///
/// Порядок — от точного к общему:
/// 1. русский текст сервера: верхний `message`, `error.message`, первая
///    русская фраза в `error.details` (отказ поля формы);
/// 2. фраза по коду отказа (`error.code`) — сервер пишет многие отказы
///    модерации по-английски, а коды у них стабильны; русский текст сервера,
///    когда появится, сам займёт первое место;
/// 3. фраза по коду статуса;
/// 4. русский текст самого транспорта (`DioException.error`) — так приходят
///    отказы без ответа сервера: истёкшая сессия, недошедшее обновление токена;
/// 5. вид сбоя связи — нет связи, таймаут;
/// 6. общая фраза.
///
/// Английский текст сервера не показывается никогда: он писался для
/// разработчика (`Cannot suspend establishment with status 'draft'…`).
///
/// [notFound] — фраза для 404 о том, что ищет этот экран: «Заведение не
/// найдено…» вернее общего «Не найдено». [codes] дополняет и перекрывает общий
/// словарь кодов для своего экрана.
String describeError(
  Object error, {
  String? notFound,
  Map<String, String> codes = const <String, String>{},
}) {
  if (error is DioException) {
    final response = error.response;
    final body = response?.data;

    final serverText = _serverRussianText(body);
    if (serverText != null) return serverText;

    final code = _errorCode(body);
    if (code != null) {
      final phrase = codes[code] ?? kRefusalCodePhrases[code];
      if (phrase != null) return phrase;
    }

    final status = response?.statusCode;
    if (status != null) return statusPhrase(status, notFound: notFound);

    final transportText = error.error;
    if (transportText is String && _hasCyrillic(transportText)) {
      return transportText;
    }

    return _transportPhrase(error);
  }
  if (error is TimeoutException) return kTimeoutPhrase;
  return kGenericFailurePhrase;
}

/// Код статуса ответа, если ответ был.
int? errorStatus(Object error) =>
    error is DioException ? error.response?.statusCode : null;

/// Код отказа сервера (`error.code`), если ответ был.
String? errorCode(Object error) =>
    error is DioException ? _errorCode(error.response?.data) : null;

/// Отказ значит «на сервере уже не так, как на экране»: объект удалили,
/// изменили другим действием, действие уже выполнено.
///
/// Экран после такого отказа перечитывает данные: повторять действие поверх
/// устаревшей картинки бессмысленно — сервер ответит тем же.
bool refusalMeansStaleData(Object error) {
  final status = errorStatus(error);
  if (status == 404 || status == 409) return true;
  final code = errorCode(error);
  return code != null && kStaleStateCodes.contains(code);
}

/// Фраза по коду статуса — когда ни текста, ни знакомого кода в ответе нет.
String statusPhrase(int status, {String? notFound}) {
  if (status >= 500 && status < 600) return kServerFailurePhrase;
  return switch (status) {
    400 => 'Сервер не принял запрос. Обновите данные и попробуйте снова.',
    401 => kSessionExpiredPhrase,
    403 => 'Недостаточно прав для этого действия.',
    404 => notFound ?? 'Не найдено — возможно, это уже удалили или изменили.',
    409 => 'Это уже изменили другим действием. Обновите данные и посмотрите снова.',
    413 => 'Файл слишком большой.',
    422 => 'Сервер не принял введённые данные. Проверьте их и попробуйте снова.',
    429 => 'Слишком много запросов. Подождите минуту и попробуйте снова.',
    _ => kGenericFailurePhrase,
  };
}

/// Фраза как предложение — с точкой в конце, если знака нет.
///
/// Экраны дописывают к причине следствие («… На экране остались прежние
/// числа»). Фразы сервера кончаются точкой, фразы прежних разборов — нет, и
/// склейка через «. » давала «Попробуйте снова.. На экране…».
String asSentence(String text) {
  final trimmed = text.trimRight();
  if (trimmed.isEmpty) return trimmed;
  final last = trimmed[trimmed.length - 1];
  return '.!?…'.contains(last) ? trimmed : '$trimmed.';
}

const String kGenericFailurePhrase =
    'Что-то пошло не так. Попробуйте ещё раз.';
const String kServerFailurePhrase =
    'Сервер не ответил. Попробуйте ещё раз через минуту.';
const String kNoConnectionPhrase =
    'Нет связи с сервером. Проверьте интернет и попробуйте снова.';
const String kTimeoutPhrase =
    'Сервер долго не отвечает. Попробуйте ещё раз.';
const String kSessionExpiredPhrase = 'Сессия истекла — войдите снова.';
const String kEstablishmentNotFoundPhrase =
    'Заведение не найдено — возможно, его уже удалили или изменили.';
const String kReviewNotFoundPhrase =
    'Отзыв не найден — возможно, его уже удалили.';
const String kUserNotFoundPhrase = 'Пользователь не найден.';
const String kServiceUnavailablePhrase =
    'Сервер временно недоступен. Попробуйте ещё раз.';

/// Отказы по коду сервера (`error.code`). Коды — из `backend/src/services`
/// (`adminService.js`, `adminReviewService.js`, `adminController.js`),
/// сверены 20.10.2026. Незнакомый код не ломает ничего: фраза берётся по
/// статусу.
const Map<String, String> kRefusalCodePhrases = <String, String>{
  // Заявки и заведения.
  'ESTABLISHMENT_NOT_FOUND': kEstablishmentNotFoundPhrase,
  'INVALID_STATUS_FOR_MODERATION':
      'Заявку уже разобрали — она больше не ждёт проверки.',
  'MODERATION_CONFLICT':
      'Заявку только что изменили. Обновите список и посмотрите снова.',
  'INVALID_STATUS_FOR_SUSPEND':
      'Заведение уже приостановлено или в этом статусе его приостановить нельзя.',
  'SUSPEND_CONFLICT':
      'Заведение только что изменили. Обновите данные и посмотрите снова.',
  'INVALID_STATUS_FOR_UNSUSPEND':
      'Заведение уже не приостановлено — возможно, его уже возобновили.',
  'UNSUSPEND_CONFLICT':
      'Заведение только что изменили. Обновите данные и посмотрите снова.',
  'SUSPENDED_BY_PARTNER':
      'Это пауза партнёра — включить заведение может только сам партнёр.',
  'REASON_REQUIRED': 'Укажите причину.',
  'INVALID_LATITUDE': 'Широта вне границ Беларуси.',
  'INVALID_LONGITUDE': 'Долгота вне границ Беларуси.',
  'COORDINATES_CITY_MISMATCH':
      'Точка не в городе заведения. Проверьте координаты или город в карточке.',
  'SLUG_ALREADY_TAKEN': 'Такой адрес страницы уже занят другим заведением.',
  'ESTABLISHMENT_ARCHIVED': 'Заведение в архиве — передать его нельзя.',
  'ALREADY_OWNED': 'Заведение уже принадлежит этому пользователю.',
  'USER_NOT_FOUND': kUserNotFoundPhrase,
  'USER_INACTIVE': 'Учётная запись пользователя отключена.',
  // Позиции меню.
  'MENU_ITEM_NOT_FOUND':
      'Позиция не найдена — возможно, меню распознали заново.',
  'MENU_ITEM_ALREADY_HIDDEN': 'Позиция уже скрыта.',
  'MENU_ITEM_NOT_HIDDEN': 'Позиция уже показана.',
  'MENU_ITEM_NO_FLAG': 'Флаг с позиции уже снят.',
  'MENU_ITEM_HIDE_CONFLICT': 'Позицию только что изменили или удалили.',
  'MENU_ITEM_UNHIDE_CONFLICT': 'Позицию только что изменили или удалили.',
  // Отзывы.
  'REVIEW_NOT_FOUND': kReviewNotFoundPhrase,
  'REVIEW_ALREADY_DELETED': 'Отзыв уже удалён.',
  'VISIBILITY_CONFLICT': 'Видимость отзыва только что изменили.',
  'VIEWER_PERSON_FILTER_FORBIDDEN':
      'В режиме просмотра отзывы одного человека недоступны.',
  // Вход.
  'INVALID_CREDENTIALS': 'Неверный email или пароль.',
  'ADMIN_ACCESS_REQUIRED': 'Доступ только для администраторов',
};

/// Коды отказов «уже не так, как на экране» — см. [refusalMeansStaleData].
const Set<String> kStaleStateCodes = <String>{
  'ESTABLISHMENT_NOT_FOUND',
  'INVALID_STATUS_FOR_MODERATION',
  'MODERATION_CONFLICT',
  'INVALID_STATUS_FOR_SUSPEND',
  'SUSPEND_CONFLICT',
  'INVALID_STATUS_FOR_UNSUSPEND',
  'UNSUSPEND_CONFLICT',
  'SUSPENDED_BY_PARTNER',
  'ALREADY_OWNED',
  'ESTABLISHMENT_ARCHIVED',
  'MENU_ITEM_NOT_FOUND',
  'MENU_ITEM_ALREADY_HIDDEN',
  'MENU_ITEM_NOT_HIDDEN',
  'MENU_ITEM_NO_FLAG',
  'MENU_ITEM_HIDE_CONFLICT',
  'MENU_ITEM_UNHIDE_CONFLICT',
  'REVIEW_NOT_FOUND',
  'REVIEW_ALREADY_DELETED',
  'VISIBILITY_CONFLICT',
};

final RegExp _cyrillic = RegExp('[А-Яа-яЁё]');

bool _hasCyrillic(String text) => _cyrillic.hasMatch(text);

String? _russian(Object? value) =>
    value is String && _hasCyrillic(value) ? value.trim() : null;

String? _serverRussianText(Object? body) {
  if (body is! Map) return null;
  final top = _russian(body['message']);
  if (top != null) return top;

  final error = body['error'];
  final inError = _russian(error);
  if (inError != null) return inError;
  if (error is Map) {
    final message = _russian(error['message']);
    if (message != null) return message;
    final details = error['details'];
    if (details is List) {
      for (final detail in details) {
        if (detail is Map) {
          final text = _russian(detail['message']);
          if (text != null) return text;
        }
      }
    }
  }
  return null;
}

String? _errorCode(Object? body) {
  if (body is! Map) return null;
  final error = body['error'];
  if (error is Map) {
    final code = error['code'];
    if (code is String && code.isNotEmpty) return code;
  }
  return null;
}

/// Сбой без ответа сервера.
///
/// `unknown` — тоже «нет связи», если внутри сетевая причина: dio 5.9
/// выпускает сбой TLS и обрыв после соединения как есть, с типом `unknown`
/// (память `feedback_dio_no_response_not_only_connection_error`). В браузере
/// причина — `XMLHttpRequest onError`.
String _transportPhrase(DioException error) {
  switch (error.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
      return kTimeoutPhrase;
    case DioExceptionType.connectionError:
      return kNoConnectionPhrase;
    case DioExceptionType.badCertificate:
      return 'Не удалось установить защищённое соединение с сервером.';
    case DioExceptionType.cancel:
      return 'Запрос отменён.';
    case DioExceptionType.badResponse:
      return kGenericFailurePhrase;
    case DioExceptionType.unknown:
      final inner = '${error.error ?? ''} ${error.message ?? ''}';
      if (RegExp(r'Socket|Handshake|HttpException|XMLHttpRequest|Connection')
          .hasMatch(inner)) {
        return kNoConnectionPhrase;
      }
      return kGenericFailurePhrase;
  }
}
