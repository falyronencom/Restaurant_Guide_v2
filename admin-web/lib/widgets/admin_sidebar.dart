import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';

/// Навигационный рейл админки — 260px по редизайну (было 363).
///
/// Сужение — не косметика: при 363px и высоте пункта 44 последний раздел
/// («Здоровье данных») уходил под нижний разделитель и требовал прокрутки.
/// На 260px с высотой пункта 34 весь список — 12 пунктов и 4 заголовка —
/// умещается примерно в 683px против 820 доступных.
///
/// Отступление от макета: там рейл жёстко `height:820px` без `overflow`, то
/// есть на экране ниже 820 содержимое молча обрезалось бы. Здесь список
/// прокручивается, но только когда действительно не помещается.
///
/// Свёрнутое меню — 64px, одни значки с подсказками (проход по панели
/// модератора, 20.10, A3-11, A1-14, F-05): на ноутбуке 260px — четверть
/// экрана. Когда сворачивать, решает каркас ([collapsed]).
class AdminSidebar extends StatelessWidget {
  /// Меню свёрнуто до значков. Решает каркас (`AdminShell`): ширина окна и
  /// выбор модератора (`RailPreference`).
  final bool collapsed;

  /// Щелчок по кнопке «Свернуть меню» / «Развернуть меню». Без него кнопки
  /// нет (стенды тестов, где меню рисуется отдельно от каркаса).
  final VoidCallback? onToggle;

  /// Менять ширину плавно. Каркас выключает это, пока не прочитал выбор
  /// модератора: иначе сохранённое «развёрнуто» въезжало бы анимацией при
  /// каждой загрузке панели.
  final bool animate;

  const AdminSidebar({
    super.key,
    this.collapsed = false,
    this.onToggle,
    this.animate = true,
  });

  /// Ширина вместе с правой границей (в макете `box-sizing: border-box`).
  static const double width = 260;

  /// Ширина свёрнутого меню: значок 18 и поля по 23 — щелчок по пункту
  /// остаётся щелчком, а не прицеливанием.
  static const double collapsedWidth = 64;

  /// Уже этого меню рисуется значками. Порог, а не флаг [collapsed]: пока
  /// ширина анимируется, подписи не должны ломаться на промежуточных кадрах.
  static const double labelsMinWidth = 200;

  static const Duration animation = Duration(milliseconds: 160);

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;

    return AnimatedContainer(
      duration: animate ? animation : Duration.zero,
      curve: Curves.easeOut,
      width: collapsed ? collapsedWidth : width,
      decoration: const BoxDecoration(
        color: AppTheme.backgroundWarm,
        border: Border(right: BorderSide(color: AppTheme.beigeDivider)),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < labelsMinWidth;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _RailHeader(compact: compact, onToggle: onToggle),
              Expanded(child: _RailNav(location: location, compact: compact)),
              _RailFooter(compact: compact),
            ],
          );
        },
      ),
    );
  }
}

// ============================================================================
// Данные навигации
// ============================================================================

/// Какая очередь питает бейдж пункта.
enum _RailBadge { pendingModeration, menuFlags }

/// Пункт рейла.
///
/// [soon] помечает раздел-заглушку: экран существует, но осмысленного
/// содержимого там нет. Пометка нужна, чтобы тупик был виден до клика;
/// переход при этом остаётся рабочим.
class _NavEntry {
  final String title;
  final String path;
  final IconData icon;
  final bool soon;
  final _RailBadge? badge;

  const _NavEntry(
    this.title,
    this.path,
    this.icon, {
    this.soon = false,
    this.badge,
  });
}

/// Группа пунктов. [title] == null — пункты до первого заголовка секции.
class _NavGroup {
  final String? title;
  final List<_NavEntry> items;

  const _NavGroup({this.title, required this.items});
}

