import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/config/establishment_vocabulary.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';

/// Per-field review state during moderation session
enum FieldReviewStatus { neutral, approved, rejected }

class FieldReviewState {
  final FieldReviewStatus status;
  final String? comment;

  const FieldReviewState({
    this.status = FieldReviewStatus.neutral,
    this.comment,
  });

  FieldReviewState copyWith({FieldReviewStatus? status, String? comment}) {
    return FieldReviewState(
      status: status ?? this.status,
      comment: comment ?? this.comment,
    );
  }
}

/// Названия вкладок панели модерации — в порядке их показа.
const List<String> kModerationTabTitles = <String>[
  'Данные',
  'О заведении',
  'Медиа',
  'Адрес',
];

/// Поля, разложенные по вкладкам. Единственный источник правды о составе
/// проверки: 5 + 6 + 2 + 1 = 14.
///
/// Три числа на экране считаются отсюда — прогресс в шапке, счётчики на
/// вкладках и «осталось проверить» в нижней панели. Если каждое из них
/// считать по месту, они разъедутся ровно тогда, когда состав полей
/// изменится, и модератор увидит «3 из 14» над вкладками, дающими в сумме 15.
/// Порядок групп обязан совпадать с порядком вкладок в
/// `ModerationDetailPanel`.
const List<List<String>> kModerationTabFields = <List<String>>[
  <String>[
    'legal_name',
    'unp',
    'registration_doc',
    'contact_person',
    'contact_email',
  ],
  <String>[
    'description',
    'name',
    'customer_phone',
    'website',
    'working_hours',
    'price_range',
  ],
  <String>['photos', 'menu'],
  <String>['address'],
];

/// Подписи полей проверки — для диалогов и блока заметок, в порядке вкладок.
/// Имена — из общего словаря полей карточки (`kEstablishmentFieldNames`):
/// те же, что у строк полей в панели разбора, в карточке одобренного и в
/// журнале (F-25, Ч13 — было «Полное название» здесь и «Полное название
/// заведения» в строке поля, «Номер для связи» и «Номер для связи с
/// клиентом»).
final Map<String, String> kModerationFieldLabels = <String, String>{
  for (final key in kModerationTabFields.expand((tab) => tab))
    key: fieldLabel(key),
};

/// Поля, помеченные в панели звёздочкой. Необязательно только одно — сайт.
const Set<String> kModerationOptionalFields = <String>{'website'};

/// Обязательные поля заявки, которые пусты, — подписями, в порядке вкладок.
///
/// Пустота считается по тому же значению, что показывает строка поля (у
/// юридического названия и контактов есть запасные значения карточки):
/// модератор подтверждает ровно то, что видел как «не указано».
List<String> missingRequiredFieldLabels(EstablishmentDetail detail) {
  bool blank(String? value) => value == null || value.trim().isEmpty;
  final hours = detail.workingHours;
  final empty = <String, bool>{
    'legal_name': blank(detail.legalName ?? detail.name),
    'unp': blank(detail.unp),
    'registration_doc': blank(detail.registrationDocUrl),
    'contact_person': blank(detail.contactPerson ?? detail.phone),
    'contact_email': blank(detail.contactEmail ?? detail.email),
    'description': blank(detail.description),
    'name': blank(detail.name),
    'customer_phone': blank(detail.phone),
    'working_hours': hours == null || hours.isEmpty,
    'price_range': blank(detail.priceRange),
    'photos': detail.interiorPhotos.isEmpty,
    'menu': detail.menuMedia.isEmpty,
    'address': blank(detail.city) && blank(detail.address),
  };
  return <String>[
    for (final fields in kModerationTabFields)
      for (final field in fields)
        if (!kModerationOptionalFields.contains(field) && empty[field] == true)
          kModerationFieldLabels[field] ?? field,
  ];
}

