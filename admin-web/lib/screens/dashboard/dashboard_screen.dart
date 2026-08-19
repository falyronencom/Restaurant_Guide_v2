import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/dashboard_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/canon_line_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/dashboard/attention_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_card.dart';
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
  /// Высота ряда метрик. Задана явно, а не подобрана содержимым: внутренняя
  /// раскладка карточки фиксирована (18 + 32 + 14 + 30 + 8 + 16 + 18), а
  /// предсказуемая высота позволяет отдать графику весь остаток окна.
  static const double _metricsRowHeight = 140;
  static const double _minChartRowHeight = 360;
  static const double _bodyPadding = 24;
  static const double _rowGap = 20;
  static const double _attentionWidth = 320;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DashboardProvider>().loadDashboard();
    });
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
              subtitle: refreshing
                  ? 'обновляем'
                  : 'Обзор платформы · сравнение с ${_previousPeriodLabel(provider.period)}',
              subtitleLeading: refreshing
                  ? const AdminInlineSpinner(size: 13)
                  : null,
              busy: refreshing,
              actions: [
                PeriodSelector(
                  currentPeriod: provider.period,
                  onPeriodChanged: (selection) => provider.loadDashboard(
                    period: selection.period,
                    from: selection.from?.toIso8601String(),
                    to: selection.to?.toIso8601String(),
                  ),
                ),
              ],
            ),
            Expanded(child: _body(context, provider, refreshing)),
          ],
        );
      },
    );
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

        final cards = <Widget>[
          MetricCard(
            icon: Icons.group_outlined,
            label: 'Пользователи',
            value: formatCount(ov.users.total),
            changePercent: ov.users.changePercent,
            footnote: '+${formatCount(ov.users.newInPeriod)} за период',
          ),
          MetricCard(
            brandIcon: 'restaurant',
            label: 'Заведения',
            value: formatCount(ov.establishments.active),
            changePercent: ov.establishments.changePercent,
            footnote: '${formatCount(ov.establishments.pending)} '
                '${plural(ov.establishments.pending, 'ожидает', 'ожидают', 'ожидают')} модерации',
          ),
          MetricCard(
            icon: Icons.star_outline,
            label: 'Отзывы',
            value: formatCount(ov.reviews.total),
            changePercent: ov.reviews.changePercent,
            footnote:
                'Средняя оценка ${formatDecimal(ov.reviews.averageRating)}',
          ),
          MetricCard(
            icon: Icons.shield_outlined,
            label: 'Модерация',
            value: formatCount(ov.moderation.pendingCount),
            // Дельты нет намеренно: очередь — это остаток работы, а не
            // показатель роста. Сравнивать её с прошлым периодом бессмысленно.
            valueNote: 'в очереди',
            footnote: countWithNoun(
              ov.moderation.actionsInPeriod,
              'действие',
              'действия',
              'действий',
            ),
          ),
        ];

        return SingleChildScrollView(
          padding: const EdgeInsets.all(_bodyPadding),
          child: Column(
            children: [
              SizedBox(
                height: metricsHeight,
                child: wide ? _row(cards) : _grid2x2(cards),
              ),
              const SizedBox(height: _rowGap),
              SizedBox(
                height: chartRowHeight,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  spacing: 16,
                  children: [
                    Expanded(
                      child: _ChartCard(
                        data: provider.registrationTimeline,
                        aggregation: provider.aggregation,
                      ),
                    ),
                    SizedBox(
                      width: _attentionWidth,
                      child: AttentionPanel(items: _attention(context, ov)),
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

  /// Пока доступна одна строка из четырёх, нарисованных в макете.
  ///
  /// Остальные три требуют счётчиков, которых `/admin/analytics/overview` не
  /// отдаёт: флаги позиций меню, сигналы здоровья данных, отзывы на разбор.
  /// Подпись «старейшая ждёт N дней» требует `oldest_pending_at`. Ни то ни
  /// другое не заполняется приблизительным значением — строки просто нет.
  List<AttentionItem> _attention(BuildContext context, dynamic ov) {
    return <AttentionItem>[
      AttentionItem(
        count: ov.moderation.pendingCount as int,
        title: 'Заявок на модерации',
        onTap: () => context.go('/moderation/pending'),
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
              Expanded(
                child: Text(
                  'Регистрации пользователей',
                  style: AppTheme.canonSheetTitle,
                ),
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                spacing: 6,
                children: [
                  Container(
                    width: 9,
                    height: 9,
                    decoration: const BoxDecoration(
                      color: AppTheme.primaryOrange,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const Text(
                    'новые за день',
                    style: TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 14),
          Expanded(
            child: CanonLineChart(
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
          SkeletonBlock(widthFactor: 0.55, height: 11, shade: SkeletonShade.weak),
        ],
      ),
    );
  }
}
