import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';

/// Итоги для полосы вкладок: «Заведения 412 · Пользователи 3 480 · Отзывы 1 240».
///
/// Отдельный запрос за `overview` вместо загрузки всех трёх вкладок сразу:
/// одно обращение вместо трёх, и оно уже существует. Величины — снимки, от
/// периода не зависят, поэтому при смене окна не перечитываются.
///
/// Числа здесь — только для ещё не открытых вкладок. Как только вкладка
/// загрузилась, полоса берёт её собственный `total`: два запроса видят базу в
/// разные моменты, и показывать в подписи одно число, а в карточке под ней
/// другое — хуже, чем не показывать никакого.
class AnalyticsTotalsProvider with ChangeNotifier {
  final AnalyticsService _service;

  OverviewData? _overview;
  bool _isLoading = false;
  DateTime? _loadedAt;

  /// Часы — подменяются в тестах.
  @visibleForTesting
  DateTime Function() clock = DateTime.now;

  /// Старше этого итоги перечитываются при входе в раздел — тот же срок,
  /// что у вкладок (A3-22): раньше они не обновлялись за сеанс вовсе.
  static const Duration maxAge = Duration(minutes: 5);

  /// Поколение аккаунта — как в BadgesProvider (решение Координатора
  /// 12.10.2026: метка у каждого провайдера реестра).
  int _generation = 0;

  AnalyticsTotalsProvider({AnalyticsService? service})
      : _service = service ?? AnalyticsService() {
    AccountScope.register(resetAccountScope);
  }

  /// Сброс при смене аккаунта: итоги перечитываются при следующем входе.
  void resetAccountScope() {
    _generation++;
    _overview = null;
    _isLoading = false;
    _loadedAt = null;
    notifyListeners();
  }

  int? get establishments => _overview?.establishments.total;
  int? get users => _overview?.users.total;
  int? get reviews => _overview?.reviews.total;

  /// Загрузить, если итогов нет или им больше [maxAge].
  Future<void> loadOnce() async {
    if (_isLoading) return;
    final at = _loadedAt;
    if (_overview != null && at != null && clock().difference(at) < maxAge) {
      return;
    }
    _isLoading = true;
    final generation = _generation;

    try {
      final overview = await _service.getOverview();
      if (generation == _generation) {
        _overview = overview;
        _loadedAt = clock();
      }
    } catch (_) {
      // Молча. Итог в подписи вкладки — удобство, а не содержание экрана:
      // сообщать об ошибке дважды (здесь и в теле вкладки) значило бы
      // объявить сбоем то, что сбоем не является.
    } finally {
      if (generation == _generation) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }
}