/// Сколько полных суток заявка ждёт очереди.
///
/// Отсчёт от `updated_at`, а не от `created_at`: партнёр может держать
/// черновик неделями, и ожиданием это не является — очередь начинается с
/// отправки на модерацию, которая и есть последняя запись в строку. Бэкенд
/// сортирует очередь тем же полем (`ORDER BY e.updated_at ASC`), поэтому
/// бейджи в списке идут строго по убыванию, а подпись шапки сходится с
/// верхней карточкой.
///
/// Расхождение с `oldest_pending_at` на дашборде — осознанное: тот считает
/// по `created_at` и закреплён тестом с явной формулировкой «время создания».
/// Это разные экраны; внутри одного экрана все числа сходятся.
int? moderationWaitingDays(DateTime? since, {DateTime? now}) {
  if (since == null) return null;
  final reference = now ?? DateTime.now();
  final days = reference.difference(since).inDays;
  return days < 0 ? 0 : days;
}

/// State management for the moderation workflow
class ModerationProvider with ChangeNotifier {
  final ModerationService _service;

  // Pending list state
  List<EstablishmentListItem> _establishments = [];
  bool _isLoadingList = false;
  String? _listError;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  // Selected establishment state
  EstablishmentDetail? _selectedDetail;
  bool _isLoadingDetail = false;
  String? _detailError;
  String? _selectedId;

  // Per-field review state (field_name → state)
  Map<String, FieldReviewState> _fieldReviews = {};

  /// Отметки по заявкам, которые модератор открывал и оставил неразобранными:
  /// id заявки → отметки по полям (пункт A1-13).
  ///
  /// До 21.10.2026 переход на соседнюю заявку («только глянуть») молча стирал
  /// всё: вернувшись, модератор видел «Проверено 0 из 14». Теперь отметки
  /// уходят сюда и возвращаются, когда заявку открывают снова. Живут до
  /// решения по заявке, до её ухода из очереди и до смены аккаунта.
  final Map<String, Map<String, FieldReviewState>> _reviewsById =
      <String, Map<String, FieldReviewState>>{};

  // Moderation action state
  bool _isSubmitting = false;
  String? _submitError;

  ModerationProvider({ModerationService? service})
      : _service = service ?? ModerationService() {
    AccountScope.register(resetAccountScope);
  }

  /// Метки запросов (пакет 2, пункт 4; Codex CL-4) — как в ApprovedProvider.
  ///
  /// Сверки id выбора мало: просмотрщик, вошедший после администратора, может
  /// открыть ту же заявку, и поздний ответ на запрос администратора (с
  /// контактами и документом партнёра) совпал бы по id. [_generation] —
  /// аккаунт, [_detailRequest] — последний запрос детали, [_listRequest] —
  /// последний запрос очереди.
  int _generation = 0;
  int _detailRequest = 0;
  int _listRequest = 0;

  /// Сброс при смене аккаунта. Вердикты по полям — работа модератора, и
  /// переносить их на следующего вошедшего нельзя так же, как с одной заявки
  /// на другую. Ответ на летящую загрузку детали выбросится: сброс сдвигает
  /// метки запросов.
  void resetAccountScope() {
    _generation++;
    _detailRequest++;
    _listRequest++;
    _establishments = [];
    _isLoadingList = false;
    _listError = null;
    _currentPage = 1;
    _totalPages = 1;
    _totalCount = 0;
    _selectedDetail = null;
    _isLoadingDetail = false;
    _detailError = null;
    _selectedId = null;
    _fieldReviews = {};
    _reviewsById.clear();
    _isSubmitting = false;
    _submitError = null;
    notifyListeners();
  }

  /// Есть ли проставленные, но не отправленные отметки — по открытой заявке
  /// или по оставленным. Выход из панели их сотрёт, и каркас спрашивает об
  /// этом (пункт A3-10).
  bool get hasUnsavedVerdicts =>
      _hasMarks(_fieldReviews) || _reviewsById.values.any(_hasMarks);

  static bool _hasMarks(Map<String, FieldReviewState> reviews) =>
      reviews.values.any((r) =>
          r.status != FieldReviewStatus.neutral ||
          (r.comment != null && r.comment!.isNotEmpty));

  /// Отложить отметки открытой заявки, чтобы вернуть их при следующем
  /// открытии.
  void _stashReviews() {
    final id = _selectedId;
    if (id == null) return;
    if (_hasMarks(_fieldReviews)) {
      _reviewsById[id] = _fieldReviews;
    } else {
      _reviewsById.remove(id);
    }
  }

  /// Страница очереди. Совпадает с умолчанием сервиса и с подписью футера.
  static const int perPage = 20;

