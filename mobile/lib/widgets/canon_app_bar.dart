import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Каноническая шапка экрана («канон B», аудит 2026-07-06):
/// тёплый фон backgroundWarm, заголовок Unbounded 25/w400 тёмно-оранжевым,
/// иконки textDark, без тени и scroll-тонировки.
/// Образцы: login_screen, method_selection_screen, edit_establishment_screen.
class CanonAppBar extends StatelessWidget implements PreferredSizeWidget {
  final String title;
  final List<Widget>? actions;
  final Widget? leading;

  const CanonAppBar({
    super.key,
    required this.title,
    this.actions,
    this.leading,
  });

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      // FittedBox: Unbounded широкий — длинные заголовки («Подключение
      // бронирования») ужимаются, а не обрезаются.
      title: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(title, style: AppTheme.canonAppBarTitle),
      ),
      backgroundColor: AppTheme.backgroundWarm,
      foregroundColor: AppTheme.textDark,
      elevation: 0,
      scrolledUnderElevation: 0,
      leading: leading,
      actions: actions,
    );
  }
}
