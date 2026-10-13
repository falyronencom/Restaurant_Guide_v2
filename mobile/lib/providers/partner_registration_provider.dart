import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';
import 'package:restaurant_guide_mobile/utils/error_helpers.dart';

/// Partner Registration wizard state provider
/// Manages the 6-step registration flow for establishment partners
/// Phase 5.1 - Partner Registration Flow
class PartnerRegistrationProvider with ChangeNotifier {
  // ============================================================================
  // Constants
  // ============================================================================

  static const int totalSteps = 7;

  // ============================================================================
  // State
  // ============================================================================

  final bool editMode;
  final String? establishmentId;
  int _currentStep;
  PartnerRegistration _data;
  bool _isSubmitting = false;
  String? _error;

  PartnerRegistrationProvider({
    this.editMode = false,
    this.establishmentId,
    int initialStep = 0,
    PartnerRegistration? initialData,
  })  : _currentStep = initialStep,
        _data = initialData ?? const PartnerRegistration();

  /// Create PartnerRegistration from existing PartnerEstablishment data
  static PartnerRegistration dataFromEstablishment(PartnerEstablishment est) {
    return PartnerRegistration(
      categories: est.categories
          .map((name) => PartnerRegistration.categoryNameToId(name))
          .toList(),
      cuisineTypes: est.cuisineTypes
          .map((name) => PartnerRegistration.cuisineNameToId(name))
          .toList(),
      name: est.name,
      description: est.description,
      phone: est.phone,
      email: est.email,
      instagram: est.instagram,
      weeklyWorkingHours: est.workingHours,
      priceRange: est.priceRange,
      attributes: est.attributes,
      primaryPhotoUrl: est.primaryImageUrl,
      interiorPhotos: est.interiorPhotos,
      menuPhotos: est.menuPhotos,
      city: est.city,
      street: est.street,
      building: est.building,
      latitude: est.latitude,
      longitude: est.longitude,
      legalName: est.legalName,
      unp: est.unp,
      contactPerson: est.contactPerson,
      contactEmail: est.contactEmail,
    );
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /// Current step index (0-5)
  int get currentStep => _currentStep;

  /// Current step number for display (1-6)
  int get currentStepNumber => _currentStep + 1;

  /// Total number of steps
  int get stepCount => totalSteps;

  /// Registration data
  PartnerRegistration get data => _data;

  /// Whether submission is in progress
  bool get isSubmitting => _isSubmitting;

  /// Current error message
  String? get error => _error;

  /// Whether we're on the first step
  bool get isFirstStep => _currentStep == 0;

  /// Whether we're on the last step
  bool get isLastStep => _currentStep == totalSteps - 1;

  // ============================================================================
  // Step Navigation
  // ============================================================================

  /// Move to the next step if validation passes
  bool nextStep() {
    if (!canProceed()) {
      return false;
    }

    if (_currentStep < totalSteps - 1) {
      _currentStep++;
      _clearError();
      notifyListeners();
      return true;
    }
    return false;
  }

  /// Move to the previous step
  void previousStep() {
    if (_currentStep > 0) {
      _currentStep--;
      _clearError();
      notifyListeners();
    }
  }

  /// Jump to a specific step (for step indicator taps)
  void goToStep(int step) {
    if (step >= 0 && step < totalSteps && step <= _getMaxReachableStep()) {
      _currentStep = step;
      _clearError();
      notifyListeners();
    }
  }

  /// Get the maximum step user can navigate to based on completed steps
  int _getMaxReachableStep() {
    if (editMode) return totalSteps - 1;
    // User can go back to any completed step
    // For now, allow navigation to current step only
    // Could be enhanced to track completed steps
    return _currentStep;
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /// Check if current step is valid and user can proceed
  bool canProceed() {
    switch (_currentStep) {
      case 0:
        return _validateCategoryStep();
      case 1:
        return _validateCuisineStep();
      case 2:
        return _validateBasicInfoStep();
      case 3:
        return _validateMediaStep();
      case 4:
        return _validateAddressStep();
      case 5:
        return _validateLegalInfoStep();
      case 6:
        return _validateSummaryStep();
      default:
        return false;
    }
  }

  /// Validate Step 1: Categories
  bool _validateCategoryStep() {
    return _data.categories.isNotEmpty &&
        _data.categories.length <= CategoryOptions.maxSelection;
  }

  /// Validate Step 2: Cuisine types
  bool _validateCuisineStep() {
    return _data.cuisineTypes.isNotEmpty &&
        _data.cuisineTypes.length <= CuisineOptions.maxSelection;
  }

  /// Validate Step 3: Basic information
  /// Relaxed validation for testing - only require name and price range
  bool _validateBasicInfoStep() {
    final name = _data.name ?? '';
    final description = _data.description ?? '';
    final priceRange = _data.priceRange;

    // Basic requirements: name (2+ chars) and price range selected.
    // Description and phone are optional; a phone, once typed, must be one
    // the server accepts — see [phoneError].
    return name.length >= 2 &&
        (description.isEmpty || description.length >= 5) &&
        phoneError == null &&
        priceRange != null &&
        priceRange.isNotEmpty;
  }

  /// Same rule as the server (backend/src/constants/belarusPhone.js): +375,
  /// then a mobile code 25/29/33/44 or a city/region area code 15x–17x,
  /// 21x–23x — 9 digits in all after 375. Until 13.10.2026 this step let any
  /// phone of 5+ characters through, and the server refused a city landline
  /// only at «Отправить», four steps later.
  static final RegExp _belarusPhone =
      RegExp(r'^\+375(25|29|33|44|1[5-7]|2[1-3])\d{7}$');

  /// Shown when the number does not start with +375: the field prepends
  /// 375 only to input that does not start with 3, so «33 123 45 67» stays
  /// «+331 23 456 7».
  static const phonePrefixMessage = 'Номер должен начинаться с +375.';

  /// Shown under the phone field when the number has too few or too many
  /// digits — including while it is still being typed.
  static const phoneLengthMessage =
      'После +375 должно быть 9 цифр: код и номер.';

  /// Shown when the length is right but the code is not. Typically a number
  /// typed the domestic way: the field prepends 375, so «8 029 …» becomes
  /// «+375 80 …».
  static const phoneCodeMessage =
      'Неверный код после +375. Мобильный: 25, 29, 33 или 44; городской: '
      'код города — 17 Минск, 152 Гродно, 232 Гомель… Номер вида 8 017… '
      'вводите как +375 17…';

  /// Message under the phone field on the «О заведении» step; null when the
  /// phone is empty or valid. While it is set, the step cannot be left.
  String? get phoneError {
    final phone = (_data.phone ?? '').replaceAll(' ', '');
    if (phone.isEmpty || _belarusPhone.hasMatch(phone)) return null;
    final digits = phone.replaceAll(RegExp(r'\D'), '');
    // From the third digit on — «+3», «+37» are a country code being typed.
    if (digits.length >= 3 && !digits.startsWith('375')) {
      return phonePrefixMessage;
    }
    return digits.length == 12 ? phoneCodeMessage : phoneLengthMessage;
  }

  /// Validate Step 4: Media
  bool _validateMediaStep() {
    return _data.interiorPhotos.isNotEmpty &&
        _data.menuPhotos.isNotEmpty &&
        _data.primaryPhotoUrl != null;
  }

  /// Validate Step 5: Address
  bool _validateAddressStep() {
    final city = _data.city ?? '';
    final street = _data.street ?? '';
    final building = _data.building ?? '';

    return city.isNotEmpty && street.isNotEmpty && building.isNotEmpty;
  }

  /// Validate Step 6: Legal information
  bool _validateLegalInfoStep() {
    final legalName = _data.legalName ?? '';
    final unp = _data.unp ?? '';
    final contactPerson = _data.contactPerson ?? '';
    final contactEmail = _data.contactEmail ?? '';

    return legalName.isNotEmpty &&
        _isValidUNP(unp) &&
        contactPerson.isNotEmpty &&
        _isValidEmail(contactEmail);
  }

  /// Validate Step 7: Summary (all previous steps must be valid)
  bool _validateSummaryStep() {
    return _validateCategoryStep() &&
        _validateCuisineStep() &&
        _validateBasicInfoStep() &&
        _validateMediaStep() &&
        _validateAddressStep() &&
        _validateLegalInfoStep();
  }

  /// Validate UNP (9 digits)
  bool _isValidUNP(String unp) {
    final unpRegex = RegExp(r'^\d{9}$');
    return unpRegex.hasMatch(unp);
  }

  /// Validate email format
  bool _isValidEmail(String email) {
    if (email.isEmpty) return false;
    final emailRegex = RegExp(r'^[\w\.-]+@[\w\.-]+\.\w+$');
    return emailRegex.hasMatch(email);
  }

  // ============================================================================
  // Data Updates - Step 1: Categories
  // ============================================================================

  /// Update selected categories
  void updateCategories(List<String> categories) {
    if (categories.length <= CategoryOptions.maxSelection) {
      _data = _data.copyWith(categories: categories);
      notifyListeners();
    }
  }

  /// Toggle a category selection
  void toggleCategory(String categoryId) {
    final current = List<String>.from(_data.categories);

    if (current.contains(categoryId)) {
      current.remove(categoryId);
    } else if (current.length < CategoryOptions.maxSelection) {
      current.add(categoryId);
    }

    _data = _data.copyWith(categories: current);
    notifyListeners();
  }

  /// Check if a category is selected
  bool isCategorySelected(String categoryId) {
    return _data.categories.contains(categoryId);
  }

  /// Get count of selected categories
  int get selectedCategoriesCount => _data.categories.length;

  // ============================================================================
  // Data Updates - Step 2: Cuisine Types
  // ============================================================================

  /// Update selected cuisine types
  void updateCuisineTypes(List<String> cuisineTypes) {
    if (cuisineTypes.length <= CuisineOptions.maxSelection) {
      _data = _data.copyWith(cuisineTypes: cuisineTypes);
      notifyListeners();
    }
  }

  /// Toggle a cuisine type selection
  void toggleCuisineType(String cuisineId) {
    final current = List<String>.from(_data.cuisineTypes);

    if (current.contains(cuisineId)) {
      current.remove(cuisineId);
    } else if (current.length < CuisineOptions.maxSelection) {
      current.add(cuisineId);
    }

    _data = _data.copyWith(cuisineTypes: current);
    notifyListeners();
  }

  /// Check if a cuisine type is selected
  bool isCuisineSelected(String cuisineId) {
    return _data.cuisineTypes.contains(cuisineId);
  }

  /// Get count of selected cuisine types
  int get selectedCuisineCount => _data.cuisineTypes.length;

  // ============================================================================
  // Data Updates - Step 3: Basic Information
  // ============================================================================

  /// Update basic information fields
  void updateBasicInfo({
    String? name,
    String? description,
    String? phone,
    String? email,
    String? instagram,
    WorkingHours? workingHours,
    String? priceRange,
    List<String>? attributes,
  }) {
    _data = _data.copyWith(
      name: name ?? _data.name,
      description: description ?? _data.description,
      phone: phone ?? _data.phone,
      email: email ?? _data.email,
      instagram: instagram ?? _data.instagram,
      workingHours: workingHours ?? _data.workingHours,
      priceRange: priceRange ?? _data.priceRange,
      attributes: attributes ?? _data.attributes,
    );
    notifyListeners();
  }

  /// Toggle an attribute selection
  void toggleAttribute(String attributeId) {
    final current = List<String>.from(_data.attributes);

    if (current.contains(attributeId)) {
      current.remove(attributeId);
    } else {
      current.add(attributeId);
    }

    _data = _data.copyWith(attributes: current);
    notifyListeners();
  }

  /// Check if an attribute is selected
  bool isAttributeSelected(String attributeId) {
    return _data.attributes.contains(attributeId);
  }

  /// Update weekly working hours
  void updateWeeklyWorkingHours(WeeklyWorkingHours hours) {
    _data = _data.copyWith(weeklyWorkingHours: hours);
    notifyListeners();
  }

  /// Get current weekly working hours or create default
  WeeklyWorkingHours get weeklyWorkingHours =>
      _data.weeklyWorkingHours ?? const WeeklyWorkingHours();

  // ============================================================================
  // Data Updates - Step 4: Media
  // ============================================================================

  /// Add an interior photo
  void addInteriorPhoto(String url) {
    if (_data.interiorPhotos.length < 20) {
      final photos = List<String>.from(_data.interiorPhotos)..add(url);
      _data = _data.copyWith(interiorPhotos: photos);

      // Auto-select as primary if first photo
      if (_data.primaryPhotoUrl == null) {
        _data = _data.copyWith(primaryPhotoUrl: url);
      }

      notifyListeners();
    }
  }

  /// Remove an interior photo
  void removeInteriorPhoto(String url) {
    final photos = List<String>.from(_data.interiorPhotos)..remove(url);
    _data = _data.copyWith(interiorPhotos: photos);

    // Update primary photo if removed
    if (_data.primaryPhotoUrl == url) {
      _data = _data.copyWith(
        primaryPhotoUrl: photos.isNotEmpty ? photos.first : null,
      );
    }

    notifyListeners();
  }

  /// Add a menu photo
  void addMenuPhoto(String url) {
    if (_data.menuPhotos.length < 20) {
      final photos = List<String>.from(_data.menuPhotos)..add(url);
      _data = _data.copyWith(menuPhotos: photos);
      notifyListeners();
    }
  }

  /// Remove a menu photo
  void removeMenuPhoto(String url) {
    final photos = List<String>.from(_data.menuPhotos)..remove(url);
    _data = _data.copyWith(menuPhotos: photos);
    notifyListeners();
  }

  /// Add a PDF menu file (max 2 per establishment)
  void addMenuPdf(MenuPdf pdf) {
    if (_data.menuPdfs.length < 2) {
      final pdfs = List<MenuPdf>.from(_data.menuPdfs)..add(pdf);
      _data = _data.copyWith(menuPdfs: pdfs);
      notifyListeners();
    }
  }

  /// Remove a PDF menu file by its url
  void removeMenuPdf(String url) {
    final pdfs = List<MenuPdf>.from(_data.menuPdfs)
      ..removeWhere((pdf) => pdf.url == url);
    _data = _data.copyWith(menuPdfs: pdfs);
    notifyListeners();
  }

  /// Set primary photo
  void setPrimaryPhoto(String url) {
    _data = _data.copyWith(primaryPhotoUrl: url);
    notifyListeners();
  }

  // ============================================================================
  // Data Updates - Step 5: Address
  // ============================================================================

  /// Update address fields
  void updateAddress({
    String? city,
    String? street,
    String? building,
    double? latitude,
    double? longitude,
  }) {
    _data = _data.copyWith(
      city: city ?? _data.city,
      street: street ?? _data.street,
      building: building ?? _data.building,
      latitude: latitude ?? _data.latitude,
      longitude: longitude ?? _data.longitude,
    );
    notifyListeners();
  }

  // ============================================================================
  // Data Updates - Step 6: Legal Information
  // ============================================================================

  /// Update legal information fields
  void updateLegalInfo({
    String? legalName,
    String? unp,
    String? contactPerson,
    String? contactEmail,
    String? registrationDocumentUrl,
  }) {
    _data = _data.copyWith(
      legalName: legalName ?? _data.legalName,
      unp: unp ?? _data.unp,
      contactPerson: contactPerson ?? _data.contactPerson,
      contactEmail: contactEmail ?? _data.contactEmail,
      registrationDocumentUrl:
          registrationDocumentUrl ?? _data.registrationDocumentUrl,
    );
    notifyListeners();
  }

  // ============================================================================
  // Submission
  // ============================================================================

  final EstablishmentsService _establishmentsService = EstablishmentsService();

  /// Карточка, которую этот мастер уже создал на сервере, — её id.
  ///
  /// Отправка новой карточки — два запроса: создать черновик и отправить его
  /// на модерацию. Если второй не дошёл (нет связи, сбой сервера), карточка
  /// уже лежит у партнёра черновиком. До 13.10.2026 повторное «Отправить на
  /// верификацию» создавало её заново, и сервер отказывал по-английски:
  /// заведение с таким названием у партнёра уже есть (409
  /// DUPLICATE_ESTABLISHMENT). Теперь повтор продолжает с созданной карточки.
  String? _createdId;

  /// Данные мастера, какими они ушли на сервер последний раз (JSON). Если
  /// партнёр между попытками что-то поменял, повтор сначала сохраняет правки
  /// в созданную карточку и только потом отправляет её.
  String? _sentData;

  /// Прошлая попытка создать карточку кончилась без ответа сервера: связь
  /// оборвалась, сервер не ответил или упал. Карточка при этом могла
  /// создаться, но её id приложение не узнало — повтор упрётся в то же
  /// название.
  bool _createOutcomeUnknown = false;

  bool _cardOnServer = false;

  /// У партнёра на сервере уже есть карточка: этот мастер её создал, или
  /// сервер отказал «заведение с таким названием у вас уже есть». Значит,
  /// человек уже партнёр (роль сервер меняет при первой карточке), даже если
  /// отправка на модерацию не прошла. Экран по этому признаку обновляет роль
  /// и список заведений, чтобы черновик был виден в профиле.
  bool get hasCardOnServer => _cardOnServer;

  /// Хвост к причине отказа, когда карточка создана, но не отправлена
  /// (решение Координатора 13.10.2026).
  static const _savedAsDraftTail = 'Заведение сохранено как черновик — '
      'нажмите «Отправить на верификацию» ещё раз.';

  /// Повтор после потерянного ответа упёрся в то же название (решение
  /// Координатора 13.10.2026). «Возможно» — потому что 409 бывает и у
  /// настоящего тёзки: второе заведение сети с тем же названием.
  static const _alreadyCreatedHint =
      'Заведение с таким названием уже есть в вашем профиле — возможно, оно '
      'создалось при прошлой попытке. Откройте его в профиле и нажмите '
      '«Отправить на модерацию».';

  /// Submit registration to API
  /// Returns true on success, false on failure
  Future<bool> submit() async {
    // Второе нажатие, пока первое в пути, создало бы вторую карточку: сервер
    // сверяет названия без защиты от одновременных запросов.
    if (_isSubmitting) return false;

    if (!_validateSummaryStep()) {
      _setError('Пожалуйста, заполните все обязательные поля');
      return false;
    }

    final data = jsonEncode(_data.toJson());

    _isSubmitting = true;
    _clearError();
    notifyListeners();

    try {
      if (_createdId == null) {
        // Call API to create establishment (status: draft)
        final result = await _establishmentsService.createEstablishment(_data);
        _createdId = result.id;
        _sentData = data;
        _cardOnServer = true;
      } else if (data != _sentData) {
        await _establishmentsService.updateEstablishment(
          _createdId!,
          _dataForCreatedCard(),
        );
        _sentData = data;
      }

      // Auto-submit for moderation (draft → pending)
      await _sendCreatedCard();

      _isSubmitting = false;
      notifyListeners();
      return true;
    } catch (e) {
      final reason =
          userMessageOf(e, fallback: 'Не удалось отправить на верификацию.');
      _setError(_createdId == null
          ? _onCreateFailed(e)
          // «Нажмите ещё раз» — только там, где повтор может помочь. Отказ
          // правки (тёзка, точка вне города) повтор получит тот же: партнёру
          // нужна причина, а не совет повторить.
          : _retryMayHelp(e)
              ? '$reason $_savedAsDraftTail'
              : reason);
      _isSubmitting = false;
      notifyListeners();
      return false;
    }
  }

  /// Текст отказа создания; заодно запоминает, что о карточке теперь
  /// известно.
  String _onCreateFailed(Object error) {
    final duplicate = _errorCodeOf(error) == 'DUPLICATE_ESTABLISHMENT';
    if (duplicate) _cardOnServer = true;
    final message = duplicate && _createOutcomeUnknown
        ? _alreadyCreatedHint
        : userMessageOf(
            error,
            fallback: 'Не удалось отправить на верификацию. Попробуйте ещё раз.',
          );
    // Отказ 4xx значит, что сервер разобрал запрос и карточку не создал. Всё
    // прочее исхода не сообщает. Признак не сбрасывается: третья попытка
    // упрётся в то же название, что и вторая.
    if (!_isServerRefusal(error)) _createOutcomeUnknown = true;
    return message;
  }

  /// Отправка созданной карточки на модерацию (черновик → на модерации).
  ///
  /// Отказ «статус уже не тот» значит, что карточка ушла раньше: прошлая
  /// отправка дошла до сервера, а ответ потерялся. Цель достигнута — это
  /// успех, а не ошибка.
  Future<void> _sendCreatedCard() async {
    try {
      await _establishmentsService.submitForModeration(_createdId!);
    } catch (e) {
      if (_errorCodeOf(e) == 'INVALID_STATUS_FOR_SUBMISSION') return;
      rethrow;
    }
  }

  /// Данные мастера для правки уже созданной карточки (PUT).
  ///
  /// На сервере PDF-меню лежит в той же корзине «меню», что и фото меню, а
  /// правка оставляет в корзине ровно те ссылки, что пришли в `menu_photos`:
  /// без ссылок на PDF она бы их удалила. `menu_pdfs` — поле только
  /// создания, правка его не читает. Поэтому PDF едут вместе с фото меню —
  /// так же, как при правке из кабинета, куда сервер отдаёт PDF в
  /// `menu_photos`.
  PartnerRegistration _dataForCreatedCard() => _data.copyWith(
        menuPhotos: [
          ..._data.menuPhotos,
          ..._data.menuPdfs.map((pdf) => pdf.url),
        ],
        menuPdfs: const [],
      );

  /// Код отказа из конверта ошибки бэкенда (`{error: {code}}`), если сервер
  /// ответил.
  static String? _errorCodeOf(Object error) {
    if (error is! DioException) return null;
    final body = error.response?.data;
    if (body is! Map) return null;
    final envelope = body['error'];
    if (envelope is! Map) return null;
    final code = envelope['code'];
    return code is String ? code : null;
  }

  /// Сервер ответил отказом 4xx: запрос разобран и отклонён. Нет связи, нет
  /// ответа, сбой 5xx исхода не сообщают — запрос мог успеть сделать своё.
  static bool _isServerRefusal(Object error) {
    final status = error is DioException ? error.response?.statusCode : null;
    return status != null && status >= 400 && status < 500;
  }

  /// Повтор может помочь: ответа сервера нет (связь, таймаут), сбой 5xx или
  /// лимит запросов (429). На прочий отказ 4xx повтор получит тот же отказ.
  static bool _retryMayHelp(Object error) {
    final status = error is DioException ? error.response?.statusCode : null;
    return status == null || status >= 500 || status == 429;
  }

  // ============================================================================
  // Update (edit mode)
  // ============================================================================

  /// Save changes to an existing establishment via PUT
  /// Returns true on success, false on failure
  Future<bool> saveChanges() async {
    if (establishmentId == null) {
      _setError('Не указан ID заведения');
      return false;
    }

    _isSubmitting = true;
    _clearError();
    notifyListeners();

    try {
      await _establishmentsService.updateEstablishment(establishmentId!, _data);
      _isSubmitting = false;
      notifyListeners();
      return true;
    } catch (e) {
      // Без приставки «Ошибка при сохранении:», как при создании карточки
      // (решение Координатора 07.10.2026): партнёр читает ровно фразу,
      // утверждённую для отказа, а красная плашка и незакрывшийся экран и
      // так говорят, что изменения не сохранились.
      _setError(userMessageOf(
        e,
        fallback: 'Не удалось сохранить изменения. Попробуйте ещё раз.',
      ));
      _isSubmitting = false;
      notifyListeners();
      return false;
    }
  }

  // ============================================================================
  // Reset
  // ============================================================================

  /// Reset all data and go back to step 1
  void reset() {
    _currentStep = 0;
    _data = const PartnerRegistration();
    // Новая карточка — не продолжение прежней: иначе её отправка ушла бы в
    // уже созданную.
    _createdId = null;
    _sentData = null;
    _createOutcomeUnknown = false;
    _cardOnServer = false;
    _isSubmitting = false;
    _clearError();
    notifyListeners();
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  /// Set error message
  void _setError(String message) {
    _error = message;
    notifyListeners();
  }

  /// Clear error message
  void _clearError() {
    _error = null;
  }

  /// Clear error publicly
  void clearError() {
    _clearError();
    notifyListeners();
  }
}
