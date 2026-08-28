/// Data models for the Quality Health admin panel (AI-ops Brick-1, Tier-0 immunity).
library;

/// One attribute key and how many active establishments carry it.
class AttributeKeyCount {
  final String key;
  final int count;

  const AttributeKeyCount({required this.key, required this.count});

  factory AttributeKeyCount.fromJson(Map<String, dynamic> json) {
    return AttributeKeyCount(
      key: json['key'] is String ? json['key'] as String : '',
      count: json['count'] is int ? json['count'] as int : 0,
    );
  }
}

/// Заведение, попавшее под сигнал: имя, город и что именно у него не так.
///
/// Бэкенд собирает такие списки по четырём сигналам (до 25 строк на каждый) и
/// до этапа 7 клиент их выбрасывал целиком. Без них экран сообщал «три карточки
/// сломаны» и не давал узнать какие: маршрута на отдельное заведение в админке
/// нет вовсе, только списки очередей. Имя плюс город — рабочий адрес: поиск на
/// «Одобренных» ищет по всем статусам.
class QualitySample {
  final String id;
  final String name;
  final String? city;

  /// Диагноз этой карточки, своей фразой у каждого сигнала. `null` — сигнал
  /// ничего сверх имени не присылает (так у пустых меню).
  final String? detail;

  const QualitySample({
    required this.id,
    required this.name,
    required this.city,
    required this.detail,
  });

  /// Общая часть разбора; [detail] строит вызывающий — он один знает правило.
  factory QualitySample.fromJson(
    Map<String, dynamic> json, {
    String? Function(Map<String, dynamic>)? detail,
  }) {
    return QualitySample(
      // Через `is String`, а не `as String?`. Приведение бросает на числе, а
      // исключение из разбора одной строки примера всплывает до провайдера и
      // подменяет ВЕСЬ экран карточкой «Снимок не загрузился»: одиннадцать
      // проверок исчезают из-за одного поля в одном примере. Терять строку —
      // приемлемо, терять экран — нет.
      id: json['id'] is String ? json['id'] as String : '',
      name: json['name'] is String ? json['name'] as String : '—',
      city: json['city'] is String ? json['city'] as String : null,
      detail: detail?.call(json),
    );
  }
}

List<QualitySample> _samples(
  dynamic raw, {
  String? Function(Map<String, dynamic>)? detail,
}) {
  if (raw is! List) return const <QualitySample>[];
  return raw
      .whereType<Map<String, dynamic>>()
      .map((e) => QualitySample.fromJson(e, detail: detail))
      .toList();
}

/// «Недостижимы»: какой из двух слагов пустой — то и чинить.
String? _unreachableDetail(Map<String, dynamic> json) {
  final noCity = json['city_slug'] == null;
  final noCategory = json['category_slug'] == null;
  if (noCity && noCategory) return 'ни город, ни категория не в каноне';
  if (noCity) return 'город не в каноне';
  if (noCategory) return 'категория не в каноне';
  return null;
}

/// «Координаты вне границ»: две разные поломки с разной починкой.
String? _geoDetail(Map<String, dynamic> json) {
  return switch (json['reason']) {
    'outside_belarus' => 'точка вне Беларуси',
    'city_mismatch' => 'точка не в своём городе',
    _ => null,
  };
}


/// Отбирает из общего списка часов строки с поднятым флагом [flag].
List<dynamic> _pick(dynamic raw, String flag) {
  if (raw is! List) return const <dynamic>[];
  return raw
      .whereType<Map<String, dynamic>>()
      .where((e) => e[flag] == true)
      .toList();
}

/// Read-only quality-health snapshot over active establishments.
class QualityHealthData {
  final String scope;
  final String? generatedAt;

  // Canon / slug reachability
  final int unreachableCount;
  final List<QualitySample> unreachableSamples;
  final int categoryOffCanonCount;
  final int cuisineOffCanonCount;

  // Menu completeness
  final int emptyMenusCount;
  final List<QualitySample> emptyMenusSamples;
  final int ocrFailedCount;
  final int ocrStuckCount;

  // Geo bounds
  final int outOfBoundsCount;
  final List<QualitySample> outOfBoundsSamples;

  // Working hours
  final int hoursMalformedCount;
  final int hoursAllClosedCount;

  /// Часы приходят ОДНИМ списком на два сигнала — с флагами `malformed` и
  /// `all_closed`, и одна карточка бывает сразу в обоих. Разбор на две части
  /// сделан здесь, а не оставлен потребителю: забыть отфильтровать легко, и
  /// тогда карточка «всё закрыто» показала бы заведения с битым форматом.
  final List<QualitySample> hoursMalformedSamples;
  final List<QualitySample> hoursAllClosedSamples;

