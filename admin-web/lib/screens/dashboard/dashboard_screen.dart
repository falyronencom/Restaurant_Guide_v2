import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/quality_signals.dart';
import 'package:restaurant_guide_admin_web/models/admin_badges.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/dashboard_provider.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/analytics_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/canon_bar_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/chart_scale.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/dashboard/attention_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_inline_spinner.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Панель управления — обзор платформы.
///
/// Раскладка редизайна: ряд из четырёх метрик, под ним график регистраций и
/// панель «Требует внимания» шириной 320. Панель отвечает на другой вопрос,
/// чем метрики: не «сколько всего», а «за что браться сейчас».
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late final DashboardProvider _provider;

  /// Сбой обновления при числах на экране — тостом (пункт A3-02).
  final _refreshFailure = AdminErrorToastReporter();

  /// Высота ряда метрик. Задана явно, а не подобрана содержимым: внутренняя
  /// раскладка карточки фиксирована (18 + 32 + 14 + 30 + 8 + 16 + 18), а
  /// предсказуемая высота позволяет отдать графику весь остаток окна.
  static const double _metricsRowHeight = 140;
  static const double _minChartRowHeight = 360;
  static const double _bodyPadding = 24;
  static const double _rowGap = 20;
  static const double _attentionWidth = 320;

  /// Уже этого тела график рядом с панелью «Требует внимания» сжимается в
  /// полоску, и панель уходит под него. 760 — тело окна 1024 (минимум окна,
  /// решение Координатора 20.10, А): график там ещё шириной около 380.
  static const double _sideBySideMinWidth = 760;
  static const double _stackedAttentionHeight = 300;

  /// «+3 за период».
  static String _newInPeriod(int count) => '+${formatCount(count)} за период';

  @override
  void initState() {
    super.initState();
    _provider = context.read<DashboardProvider>();
    _provider.addListener(_onProviderChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DashboardProvider>().loadDashboard();
      // Строка «Сигналов здоровья данных» считается по тому же снимку, что
      // рисует экран «Здоровье данных». Отдельного счётчика для неё нет и не
      // будет: получить «сколько проверок красные» нельзя, не выполнив все
      // одиннадцать, а вешать это на /admin/badges значило бы пересчитывать
      // достижимость каталога после каждого действия модератора. Клиентского
      // кэша у провайдера нет: запрос уходит при каждом монтировании дашборда, а
      // от повторного скана каталога спасает двухминутный снимок на сервере.
      context.read<QualityHealthProvider>().load();
    });
  }

  @override
  void dispose() {
    _provider.removeListener(_onProviderChanged);
    _refreshFailure.dispose();
    super.dispose();
  }

  void _onProviderChanged() {
    final error = _provider.overview == null ? null : _provider.error;
    _refreshFailure.report(
      this,
      key: error,
      title: 'Обзор не обновился',
      message: '${asSentence(error ?? '')} '
          '${_provider.isStale ? 'На экране остались числа за прежний период.' : 'На экране остались числа прошлой загрузки.'}',
      onRetry: _provider.loadDashboard,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<DashboardProvider>(
      builder: (context, provider, _) {
        final hasData = provider.overview != null;
        final refreshing = provider.isLoading && hasData;

        return Column(
          children: [
            AdminScreenHeader(
              title: 'Панель управления',
              subtitle: refreshing ? 'обновляем' : _subtitle(provider),
              subtitleLeading:
                  refreshing ? const AdminInlineSpinner(size: 13) : null,
              busy: refreshing,
              actions: [
                PeriodSelector(
                  currentPeriod: provider.period,
                  customRange: provider.selection.range,
                  onPeriodChanged: provider.loadDashboard,
                ),
              ],
            ),
            Expanded(child: _body(context, provider, refreshing)),
          ],
        );
      },
    );
  }

  /// Подпись описывает числа НА ЭКРАНЕ: после неудачной смены периода — их
  /// прежний период и честное «не удалось обновить».
  String _subtitle(DashboardProvider provider) {
    if (provider.isStale && provider.error != null) {
      final loaded = provider.loadedSelection?.period ?? provider.period;
      return 'Обзор платформы · сравнение с ${_previousPeriodLabel(loaded)} '
          '· не удалось обновить';
    }
    return 'Обзор платформы · сравнение с ${_previousPeriodLabel(provider.period)}';
  }

  Widget _body(
    BuildContext context,
    DashboardProvider provider,
    bool refreshing,
  ) {
    if (provider.overview == null) {
      if (provider.error != null) {
        return AdminErrorCard(
          title: 'Обзор не загрузился',
          reason: provider.error!,
          message: 'Данные на месте — недоступна только сводка по ним. '
              'Попробуйте ещё раз через минуту.',
          onRetry: provider.loadDashboard,
        );
      }
      return const _DashboardSkeleton(
        metricsRowHeight: _metricsRowHeight,
        minChartRowHeight: _minChartRowHeight,
        bodyPadding: _bodyPadding,
        rowGap: _rowGap,
        attentionWidth: _attentionWidth,
      );
    }

    // Фоновое обновление приглушает содержимое, но не убирает его: данные
    // остаются читаемыми, работа не сбрасывается.
    return Opacity(
      opacity: refreshing ? 0.75 : 1,
      child: _content(context, provider),
    );
  }

  Widget _content(BuildContext context, DashboardProvider provider) {
    final ov = provider.overview!;

    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 900;
        final metricsHeight =
            wide ? _metricsRowHeight : _metricsRowHeight * 2 + 16;
        final chartRowHeight = math.max(
          _minChartRowHeight,
          constraints.maxHeight - _bodyPadding * 2 - _rowGap - metricsHeight,
        );

        // Процента на плитках главной нет (решение Координатора 20.10, В):
        // крупное число — итог, а процент считался от НОВЫХ за период, и
        // «Пользователи 37 ↓100 %» читалось как обвал всей базы (Ч4, F-19,
        // A3-17). Под числом — «+N за период»; процент остаётся в аналитике,
        // где стоит у самого числа новых.
        final cards = <Widget>[
          MetricCard(
            icon: Icons.group_outlined,
            label: 'Пользователи',
            value: formatCount(ov.users.total),
            footnote: _newInPeriod(ov.users.newInPeriod),
          ),
          MetricCard(
            brandIcon: 'restaurant',
            // «Активные», а не «Заведения»: число — опубликованные карточки;
            // в аналитике оно стоит под тем же словом рядом со «Всего
            // заведений» всех статусов (Ч3).
            label: 'Активные заведения',
            value: formatCount(ov.establishments.active),
            footnote: _newInPeriod(ov.establishments.newInPeriod),
          ),
          MetricCard(
            icon: Icons.star_outline,
            label: 'Отзывы',
            value: formatCount(ov.reviews.total),
            footnote: '${_newInPeriod(ov.reviews.newInPeriod)} · средняя '
                '${formatDecimal(ov.reviews.averageRating)}',
          ),
          MetricCard(
            icon: Icons.shield_outlined,
            label: 'Модерация',
            value: formatCount(ov.moderation.pendingCount),
            // Дельты нет намеренно: очередь — это остаток работы, а не
            // показатель роста. Сравнивать её с прошлым периодом бессмысленно.
            valueNote: 'в очереди',
            // Решения модератора по заведениям: одобрения, отклонения,
            // приостановки и возобновления (A3-18). Пауза партнёра и
            // приостановка системой решениями модератора не считаются.
            footnote: '${countWithNoun(
              ov.moderation.actionsInPeriod,
              'решение',
              'решения',
              'решений',
            )} за период',
          ),
        ];

        final chart = _ChartCard(
          data: provider.registrationTimeline,
          aggregation: provider.aggregation,
        );
        final attention = AttentionPanel(
          items: _attention(
            context,
            ov,
            context.watch<BadgesProvider>().badges,
            context.watch<QualityHealthProvider>().data,
          ),
        );

        return SingleChildScrollView(
          padding: const EdgeInsets.all(_bodyPadding),
          child: Column(
            children: [
              SizedBox(
                height: metricsHeight,
                child: wide ? _row(cards) : _grid2x2(cards),
              ),
              const SizedBox(height: _rowGap),
              if (constraints.maxWidth >= _sideBySideMinWidth)
                SizedBox(
                  height: chartRowHeight,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    spacing: 16,
                    children: [
                      Expanded(child: chart),
                      SizedBox(width: _attentionWidth, child: attention),
                    ],
                  ),
                )
              else ...[
                // Узко: график не ужимается в полоску рядом с панелью, а
                // панель встаёт под ним во всю ширину (A3-12).
                SizedBox(height: _minChartRowHeight, child: chart),
                const SizedBox(height: _rowGap),
                SizedBox(height: _stackedAttentionHeight, child: attention),
              ],
            ],
          ),
        );
      },
    );
  }

  /// Три строки из четырёх, нарисованных в макете.
  ///
  /// **Строка «Сигналов здоровья данных» получила определение** (решение
  /// владельца, 27.08.2026): сигнал — это красная карточка экрана «Здоровье
  /// данных», то есть проверка со счётчиком больше нуля; знаменатель — набор
  /// карточек того экрана. Форма выбрана так, что число здесь не может
  /// разойтись с числом там: считает один и тот же список
  /// `config/quality_signals.dart`. Подпись — первая красная проверка в
  /// каноническом порядке, ровно как в макете («3 недостижимы в sitemap» при
  /// том, что двенадцать флагов больше).
  ///
  /// **Четвёртой строки — «Отзывов на разбор» — не будет.** Механизма жалоб в
  /// системе нет: ни таблицы, ни колонки, ни эндпоинта. Косвенная метрика
  /// вроде «низкая оценка без ответа партнёра» поставила бы перед админом
  /// список честных единиц и двоек, а действий у него над отзывом ровно два —
  /// скрыть или удалить. Такая очередь зовёт гасить обратную связь.
  List<AttentionItem> _attention(
    BuildContext context,
    OverviewData ov,
    AdminBadges? badges,
    QualityHealthData? health,
  ) {
    final oldestDays = ov.moderation.oldestPendingDays;
    final red = health == null ? const <QualitySignal>[] : redSignals(health);

    return <AttentionItem>[
      AttentionItem(
        count: ov.moderation.pendingCount,
        title: 'Заявок на модерации',
        note: oldestDays == null
            ? null
            : 'старейшая ждёт ${countWithNoun(oldestDays, 'день', 'дня', 'дней')}',
        onTap: () => context.go('/moderation/pending'),
      ),
      if (badges != null)
        AttentionItem(
          count: badges.menuFlags,
          title: 'Флагов в позициях меню',
          note: badges.menuFlagsAgedOver7d > 0
              ? '${badges.menuFlagsAgedOver7d} старше 7 дней'
              : null,
          onTap: () => context.go('/moderation/menu-items'),
        ),
      // Снимок ещё не пришёл — строки нет вовсе. Ноль в ней читался бы как
      // «проверено, чисто», а проверено пока ничего.
      // Подпись называет ВСЕ красные проверки, а не первую: главная молчала
      // об «Ошибках распознавания 5», когда первыми шли флаги (Ч7).
      if (health != null)
        AttentionItem(
          count: red.length,
          title: 'Сигналов здоровья данных',
          note: red.isEmpty
              ? null
              : red.map((s) => s.note(s.countOf(health))).join(' · '),
          tone: AttentionTone.critical,
          onTap: () => context.go('/quality/health'),
        ),
    ];
  }

  Widget _row(List<Widget> cards) => Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 16,
        children: [for (final c in cards) Expanded(child: c)],
      );

  Widget _grid2x2(List<Widget> cards) => Column(
        spacing: 16,
        children: [
          Expanded(child: _row(cards.sublist(0, 2))),
          Expanded(child: _row(cards.sublist(2))),
        ],
      );

  String _previousPeriodLabel(String period) => switch (period) {
        '7d' => 'предыдущими 7 днями',
        '30d' => 'предыдущими 30 днями',
        '90d' => 'предыдущими 90 днями',
        _ => 'предыдущим периодом',
      };
}

