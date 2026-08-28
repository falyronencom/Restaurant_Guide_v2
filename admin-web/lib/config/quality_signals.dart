import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';

/// Канон сигналов «Здоровья данных»: состав, порядок и то, как каждый из них
/// называется человеку.
///
/// **Зачем отдельный файл.** Порядок карточек перестал быть внутренним делом
/// экрана: панель «Требует внимания» на дашборде считает по нему красные
/// проверки и берёт ПЕРВУЮ из них себе в подпись. Держи он этот список у себя
/// — два экрана разошлись бы молча, и дашборд отправлял бы читателя искать
/// сигнал, которого на экране нет в этом месте.
///
/// **Откуда порядок.** Он не выдуман: если убрать из него четыре проверки,
/// которые в кадре 04 стоят на нуле, останется ровно та последовательность
/// красных карточек, что нарисована в макете. Там, где макет молчит (куда
/// встанет проверка, если она перестанет быть нулевой), проверка поставлена
/// рядом со своей роднёй — «всё закрыто» за «битым форматом», «зависшие OCR»
/// за «ошибками OCR», «канон категорий» перед «каноном кухонь».
///
/// Сортировка «проблемные первыми» на экране — устойчивая перестановка ПОВЕРХ
/// этого порядка, а не замена ему.
///
/// **Область у сигналов разная**, и шапка экрана за всех не отвечает. Восемь
/// проверок считаются по активным заведениям; у трёх область шире, и они
/// называют её сами — [QualitySignal.scopeNote]. Прежняя шапка обещала одну
/// область на всех и в трёх случаях из одиннадцати говорила неправду.
class QualitySignal {
  /// Устойчивый ключ. По нему тесты адресуют сигнал, не завися от подписи.
  final String id;

  /// Заголовок карточки.
  final String title;

  /// Что означает ненулевой счётчик. У чистой карточки не показывается:
  /// объяснять нечего, а строка занимала бы место в сетке из одиннадцати.
  final String subtitle;

  /// Область, если она шире активных заведений. `null` — область обычная.
  final String? scopeNote;

  /// Короткое имя для перечисления чистых проверок в сводке.
  final String cleanLabel;

  final IconData icon;

  /// Как достать счётчик из ответа.
  final int Function(QualityHealthData) countOf;

  /// Какие заведения попали под сигнал. Пустой список — примеров нет.
  ///
  /// Есть у четырёх сигналов из одиннадцати, и асимметрия честная: это ровно
  /// те проверки, где чинить надо конкретную карточку. Пробел на стороне
  /// бэкенда: категории и кухни вне канона, а также не-объектные атрибуты
  /// чинятся так же покарточно, но примеров не присылают вовсе.
  /// `null` — бэкенд примеров для этого сигнала не собирает вовсе. Пустой
  /// СПИСОК от непустой функции значит другое: примеры бывают, но в этот срез
  /// не попали (у часов лимит в 25 строк общий на два сигнала). Экран говорит
  /// об этих двух случаях по-разному, поэтому и различать их надо здесь.
  final List<QualitySample> Function(QualityHealthData)? samplesOf;

  /// Существительное подписи на дашборде, три формы.
  final String noteOne;
  final String noteFew;
  final String noteMany;

  /// Предложный хвост подписи: «…без адреса в каталоге».
  ///
  /// Хвост намеренно предложный, без глаголов и согласуемых прилагательных.
  /// В макете подпись строки 3 написана как «3 недостижимы в sitemap» — форма,
  /// верная ровно для тройки: при единице вышло бы «1 недостижимы». Число
  /// приходит из базы и бывает любым, поэтому склоняется существительное, а
  /// хвост от числа не зависит вовсе.
  final String noteTail;

  const QualitySignal({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.cleanLabel,
    required this.icon,
    required this.countOf,
    this.samplesOf,
    required this.noteOne,
    required this.noteFew,
    required this.noteMany,
    required this.noteTail,
    this.scopeNote,
  });

  /// Подпись для панели «Требует внимания»: «3 заведения без адреса в каталоге».
  String note(int count) =>
      '${countWithNoun(count, noteOne, noteFew, noteMany)} $noteTail';
}


