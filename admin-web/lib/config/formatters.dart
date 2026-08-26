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

/// Доля от целого в процентах: 365 из 412 → «88,6%».
///
/// Один знак после запятой, и он не декоративный: доли статусов различаются
/// в пределах процента («1,7%» против «2,2%»), и округление до целых слило бы
/// их в одинаковые «2%».
///
/// Пустое целое даёт «0,0%» — ту же форму, что и нулевая доля непустого, а не
/// «NaN%» и не пустоту. Две записи нуля в одной колонке читались бы как две
/// разные величины.
String formatShare(int value, int total) {
  if (total <= 0) return '${formatDecimal(0)}%';
  return '${formatDecimal(value * 100 / total)}%';
}

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

/// Окно аналитики словами: «12 июля — 10 августа 2026».
///
/// Обе границы читаются по UTC, а не переводятся в местное время. Окно и
/// задано в сутках UTC — по ним же группируются столбцы графиков, — поэтому
/// перевод в пояс браузера сдвинул бы подпись относительно того, что реально
/// посчитано, и на UTC+3 подпись разошлась бы с данными на день.
///
/// Год пишется один раз в конце, если он общий; месяц не повторяется, когда
/// обе даты в одном месяце: «1 — 10 августа 2026».
String formatPeriodRangeUtc(DateTime start, DateTime lastDay) {
  final a = start.toUtc();
  final b = lastDay.toUtc();

  String dayMonth(DateTime d) => '${d.day} ${_monthsGenitive[d.month - 1]}';

  if (a.year == b.year && a.month == b.month && a.day == b.day) {
    return '${dayMonth(b)} ${b.year}';
  }
  if (a.year != b.year) {
    return '${dayMonth(a)} ${a.year} — ${dayMonth(b)} ${b.year}';
  }
  if (a.month == b.month) {
    return '${a.day} — ${dayMonth(b)} ${b.year}';
  }
  return '${dayMonth(a)} — ${dayMonth(b)} ${b.year}';
}

/// Месяц сокращённо для подписи оси: «авг».
///
/// Список написан руками по той же причине, что и родительный падеж выше:
/// `DateFormat('MMM', 'ru')` требует данных локали, которые подгружает
/// `GlobalMaterialLocalizations` при старте приложения. В виджет-тесте
/// делегатов нет, и тот же вызов бросает `LocaleDataException` — то есть
/// график с месячной агрегацией нельзя было бы покрыть тестом вовсе.
const List<String> _monthsShort = <String>[
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

String formatMonthShort(DateTime value) => _monthsShort[value.month - 1];

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
