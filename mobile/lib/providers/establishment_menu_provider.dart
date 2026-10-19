import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/models/public_menu_item.dart';
import 'package:restaurant_guide_mobile/services/public_menu_service.dart';

enum MenuLoadStatus { idle, loading, loaded, failed }

/// Распознанное меню одного заведения: живёт, пока открыта его карточка, и
/// делится с экраном меню — второй раз за тем же меню экран не ходит.
///
/// Грузится лениво (SDL CAT-D-1.6): когда гость дошёл до раздела «Меню» или
/// нажал кнопку «Меню». Данные публичные, от учётки не зависят — в
/// `AccountScope` не регистрируется.
class EstablishmentMenuProvider extends ChangeNotifier {
  EstablishmentMenuProvider({required this.slug, PublicMenuService? service})
      : _service = service ?? PublicMenuService();

  /// Без адреса заведения меню не запросить — тогда оно считается пустым
  /// (старый ответ сервера без `slug`): карточка показывает фото и PDF, как
  /// до распознанного меню.
  final String? slug;
  final PublicMenuService _service;

  MenuLoadStatus _status = MenuLoadStatus.idle;
  List<PublicMenuItem> _items = const [];
  List<MenuSection> _sections = const [];
  bool _disposed = false;

  MenuLoadStatus get status => _status;
  List<PublicMenuItem> get items => _items;
  bool get hasItems => _items.isNotEmpty;

  /// Позиции по разделам ([groupMenuSections]) — считаются раз на загрузку.
  List<MenuSection> get sections => _sections;

  /// Дошёл до раздела: грузим один раз. После сбоя сама не повторяет —
  /// повтор по «Повторить» или по кнопке «Меню».
  Future<void> loadIfIdle() async {
    if (_status != MenuLoadStatus.idle) return;
    await _load();
  }

  /// Кнопка «Меню» и «Повторить»: грузит, если ещё не загружено или прошлый
  /// раз не удалось.
  Future<void> ensureLoaded() async {
    if (_status == MenuLoadStatus.loading || _status == MenuLoadStatus.loaded) {
      return;
    }
    await _load();
  }

  Future<void> _load() async {
    final slug = this.slug;
    if (slug == null || slug.isEmpty) {
      _status = MenuLoadStatus.loaded;
      _items = const [];
      _sections = const [];
      _notify();
      return;
    }
    _status = MenuLoadStatus.loading;
    _notify();
    try {
      final items = await _service.getMenuItems(slug);
      if (_disposed) return;
      _items = List.unmodifiable(items);
      _sections = List.unmodifiable(groupMenuSections(_items));
      _status = MenuLoadStatus.loaded;
    } catch (_) {
      if (_disposed) return;
      _status = MenuLoadStatus.failed;
    }
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
