import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Как «Избранное» показывает места: списком или на карте.
enum FavoritesViewMode { list, map }

/// Режим «Избранного» запоминается между заходами и перезапусками (решение
/// Координатора Р5, 17.10.2026): кто пользуется картой, пользуется ей
/// постоянно. Прогулка (этап 4) не запоминается — она про «сейчас».
///
/// Запоминание — удобство, не данные: хранилище не ответило — список, а
/// несохранённый выбор просто не переживёт перезапуск.
class FavoritesViewModeStore {
  FavoritesViewModeStore._();

  static const String key = 'favorites_view_mode';

  /// Сохранённый режим; ничего не сохранено или значение незнакомо — список.
  static Future<FavoritesViewMode> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(key) == FavoritesViewMode.map.name
          ? FavoritesViewMode.map
          : FavoritesViewMode.list;
    } catch (e) {
      debugPrint('FavoritesViewModeStore.load: $e');
      return FavoritesViewMode.list;
    }
  }

  static Future<void> save(FavoritesViewMode mode) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(key, mode.name);
    } catch (e) {
      debugPrint('FavoritesViewModeStore.save: $e');
    }
  }
}
