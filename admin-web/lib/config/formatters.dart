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

/// Месяцы в родительном падеже — «14 июля», а не «14 июль».
///
/// Список написан руками, а не взят у `DateFormat('d MMMM', 'ru')`, по двум
/// причинам. Первая: данные локали в `intl` подгружает
/// `GlobalMaterialLocalizations` при старте приложения, и в виджет-тесте, где
/// делегатов нет, тот же вызов бросает `LocaleDataException` — проверено.
/// Вторая: `MMMM` отдаёт форму месяца вне контекста даты, и «14 июль» здесь
/// вероятнее «14 июля».
const List<String> _monthsGenitive = <String>[
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/// День и месяц в местном времени: «14 июля».
///
/// Год добавляется, только когда он отличается от текущего: в журнале за
/// последние 30 дней «14 июля 2026» — лишний шум, а вот «14 июля» у записи
/// позапрошлого года — прямая дезинформация.
String formatDayMonthLocal(DateTime value, {DateTime? now}) {
  final local = value.toLocal();
  final currentYear = (now ?? DateTime.now()).toLocal().year;
  final base = '${local.day} ${_monthsGenitive[local.month - 1]}';
  return local.year == currentYear ? base : '$base ${local.year}';
}

/// День и месяц числами: «12.08».
///
/// Компактная форма для карточек списка, где на дату отведён угол строки.
/// Год не пишется по той же причине, что и в [formatDayMonthLocal], — но
/// здесь его нет и у прошлогодних записей: в моноширинном углу карточки
/// «12.08.2025» ломает выравнивание всей колонки дат, а точная давность
/// читается в панели разбора.
String formatDayMonthShort(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}.${two(local.month)}';
}

/// Время в местном времени: «09:41».
String formatTimeLocal(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.hour)}:${two(local.minute)}';
}

/// Сколько прошло: «только что», «4 минуты назад», «2 часа назад», «3 дня назад».
///
/// Отрицательная разница (часы клиента убежали вперёд) читается как «только
/// что»: «−2 минуты назад» сообщало бы о неисправности часов, а не о журнале.
String formatRelativePast(DateTime value, {DateTime? now}) {
  final elapsed = (now ?? DateTime.now()).difference(value);

  if (elapsed.inMinutes < 1) return 'только что';

  if (elapsed.inHours < 1) {
    final minutes = elapsed.inMinutes;
    return '$minutes ${plural(minutes, 'минуту', 'минуты', 'минут')} назад';
  }

  if (elapsed.inDays < 1) {
    final hours = elapsed.inHours;
    return '$hours ${plural(hours, 'час', 'часа', 'часов')} назад';
  }

  final days = elapsed.inDays;
  return '$days ${plural(days, 'день', 'дня', 'дней')} назад';
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
