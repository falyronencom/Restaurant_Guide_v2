/// Шкала и подписи для графиков аналитики.
///
/// Живёт отдельно от обоих графиков намеренно: `CanonBarChart` и
/// `CanonComboChart` — соседи, и одному тянуть другого ради статического
/// помощника значило бы завести зависимость там, где её по смыслу нет.
library;

/// Верх шкалы количества, кратный четырём делениям.
///
/// Просто `ceil(max * 1.2)` даёт нецелый шаг: при пяти событиях верх выходит
/// 6, шаг 1,5, а подписи печатаются целыми — и линия сетки, подписанная «2»,
/// стоит на высоте 1,5. Столбец высотой 2 оказывается ВЫШЕ подписи «2».
/// Промах тем вероятнее, чем меньше числа, то есть как раз на малом трафике.
double niceMaxY(int maxCount) {
  final headroom = (maxCount * 1.2).ceilToDouble().clamp(1.0, double.infinity);
  final step = (headroom / 4).ceilToDouble().clamp(1.0, double.infinity);
  return step * 4;
}

/// Что значит один столбец графика — «в день», «в неделю», «в месяц».
///
/// Шаг выбирает сервер по длине окна (≤ 30 суток — день, ≤ 90 — неделя,
/// дальше — месяц), а легенды были константой «в день»: при «90 днях» столбец
/// недельный, и «42» читалось как 42 за сутки (проход по панели модератора,
/// 20.10, A3-15, Ч6).
String perBucketLabel(String aggregation) => switch (aggregation) {
      'week' => 'в неделю',
      'month' => 'в месяц',
      _ => 'в день',
    };

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

const List<String> _monthsNominative = <String>[
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/// Какой отрезок времени покрывает столбец — для подсказки при наведении:
/// «14 октября», «13 — 19 октября», «29 сентября — 5 октября», «октябрь 2026».
///
/// Дата столбца приходит календарным днём ('2026-10-13') — началом корзины,
/// как её группирует SQL (неделя — с понедельника, месяц — с первого числа).
/// Часовой пояс не участвует: день читается полями строки, как написан.
String bucketLabel(String raw, String aggregation) {
  final date = DateTime.tryParse(raw);
  if (date == null) return raw;
  String dayMonth(DateTime d) => '${d.day} ${_monthsGenitive[d.month - 1]}';

  switch (aggregation) {
    case 'month':
      return '${_monthsNominative[date.month - 1]} ${date.year}';
    case 'week':
      final end = DateTime(date.year, date.month, date.day + 6);
      if (end.month == date.month) return '${date.day} — ${dayMonth(end)}';
      return '${dayMonth(date)} — ${dayMonth(end)}';
    default:
      return dayMonth(date);
  }
}

/// Через сколько столбцов ставить подпись оси X, чтобы подписи не слипались.
///
/// Считается от ширины поля, а не только от числа точек: при «90 днях» на
/// узкой карточке «12.10» и «19.10» вставали вплотную (Ч5). На подпись
/// отводится [labelWidth] — «12.10» шрифтом 10 занимает около 30 пикселей,
/// остальное — воздух между соседями.
int labelStride(int count, double width, {double labelWidth = 48}) {
  if (count <= 1 || width <= 0) return 1;
  final fit = (width / labelWidth).floor().clamp(1, count);
  return (count / fit).ceil().clamp(1, count);
}
