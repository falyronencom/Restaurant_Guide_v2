import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/analytics_tab_provider.dart';
import 'package:restaurant_guide_admin_web/providers/analytics_totals_provider.dart';
import 'package:restaurant_guide_admin_web/providers/establishments_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/reviews_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/users_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/establishments_analytics_tab.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/reviews_analytics_tab.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/users_analytics_tab.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_inline_spinner.dart';

/// Раздел «Статистика и аналитика»: шапка, период, три вкладки.
///
/// Период живёт здесь, а не во вкладках. Раньше у каждой вкладки был свой
/// сегмент-контрол и свой период в своём провайдере: три вкладки могли стоять
/// на трёх разных окнах, и заметить это было нельзя — контрол показывал только
/// своё. Теперь окно одно на раздел, а вкладки догружаются при открытии
/// ([AnalyticsTabProvider.loadIfStale]): ходить за данными для двух невидимых
/// вкладок при каждой смене периода незачем.
class AnalyticsContainerScreen extends StatefulWidget {
  const AnalyticsContainerScreen({super.key});

  @override
  State<AnalyticsContainerScreen> createState() =>
      _AnalyticsContainerScreenState();
}

class _AnalyticsContainerScreenState extends State<AnalyticsContainerScreen> {
  int _active = 0;

  /// Об одной и той же неудаче не сообщаем дважды: без этого тост
  /// перевыставлялся бы на каждую перерисовку.
  String? _reportedError;
  VoidCallback? _dismissToast;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<AnalyticsTotalsProvider>().loadOnce();
      _activeProvider().loadIfStale();
    });
  }

  // Возвраты по одному, а не switch-выражением: у ветвей разные параметры
  // типа, и общий тип выражения выводится в `ChangeNotifier`, теряя интерфейс
  // вкладки. Каждый `return` проверяется против объявленного типа отдельно.
  AnalyticsTabProvider _providerAt(int index) {
    switch (index) {
      case 0:
        return context.read<EstablishmentsAnalyticsProvider>();
      case 1:
        return context.read<UsersAnalyticsProvider>();
      default:
        return context.read<ReviewsAnalyticsProvider>();
    }
  }

  AnalyticsTabProvider _activeProvider() => _providerAt(_active);

  void _selectTab(int index) {
    if (index == _active) return;
    setState(() => _active = index);
    _providerAt(index).loadIfStale();
  }

  void _changePeriod(PeriodSelection selection) {
    if (!mounted) return;
    // Клик по уже выбранному сегменту — не команда обновить: экран на секунду
    // тускнеет, и понять, что произошло, нельзя.
    if (selection.key == _activeProvider().selection.key) return;

    // Период запоминают все три вкладки, ходит за данными только открытая.
    for (var i = 0; i < 3; i++) {
      _providerAt(i).setPeriod(selection);
    }
    _activeProvider().load();
  }

  /// Сообщить о неудачном обновлении, когда прежние числа остались на экране.
  ///
  /// Карточка ошибки здесь не годится: подменять ей содержимое нечего, данные
  /// целы. Но и молчать нельзя — полоса загрузки погасла, приглушение снялось,
  /// и устаревшие числа выглядят окончательными. Тот же приём, что в журнале
  /// действий: тост с поводом и кнопкой повтора.
  void _reportRefreshFailure(AnalyticsTabProvider active) {
    final message = active.error;

    if (message == null || active.data == null) {
      _reportedError = null;
      return;
    }
    if (message == _reportedError) return;
    _reportedError = message;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _dismissToast?.call();
      _dismissToast = showAdminErrorToast(
        context,
        title: 'Статистика не обновилась',
        message: '$message. На экране остались числа за прежний период.',
        onRetry: active.load,
      );
    });
  }

  @override
  void dispose() {
    _dismissToast?.call();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final establishments = context.watch<EstablishmentsAnalyticsProvider>();
    final users = context.watch<UsersAnalyticsProvider>();
    final reviews = context.watch<ReviewsAnalyticsProvider>();
    final totals = context.watch<AnalyticsTotalsProvider>();

    final active = <AnalyticsTabProvider>[establishments, users, reviews][_active];
    final refreshing = active.isLoading && active.data != null;
    _reportRefreshFailure(active);

    return Column(
      children: [
        AdminScreenHeader(
          title: 'Статистика и аналитика',
          subtitle: _subtitle(active),
          subtitleLeading:
              refreshing ? const AdminInlineSpinner(size: 13) : null,
          busy: refreshing,
          actions: <Widget>[
            PeriodSelector(
              currentPeriod: active.selection.period,
              customRange: active.selection.range,
              onPeriodChanged: _changePeriod,
            ),
          ],
        ),
        _TabStrip(
          active: _active,
          onSelect: _selectTab,
          tabs: <_TabSpec>[
            _TabSpec(
              'Заведения',
              _tabCount(establishments.data?.total, totals.establishments),
            ),
            _TabSpec(
              'Пользователи',
              _tabCount(users.data?.total, totals.users),
            ),
            _TabSpec(
              'Отзывы и оценки',
              _tabCount(reviews.data?.total, totals.reviews),
            ),
          ],
        ),
        Expanded(
          child: IndexedStack(
            index: _active,
            children: const <Widget>[
              EstablishmentsAnalyticsTab(),
              UsersAnalyticsTab(),
              ReviewsAnalyticsTab(),
            ],
          ),
        ),
      ],
    );
  }

  /// Своё число вкладки всегда важнее сводного: они из разных запросов.
  static int? _tabCount(int? own, int? fromTotals) => own ?? fromTotals;

  /// «12 июля — 10 августа 2026 · сравнение с предыдущими 30 днями».
  ///
  /// Обе половины описывают ОДИН период — тот, за который посчитано лежащее на
  /// экране. Брать окно из данных, а базу сравнения из выбора нельзя: после
  /// неудачного обновления они разъезжаются, и подпись начинает утверждать
  /// невозможное — тридцатидневное окно, посчитанное к предыдущим семи дням.
  ///
  /// Окно берётся из ответа, а не считается здесь. Пока ответа нет, остаётся
  /// одна вторая половина: подпись не должна исчезать целиком — заголовок без
  /// неё центрируется по вертикали и прыгает при каждой загрузке.
  String _subtitle(AnalyticsTabProvider active) {
    final loaded = active.loadedSelection;
    final window = _window(active.data);
    if (loaded == null || window == null) {
      return active.selection.comparisonLabel;
    }

    // Обновление не удалось: выбран один период, показан другой. Промолчать
    // здесь — значит выдать старые числа за ответ на новый вопрос.
    if (active.isStale && active.error != null) {
      return '$window · не удалось обновить';
    }

    return '$window · ${loaded.comparisonLabel}';
  }

  static String? _window(Object? data) {
    final period = switch (data) {
      EstablishmentsAnalyticsData d => d.period,
      UsersAnalyticsData d => d.period,
      ReviewsAnalyticsData d => d.period,
      _ => null,
    };
    if (period == null) return null;
    return formatPeriodRangeUtc(period.start, period.lastDay);
  }
}

