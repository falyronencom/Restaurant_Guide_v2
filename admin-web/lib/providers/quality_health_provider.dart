import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/services/quality_health_service.dart';

/// State for the Quality Health panel (AI-ops Brick-1, Tier-0 immunity, read-only).
class QualityHealthProvider with ChangeNotifier {
  final QualityHealthService _service;

  QualityHealthData? _data;
  bool _isLoading = false;
  String? _error;

  QualityHealthProvider({QualityHealthService? service})
      : _service = service ?? QualityHealthService();

  QualityHealthData? get data => _data;
  bool get isLoading => _isLoading;
  String? get error => _error;

  Future<void> load() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _data = await _service.getHealth();
    } catch (e) {
      _error = _extractMessage(e);
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('Connection timeout')) return 'Превышено время ожидания';
    if (msg.contains('No internet')) return 'Нет подключения к серверу';
    if (msg.contains('403')) return 'Доступ запрещён';
    return 'Произошла ошибка. Попробуйте снова.';
  }
}