/// Порядок и глифы — из макета редизайна (11 кадров, идентичны).
///
/// Группировка — нет: в макете статистика, отзывы, пользователи, платежи и
/// уведомления лежали под заголовком «Настройки», а настроек там нет (проход
/// по панели модератора, 20.10, Ч40). Теперь обзорные экраны — главная и
/// статистика — стоят вместе вверху, а люди и то, что они пишут и платят, —
/// группой «Сообщество». Адреса экранов (`/settings/…`) прежние: на них
/// могут стоять закладки.
const List<_NavGroup> _navGroups = <_NavGroup>[
  _NavGroup(
    items: <_NavEntry>[
      _NavEntry('Панель управления', '/', Icons.space_dashboard_outlined),
      _NavEntry('Статистика и аналитика', '/settings/analytics', Icons.insights),
    ],
  ),
  _NavGroup(
    title: 'Модерация',
    items: <_NavEntry>[
      _NavEntry('Ожидают просмотра', '/moderation/pending',
          Icons.pending_actions_outlined,
          badge: _RailBadge.pendingModeration),
      _NavEntry(
          'Одобренные', '/moderation/approved', Icons.check_circle_outline),
      _NavEntry('Отклонённые', '/moderation/rejected', Icons.cancel_outlined),
      _NavEntry('Приостановленные', '/moderation/suspended',
          Icons.pause_circle_outline),
      _NavEntry(
          'Позиции меню', '/moderation/menu-items', Icons.menu_book_outlined,
          badge: _RailBadge.menuFlags),
    ],
  ),
  _NavGroup(
    title: 'Сообщество',
    items: <_NavEntry>[
      _NavEntry('Отзывы', '/settings/reviews', Icons.reviews_outlined),
      _NavEntry('Пользователи', '/settings/users', Icons.people_outline),
      _NavEntry('История платежей', '/settings/payments',
          Icons.receipt_long_outlined,
          soon: true),
      _NavEntry('Уведомления', '/settings/notifications',
          Icons.notifications_outlined,
          soon: true),
    ],
  ),
  _NavGroup(
    title: 'Аудит',
    items: <_NavEntry>[
      _NavEntry('Журнал действий', '/audit-log', Icons.history),
    ],
  ),
  _NavGroup(
    title: 'Качество',
    items: <_NavEntry>[
      _NavEntry(
          'Здоровье данных', '/quality/health', Icons.monitor_heart_outlined),
    ],
  ),
];

// ============================================================================
// Блоки рейла
// ============================================================================

/// Верх: вордмарк и подпись. Паддинг 18/16/14 из макета. Свёрнутое меню
/// вордмарк не помещает — там только кнопка «Развернуть меню».
class _RailHeader extends StatelessWidget {
  final bool compact;
  final VoidCallback? onToggle;

  const _RailHeader({required this.compact, this.onToggle});

  @override
  Widget build(BuildContext context) {
    final toggle = onToggle == null
        ? null
        : IconButton(
            key: const ValueKey<String>('rail-toggle'),
            tooltip: compact ? 'Развернуть меню' : 'Свернуть меню',
            onPressed: onToggle,
            visualDensity: VisualDensity.compact,
            icon: Icon(
              compact
                  ? Icons.keyboard_double_arrow_right
                  : Icons.keyboard_double_arrow_left,
              size: 18,
              color: AppTheme.textSecondary,
            ),
          );

    if (compact) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(0, 14, 0, 10),
        child: Center(child: toggle ?? const SizedBox(height: 40)),
      );
    }
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 18, toggle == null ? 16 : 6, 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('NIRIVIO', style: AppTheme.canonWordmark),
                SizedBox(height: 4),
                Text('АДМИН-ПАНЕЛЬ', style: AppTheme.canonWordmarkCaption),
              ],
            ),
          ),
          if (toggle != null) toggle,
        ],
      ),
    );
  }
}

/// Список разделов. Паддинг по 8 с боков и зазор 1px — из макета:
/// пункт получается шириной 244, а не во всю ширину рейла.
class _RailNav extends StatelessWidget {
  final String location;
  final bool compact;

  const _RailNav({required this.location, required this.compact});

