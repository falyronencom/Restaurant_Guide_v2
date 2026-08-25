import 'package:intl/intl.dart';

/// Форматирование чисел для админки — по русским правилам.
///
/// Вынесено отдельно, потому что одни и те же величины показываются в
/// метриках, панели «Требует внимания», таблицах и подписях графиков, и
/// расходиться они не должны.

final NumberFormat _decimal = NumberFormat.decimalPattern('ru');

/// Счётчик с разделителем разрядов: 1248 → «1 248».
String formatCount(int value) => _decimal.format(value);

/// Процент изменения со знаком-стрелкой: 12.4 → «↑ 12,4%», -2.3 → «↓ 2,3%».
///
/// Знак несёт стрелка, поэтому минус в числе не дублируется. Ноль — без
/// стрелки: «0%», изменения не было.
String formatDelta(double percent) {
  final value = percent.abs().toStringAsFixed(1).replaceAll('.', ',');
  if (percent == 0) return '$value%';
  return '${percent > 0 ? '↑' : '↓'} $value%';
}

/// Дробное с запятой: 4.4 → «4,4».
String formatDecimal(double value, {int digits = 1}) =>
    value.toStringAsFixed(digits).replaceAll('.', ',');

/// Дата в местном времени: 2026-08-09T22:10Z → «10.08.2026» на UTC+3.
///
/// `.toLocal()` здесь не украшение. Метки приходят с бэкенда в UTC
/// (`toISOString`), и чтение `.day` прямо с них показывает вчерашнее число
/// для всего, что произошло после 21:00 по Минску. Дефект тихий: в проде
/// процесс живёт в UTC, и расхождение видно только у пользователя.
String formatDateLocal(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}.${two(local.month)}.${local.year}';
}

/// Склонение существительного при числе.
///
/// [one] — 1 действие, [few] — 2 действия, [many] — 5 действий.
/// Русские правила: 11–14 всегда «many», дальше по последней цифре.
String plural(int count, String one, String few, String many) {
  final mod100 = count.abs() % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  return switch (count.abs() % 10) {
    1 => one,
    2 || 3 || 4 => few,
    _ => many,
  };
}

/// Число со склонённым существительным: «23 действия».
String countWithNoun(int count, String one, String few, String many) =>
    '${formatCount(count)} ${plural(count, one, few, many)}';
