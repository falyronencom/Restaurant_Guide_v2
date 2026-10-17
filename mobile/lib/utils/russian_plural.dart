/// Склонение существительного по числу: 1 отзыв, 2 отзыва, 5 отзывов.
///
/// 11–14 всегда «много» (11 отзывов, не «11 отзыв»), иначе решает последняя
/// цифра.
String pluralRu(int count, String one, String few, String many) {
  final abs = count.abs();
  final lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  switch (abs % 10) {
    case 1:
      return one;
    case 2:
    case 3:
    case 4:
      return few;
    default:
      return many;
  }
}

/// «1 отзыв», «2 отзыва», «5 отзывов».
String reviewsCountLabel(int count) =>
    '$count ${pluralRu(count, 'отзыв', 'отзыва', 'отзывов')}';