  @override
  Widget build(BuildContext context) {
    final badges = context.watch<BadgesProvider>().badges;

    final children = <Widget>[];
    for (final group in _navGroups) {
      final title = group.title;
      if (title != null) {
        children.add(compact
            ? const _RailSectionDivider()
            : _RailSectionHeader(title: title));
      }
      for (final entry in group.items) {
        children.add(_RailItem(
          entry: entry,
          compact: compact,
          isActive: location == entry.path,
          badgeCount: switch (entry.badge) {
            _RailBadge.pendingModeration => badges?.establishmentsPending,
            _RailBadge.menuFlags => badges?.menuFlags,
            null => null,
          },
        ));
      }
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 1,
        children: children,
      ),
    );
  }
}

class _RailSectionHeader extends StatelessWidget {
  final String title;

  const _RailSectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 14, 10, 6),
      child: Text(
        title.toUpperCase(),
        style: AppTheme.canonRailSectionHeader,
      ),
    );
  }
}

/// Заголовок секции в свёрнутом меню: слово не помещается, остаётся
/// черта — группы по-прежнему видны.
class _RailSectionDivider extends StatelessWidget {
  const _RailSectionDivider();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 10),
      child: Divider(
        height: 1,
        indent: 8,
        endIndent: 8,
        color: AppTheme.beigeDivider,
      ),
    );
  }
}

class _RailItem extends StatelessWidget {
  final _NavEntry entry;
  final bool isActive;

  /// Свёрнутое меню: только значок, подпись — подсказкой при наведении.
  final bool compact;

  /// Размер очереди. null — счётчики ещё не пришли или пункт их не имеет;
  /// ноль — очередь разобрана, и бейдж не рисуется: молчание = норма.
  final int? badgeCount;

  const _RailItem({
    required this.entry,
    required this.isActive,
    this.compact = false,
    this.badgeCount,
  });

  @override
  Widget build(BuildContext context) {
    // Активность важнее пометки «скоро»: если раздел открыт, он должен
    // читаться как текущий, иначе непонятно, где ты находишься.
    final Color iconColor;
    final TextStyle labelStyle;
    if (isActive) {
      iconColor = AppTheme.primaryOrange;
      labelStyle = const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: AppTheme.primaryOrangeDark,
      );
    } else if (entry.soon) {
      iconColor = AppTheme.textGrey;
      labelStyle = const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w500,
        color: AppTheme.textGrey,
      );
    } else {
      iconColor = AppTheme.textSecondary;
      labelStyle = const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w500,
        color: AppTheme.textDark,
      );
    }

    final radius = BorderRadius.circular(AppTheme.radiusControl);
    final count = badgeCount ?? 0;

    final Widget content;
    if (compact) {
      // Значок, а над ним — бейдж очереди: работа видна и в свёрнутом меню.
      // «Скоро» здесь не помещается — его говорит подсказка.
      content = Center(
        child: Badge(
          isLabelVisible: count > 0,
          label: Text('$count'),
          backgroundColor: AppTheme.primaryOrangeDark,
          textColor: AppTheme.textOnPrimary,
          offset: const Offset(8, -6),
          child: Icon(entry.icon, size: 18, color: iconColor),
        ),
      );
    } else {
      content = Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        child: Row(
          children: [
            Icon(entry.icon, size: 18, color: iconColor),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                entry.title,
                style: labelStyle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (entry.soon) ...[
              const SizedBox(width: 6),
              const Text('СКОРО', style: AppTheme.canonRailSoonLabel),
            ],
            if (count > 0) ...[
              const SizedBox(width: 6),
              _QueueBadge(count: count),
            ],
          ],
        ),
      );
    }

    final item = DecoratedBox(
      decoration: isActive
          ? BoxDecoration(
              color: AppTheme.backgroundPrimary,
              borderRadius: radius,
              boxShadow: AppTheme.railActiveShadow,
            )
          : const BoxDecoration(),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: radius,
          onTap: () => context.go(entry.path),
          child: SizedBox(height: 34, child: content),
        ),
      ),
    );

    if (!compact) return item;
    final hint = StringBuffer(entry.title);
    if (entry.soon) hint.write(' · скоро');
    if (count > 0) hint.write(' · $count');
    return Tooltip(
      message: hint.toString(),
      waitDuration: const Duration(milliseconds: 300),
      child: item,
    );
  }
}