  // ============================================================================
  // Getters
  // ============================================================================

  List<EstablishmentListItem> get establishments => _establishments;
  bool get isLoadingList => _isLoadingList;
  String? get listError => _listError;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;

  /// Деталь показывается только вместе со своим выбором (пакет 2, пункт 4):
  /// пока грузится другая заявка, деталь прежней не отдаётся.
  EstablishmentDetail? get selectedDetail =>
      _selectedDetail?.id == _selectedId ? _selectedDetail : null;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get detailError => _detailError;
  String? get selectedId => _selectedId;

  Map<String, FieldReviewState> get fieldReviews => _fieldReviews;

  // ============================================================================
  // Прогресс проверки — производное от _fieldReviews, считается в одном месте
  // ============================================================================

  /// Поле считается проверенным, когда по нему вынесен вердикт. Комментарий
  /// без вердикта проверкой не является: `commentField` оставляет статус
  /// `neutral`, и модератор, написавший заметку, поле ещё не закрыл.
  bool _isChecked(String fieldName) =>
      (_fieldReviews[fieldName] ?? const FieldReviewState()).status !=
      FieldReviewStatus.neutral;

  /// Сколько полей на каждой вкладке — [5, 6, 2, 1].
  List<int> get tabFieldCounts =>
      kModerationTabFields.map((fields) => fields.length).toList(growable: false);

  /// Сколько проверено на каждой вкладке.
  List<int> get tabCheckedCounts => kModerationTabFields
      .map((fields) => fields.where(_isChecked).length)
      .toList(growable: false);

  int get totalFieldCount =>
      kModerationTabFields.fold(0, (sum, fields) => sum + fields.length);

  int get checkedFieldCount =>
      kModerationTabFields.fold(0, (sum, fields) => sum + fields.where(_isChecked).length);

  int get remainingFieldCount => totalFieldCount - checkedFieldCount;

  /// Доля проверенного — для полосы прогресса. 0.0 при пустом составе полей.
  double get checkedFraction =>
      totalFieldCount == 0 ? 0 : checkedFieldCount / totalFieldCount;

  /// Сколько полей отклонено — нижняя панель называет это число вслух.
  int get rejectedFieldCount => kModerationTabFields.fold(
        0,
        (sum, fields) =>
            sum +
            fields
                .where(
                  (name) =>
                      (_fieldReviews[name] ?? const FieldReviewState()).status ==
                      FieldReviewStatus.rejected,
                )
                .length,
      );

  /// Хотя бы одно поле отклонено.
  bool get hasRejectedField => rejectedFieldCount > 0;

  /// Причины, которые уйдут партнёру при отказе: отклонённые поля с текстом,
  /// подписью поля, в порядке вкладок. Диалог отказа называет их число, а
  /// при пустом списке предупреждает (пункт A1-11).
  List<String> get rejectionReasonLabels => <String>[
        for (final fields in kModerationTabFields)
          for (final field in fields)
            if (_fieldReviews[field]?.status == FieldReviewStatus.rejected &&
                (_fieldReviews[field]?.comment?.trim().isNotEmpty ?? false))
              kModerationFieldLabels[field] ?? field,
      ];

  /// Одобрение запрещено ровно одним условием — есть отклонённое поле.
  ///
  /// Требовать вердикт по всем четырнадцати полям макет не просит, и вводить
  /// такой шлюз самостоятельно нельзя: это меняет работу модератора, а не
  /// оформление экрана. Отклонённое поле блокирует одобрение потому, что
  /// одобрить отклонённое — противоречие, а не потому, что «мало проверено».
  bool get canApprove => !hasRejectedField;

  /// Сколько ждёт старейшая заявка из загруженных. `null` — очередь пуста.
  ///
  /// Считается по загруженному списку, а не отдельным запросом: очередь
  /// приходит отсортированной по возрастанию `updated_at`, поэтому максимум
  /// лежит в первом элементе. Минимум по списку берётся всё равно — так
  /// подпись остаётся верной и на второй странице («старейшая из показанных»),
  /// когда пагинацию сюда добавят.
  int? get oldestWaitingDays {
    DateTime? oldest;
    for (final item in _establishments) {
      final stamp = item.updatedAt;
      if (stamp == null) continue;
      if (oldest == null || stamp.isBefore(oldest)) oldest = stamp;
    }
    return moderationWaitingDays(oldest);
  }

