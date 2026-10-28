import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Provider for push notification preferences (ChangeNotifier).
///
/// State: four booleans per category + loading flag.
/// Uses GET/PUT /api/v1/notifications/preferences with optimistic updates.
///
/// `menu_push_enabled` (backend migration 033) may be absent from a response
/// served by a backend whose schema predates it — read as `true`, the backend
/// default, so the toggle never flips off on its own.
class NotificationPreferencesProvider extends ChangeNotifier {
  final ApiClient _apiClient;

  /// [apiClient] is injectable for tests; the app uses the singleton.
  NotificationPreferencesProvider({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient() {
    AccountScope.register(resetAccountScope);
  }

  /// Bumped on every account-scope reset; a request started under the
  /// previous account captured an older value and drops its write, so a late
  /// answer can never show the previous account's data (pack 1 of the critics'
  /// findings, point 4 — Codex C2; the pattern of PartnerDashboardProvider).
  int _generation = 0;

  /// Back to defaults + not-initialized so the next account re-fetches its
  /// own preferences; registered in [AccountScope].
  void resetAccountScope() {
    _generation++;
    _bookingPushEnabled = true;
    _reviewsPushEnabled = true;
    _promotionsPushEnabled = true;
    _menuPushEnabled = true;
    _confirmed.addAll(_defaults());
    _inFlight.clear();
    _isLoading = false;
    _isInitialized = false;
    notifyListeners();
  }

  bool _bookingPushEnabled = true;
  bool _reviewsPushEnabled = true;
  bool _promotionsPushEnabled = true;
  bool _menuPushEnabled = true;
  bool _isLoading = false;
  bool _isInitialized = false;

  bool get bookingPushEnabled => _bookingPushEnabled;
  bool get reviewsPushEnabled => _reviewsPushEnabled;
  bool get promotionsPushEnabled => _promotionsPushEnabled;
  bool get menuPushEnabled => _menuPushEnabled;
  bool get isLoading => _isLoading;

  /// Fetch current preferences from backend.
  /// Returns defaults if no row exists (backend returns defaults).
  Future<void> fetchPreferences() async {
    if (_isLoading) return;
    _isLoading = true;
    notifyListeners();

    final generation = _generation;
    try {
      final response = await _apiClient.get(
        '/api/v1/notifications/preferences',
      );
      if (generation != _generation) return; // account switched mid-flight

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final prefs = data['data'] as Map<String, dynamic>? ?? data;

        _bookingPushEnabled = prefs['booking_push_enabled'] as bool? ?? true;
        _reviewsPushEnabled = prefs['reviews_push_enabled'] as bool? ?? true;
        _promotionsPushEnabled =
            prefs['promotions_push_enabled'] as bool? ?? true;
        _menuPushEnabled = prefs['menu_push_enabled'] as bool? ?? true;
        for (final key in _confirmed.keys.toList()) {
          _confirmed[key] = _shown(key);
        }
      }
      _isInitialized = true;
    } catch (e) {
      if (generation != _generation) return;
      debugPrint('Failed to fetch notification preferences: $e');
      // Keep defaults on error
    } finally {
      if (generation == _generation) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  /// Update a preference category. Optimistic update with rollback on failure.
  ///
  /// Only the categories passed are sent — the backend keeps the rest as is.
  ///
  /// Откат — только своих полей и только к тому, что сервер подтвердил.
  /// Раньше вызов снимал все четыре флага до запроса и при отказе возвращал
  /// все четыре: гость выключал «Отзывы» и сразу «Акции», запрос по
  /// «Отзывам» срывался, по «Акциям» проходил — и откат «Отзывов» возвращал
  /// «Акции» во «вкл.» из своего снимка, хотя сервер их выключил (сверка
  /// «Честность тестов клиентов», 25.10.2026). Сервер пишет по полям
  /// (`COALESCE` по каждой колонке), поэтому и клиент ведёт каждое поле
  /// отдельно:
  ///  * удачная запись подтверждает присланные поля — сервер хранит именно их;
  ///  * когда по полю не осталось запросов в пути, переключатель встаёт на
  ///    подтверждённое значение; пока они есть, он показывает последнее
  ///    нажатие — его судьбу решат их ответы, в каком бы порядке они ни
  ///    пришли (повторное нажатие может отказать раньше, чем придёт успех
  ///    первого).
  /// «Подтверждённое» — значение последнего пришедшего удачного ответа: если
  /// сеть переставит два удачных ответа одного поля, экран покажет то, что
  /// сервер записал первым. Это — предел клиента без номера версии на
  /// сервере.
  /// Строка из ответа PUT для остальных полей не применяется: она снята в
  /// момент этой записи, и ответ, пришедший позже ответа соседнего запроса,
  /// вернул бы его поле назад.
  Future<void> updatePreferences({
    bool? booking,
    bool? reviews,
    bool? promotions,
    bool? menu,
  }) async {
    final changes = <String, bool>{
      if (booking != null) _bookingKey: booking,
      if (reviews != null) _reviewsKey: reviews,
      if (promotions != null) _promotionsKey: promotions,
      if (menu != null) _menuKey: menu,
    };
    if (changes.isEmpty) return;

    // Optimistic update
    changes.forEach((key, value) {
      _inFlight[key] = (_inFlight[key] ?? 0) + 1;
      _setShown(key, value);
    });
    notifyListeners();

    final generation = _generation;
    var stored = false;
    try {
      await _apiClient.put(
        '/api/v1/notifications/preferences',
        data: <String, dynamic>{...changes},
      );
      stored = true;
    } catch (e) {
      debugPrint('Failed to update notification preferences: $e');
    }

    // The account changed meanwhile: these toggles are the previous
    // account's.
    if (generation != _generation) return;

    var changed = false;
    changes.forEach((key, value) {
      if (stored) _confirmed[key] = value;
      final pending = _inFlight[key]! - 1;
      _inFlight[key] = pending;
      if (pending > 0) return; // в пути ещё запрос по полю — решит его ответ
      final confirmed = _confirmed[key]!;
      if (_shown(key) != confirmed) {
        _setShown(key, confirmed);
        changed = true;
      }
    });
    if (changed) notifyListeners();
  }

  static const String _bookingKey = 'booking_push_enabled';
  static const String _reviewsKey = 'reviews_push_enabled';
  static const String _promotionsKey = 'promotions_push_enabled';
  static const String _menuKey = 'menu_push_enabled';

  /// Последнее значение каждой колонки, которое подтвердил сервер: чтением
  /// или удачной записью этого поля. К нему возвращается переключатель,
  /// запрос которого отказал.
  final Map<String, bool> _confirmed = _defaults();

  /// Сколько запросов записи по каждой колонке ещё в пути.
  final Map<String, int> _inFlight = {};

  static Map<String, bool> _defaults() => {
        _bookingKey: true,
        _reviewsKey: true,
        _promotionsKey: true,
        _menuKey: true,
      };

  bool _shown(String key) => switch (key) {
        _bookingKey => _bookingPushEnabled,
        _reviewsKey => _reviewsPushEnabled,
        _promotionsKey => _promotionsPushEnabled,
        _ => _menuPushEnabled,
      };

  void _setShown(String key, bool value) {
    switch (key) {
      case _bookingKey:
        _bookingPushEnabled = value;
      case _reviewsKey:
        _reviewsPushEnabled = value;
      case _promotionsKey:
        _promotionsPushEnabled = value;
      default:
        _menuPushEnabled = value;
    }
  }

  /// Ensure preferences are loaded (call on screen open).
  Future<void> ensureLoaded() async {
    if (!_isInitialized) {
      await fetchPreferences();
    }
  }
}
