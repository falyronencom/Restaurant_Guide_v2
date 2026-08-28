import 'package:restaurant_guide_admin_web/config/formatters.dart';

/// Машинные обозначения человеческим языком.
///
/// Модератор не программист: `price_above_threshold` и `menu_item` для него
/// не сокращения, а шум. Коду место в базе, в журнале сервера и в URL —
/// на экране место слову.
///
/// Карты закрыты тестами на полноту, но важно понимать, ЧТО именно они
/// стерегут. Набор кодов в тесте — копия здешнего набора, поэтому тест ловит
/// правку карты без правки теста, а вот появление нового кода НА БЭКЕНДЕ он
/// не заметит: там не меняется ничего из того, что он читает.
///
/// Настоящий сторож есть только у действий журнала — `admin-audit-log-
/// summaries.test.js` бьёт по живому API и сверяет подписи со всем, что
/// сервисы реально пишут.
///
/// У причин флагов сторож теперь тоже есть, но на другой стороне: набор кодов
/// выставлен наружу как `SANITY_FLAG_REASONS` (`sanityChecker.js`), едет
/// клиенту в `meta.reasons` и закрыт guard-тестами бэкенда — правило не может
/// завести причину мимо канона. Здешняя карта переводит его на русский; код,
/// которого в ней не окажется, показывается как есть — так дрейф между двумя
/// языками виден на экране, а не прячется за вежливой подписью.

// ============================================================================
// Типы сущностей журнала действий
// ============================================================================

/// Источник истины — `entity_type` в `audit_log`
/// (`backend/src/models/auditLogModel.js`).
const Map<String, String> kAuditEntityTypes = <String, String>{
  'establishment': 'Заведение',
  'menu_item': 'Позиция меню',
  'review': 'Отзыв',
  'user': 'Пользователь',
};

/// Тип сущности словом. Незнакомый код возвращается как есть — так дефект
/// виден, а не спрятан за вежливым «объект».
String auditEntityLabel(String entityType) =>
    kAuditEntityTypes[entityType] ?? entityType;

/// Действия журнала — короткие подписи для фильтра.
///
/// Отличаются от подписей строк: в таблице стоит «Скрыта позиция меню»
/// (собирает бэкенд), в фильтре — «Скрытие позиции меню». Набор обязан быть
/// полным: модератор, прочитавший действие в таблице, должен уметь по нему
/// отфильтровать. До этой правки в списке было восемь из четырнадцати.
const Map<String, String> kAuditActions = <String, String>{
  'moderate_approve': 'Одобрение',
  'moderate_reject': 'Отклонение',
  'suspend': 'Приостановка',
  'unsuspend': 'Возобновление',
  'claim_establishment': 'Передача партнёру',
  'admin_update_coordinates': 'Обновление координат',
  'admin_update_slug': 'Изменение адреса страницы',
  'review_hide': 'Скрытие отзыва',
  'review_show': 'Показ отзыва',
  'review_delete': 'Удаление отзыва',
  'hide_menu_item': 'Скрытие позиции меню',
  'unhide_menu_item': 'Показ позиции меню',
  'dismiss_sanity_flag': 'Снятие флага',
  'upgrade_user_to_partner': 'Повышение до партнёра',
};

/// Что действие сделало с доступностью объекта.
///
/// Точка слева от подписи в журнале кодирует **направление ограничения**, а
/// не одобрение поступка. Приостановка не «плохая» — она ограничивающая;
/// передача заведения партнёру не «хорошая» — она ничего не открывает и не
/// закрывает. Такая шкала читается сканирующим взглядом: красное отняло,
/// зелёное вернуло, серое переписало данные.
enum AuditActionTone {
  /// Впустило в каталог или сняло ограничение.
  allowing,

  /// Отклонило, скрыло, приостановило, удалило.
  restricting,

  /// Правка, не менявшая доступность.
  neutral,
}

