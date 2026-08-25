import 'package:intl/intl.dart';
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
/// сервисы реально пишут. У причин флагов такого сторожа нет: их набор живёт
/// строковыми литералами внутри `sanityChecker.js` и наружу не выставлен.
/// Дрейф там придётся ловить чтением, а не сборкой.

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

/// Деньги: 1000 → «1 000», 1234.5 → «1 234,50».
///
/// Разряды группируются и у дробных сумм. Иначе в одной фразе оказывались бы
/// два разных формата числа — «Цена 1234,50 BYN при пороге 1 000 BYN».
final NumberFormat _moneyFormat = NumberFormat('#,##0.00', 'ru');

String _money(double value) => value == value.roundToDouble()
    ? formatCount(value.round())
    : _moneyFormat.format(value);

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