  bool get isSubmitting => _isSubmitting;
  String? get submitError => _submitError;

  // ============================================================================
  // List operations
  // ============================================================================

  Future<void> loadPendingEstablishments({int page = 1}) async {
    final request = ++_listRequest;
    _isLoadingList = true;
    _listError = null;
    notifyListeners();

    try {
      final response = await _service.getPendingEstablishments(page: page);
      if (request != _listRequest) return; // обогнали или сменился аккаунт
      _establishments = response.establishments;
      _currentPage = response.page;
      _totalPages = response.pages;
      _totalCount = response.total;

      // Clear stale selection if the selected item is no longer in the list.
      // Отметки уходят в отложенные, а не в никуда: заявка могла просто
      // уехать на другую страницу очереди.
      if (_selectedId != null &&
          !_establishments.any((e) => e.id == _selectedId)) {
        _stashReviews();
        _detailRequest++;
        _isLoadingDetail = false;
        _selectedId = null;
        _selectedDetail = null;
        _fieldReviews = {};
        _detailError = null;
        _submitError = null;
      }
    } catch (e) {
      if (request != _listRequest) return;
      _listError = _extractMessage(e);
    }
    _isLoadingList = false;
    notifyListeners();

    // Страница за пределами очереди (её добрали другие модераторы, пока эта
    // была открыта) — перейти на последнюю. Один шаг, без зацикливания.
    if (request == _listRequest &&
        _listError == null &&
        _establishments.isEmpty &&
        _totalCount > 0 &&
        _currentPage > 1) {
      final lastPage = (_totalCount + perPage - 1) ~/ perPage;
      if (lastPage < _currentPage) {
        await loadPendingEstablishments(page: lastPage);
      }
    }
  }

  /// Перелистнуть очередь (пункт A1-04). До 21.10.2026 запрашивалась только
  /// первая страница: заявки после 20-й были недостижимы, а шапка говорила
  /// «35 заявок в очереди» над списком из двадцати.
  Future<void> goToPage(int page) {
    if (page < 1 || page == _currentPage) return Future<void>.value();
    return loadPendingEstablishments(page: page);
  }

  /// После решения очередь перечитывается: заявка ушла, и страницу добирают
  /// следующие по очереди. Правка на месте оставляла бы на странице 19, 18,
  /// … заявок, а после двадцатого решения — «Очередь пуста» при живой
  /// очереди. Номер страницы зажимается в новые границы.
  void _refillQueue() {
    final lastPage = _totalCount == 0 ? 1 : (_totalCount + perPage - 1) ~/ perPage;
    loadPendingEstablishments(
      page: _currentPage > lastPage ? lastPage : _currentPage,
    );
  }

  // ============================================================================
  // Detail operations
  // ============================================================================

  /// Открыть карточку из очереди.
  ///
  /// Обнуление вердиктов принадлежит смене заявки, а не загрузке данных:
  /// переносить проверку с одной карточки на другую нельзя, а повторное
  /// открытие той же карточки заявку не меняет, и проверка обязана уцелеть.
  /// Поэтому `_fieldReviews` чистится по условию `_selectedId != id`, а не
  /// на каждом входе сюда.
  Future<void> selectEstablishment(String id) async {
    // Повтор по уже открытой и успешно загруженной карточке — ничего не
    // делаем. Ошибка загрузки исключение: повторный тап по той же строке и
    // есть «попробовать снова», иначе панель остаётся с ошибкой навсегда.
    if (_selectedId == id && _selectedDetail != null && _detailError == null) {
      return;
    }

    if (_selectedId != id) {
      // Другая заявка — вердикты предыдущей к ней не относятся: они
      // откладываются до её следующего открытия, а у открываемой
      // возвращаются её собственные (пункт A1-13).
      _stashReviews();
      _fieldReviews = _reviewsById.remove(id) ?? <String, FieldReviewState>{};
    }

    _selectedId = id;
    _submitError = null;
    await _reloadSelectedDetail();
  }

