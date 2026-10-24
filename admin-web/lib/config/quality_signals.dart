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

  /// Куда вести за списком того, что надо разобрать: экран панели, где этот
  /// сигнал разбирают. `null` — такого экрана нет (ошибки распознавания
  /// разбирает разработчик), и карточка не притворяется ссылкой.
  ///
  /// Раньше ни сигнал, ни карточка никуда не вели (К-6, A3-29): число было,
  /// а что с ним делать — нет.
  final String? listRoute;

  /// Подпись ссылки [listRoute]: «Открыть позиции меню».
  final String? listLabel;

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
    this.listRoute,
    this.listLabel,
  }) : assert((listRoute == null) == (listLabel == null),
            'у ссылки на список есть и адрес, и подпись');

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
    title: 'Нет страницы на сайте',
    subtitle: 'Категория или город не из справочника — у заведения нет '
        'адреса страницы, и в каталог сайта оно не попадает',
    cleanLabel: 'страницы на сайте',
    icon: Icons.link_off,
    countOf: (d) => d.unreachableCount,
    samplesOf: (d) => d.unreachableSamples,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'без страницы на сайте',
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
    listRoute: '/moderation/menu-items',
    listLabel: 'Открыть позиции меню',
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
    title: 'Время работы не читается',
    subtitle: 'Время работы записано так, что ни сайт, ни приложение не могут '
        'его показать',
    cleanLabel: 'время работы',
    icon: Icons.schedule,
    countOf: (d) => d.hoursMalformedCount,
    samplesOf: (d) => d.hoursMalformedSamples,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с нечитаемым временем работы',
  ),
  QualitySignal(
    id: 'hours_all_closed',
    title: 'Закрыто все дни недели',
    subtitle: 'В расписании нет ни одного рабочего дня',
    cleanLabel: 'рабочие дни',
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
    title: 'Меню не распозналось',
    subtitle: 'Распознавание фото или PDF меню завершилось ошибкой',
    // Сужать до активных нельзя: самый срочный случай — карточка подана,
    // меню не распозналось, и она стоит в очереди модерации без меню. Такое
    // заведение ещё не активно.
    scopeNote: 'по всем заведениям, включая ждущие модерации',
    cleanLabel: 'распознавание меню',
    icon: Icons.error_outline,
    countOf: (d) => d.ocrFailedCount,
    noteOne: 'задача',
    noteFew: 'задачи',
    noteMany: 'задач',
    noteTail: 'распознавания меню с ошибкой',
  ),
  QualitySignal(
    id: 'ocr_stuck',
    title: 'Распознавание ждёт повтора',
    subtitle: 'Первая попытка распознать меню не удалась, повтор ещё впереди',
    scopeNote: 'по всем заведениям, включая ждущие модерации',
    cleanLabel: 'повторы распознавания',
    icon: Icons.hourglass_bottom,
    countOf: (d) => d.ocrStuckCount,
    noteOne: 'задача',
    noteFew: 'задачи',
    noteMany: 'задач',
    noteTail: 'распознавания меню в ожидании повтора',
  ),
  QualitySignal(
    id: 'category_off_canon',
    title: 'Категория не из справочника',
    subtitle: 'Категория — не одна из 15, которые знают сайт и приложение',
    cleanLabel: 'категории',
    icon: Icons.category_outlined,
    countOf: (d) => d.categoryOffCanonCount,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с категорией не из справочника',
  ),
  QualitySignal(
    id: 'cuisine_off_canon',
    title: 'Кухня не из справочника',
    subtitle: 'Кухня — не одна из 12, которые знают сайт и приложение',
    cleanLabel: 'кухни',
    icon: Icons.restaurant_menu,
    countOf: (d) => d.cuisineOffCanonCount,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с кухней не из справочника',
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
    title: 'Удобства записаны с ошибкой',
    subtitle: 'Вместо списка удобств в карточке записано что-то другое — '
        'ни одно удобство не покажется',
    cleanLabel: 'удобства',
    icon: Icons.data_object,
    countOf: (d) => d.nonObjectAttributesCount,
    noteOne: 'заведение',
    noteFew: 'заведения',
    noteMany: 'заведений',
    noteTail: 'с испорченным списком удобств',
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
