import 'package:flutter/widgets.dart';

/// Выбрана ли в нижнем меню вкладка, внутри которой стоит виджет.
///
/// TickerMode этого не различает: он гаснет и когда выбрали другую вкладку,
/// и когда вкладку накрыл экран корневого навигатора (карточка заведения).
/// Прогулке «Избранного» нужно различать: под карточкой она ждёт «назад»,
/// с другой вкладкой — выключается (17.10.2026).
///
/// Вне главной (экран в тесте сам по себе) вкладка считается выбранной.
class SelectedTabScope extends InheritedWidget {
  const SelectedTabScope({
    super.key,
    required this.selected,
    required super.child,
  });

  final bool selected;

  static bool of(BuildContext context) =>
      context
          .dependOnInheritedWidgetOfExactType<SelectedTabScope>()
          ?.selected ??
      true;

  @override
  bool updateShouldNotify(SelectedTabScope oldWidget) =>
      selected != oldWidget.selected;
}