  /// Перечитать деталь уже выбранной карточки, не трогая вердикты.
  ///
  /// Отдельный путь нужен затем, что перезагрузка своей же карточки — не
  /// смена заявки. Раньше её делали через [selectEstablishment], и правка
  /// координат стирала всю проверку: прогресс в шапке на глазах падал
  /// с «9 из 14» до «0 из 14», а модератор не понимал, куда делась работа.
  Future<void> _reloadSelectedDetail() async {
    final id = _selectedId;
    if (id == null) return;
    final request = ++_detailRequest;

    _isLoadingDetail = true;
    _detailError = null;
    notifyListeners();

    EstablishmentDetail? loaded;
    String? failure;
    try {
      loaded = await _service.getEstablishmentDetails(id);
    } catch (e) {
      failure = _extractMessage(e);
    }

    // Пока ответ шёл, модератор мог открыть другую карточку, а аккаунт —
    // смениться. Тогда этот ответ уже не о ней: положить его в
    // `_selectedDetail` значит показать чужие данные под её именем — и
    // вердикты по ним ушли бы не в ту заявку; после смены аккаунта — показать
    // просмотрщику то, что сервер отдал администратору. Флаг загрузки тоже не
    // трогаем: его держит более свежий запрос.
    if (request != _detailRequest || _selectedId != id) return;

    // При сбое прежняя деталь остаётся на месте: она устарела, но это всё
    // ещё та самая карточка, и обнулять её ради сообщения об ошибке незачем.
    if (loaded != null) _selectedDetail = loaded;
    _detailError = failure;
    _isLoadingDetail = false;
    notifyListeners();
  }

  void clearSelection() {
    _detailRequest++;
    _isLoadingDetail = false;
    _selectedId = null;
    _selectedDetail = null;
    _fieldReviews = {};
    _detailError = null;
    _submitError = null;
    notifyListeners();
  }

  // ============================================================================
  // Field review operations
  // ============================================================================

  /// ✓ у поля. Заметка, написанная раньше, остаётся (пункт A1-12): до
  /// 21.10.2026 ✓ после 💬 стирал её без предупреждения.
  void approveField(String fieldName) {
    _fieldReviews[fieldName] = FieldReviewState(
      status: FieldReviewStatus.approved,
      comment: _fieldReviews[fieldName]?.comment,
    );
    notifyListeners();
  }

  void rejectField(String fieldName, {String? comment}) {
    _fieldReviews[fieldName] = FieldReviewState(
      status: FieldReviewStatus.rejected,
      comment: comment,
    );
    notifyListeners();
  }

  void commentField(String fieldName, String comment) {
    final current = _fieldReviews[fieldName] ?? const FieldReviewState();
    _fieldReviews[fieldName] = current.copyWith(comment: comment);
    notifyListeners();
  }

  /// Снять вердикт повторным нажатием. Текст при этом не пропадает: снятый
  /// вердикт — не стёртая заметка, она остаётся комментарием к полю.
  void resetField(String fieldName) {
    final comment = _fieldReviews[fieldName]?.comment;
    if (comment != null && comment.isNotEmpty) {
      _fieldReviews[fieldName] = FieldReviewState(comment: comment);
    } else {
      _fieldReviews.remove(fieldName);
    }
    notifyListeners();
  }

  FieldReviewState getFieldState(String fieldName) {
    return _fieldReviews[fieldName] ?? const FieldReviewState();
  }

  // ============================================================================
  // Moderation actions
  // ============================================================================

  /// Действие выполняется над показанной карточкой — по ней модератор
  /// выставлял вердикты (пакет 2, пункт 4).
  String? get _shownId => selectedDetail?.id;

