import 'package:shared_preferences/shared_preferences.dart';

/// Свёрнуто ли меню слева — правило и память выбора модератора.
///
/// Меню 260 px на ноутбуке съедало четверть экрана (проход по панели
/// модератора, 20.10, A3-11, A1-14, F-05; решение А — самое узкое окно
/// 1024 px). Поэтому ниже [autoCollapseBelowWindowWidth] меню само
/// сворачивается до значков, а модератор может развернуть или свернуть его
/// кнопкой — и панель запомнит выбор.
///
/// Запоминается только **отступление от правила**: развернул на узком окне —
/// помним «развёрнуто»; свернул обратно — память стирается, и меню снова
/// следует ширине окна. Иначе один щелчок на большом мониторе навсегда
/// отключил бы сворачивание на ноутбуке.
class RailPreference {
  RailPreference._();

  /// Ширина окна, ниже которой меню свёрнуто само. На 1280 развёрнутое меню
  /// оставляет экрану 1020 px — с этой ширины экраны волны 2 ещё держат
  /// кнопки шапки подписями; уже — экран важнее подписей меню.
  static const double autoCollapseBelowWindowWidth = 1280;

  /// Ключ в хранилище браузера.
  static const String storageKey = 'admin_rail_collapsed';

  /// Свёрнуто ли меню при ширине окна [windowWidth] и запомненном выборе
  /// [stored] (null — выбора нет, правило по ширине).
  static bool collapsed({required double windowWidth, bool? stored}) =>
      stored ?? windowWidth < autoCollapseBelowWindowWidth;

  /// Что запомнить после щелчка по кнопке меню: новое состояние, если оно
  /// расходится с правилом для этой ширины, иначе — ничего (null).
  static bool? afterToggle({required double windowWidth, bool? stored}) {
    final next = !collapsed(windowWidth: windowWidth, stored: stored);
    final byWidth = windowWidth < autoCollapseBelowWindowWidth;
    return next == byWidth ? null : next;
  }

  /// Прочитать выбор. Хранилище недоступно (тесты, закрытый режим) — выбора
  /// нет: меню просто следует ширине окна.
  static Future<bool?> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(storageKey);
    } catch (_) {
      return null;
    }
  }

  /// Записать выбор; null — стереть.
  static Future<void> save(bool? value) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (value == null) {
        await prefs.remove(storageKey);
      } else {
        await prefs.setBool(storageKey, value);
      }
    } catch (_) {
      // Не запомнилось — не беда: в этой вкладке выбор уже применён.
    }
  }
}
