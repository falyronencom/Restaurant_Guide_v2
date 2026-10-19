/// Позиция распознанного меню для гостя — публичная проекция сервера
/// (`toPublicMenuItem`, `backend/src/projections/menuItemProjections.js`).
///
/// Правила показа — те же, что у сайта (SDL CAT-C-2.7 в редакции
/// 2026-05-26): скрытые модератором позиции сервер не отдаёт вовсе, порог
/// уверенности распознавания (`MIN_CONFIDENCE`) живёт только на сервере и
/// доходит сюда готовым признаком [qualityTier]. Своих порогов приложение не
/// заводит: всё, что пришло, показывается; `needs_caution` — с пометкой,
/// без цены — без цены.
class PublicMenuItem {
  final String id;
  final String itemName;

  /// Нет цены (блюдо внутри сета, не распозналась) — позиция всё равно
  /// показывается.
  final double? priceByn;

  /// Раздел как распознан, без нормализации (CAT-C-2.7).
  final String? categoryRaw;
  final int position;

  /// `clean` или `needs_caution`. Незнакомое значение читается как
  /// `needs_caution`: лишняя пометка безопаснее, чем выдать сомнительную
  /// позицию за проверенную.
  final String qualityTier;

  const PublicMenuItem({
    required this.id,
    required this.itemName,
    required this.priceByn,
    required this.categoryRaw,
    required this.position,
    required this.qualityTier,
  });

  bool get needsCaution => qualityTier != 'clean';

  factory PublicMenuItem.fromJson(Map<String, dynamic> json) {
    final price = json['price_byn'];
    return PublicMenuItem(
      id: json['id'].toString(),
      itemName: json['item_name'] as String,
      priceByn: price is num
          ? price.toDouble()
          : (price is String ? double.tryParse(price) : null),
      categoryRaw: json['category_raw'] as String?,
      position: (json['position'] as num?)?.toInt() ?? 0,
      qualityTier: json['quality_tier'] as String? ?? 'needs_caution',
    );
  }
}

/// Раздел меню: [title] — как распознан; `null` — позиции без раздела.
class MenuSection {
  final String? title;
  final List<PublicMenuItem> items;

  const MenuSection({required this.title, required this.items});
}

/// Позиции по разделам — так же, как их собирает сайт (`MenuItemsList`):
/// разделы — в порядке первой встречи в ответе сервера (он отдаёт позиции
/// по `position`, затем по названию), внутри раздела — по `position`. Пустое
/// название раздела — то же, что его отсутствие.
///
/// Сортировка устойчивая, как у сайта: `position` считается заново для
/// каждого файла меню, и при двух-трёх фото одинаковые номера в разделе
/// обычны — их порядок остаётся серверным. `List.sort` в Dart на списках
/// длиннее 32 неустойчив, поэтому при равных `position` решает место в ответе.
List<MenuSection> groupMenuSections(List<PublicMenuItem> items) {
  final groups = <String?, List<(int, PublicMenuItem)>>{};
  for (var i = 0; i < items.length; i++) {
    final raw = items[i].categoryRaw;
    final key = raw != null && raw.isNotEmpty ? raw : null;
    groups.putIfAbsent(key, () => []).add((i, items[i]));
  }
  return [
    for (final entry in groups.entries)
      MenuSection(
        title: entry.key,
        items: [
          for (final pair in entry.value
            ..sort((a, b) {
              final byPosition = a.$2.position.compareTo(b.$2.position);
              return byPosition != 0 ? byPosition : a.$1.compareTo(b.$1);
            }))
            pair.$2,
        ],
      ),
  ];
}

/// Цена словами сайта: «14 BYN» для целой, «14,50 BYN» с копейками,
/// «—» без цены.
String formatMenuPrice(double? byn) {
  if (byn == null) return '—';
  if (byn % 1 == 0) return '${byn.toInt()} BYN';
  return '${byn.toStringAsFixed(2).replaceAll('.', ',')} BYN';
}

/// Первые [limit] позиций меню — по разделам, в порядке показа: так
/// карточка показывает начало меню, а «Всё меню» — остальное.
List<MenuSection> menuPreviewSections(List<MenuSection> sections, int limit) {
  final preview = <MenuSection>[];
  var left = limit;
  for (final section in sections) {
    if (left <= 0) break;
    final items = section.items.take(left).toList();
    preview.add(MenuSection(title: section.title, items: items));
    left -= items.length;
  }
  return preview;
}
