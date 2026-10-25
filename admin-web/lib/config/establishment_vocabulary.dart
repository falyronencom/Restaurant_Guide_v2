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

// ============================================================================
// Имена полей карточки
// ============================================================================

/// Род имени поля — по нему пустое значение говорит «не указан», «не
/// указана», «не указано» или «не указаны».
enum FieldGender { masculine, feminine, neuter, plural }

/// Имя поля карточки и его род.
class FieldName {
  final String label;
  final FieldGender gender;

  const FieldName(this.label, this.gender);

  /// Пустое значение словом, согласованным с именем поля: «Регистрация — не
  /// указана», а не «не указан» у всех подряд (F-21, Ч11).
  String get emptyText => switch (gender) {
        FieldGender.masculine => 'не указан',
        FieldGender.feminine => 'не указана',
        FieldGender.neuter => 'не указано',
        FieldGender.plural => 'не указаны',
      };
}

/// Одно поле — одно имя на всех экранах панели: в разборе заявки, в
/// карточке одобренного, в диалогах и заметках модерации, в журнале
/// действий (проход по панели модератора, 20.10, F-25, Ч13 — было «Средний
/// чек» и «Ценовой диапазон», «Время работы» и «Часы работы», «Атрибуты
/// заведения» и «Удобства», «Номер для связи», «Номер для связи с клиентом»
/// и «Телефон» у одного поля).
///
/// Ключи — имена полей проверки (`field_notes` заявки) и колонок карточки.
/// Два телефона карточки — разные поля и потому разные имена: гостям
/// звонят по одному, модератор — по другому.
const Map<String, FieldName> kEstablishmentFieldNames = <String, FieldName>{
  'name': FieldName('Название', FieldGender.neuter),
  'legal_name': FieldName('Юридическое название', FieldGender.neuter),
  'unp': FieldName('УНП', FieldGender.masculine),
  'registration_doc': FieldName('Регистрация', FieldGender.feminine),
  'contact_person': FieldName('Телефон контактного лица', FieldGender.masculine),
  'contact_email': FieldName('E-mail', FieldGender.masculine),
  'description': FieldName('Описание', FieldGender.neuter),
  'customer_phone': FieldName('Телефон для гостей', FieldGender.masculine),
  'website': FieldName('Сайт или соцсеть', FieldGender.masculine),
  'working_hours': FieldName('Часы работы', FieldGender.plural),
  'special_hours':
      FieldName('Время дополнительного меню', FieldGender.neuter),
  'price_range': FieldName('Средний чек', FieldGender.masculine),
  'attributes': FieldName('Удобства', FieldGender.plural),
  'categories': FieldName('Категории', FieldGender.plural),
  'cuisines': FieldName('Кухни', FieldGender.plural),
  'photos': FieldName('Фото', FieldGender.neuter),
  'menu': FieldName('Меню', FieldGender.neuter),
  'address': FieldName('Адрес', FieldGender.masculine),
  'city': FieldName('Город', FieldGender.masculine),
  'coordinates': FieldName('Координаты', FieldGender.plural),
  'partner': FieldName('Партнёр', FieldGender.masculine),
};

/// Имя поля по ключу. Незнакомый ключ — как есть: расхождение видно.
String fieldLabel(String key) => kEstablishmentFieldNames[key]?.label ?? key;

/// «не указан/а/о/ы» для поля по ключу; незнакомый ключ — «не указано»,
/// безличное «не указано» читается при любом имени.
String fieldEmptyText(String key) =>
    kEstablishmentFieldNames[key]?.emptyText ?? 'не указано';