  // Attribute census
  final List<AttributeKeyCount> attributeKeys;
  final int nonObjectAttributesCount;

  // Hanging OCR flags
  final int hangingFlagsCount;

  /// Две корзины возраста, а не одна.
  ///
  /// Обе приходили с бэкенда и обе выбрасывались: тридцатидневная не
  /// разбиралась вовсе, семидневная разбиралась и не показывалась. Корзины
  /// отличают «не успели на этой неделе» от «забыли месяц назад» — это
  /// единственная величина на экране, которая говорит не «плохо сейчас», а
  /// «плохо давно».
  final int hangingAgedOver7d;
  final int hangingAgedOver30d;

  // Price distribution (deferred stub)
  final String priceDistributionStatus;

  const QualityHealthData({
    required this.scope,
    required this.generatedAt,
    required this.unreachableCount,
    this.unreachableSamples = const <QualitySample>[],
    required this.categoryOffCanonCount,
    required this.cuisineOffCanonCount,
    required this.emptyMenusCount,
    this.emptyMenusSamples = const <QualitySample>[],
    required this.ocrFailedCount,
    required this.ocrStuckCount,
    required this.outOfBoundsCount,
    this.outOfBoundsSamples = const <QualitySample>[],
    required this.hoursMalformedCount,
    required this.hoursAllClosedCount,
    this.hoursMalformedSamples = const <QualitySample>[],
    this.hoursAllClosedSamples = const <QualitySample>[],
    required this.attributeKeys,
    required this.nonObjectAttributesCount,
    required this.hangingFlagsCount,
    required this.hangingAgedOver7d,
    required this.hangingAgedOver30d,
    required this.priceDistributionStatus,
  });

  factory QualityHealthData.fromJson(Map<String, dynamic> json) {
    final canon = json['canon_reachability'] as Map<String, dynamic>? ?? const {};
    final menu = json['menu_completeness'] as Map<String, dynamic>? ?? const {};
    final geo = json['geo_bounds'] as Map<String, dynamic>? ?? const {};
    final hours = json['working_hours'] as Map<String, dynamic>? ?? const {};
    final census = json['attribute_census'] as Map<String, dynamic>? ?? const {};
    final flags = json['hanging_flags'] as Map<String, dynamic>? ?? const {};
    final price = json['price_distribution'] as Map<String, dynamic>? ?? const {};
    final keysRaw = census['keys'] as List<dynamic>? ?? const [];

    return QualityHealthData(
      scope: json['scope'] as String? ?? 'active',
      generatedAt: json['generated_at'] as String?,
      unreachableCount: canon['unreachable_count'] as int? ?? 0,
      unreachableSamples: _samples(
        canon['unreachable_samples'],
        detail: _unreachableDetail,
      ),
      categoryOffCanonCount: canon['category_offcanon_count'] as int? ?? 0,
      cuisineOffCanonCount: canon['cuisine_offcanon_count'] as int? ?? 0,
      emptyMenusCount: menu['empty_menus_count'] as int? ?? 0,
      emptyMenusSamples: _samples(menu['empty_menus_samples']),
      ocrFailedCount: menu['ocr_failed_count'] as int? ?? 0,
      ocrStuckCount: menu['ocr_stuck_count'] as int? ?? 0,
      outOfBoundsCount: geo['count'] as int? ?? 0,
      outOfBoundsSamples: _samples(geo['samples'], detail: _geoDetail),
      hoursMalformedCount: hours['malformed_count'] as int? ?? 0,
      hoursAllClosedCount: hours['all_closed_count'] as int? ?? 0,
      hoursMalformedSamples: _samples(
        _pick(hours['samples'], 'malformed'),
        detail: (_) => 'время работы не читается',
      ),
      hoursAllClosedSamples: _samples(
        _pick(hours['samples'], 'all_closed'),
        detail: (_) => 'закрыто во все дни',
      ),
      // `whereType` вместо приведения: `null` или мусор в списке ключей ронял
      // весь снимок так же, как и в примерах выше.
      attributeKeys: keysRaw
          .whereType<Map<String, dynamic>>()
          .map(AttributeKeyCount.fromJson)
          .toList(),
      nonObjectAttributesCount: census['non_object_count'] as int? ?? 0,
      hangingFlagsCount: flags['hanging_count'] as int? ?? 0,
      hangingAgedOver7d: flags['aged_over_7d'] as int? ?? 0,
      hangingAgedOver30d: flags['aged_over_30d'] as int? ?? 0,
      priceDistributionStatus: price['status'] as String? ?? 'deferred',
    );
  }
}
