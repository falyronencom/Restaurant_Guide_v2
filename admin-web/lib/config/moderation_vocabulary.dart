import 'package:restaurant_guide_admin_web/config/formatters.dart';

/// Машинные обозначения человеческим языком.
///
/// Модератор не программист: `price_above_threshold` и `menu_item` для него
/// не сокращения, а шум. Коду место в базе, в журнале сервера и в URL —
/// на экране место слову.
///
/// Все карты здесь покрыты guard-тестами на полноту. Это не педантизм:
/// карты кодов дрейфуют от бэкенда молча — новый код просто просачивается
/// на экран как есть, ничего не ломая. В журнале действий такой дрейф уже
/// случился и прожил незамеченным до этой правки.

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

/// Деньги без лишних нулей: 1000 → «1 000», 0.5 → «0,50».
String _money(double value) => value == value.roundToDouble()
    ? formatCount(value.round())
    : formatDecimal(value, digits: 2);

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
