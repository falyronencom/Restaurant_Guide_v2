import 'dart:math' as math;

import 'package:restaurant_guide_mobile/utils/venue_labels.dart';

import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';
import 'package:restaurant_guide_mobile/utils/russian_plural.dart';

// Прогулка (этап 4 «Избранного», решение Координатора Р3, 17.10.2026): до
// каких мест человек дойдёт пешком за выбранные минуты. Здесь только
// арифметика и отбор — ни карты, ни экрана, ни избранного: прогулку на общей
// карте Координатор решит после этапа 4, и она возьмёт эти же функции.

/// Скорость пешехода, км/ч (README макета, экран 3).
const double kWalkSpeedKmh = 4.8;

/// Запас на улицы: путь по городу длиннее прямой. Минуты = прямая × запас /
/// скорость (Р3: «×1,3 — рекомендация, не замер»). Единственное место, где
/// это число записано.
const double kWalkDetourFactor = 1.3;

/// Минуты, которые можно выбрать.
const List<int> kWalkMinuteOptions = [5, 10, 15, 30];

/// Допуск границы круга. Точки кольца стоят от центра на радиус с ошибкой
/// вычисления в миллиардные доли метра — в обе стороны; микрометр держит
/// место на самом кольце «в круге».
const double _ringToleranceMeters = 1e-6;

/// Радиус круга для [minutes]: столько метров по прямой проходится за эти
/// минуты с запасом [kWalkDetourFactor]. 15 минут ≈ 923 м.
double walkRadiusMeters(int minutes) =>
    minutes / 60 * kWalkSpeedKmh * 1000 / kWalkDetourFactor;

/// Минуты до места в [meters] по прямой — с запасом, без округления.
double walkMinutesExact(double meters) =>
    meters * kWalkDetourFactor / (kWalkSpeedKmh * 1000) * 60;

/// Минуты для подписи «≈ N мин»: вверх до целой, не меньше одной.
///
/// Вверх — потому что подпись и так приблизительна, и обещать быстрее, чем
/// вышло с запасом, ей незачем. Место на границе круга 15 минут подписано
/// «≈ 15 мин», не «≈ 16»: допуск в миллионную долю минуты (меньше десятой
/// миллиметра) съедает дробный хвост вычислений и покрывает допуск круга.
int walkMinutesRounded(double meters) =>
    math.max(1, (walkMinutesExact(meters) - 1e-6).ceil());

/// «≈ 7 мин».
String walkMinutesLabel(double meters) => '≈ ${walkMinutesRounded(meters)} мин';

/// «550 м» до километра (с точностью до десяти метров), дальше «1,2 км» —
/// общее правило расстояния ([distanceLabelMeters]).
String walkDistanceLabel(double meters) => distanceLabelMeters(meters);

/// «15 минут» — подпись чипа и строки выбора.
String walkMinutesChoiceLabel(int minutes) =>
    '$minutes ${pluralRu(minutes, 'минута', 'минуты', 'минут')}';

/// «в 15 минутах».
String walkWithinLabel(int minutes) =>
    'в $minutes ${pluralRu(minutes, 'минуте', 'минутах', 'минутах')}';

/// «3 места в 15 минутах» — заголовок шторки.
String walkReachTitle(int count, int minutes) =>
    '$count ${pluralRu(count, 'место', 'места', 'мест')} '
    '${walkWithinLabel(minutes)}';

/// Место в пешей доступности: заведение и расстояние до него по прямой.
class WalkPlace {
  const WalkPlace(this.establishment, this.meters);

  final Establishment establishment;
  final double meters;

  /// Минуты подписи — [walkMinutesRounded].
  int get minutes => walkMinutesRounded(meters);
}

/// Что видит прогулка: места шторки и счётчики подписи «рядом · N из M».
class WalkReach {
  const WalkReach({
    required this.places,
    required this.inCircle,
    required this.total,
  });

  /// Места шторки — по возрастанию минут; при «Открыто сейчас» только
  /// открытые.
  final List<WalkPlace> places;

  /// Сколько мест в круге до фильтра «Открыто сейчас». Больше [shown] —
  /// значит, в круге есть закрытые.
  final int inCircle;

  /// Все места, с координатами и без, — M в «рядом · N из M».
  final int total;

  /// N в «рядом · N из M» — сколько мест в шторке.
  int get shown => places.length;
}

/// Кто из [establishments] дойдёт пешком за [minutes] от [from].
///
/// В круге — место, чьё расстояние по прямой не больше радиуса
/// [walkRadiusMeters]: ровно то, что нарисовано кольцом. Места без координат
/// в круг не попадают, но входят в [WalkReach.total]. Порядок — по
/// возрастанию расстояния (а с ним и минут), равные — в прежнем порядке.
/// [openNowOnly] убирает закрытые на момент [at] (по умолчанию — сейчас).
WalkReach walkReach(
  List<Establishment> establishments, {
  required GeoPoint from,
  required int minutes,
  bool openNowOnly = false,
  DateTime? at,
}) {
  final radius = walkRadiusMeters(minutes);
  final moment = at ?? DateTime.now();
  final inCircle = <(int, WalkPlace)>[];
  for (var i = 0; i < establishments.length; i++) {
    final e = establishments[i];
    final lat = e.latitude;
    final lng = e.longitude;
    if (lat == null || lng == null) continue;
    final meters = metersBetween(from, (latitude: lat, longitude: lng));
    if (meters <= radius + _ringToleranceMeters) {
      inCircle.add((i, WalkPlace(e, meters)));
    }
  }
  // List.sort нестабилен — равные расстояния держит прежний индекс.
  inCircle.sort((a, b) {
    final byMeters = a.$2.meters.compareTo(b.$2.meters);
    return byMeters != 0 ? byMeters : a.$1.compareTo(b.$1);
  });
  return WalkReach(
    places: [
      for (final (_, place) in inCircle)
        if (!openNowOnly || place.establishment.isOpenAt(moment)) place,
    ],
    inCircle: inCircle.length,
    total: establishments.length,
  );
}
