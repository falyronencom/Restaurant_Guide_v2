/// Поля карточки заведения человеческим языком: удобства, средний чек и
/// категории, которым кухня не нужна.
///
/// Ключи в базе не меняются — на них завязаны фильтры сайта, умный поиск и
/// перепись «Здоровья данных». Меняется только то, что видит модератор: до
/// 21.10.2026 карточка показывала чипы `wifi`, `live_music`, `kids_zone`
/// (проход по панели модератора, 20.10, пункты A1-10, F-23, К-4).
///
/// Источник истины — `backend/src/constants/establishmentVocab.js`. Тест
/// `establishment_vocabulary_test.dart` читает тот файл и падает, если у
/// ключа канона нет подписи здесь: новое удобство без перевода не доедет до
/// экрана молча.
library;

/// Подписи удобств. Слова — как у гостя на сайте
/// (`web/src/lib/establishment-helpers.ts`, `ATTRIBUTE_LABELS`): модератор
/// проверяет ту же карточку, что увидит гость.
const Map<String, String> kAttributeLabels = <String, String>{
  'delivery': 'Доставка еды',
  'wifi': 'Wi-Fi',
  'terrace': 'Терраса',
  'parking': 'Парковка',
  'live_music': 'Живая музыка',
  'kids_zone': 'Детская зона',
  'banquet': 'Банкет',
  'pets_allowed': 'Животные',
  'smoking': 'Курение',
  'accessible_environment': 'Доступная среда',
};

/// Подпись удобства; `null` — ключа нет в каноне. Экран показывает такой
/// ключ как есть, моноширинным: расхождение с каноном видно, а не спрятано.
String? attributeLabel(String key) => kAttributeLabels[key];

/// Средний чек — как у гостя на сайте (`InfoCard`, «до 20 руб»). В базе он
/// хранится значками `$`, `$$`, `$$$`; модератор видит сумму, а значок
/// остаётся рядом — им пользуется кабинет партнёра (Ч12, 20.10).
const Map<String, String> kPriceRangeLabels = <String, String>{
  r'$': 'до 20 руб',
  r'$$': 'до 50 руб',
  r'$$$': 'более 50 руб',
};

/// «до 50 руб · $$». Незнакомое значение — как есть; пустое — `null`.
String? priceRangeLabel(String? value) {
  final raw = value?.trim();
  if (raw == null || raw.isEmpty) return null;
  final label = kPriceRangeLabels[raw];
  return label == null ? raw : '$label · $raw';
}

/// Категории, у которых кухня не обязательна (решение Координатора В5;
/// `CUISINE_OPTIONAL_CATEGORIES` на сервере). Пустая кухня у бара — не
/// пропуск данных, и панель не должна показывать её как ошибку (A1-19).
const List<String> kCuisineOptionalCategories = <String>[
  'Бар',
  'Клуб',
  'Кальянная',
  'Боулинг',
  'Караоке',
  'Бильярд',
];

/// Нужна ли карточке кухня — то же правило, что `isCuisineRequired` на
/// сервере: обойтись без кухни можно, только если КАЖДАЯ категория из набора
/// без кухни; без категорий — нужна.
bool isCuisineRequired(List<String> categories) =>
    categories.isEmpty ||
    !categories.every(kCuisineOptionalCategories.contains);
