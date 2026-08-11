import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_sidebar.dart';

/// Каркас админки: рейл слева + область контента справа.
/// Используется как builder у ShellRoute — рейл переживает навигацию.
///
/// Разделительной линии здесь нет намеренно: в макете граница принадлежит
/// самому рейлу (`border-right: 1px solid #E4DFD6`), а не отдельному элементу.
class AdminShell extends StatelessWidget {
  final Widget child;

  const AdminShell({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Row(
        children: [
          const AdminSidebar(),
          Expanded(
            child: ColoredBox(
              color: AppTheme.backgroundPrimary,
              child: child,
            ),
          ),
        ],
      ),
    );
  }
}