class _TabSpec {
  final String label;
  final int? count;

  const _TabSpec(this.label, this.count);
}

/// Полоса вкладок раздела: подпись, итог рядом, подчёркивание у активной.
///
/// Не `TabBar`: у материального индикатора своя геометрия и свои отступы, а
/// кадр просит подчёркивание 2px вровень с нижней границей полосы и итог
/// приглушённым числом рядом с названием.
class _TabStrip extends StatelessWidget {
  final int active;
  final ValueChanged<int> onSelect;
  final List<_TabSpec> tabs;

  const _TabStrip({
    required this.active,
    required this.onSelect,
    required this.tabs,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppTheme.borderLight)),
      ),
      // Прокрутка вместо переполнения: три названия с числами не влезают в
      // тело уже ниже, чем ломается шапка, но резать их многоточием хуже —
      // «Отзывы и о…» перестаёт быть названием раздела.
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            for (var i = 0; i < tabs.length; i++)
              Padding(
                padding: EdgeInsets.only(left: i == 0 ? 0 : 26),
                child: _Tab(
                  spec: tabs[i],
                  selected: i == active,
                  onTap: () => onSelect(i),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  final _TabSpec spec;
  final bool selected;
  final VoidCallback onTap;

  const _Tab({
    required this.spec,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final count = spec.count;

    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        // Подчёркивание должно совпасть с нижней границей полосы, а не встать
        // над ней: −1 накрывает её собой.
        child: Container(
          padding: const EdgeInsets.fromLTRB(0, 15, 0, 13),
          transform: Matrix4.translationValues(0, 1, 0),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: selected ? AppTheme.primaryOrange : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            spacing: 7,
            children: [
              Text(
                spec.label,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                  color: selected
                      ? AppTheme.primaryOrangeDark
                      : AppTheme.textDark,
                ),
              ),
              if (count != null)
                Text(
                  formatCount(count),
                  style: TextStyle(
                    fontSize: 12,
                    color: selected
                        ? AppTheme.textSecondary
                        : AppTheme.textGrey,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
