import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/services/panel_version.dart';
import 'package:restaurant_guide_admin_web/services/rail_preference.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_sidebar.dart';
import 'package:restaurant_guide_admin_web/widgets/panel_update_banner.dart';

/// Каркас админки: рейл слева + область контента справа.
/// Используется как builder у ShellRoute — рейл переживает навигацию.
///
/// Разделительной линии здесь нет намеренно: в макете граница принадлежит
/// самому рейлу (`border-right: 1px solid #E4DFD6`), а не отдельному элементу.
///
/// Каркас решает, свёрнуто ли меню ([RailPreference]), сообщает экранам
/// ширину их области ([AdminContentArea]) и показывает плашку новой версии
/// панели ([PanelVersionWatcher]).
class AdminShell extends StatefulWidget {
  final Widget child;

  /// Сверка сборки — подменяется в тестах. По умолчанию — по номеру,
  /// вшитому в сборку: у сборки без номера сверки нет.
  final PanelVersionWatcher? versionWatcher;

  const AdminShell({super.key, required this.child, this.versionWatcher});

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  late final BadgesProvider _badges;
  late final PanelVersionWatcher _version;
  late final bool _ownsVersion;
  late final AppLifecycleListener _lifecycle;

  /// Выбор модератора про меню слева; null — меню следует ширине окна.
  bool? _railStored;

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
    _ownsVersion = widget.versionWatcher == null;
    _version = widget.versionWatcher ?? PanelVersionWatcher();
    _version.addListener(_onVersionChanged);
    // Вернулся на вкладку — первым делом сверить сборку: вкладка могла
    // пролежать в фоне дольше таймера.
    _lifecycle = AppLifecycleListener(onResume: _version.check);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _badges.load();
      _badges.startAutoRefresh();
      _version.check();
      _version.start();
    });
    RailPreference.load().then((stored) {
      if (mounted && stored != null) setState(() => _railStored = stored);
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

  void _onVersionChanged() {
    if (mounted) setState(() {});
  }

  void _toggleRail(double windowWidth) {
    final next =
        RailPreference.afterToggle(windowWidth: windowWidth, stored: _railStored);
    setState(() => _railStored = next);
    RailPreference.save(next);
  }

  @override
  void dispose() {
    _router?.removeListener(_onNavigated);
    _badges.stopAutoRefresh();
    _lifecycle.dispose();
    _version.removeListener(_onVersionChanged);
    if (_ownsVersion) {
      _version.dispose();
    } else {
      _version.stop();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final windowWidth = MediaQuery.sizeOf(context).width;
    final collapsed =
        RailPreference.collapsed(windowWidth: windowWidth, stored: _railStored);

    return Scaffold(
      body: Row(
        children: [
          AdminSidebar(
            collapsed: collapsed,
            onToggle: () => _toggleRail(windowWidth),
          ),
          Expanded(
            child: ColoredBox(
              color: AppTheme.backgroundPrimary,
              child: AdminContentArea(
                railWidth:
                    collapsed ? AdminSidebar.collapsedWidth : AdminSidebar.width,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_version.updateAvailable) const PanelUpdateBanner(),
                    Expanded(child: widget.child),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Ширина меню слева — для экранов, которые раскладываются по ширине своей
/// области, а знают только окно (`MediaQuery`).
///
/// Пороги экранов волны 2 считались от окна при меню 260 (находка П5+П6
/// № 6): со свёрнутым меню экрану на том же окне достаётся на 196 px больше,
/// и порог «от окна» отнимал бы у него подписи зря. Экраны, которые
/// раскладываются внутри `LayoutBuilder`, ширину своей области и так знают.
class AdminContentArea extends InheritedWidget {
  final double railWidth;

  const AdminContentArea({
    super.key,
    required this.railWidth,
    required super.child,
  });

  /// Ширина области экрана: окно минус меню слева. Вне каркаса (стенды
  /// тестов, где слева стоит распорка 260) — как при развёрнутом меню.
  static double widthOf(BuildContext context) {
    final rail = context
            .dependOnInheritedWidgetOfExactType<AdminContentArea>()
            ?.railWidth ??
        AdminSidebar.width;
    return MediaQuery.sizeOf(context).width - rail;
  }

  @override
  bool updateShouldNotify(AdminContentArea oldWidget) =>
      railWidth != oldWidget.railWidth;
}