  Future<bool> approveEstablishment() async {
    final id = _shownId;
    // Второй клик, пока первый запрос в пути, — не второе решение (пункт
    // A1-03): кнопки гаснут, но защита — здесь, а не только в кнопке.
    if (id == null || _isSubmitting) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      // Collect all field comments (both approved and rejected)
      final notes = <String, String>{};
      for (final entry in _fieldReviews.entries) {
        if (entry.value.comment != null && entry.value.comment!.isNotEmpty) {
          notes[entry.key] = entry.value.comment!;
        }
      }

      await _service.moderateEstablishment(
        id: id,
        action: 'approve',
        moderationNotes: notes,
      );
      if (generation != _generation) return false; // аккаунт уже другой

      // Убрать из списка сразу и добрать страницу из очереди: заявка ушла,
      // и на её место встаёт следующая (пункт A1-04).
      _reviewsById.remove(id);
      _establishments.removeWhere((e) => e.id == id);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      if (_selectedId == id) clearSelection();
      _isSubmitting = false;
      notifyListeners();
      _refillQueue();
      return true;
    } catch (e) {
      if (generation != _generation) return false;
      // Ошибка — о заявке, над которой действовали, не о той, что открыта
      // за это время (ревью Phase 3.5 пакета 2).
      if (_selectedId == id) _submitError = _extractMessage(e);
      _isSubmitting = false;
      notifyListeners();
      _reloadIfQueueStale(e);
      return false;
    }
  }

  Future<bool> rejectEstablishment() async {
    final id = _shownId;
    // Второй клик, пока первый запрос в пути, — не второе решение (пункт
    // A1-03): кнопки гаснут, но защита — здесь, а не только в кнопке.
    if (id == null || _isSubmitting) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      // Collect per-field rejection notes
      final notes = <String, String>{};
      for (final entry in _fieldReviews.entries) {
        if (entry.value.status == FieldReviewStatus.rejected &&
            entry.value.comment != null &&
            entry.value.comment!.trim().isNotEmpty) {
          notes[entry.key] = entry.value.comment!.trim();
        }
      }

      await _service.moderateEstablishment(
        id: id,
        action: 'reject',
        moderationNotes: notes,
      );
      if (generation != _generation) return false; // аккаунт уже другой

      // Убрать из списка сразу и добрать страницу из очереди: заявка ушла,
      // и на её место встаёт следующая (пункт A1-04).
      _reviewsById.remove(id);
      _establishments.removeWhere((e) => e.id == id);
      _totalCount = (_totalCount - 1).clamp(0, _totalCount);
      if (_selectedId == id) clearSelection();
      _isSubmitting = false;
      notifyListeners();
      _refillQueue();
      return true;
    } catch (e) {
      if (generation != _generation) return false;
      if (_selectedId == id) _submitError = _extractMessage(e);
      _isSubmitting = false;
      notifyListeners();
      _reloadIfQueueStale(e);
      return false;
    }
  }

  /// Заявку уже разобрал другой модератор или её изменил партнёр: очередь на
  /// экране устарела, и повтор получил бы тот же отказ. Причина остаётся под
  /// кнопками, пока заявка открыта; ушла из очереди — уходит с ней.
  void _reloadIfQueueStale(Object error) {
    if (refusalMeansStaleData(error)) {
      loadPendingEstablishments(page: _currentPage);
    }
  }

  // ============================================================================
  // Coordinate correction
  // ============================================================================

  /// Update establishment coordinates (admin correction)
  Future<bool> updateCoordinates(double latitude, double longitude) async {
    final id = _shownId;
    // Второй клик, пока первый запрос в пути, — не второе решение (пункт
    // A1-03): кнопки гаснут, но защита — здесь, а не только в кнопке.
    if (id == null || _isSubmitting) return false;
    final generation = _generation;

    _isSubmitting = true;
    _submitError = null;
    notifyListeners();

    try {
      await _service.updateCoordinates(
        id: id,
        latitude: latitude,
        longitude: longitude,
      );
      if (generation != _generation) return false; // аккаунт уже другой

      // Перечитать деталь, чтобы показать новые координаты. Именно
      // перечитать: [selectEstablishment] обнуляет вердикты, и правка
      // координат стирала бы проверку по всем четырнадцати полям.
      await _reloadSelectedDetail();
      if (generation != _generation) return false;

      _isSubmitting = false;
      notifyListeners();
      return true;
    } catch (e) {
      if (generation != _generation) return false;
      if (_selectedId == id) _submitError = _extractMessage(e);
      _isSubmitting = false;
      notifyListeners();
      return false;
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /// Текст отказа для модератора — общий разбор панели ([describeError]).
  String _extractMessage(Object error) =>
      describeError(error, notFound: kEstablishmentNotFoundPhrase);
}
