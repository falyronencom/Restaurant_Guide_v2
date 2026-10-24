import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/admin_badges.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/badges_service.dart';

/// Счётчики очередей для рейла и дашборда.
///
/// Живёт на уровне шелла: рейл рисуется один раз и переживает навигацию, а
/// счётчики нужны на каждом экране. Ошибку наружу не поднимает намеренно —
/// бейдж это украшение навигации, и падать из-за него экран не должен.
/// Не загрузилось — бейджей просто нет.
class BadgesProvider with ChangeNotifier {
  final BadgesService _service;

  AdminBadges? _badges;
  bool _isLoading = false;

  /// Когда счётчики пришли в последний раз. По нему [refreshIfOlderThan]
  /// решает, идти ли за свежими при переходе между экранами.
  DateTime? _loadedAt;

  /// Таймер фонового обновления, пока открыт каркас панели.
  Timer? _timer;

  /// Часы — подменяются в тестах.
  @visibleForTesting
  DateTime Function() clock = DateTime.now;

  /// Поколение аккаунта (пакет 2; решение Координатора 12.10.2026 — метка у
  /// каждого провайдера реестра). Счётчики одинаковы для обеих ролей, но
  /// ответ прежнего аккаунта не должен ни перекрыть свежий, ни снять флаг
  /// загрузки, пока запрос вошедшего ещё в пути.
  int _generation = 0;

  BadgesProvider({BadgesService? service})
      : _service = service ?? BadgesService() {
    AccountScope.register(resetAccountScope);
  }

  /// Сброс при смене аккаунта: счётчики перечитает шелл при следующем входе.
  void resetAccountScope() {
    _generation++;
    _badges = null;
    _isLoading = false;
    _loadedAt = null;
    notifyListeners();
  }

  /// Как часто счётчики обновляются сами, пока панель открыта.
  ///
  /// Раньше их грузили один раз на сеанс: новые заявки партнёров не
  /// прибавляли цифру в меню слева, пока модератор не сделает своё действие
  /// (A3-21, F-20, A1-21). Сервер держит ответ 30 секунд, так что минута —
  /// это не нагрузка, а свежесть.
  static const Duration autoRefreshEvery = Duration(seconds: 60);

  /// При переходе между экранами — свежие, если нынешним больше этого.
  static const Duration refreshOnNavigationAfter = Duration(seconds: 15);

  /// Запустить фоновое обновление (каркас панели, на всё время сеанса).
  void startAutoRefresh({Duration every = autoRefreshEvery}) {
    _timer?.cancel();
    _timer = Timer.periodic(every, (_) => load());
  }

  void stopAutoRefresh() {
    _timer?.cancel();
    _timer = null;
  }

  /// Обновить, если счётчикам больше [age] или их ещё нет.
  Future<void> refreshIfOlderThan(Duration age) async {
    final at = _loadedAt;
    if (at != null && clock().difference(at) < age) return;
    await load();
  }

  @override
  void dispose() {
    stopAutoRefresh();
    super.dispose();
  }

  AdminBadges? get badges => _badges;
  bool get isLoading => _isLoading;

  Future<void> load() async {
    if (_isLoading) return;
    _isLoading = true;
    final generation = _generation;

    try {
      final badges = await _service.getBadges();
      if (generation == _generation) {
        _badges = badges;
        _loadedAt = clock();
      }
    } catch (_) {
      // Молча: см. комментарий класса.
    } finally {
      if (generation == _generation) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }
}
