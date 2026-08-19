import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_sidebar.dart';

/// Каркас админки: рейл слева + область контента справа.
/// Используется как builder у ShellRoute — рейл переживает навигацию.
///
/// Разделительной линии здесь нет намеренно: в макете граница принадлежит
/// самому рейлу (`border-right: 1px solid #E4DFD6`), а не отдельному элементу.
class AdminShell extends StatefulWidget {
  final Widget child;

  const AdminShell({super.key, required this.child});

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  @override
  void initState() {
    super.initState();
    // Счётчики очередей грузятся один раз на шелл: рейл переживает навигацию.
    // На сервере ответ закэширован на 30 с, поэтому повторный вызов после
    // модерации дёшев — экраны могут дёргать load() сами.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<BadgesProvider>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Row(
        children: [
          const AdminSidebar(),
          Expanded(
            child: ColoredBox(
              color: AppTheme.backgroundPrimary,
              child: widget.child,
            ),
          ),
        ],
      ),
    );
  }
}