/// Бейдж очереди: пилюля 18×18 (шире при двузначном), брендовая @14%.
///
/// Нулевую очередь не показывает вовсе — молчание означает норму. Бейдж на
/// каждом пункте превратился бы в шум, из которого не видно, где работа.
class _QueueBadge extends StatelessWidget {
  final int count;

  const _QueueBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 18),
      height: 18,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 5),
      decoration: BoxDecoration(
        color: AppTheme.brandTint(0.14),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Text(
        '$count',
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: AppTheme.primaryOrangeDark,
        ),
      ),
    );
  }
}

/// Низ: кто вошёл и выход. Имя и роль — из AuthProvider, а не захардкожены,
/// как в макете. В свёрнутом меню — кружок с буквой (имя и роль — подсказкой)
/// и под ним выход.
class _RailFooter extends StatelessWidget {
  final bool compact;

  const _RailFooter({this.compact = false});

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().currentUser;
    final name = user?.displayName ?? '—';
    // Роль — словом, а не ключом БД: «Только просмотр» под именем объясняет
    // просмотрщику, почему в панели нет ни одной кнопки действия.
    final role = user == null ? '' : panelRoleLabel(user.role);
    final initial = name.isNotEmpty ? name.substring(0, 1).toUpperCase() : '?';

    final avatar = Container(
      width: 30,
      height: 30,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: AppTheme.primaryOrangeDark,
        shape: BoxShape.circle,
      ),
      child: Text(
        initial,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: AppTheme.textOnPrimary,
        ),
      ),
    );

    final logout = Tooltip(
      message: 'Выйти',
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          onTap: () => confirmLogout(context),
          child: const Padding(
            padding: EdgeInsets.all(4),
            child: Icon(
              Icons.logout,
              size: 18,
              color: AppTheme.textSecondary,
            ),
          ),
        ),
      ),
    );

    const border = BoxDecoration(
      border: Border(top: BorderSide(color: AppTheme.beigeDivider)),
    );

    if (compact) {
      return Container(
        decoration: border,
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: 8,
          children: [
            Tooltip(
              message: role.isEmpty ? name : '$name · $role',
              child: avatar,
            ),
            logout,
          ],
        ),
      );
    }

    return Container(
      decoration: border,
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          avatar,
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textDark,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  role,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppTheme.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          logout,
        ],
      ),
    );
  }
}

/// Выход из панели. Если по заявкам проставлены отметки, которые ещё не
/// ушли решением, — сначала вопрос: выход их сотрёт (пункт A3-10; П5, 21.10).
/// Без отметок — выход сразу, как прежде.
Future<void> confirmLogout(BuildContext context) async {
  final auth = context.read<AuthProvider>();
  final leave = await confirmLosingVerdicts(
    context,
    title: 'Выйти из панели?',
    confirm: 'Выйти',
  );
  if (leave) await auth.logout();
}

/// Спросить, если уход со страницы сотрёт отметки по полям заявок, которые
/// ещё не ушли решением. Отметок нет — true сразу, без диалога. Нужна
/// выходу и обновлению панели до новой версии: оба стирают состояние вкладки.
Future<bool> confirmLosingVerdicts(
  BuildContext context, {
  required String title,
  required String confirm,
}) async {
  final moderation = context.read<ModerationProvider?>();
  if (moderation == null || !moderation.hasUnsavedVerdicts) return true;
  final leave = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: const Text(
        'Отметки по полям заявок, которые ещё не одобрены и не отклонены, '
        'пропадут.',
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Остаться'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, true),
          style: FilledButton.styleFrom(backgroundColor: AppTheme.errorRed),
          child: Text(confirm),
        ),
      ],
    ),
  );
  return leave == true;
}