/// Карточка графика регистраций.
class _ChartCard extends StatelessWidget {
  final List data;
  final String aggregation;

  const _ChartCard({required this.data, required this.aggregation});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            spacing: 12,
            children: [
              const Expanded(
                child: Text(
                  'Регистрации пользователей',
                  style: AppTheme.canonSheetTitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              ChartLegend(
                color: AppTheme.primaryOrange,
                mark: LegendMark.bar,
                label: 'новые ${perBucketLabel(aggregation)}',
              ),
            ],
          ),
          const SizedBox(height: 14),
          Expanded(
            child: CanonBarChart(
              data: data.cast(),
              aggregation: aggregation,
            ),
          ),
        ],
      ),
    );
  }
}

/// Скелетон дашборда: повторяет ту раскладку, которая придёт.
///
/// Шапка экрана в него не входит — она уже нарисована и мигать ей незачем.
class _DashboardSkeleton extends StatelessWidget {
  final double metricsRowHeight;
  final double minChartRowHeight;
  final double bodyPadding;
  final double rowGap;
  final double attentionWidth;

  const _DashboardSkeleton({
    required this.metricsRowHeight,
    required this.minChartRowHeight,
    required this.bodyPadding,
    required this.rowGap,
    required this.attentionWidth,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final chartRowHeight = math.max(
          minChartRowHeight,
          constraints.maxHeight - bodyPadding * 2 - rowGap - metricsRowHeight,
        );

        return Padding(
          padding: EdgeInsets.all(bodyPadding),
          child: Column(
            children: [
              SizedBox(
                height: metricsRowHeight,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  spacing: 16,
                  children: [
                    for (var i = 0; i < 4; i++)
                      Expanded(
                        child: Opacity(
                          // Последняя карточка притушена — видно, что ряд
                          // продолжается, а не обрывается.
                          opacity: i == 3 ? 0.55 : 1,
                          child: const _MetricSkeleton(),
                        ),
                      ),
                  ],
                ),
              ),
              SizedBox(height: rowGap),
              SizedBox(
                height: chartRowHeight,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  spacing: 16,
                  children: [
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.all(18),
                        decoration: AppTheme.canonCardDecoration(),
                        child: const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SkeletonBlock(
                              width: 260,
                              height: 24,
                              radius: 8,
                              shade: SkeletonShade.strong,
                            ),
                            SizedBox(height: 14),
                            Expanded(
                              child: SkeletonBlock(
                                widthFactor: 1,
                                height: double.infinity,
                                radius: 12,
                                shade: SkeletonShade.weak,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    SizedBox(
                      width: attentionWidth,
                      child: Container(
                        padding: const EdgeInsets.all(18),
                        decoration: AppTheme.canonPanelDecoration(
                          radius: AppTheme.radiusMedium,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const SkeletonBlock(
                              width: 170,
                              height: 18,
                              shade: SkeletonShade.strong,
                            ),
                            const SizedBox(height: 12),
                            for (var i = 0; i < 4; i++) ...[
                              Opacity(
                                opacity: i == 3 ? 0.55 : 1,
                                child: Container(
                                  height: 54,
                                  decoration: BoxDecoration(
                                    color: AppTheme.backgroundPrimary,
                                    borderRadius: BorderRadius.circular(
                                      AppTheme.radiusControl,
                                    ),
                                  ),
                                ),
                              ),
                              if (i < 3) const SizedBox(height: 8),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _MetricSkeleton extends StatelessWidget {
  const _MetricSkeleton();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            spacing: 10,
            children: [
              SkeletonBlock(
                width: 32,
                height: 32,
                radius: 8,
                shade: SkeletonShade.strong,
              ),
              Expanded(
                child: SkeletonBlock(widthFactor: 0.7, height: 11),
              ),
            ],
          ),
          SizedBox(height: 14),
          SkeletonBlock(
            width: 96,
            height: 30,
            radius: 8,
            shade: SkeletonShade.strong,
          ),
          SizedBox(height: 8),
          SkeletonBlock(
              widthFactor: 0.55, height: 11, shade: SkeletonShade.weak),
        ],
      ),
    );
  }
}