/// Одиннадцать сигналов в каноническом порядке.
///
/// Список `final`, а не `const`: у каждого сигнала лежит функция извлечения
/// счётчика, и замыкание константой быть не может.
final List<QualitySignal> kQualitySignals = <QualitySignal>[
  QualitySignal(
    id: 'unreachable',
    title: 'Недостижимы в sitemap',
    subtitle: 'Категория или город вне канона — канонического адреса нет, '
        'и в каталог заведение не попадает',
    cleanLabel: 'достижимость',
    icon: Icons.link_off,
    countOf: (d) => d.unreachableCount,
    samplesOf: (d) => d.unreachableSamples,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'без адреса в каталоге',
  ),
  QualitySignal(
    id: 'hanging_flags',
    title: 'Флаги без реакции',
    subtitle: 'Позиции меню с флагом проверки, которые никто не разобрал',
    // Решение этапа 7: черновики и отказанные не считаются. Распознавание
    // запускается при СОЗДАНИИ карточки, то есть на черновике, — партнёр,
    // бросивший карточку после загрузки меню, иначе оставлял бы за собой
    // флаги навсегда, и модератор разбирал бы цены, которых никто не видит.
    // Все три исключённых статуса названы: архив — живой статус, он есть и в
    // CHECK базы, и в словарях админки, и модератор, знающий про него, иначе
    // ждал бы архивные позиции в счёте и не нашёл бы объяснения.
    scopeNote: 'черновики, отказанные и архив не в счёт',
    cleanLabel: 'флаги',
    icon: Icons.flag_outlined,
    countOf: (d) => d.hangingFlagsCount,
    noteOne: 'флаг',
    noteFew: 'флага',
    noteMany: 'флагов',
    noteTail: 'без реакции',
  ),
  QualitySignal(
    id: 'empty_menus',
    title: 'Пустые меню',
    subtitle: 'Есть фото меню, но распознавание не дало ни одной позиции',
    cleanLabel: 'меню',
    icon: Icons.menu_book_outlined,
    countOf: (d) => d.emptyMenusCount,
    samplesOf: (d) => d.emptyMenusSamples,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с пустым меню',
  ),
  QualitySignal(
    id: 'hours_malformed',
    title: 'Часы: битый формат',
    subtitle: 'Время работы записано так, что его нельзя прочитать',
    cleanLabel: 'формат часов',
    icon: Icons.schedule,
    countOf: (d) => d.hoursMalformedCount,
    samplesOf: (d) => d.hoursMalformedSamples,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с битым временем работы',
  ),
  QualitySignal(
    id: 'hours_all_closed',
    title: 'Часы: всё закрыто',
    subtitle: 'Не открыто ни в один день недели',
    cleanLabel: '«всё закрыто»',
    icon: Icons.lock_clock,
    countOf: (d) => d.hoursAllClosedCount,
    samplesOf: (d) => d.hoursAllClosedSamples,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'без единого рабочего дня',
  ),
  QualitySignal(
    id: 'ocr_failed',
    title: 'Ошибки распознавания',
    subtitle: 'Задача распознавания меню завершилась ошибкой',
    // Сужать до активных нельзя: самый срочный случай — карточка подана,
    // меню не распозналось, и она стоит в очереди модерации без меню. Такое
    // заведение ещё не активно.
    scopeNote: 'по всем заведениям, включая ждущие модерации',
    cleanLabel: 'ошибки распознавания',
    icon: Icons.error_outline,
    countOf: (d) => d.ocrFailedCount,
    noteOne: 'задача',
    noteFew: 'задачи',
    noteMany: 'задач',
    noteTail: 'распознавания с ошибкой',
  ),
  QualitySignal(
    id: 'ocr_stuck',
    title: 'Зависшие распознавания',
    subtitle: 'Задача ждёт повтора после неудачной попытки',
    scopeNote: 'по всем заведениям, включая ждущие модерации',
    cleanLabel: 'зависшие распознавания',
    icon: Icons.hourglass_bottom,
    countOf: (d) => d.ocrStuckCount,
    noteOne: 'задача',
    noteFew: 'задачи',
    noteMany: 'задач',
    noteTail: 'распознавания в ожидании',
  ),
  QualitySignal(
    id: 'category_off_canon',
    title: 'Категории вне канона',
    subtitle: 'Значение категории не из 15 канонических',
    cleanLabel: 'канон категорий',
    icon: Icons.category_outlined,
    countOf: (d) => d.categoryOffCanonCount,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с категорией вне канона',
  ),
  QualitySignal(
    id: 'cuisine_off_canon',
    title: 'Кухни вне канона',
    subtitle: 'Значение кухни не из 12 канонических',
    cleanLabel: 'канон кухонь',
    icon: Icons.restaurant_menu,
    countOf: (d) => d.cuisineOffCanonCount,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с кухней вне канона',
  ),
  QualitySignal(
    id: 'out_of_bounds',
    title: 'Координаты вне границ',
    subtitle: 'Точка вне Беларуси или вне границ своего города',
    cleanLabel: 'координаты',
    icon: Icons.wrong_location_outlined,
    countOf: (d) => d.outOfBoundsCount,
    samplesOf: (d) => d.outOfBoundsSamples,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с координатами вне границ',
  ),
  QualitySignal(
    id: 'non_object_attributes',
    title: 'Атрибуты: не объект',
    subtitle: 'Вместо набора признаков лежит что-то другое',
    cleanLabel: 'атрибуты',
    icon: Icons.data_object,
    countOf: (d) => d.nonObjectAttributesCount,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с испорченными атрибутами',
  ),
];

/// Сигналы со счётчиком больше нуля, в каноническом порядке.
///
/// Порог именно нулевой: все одиннадцать проверок — детерминированные
/// инварианты («нет канонического адреса», «координаты вне Беларуси»), а не
/// статистика, у которой бывает допустимый фон.
List<QualitySignal> redSignals(QualityHealthData data) =>
    kQualitySignals.where((s) => s.countOf(data) > 0).toList();

/// Чистые сигналы, в том же порядке.
List<QualitySignal> cleanSignals(QualityHealthData data) =>
    kQualitySignals.where((s) => s.countOf(data) == 0).toList();

/// Порядок отрисовки: проблемные первыми, внутри групп — канон.
List<QualitySignal> signalsProblemsFirst(QualityHealthData data) =>
    <QualitySignal>[...redSignals(data), ...cleanSignals(data)];