/// Направление каждого действия журнала.
///
/// Набор ключей обязан совпадать с [kAuditActions] ключ в ключ, и это
/// проверяется тестом: действие без тона получило бы серую точку молча, а
/// молчаливый серый неотличим от осознанного серого у правки координат.
const Map<String, AuditActionTone> kAuditActionTones = <String, AuditActionTone>{
  'moderate_approve': AuditActionTone.allowing,
  'moderate_reject': AuditActionTone.restricting,
  'suspend': AuditActionTone.restricting,
  'unsuspend': AuditActionTone.allowing,
  'claim_establishment': AuditActionTone.neutral,
  'admin_update_coordinates': AuditActionTone.neutral,
  'admin_update_slug': AuditActionTone.neutral,
  'review_hide': AuditActionTone.restricting,
  'review_show': AuditActionTone.allowing,
  'review_delete': AuditActionTone.restricting,
  'hide_menu_item': AuditActionTone.restricting,
  'unhide_menu_item': AuditActionTone.allowing,
  // Снятие флага ничего не открывает: помеченная позиция и так была видна
  // партнёру и в каталоге — флаг звал модератора посмотреть, а не прятал.
  'dismiss_sanity_flag': AuditActionTone.neutral,
  // Повышение до партнёра меняет права человека, а не доступность объекта.
  'upgrade_user_to_partner': AuditActionTone.neutral,
};

/// Направление действия. Незнакомое — нейтральное: выдумывать ему цвет
/// нельзя, а подпись рядом всё равно останется машинной и выдаст дрейф.
AuditActionTone auditActionTone(String action) =>
    kAuditActionTones[action] ?? AuditActionTone.neutral;

// ============================================================================
// Флаги проверки позиций меню
// ============================================================================

/// Источник истины — `backend/src/services/ocr/sanityChecker.js`, фаза 1:
/// четыре правила, первое сработавшее выигрывает.
const Map<String, String> kSanityFlagReasons = <String, String>{
  'price_below_threshold': 'Цена ниже порога',
  'price_above_threshold': 'Цена выше порога',
  'low_confidence': 'Низкая уверенность распознавания',
  'price_delta_anomaly': 'Резкое изменение цены',
};

/// Короткая подпись флага — для чипа в списке.
String sanityFlagLabel(String reason) =>
    kSanityFlagReasons[reason] ?? reason;

/// Развёрнутая фраза по флагу: что именно не так, с числами.
///
/// Числа берутся из `details`, который у каждого правила свой. Если правило
/// незнакомое или подробностей не хватило — возвращается `null`, и
/// вызывающий показывает исходное содержимое флага. Пустая строка вместо
/// фразы была бы хуже кода: непонятное лучше невидимого.
String? describeSanityFlag(Map<String, dynamic>? flag) {
  if (flag == null) return null;

  final reason = flag['reason'];
  if (reason is! String) return null;

  final details = flag['details'];
  final data = details is Map ? details : const <String, dynamic>{};

  double? number(String key) {
    final value = data[key];
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  switch (reason) {
    case 'price_below_threshold':
    case 'price_above_threshold':
      final price = number('price');
      final threshold = number('threshold');
      if (price == null || threshold == null) return null;
      return 'Цена ${_money(price)} BYN при пороге ${_money(threshold)} BYN';

    case 'low_confidence':
      final confidence = number('confidence');
      final threshold = number('threshold');
      if (confidence == null || threshold == null) return null;
      return 'Уверенность распознавания ${_percent(confidence)} '
          'при пороге ${_percent(threshold)}';

    case 'price_delta_anomaly':
      final previous = number('previousPrice');
      final current = number('currentPrice');
      final ratio = number('ratio');
      if (previous == null || current == null) return null;
      final grew = current > previous;
      final times = ratio == null ? '' : ' — в ${_ratio(ratio)} ${_times(ratio)}';
      return 'Цена ${grew ? 'выросла' : 'упала'} с ${_money(previous)} '
          'до ${_money(current)} BYN$times';

    default:
      return null;
  }
}

/// Деньги берутся из общего форматтера: та же сумма показывается и во фразе
/// флага, и в факт-гриде панели разбора, и расходиться они не должны.
String _money(double value) => formatMoney(value);

/// Кратность: 4 → «4», 3.5 → «3,5». Не деньги — копейки ей ни к чему, и
/// `_money` дал бы «3,50».
String _ratio(double value) => value == value.roundToDouble()
    ? formatCount(value.round())
    : formatDecimal(value, digits: 1);

/// Склонение «раз» при кратности: 5 → «раз», 4 → «раза», 3,5 → «раза».
///
/// Дробная кратность всегда «раза» — склоняется знаменатель, а не число
/// целиком: «в 3,5 раза», но «в 5 раз».
String _times(double ratio) => ratio == ratio.roundToDouble()
    ? plural(ratio.round(), 'раз', 'раза', 'раз')
    : 'раза';

/// Доля в процентах: 0.62 → «62%».
String _percent(double value) => '${(value * 100).round()}%';
