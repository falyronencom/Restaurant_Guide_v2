import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/services/partner_service.dart';

/// Partner Dashboard state provider
/// Manages partner's establishments list and operations
/// Phase 5.2 - Partner Dashboard
class PartnerDashboardProvider with ChangeNotifier {
  final PartnerService _partnerService = PartnerService();

  // ============================================================================
  // State
  // ============================================================================

  List<PartnerEstablishment> _establishments = [];
  bool _isLoading = false;
  bool _isInitialized = false;
  String? _error;

  // Selected establishment for detail view
  PartnerEstablishment? _selectedEstablishment;
  bool _isLoadingDetails = false;

  // ============================================================================
  // Getters
  // ============================================================================

  /// List of partner's establishments
  List<PartnerEstablishment> get establishments => _establishments;

  /// Whether data is currently loading
  bool get isLoading => _isLoading;

  /// Whether initial load has completed
  bool get isInitialized => _isInitialized;

  /// Current error message
  String? get error => _error;

  /// Whether partner has any establishments
  bool get hasEstablishments => _establishments.isNotEmpty;

  /// Count of establishments
  int get establishmentCount => _establishments.length;

  /// Selected establishment for detail view
  PartnerEstablishment? get selectedEstablishment => _selectedEstablishment;

  /// Whether details are loading
  bool get isLoadingDetails => _isLoadingDetails;

  /// Get establishments by status
  List<PartnerEstablishment> getByStatus(EstablishmentStatus status) {
    return _establishments.where((e) => e.status == status).toList();
  }

  /// Get approved establishments
  List<PartnerEstablishment> get approvedEstablishments =>
      getByStatus(EstablishmentStatus.approved);

  /// Get pending establishments
  List<PartnerEstablishment> get pendingEstablishments =>
      getByStatus(EstablishmentStatus.pending);

  /// Get rejected establishments
  List<PartnerEstablishment> get rejectedEstablishments =>
      getByStatus(EstablishmentStatus.rejected);

  // ============================================================================
  // Load Establishments
  // ============================================================================

  /// Load all partner's establishments
  Future<void> loadEstablishments() async {
    if (_isLoading) return;

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _establishments = await _partnerService.getMyEstablishments();
      _isInitialized = true;
      _error = null;
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
      // Keep existing data on error if we have any
      if (!_isInitialized) {
        _establishments = [];
      }
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Refresh establishments (for pull-to-refresh)
  Future<void> refresh() async {
    await loadEstablishments();
  }

  /// Initialize if not already done
  Future<void> initializeIfNeeded() async {
    if (!_isInitialized && !_isLoading) {
      await loadEstablishments();
    }
  }

  // ============================================================================
  // Load Establishment Details
  // ============================================================================

  /// Load details for a specific establishment
  Future<void> loadEstablishmentDetails(String id) async {
    _isLoadingDetails = true;
    notifyListeners();

    try {
      _selectedEstablishment = await _partnerService.getEstablishmentDetails(id);
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      _isLoadingDetails = false;
      notifyListeners();
    }
  }

  /// Clear selected establishment
  void clearSelectedEstablishment() {
    _selectedEstablishment = null;
    notifyListeners();
  }

  // ============================================================================
  // Update Establishment
  // ============================================================================

  /// Update an establishment
  Future<bool> updateEstablishment(String id, Map<String, dynamic> data) async {
    try {
      final updated = await _partnerService.updateEstablishment(id, data);

      // Update in local list
      final index = _establishments.indexWhere((e) => e.id == id);
      if (index != -1) {
        _establishments[index] = updated;
      }

      // Update selected if it's the same
      if (_selectedEstablishment?.id == id) {
        _selectedEstablishment = updated;
      }

      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
      notifyListeners();
      return false;
    }
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  /// Clear current error
  void clearError() {
    _error = null;
    notifyListeners();
  }

  // ============================================================================
  // Reset
  // ============================================================================

  /// Reset all state (on logout)
  void reset() {
    _establishments = [];
    _isLoading = false;
    _isInitialized = false;
    _error = null;
    _selectedEstablishment = null;
    _isLoadingDetails = false;
    notifyListeners();
  }
}
