import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
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
  late final BadgesProvider _badges;

  /// Навигатор панели — его уведомление о переходе и есть «модератор открыл
  /// другой экран». Каркас переживает навигацию, поэтому слушать приходится
  /// роутер, а не собственную перестройку.
  GoRouterDelegate? _router;

  @override
  void initState() {
    super.initState();
    // Счётчики очередей: при входе, раз в минуту и при переходе на другой
    // экран (A3-21, F-20). На сервере ответ закэширован на 30 с, поэтому
    // повторный вызов дёшев — экраны после своих действий дёргают load() сами.
    _badges = context.read<BadgesProvider>();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _badges.load();
      _badges.startAutoRefresh();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final router = GoRouter.maybeOf(context)?.routerDelegate;
    if (identical(router, _router)) return;
    _router?.removeListener(_onNavigated);
    _router = router?..addListener(_onNavigated);
  }

  void _onNavigated() =>
      _badges.refreshIfOlderThan(BadgesProvider.refreshOnNavigationAfter);

  @override
  void dispose() {
    _router?.removeListener(_onNavigated);
    _badges.stopAutoRefresh();
    super.dispose();
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
