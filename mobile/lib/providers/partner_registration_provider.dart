import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';

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

  int _currentStep = 0;
  PartnerRegistration _data = const PartnerRegistration();
  bool _isSubmitting = false;
  String? _error;

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
    final phone = _data.phone ?? '';
    final priceRange = _data.priceRange;

    // Basic requirements: name (2+ chars) and price range selected
    // Description and phone are optional for now
    return name.length >= 2 &&
        (description.isEmpty || description.length >= 5) &&
        (phone.isEmpty || phone.length >= 5) &&
        priceRange != null &&
        priceRange.isNotEmpty;
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

  /// Validate phone number format
  bool _isValidPhone(String phone) {
    if (phone.isEmpty) return false;
    // Basic validation: starts with + and has digits
    final phoneRegex = RegExp(r'^\+?[0-9]{10,15}$');
    return phoneRegex.hasMatch(phone.replaceAll(RegExp(r'[\s\-()]'), ''));
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

  /// Submit registration to API
  /// Returns true on success, false on failure
  Future<bool> submit() async {
    if (!_validateSummaryStep()) {
      _setError('Пожалуйста, заполните все обязательные поля');
      return false;
    }

    _isSubmitting = true;
    _clearError();
    notifyListeners();

    try {
      // Call API to create establishment
      await _establishmentsService.createEstablishment(_data);

      _isSubmitting = false;
      notifyListeners();
      return true;
    } catch (e) {
      _setError('Ошибка при отправке: ${e.toString()}');
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
