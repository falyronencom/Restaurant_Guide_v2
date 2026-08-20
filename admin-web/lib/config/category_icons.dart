/// Категория или кухня заведения → имя файла в `assets/icons/`.
///
/// Ключ — то, что реально приходит из API: канон хранит категории и кухни
/// кириллическими названиями (`establishments.categories`,
/// `backend/src/constants/establishmentVocab.js` — 15 категорий, 12 кухонь),
/// а слаги живут отдельно и только для URL (`urlSlugs.js`). Поэтому карта
/// ключуется названием, а не слагом — в отличие от веба, где то же самое
/// решается наоборот (`web/src/lib/category-icons.ts`).
///
/// **Набор иконок здесь неполный.** В `admin-web/assets/icons/` лежат 15
/// файлов — образец из `docs/design_handoff_web_vitrine/assets/icons`, а не
/// весь канон. Полный набор (37 файлов, кириллические имена) — в
/// `mobile/assets/icons/`. Непокрытые категории (Пиццерия, Кальянная,
/// Боулинг и ещё семь) отдают `null`, и вызывающий рисует нейтральный глиф.
/// Врать иконкой «ресторан» там, где боулинг, хуже, чем не показать ничего.
library;

/// Категории, у которых иконка есть. 5 из 15 канонических.
const Map<String, String> _categoryIcons = <String, String>{
  'ресторан': 'restaurant',
  'кофейня': 'coffee',
  'кафе': 'cafe',
  'бар': 'bar',
  'пекарня': 'bakery',
};

/// Кухни, у которых иконка есть. 6 из 12 канонических.
const Map<String, String> _cuisineIcons = <String, String>{
  'народная': 'folk',
  'азиатская': 'asian',
  'японская': 'japanese',
  'грузинская': 'georgian',
  'итальянская': 'italian',
  'европейская': 'european',
};

/// Приведение ключа: регистр и «ё» не должны решать, найдётся иконка или нет.
String _normalize(String value) => value.trim().toLowerCase().replaceAll('ё', 'е');

/// Иконка для карточки заведения: сначала категория, затем кухня.
///
/// Каскад именно такой, потому что категория отвечает на вопрос «что это за
/// место», а кухня лишь уточняет. Возвращает базовое имя файла без пути и
/// расширения либо `null`, если ни одно из названий не покрыто набором.
String? iconNameForEstablishment({
  List<String> categories = const <String>[],
  List<String> cuisines = const <String>[],
}) {
  for (final category in categories) {
    final icon = _categoryIcons[_normalize(category)];
    if (icon != null) return icon;
  }
  for (final cuisine in cuisines) {
    final icon = _cuisineIcons[_normalize(cuisine)];
    if (icon != null) return icon;
  }
  return null;
}

/// Полный путь к SVG для `SvgPicture.asset`, либо `null`.
String? iconAssetForEstablishment({
  List<String> categories = const <String>[],
  List<String> cuisines = const <String>[],
}) {
  final name = iconNameForEstablishment(
    categories: categories,
    cuisines: cuisines,
  );
  return name == null ? null : 'assets/icons/$name.svg';
}
