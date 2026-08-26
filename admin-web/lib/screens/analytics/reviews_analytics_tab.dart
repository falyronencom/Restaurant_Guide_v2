import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/reviews_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/analytics_tab_scaffold.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/analytics_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/canon_combo_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';

/// Вкладка «Отзывы и оценки» — кадр 09.
class ReviewsAnalyticsTab extends StatelessWidget {
  const ReviewsAnalyticsTab({super.key});

  static const double _chartHeight = 216;

  /// Во что помещается самая высокая карточка нижнего ряда — «Распределение
  /// оценок» с пятью строками, трёхстрочной сноской и кнопкой.
  ///
  /// Значение снято замером на самом узком рабочем теле (764 — окно 1024
  /// минус рейл), а не выведено из кеглей: арифметика по заявленным размерам
  /// ошибалась здесь дважды — на кадре 08 на целую строку, и здесь ещё на
  /// одиннадцать пикселей, когда сноске разрешили третью строку.
  static const double _minPanelsHeight = 320;

  @override
  Widget build(BuildContext context) {
    return Consumer<ReviewsAnalyticsProvider>(
      builder: (context, provider, _) {
        return AnalyticsTabScaffold(
          isLoading: provider.isLoading,
          error: provider.error,
          hasData: provider.data != null,
          onRetry: provider.load,
          errorTitle: 'Статистика отзывов не загрузилась',
          skeleton: const AnalyticsTabSkeleton(
            chartHeight: _chartHeight,
            panelsInRow: 2,
          ),
          builder: (context, restHeight) => _content(
            context,
            provider.data!,
            _chartHeight,
            AnalyticsTabScaffold.panelsHeight(
              restHeight,
              _chartHeight,
              minimum: _minPanelsHeight,
            ),
          ),
        );
      },
    );
  }

  Widget _content(
    BuildContext context,
    ReviewsAnalyticsData data,
    double chartHeight,
    double panelsHeight,
  ) {
    final stats = data.responseStats;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AnalyticsTabScaffold.gap,
      children: <Widget>[
        SizedBox(
          height: AnalyticsTabScaffold.metricsHeight,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AnalyticsTabScaffold.gap,
            children: <Widget>[
              Expanded(
                child: MetricCard(
                  icon: Icons.reviews_outlined,
                  label: 'Всего отзывов',
                  value: formatCount(data.total),
                ),
              ),
              Expanded(
                child: MetricCard(
                  icon: Icons.add_comment_outlined,
                  label: 'Новых за период',
                  value: formatCount(data.newInPeriod),
                  changePercent: data.changePercent,
                ),
              ),
              Expanded(
                child: MetricCard(
                  icon: Icons.star_outline,
                  label: 'Средняя оценка',
                  value: formatDecimal(data.averageRating),
                  // «за всё время», а не «из 5». Шкала и так очевидна, а вот
                  // срок — нет: под шапкой с периодом оценка читается как
                  // «средняя за этот месяц», тогда как это среднее по всем
                  // отзывам за всю историю. Динамику за период показывает
                  // зелёная линия на графике выше — приписка их разводит.
                  valueNote: 'за всё время',
                ),
              ),
              Expanded(
                child: MetricCard(
                  icon: Icons.reply_outlined,
                  label: 'Партнёр ответил',
                  value: formatShare(
                    stats.totalWithResponse,
                    stats.totalReviews,
                  ),
                  valueNote: countWithNoun(
                    stats.totalWithResponse,
                    'отзыв',
                    'отзыва',
                    'отзывов',
                  ),
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          height: chartHeight,
          child: AnalyticsPanel(
            title: 'Активность отзывов',
            titleGap: 12,
            expandChild: true,
            // Две метки разной формы — столбец и линия: легенда обязана
            // повторять геометрию ряда, иначе непонятно, какая шкала чья.
            titleTrailing: <Widget>[
              ChartLegend(
                color: AppTheme.primaryOrange.withValues(alpha: 0.85),
                label: 'отзывов в день — шкала слева',
                mark: LegendMark.bar,
              ),
              const ChartLegend(
                color: AppTheme.statusGreen,
                label: 'средняя оценка — шкала справа',
              ),
            ],
            child: CanonComboChart(
              data: data.reviewTimeline,
              aggregation: data.aggregation,
            ),
          ),
        ),
        SizedBox(
          height: panelsHeight,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AnalyticsTabScaffold.gap,
            children: <Widget>[
              Expanded(child: _RatingPanel(data: data)),
              Expanded(child: _ResponsePanel(stats: stats)),
            ],
          ),
        ),
      ],
    );
  }
}

/// «Распределение оценок»: звёзды, полоса, число, доля.
class _RatingPanel extends StatelessWidget {
  final ReviewsAnalyticsData data;

  const _RatingPanel({required this.data});

  @override
  Widget build(BuildContext context) {
    final dist = data.ratingDistribution;
    final total = dist.fold<int>(0, (sum, item) => sum + item.count);

    if (total == 0) {
      return const AnalyticsPanel(
        title: 'Распределение оценок',
        child: PanelEmpty('Отзывов пока нет'),
      );
    }

    final maxCount = dist.fold<int>(0, (m, i) => i.count > m ? i.count : m);
    final low = dist
        .where((item) => item.rating <= 2)
        .fold<int>(0, (sum, item) => sum + item.count);

    return AnalyticsPanel(
      title: 'Распределение оценок',
      expandChild: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Column(
            mainAxisSize: MainAxisSize.min,
            spacing: 12,
            children: <Widget>[
              // Сверху вниз от пяти звёзд к одной — так же, как их читают.
              for (final item in dist.reversed)
                _RatingRow(item: item, maxCount: maxCount, total: total),
            ],
          ),
          // Прижато к низу карточки, как в кадре: иначе под блоком остаётся
          // три десятка пикселей пустоты, а сноске не хватает строки.
          const Spacer(),
          const SizedBox(height: 14),
          Row(
            spacing: 12,
            children: <Widget>[
              Expanded(
                child: PanelFootnote(
                  _lowRatingNote(low),
                  // Три строки, а не две: при теле 764 кнопка забирает
                  // полторы сотни пикселей, и на двух строках обрезалась как
                  // раз действенная половина — «их разбирают на экране
                  // отзывов».
                  maxLines: 3,
                ),
              ),
              // Кнопка ведёт на экран, но не приносит туда отбор «1–2»:
              // фильтр оценок принимает ОДНО значение, и пункт-диапазон
              // обещал бы выборку, которой не существует.
              _OpenInReviews(onTap: () => context.go('/settings/reviews')),
            ],
          ),
        ],
      ),
    );
  }
}

/// «137 отзывов с оценкой 1–2 — их разбирают на экране отзывов».
///
/// Единственный отзыв получает своё согласование: «1 отзыв … их разбирают»
/// читается как ошибка, а не как число.
String _lowRatingNote(int low) {
  if (low == 0) return 'Отзывов с оценкой 1–2 нет';
  final subject = countWithNoun(low, 'отзыв', 'отзыва', 'отзывов');
  final verb =
      low % 10 == 1 && low % 100 != 11 ? 'его разбирают' : 'их разбирают';
  return '$subject с оценкой 1–2 — $verb на экране отзывов';
}

class _RatingRow extends StatelessWidget {
  final RatingDistributionItem item;
  final int maxCount;
  final int total;

  const _RatingRow({
    required this.item,
    required this.maxCount,
    required this.total,
  });

  @override
  Widget build(BuildContext context) {
    final fraction = maxCount > 0 ? item.count / maxCount : 0.0;

    return Row(
      spacing: 12,
      children: <Widget>[
        Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            for (var star = 1; star <= 5; star++)
              Icon(
                Icons.star,
                size: 14,
                color: star <= item.rating
                    ? AppTheme.primaryOrange
                    : AppTheme.strokeGrey,
              ),
          ],
        ),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Container(
              height: 16,
              color: AppTheme.backgroundWarm,
              child: FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: fraction,
                child: const ColoredBox(color: AppTheme.primaryOrange),
              ),
            ),
          ),
        ),
        SizedBox(
          // Ширина под пятизначное «12 400» и `maxLines`: без них число
          // переносится на вторую строку, строка распределения растёт, и
          // карточка фиксированной высоты рвётся лентой переполнения.
          width: 54,
          child: Text(
            formatCount(item.count),
            textAlign: TextAlign.right,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppTheme.textPrimary,
            ),
          ),
        ),
        SizedBox(
          width: 46,
          child: Text(
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            // Доля считается здесь, а не берётся из `percentage` ответа:
            // там она подгоняется до ровных ста процентов правкой самой
            // крупной доли, и число в строке разошлось бы с делением,
            // которое читатель может выполнить сам.
            formatShare(item.count, total),
            textAlign: TextAlign.right,
            style: const TextStyle(fontSize: 12, color: AppTheme.textGrey),
          ),
        ),
      ],
    );
  }
}

class _OpenInReviews extends StatelessWidget {
  final VoidCallback onTap;

  const _OpenInReviews({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.radiusControl),
        onTap: onTap,
        child: Container(
          height: 34,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            border: Border.all(color: AppTheme.strokeGrey),
            borderRadius: BorderRadius.circular(AppTheme.radiusControl),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            spacing: 7,
            children: <Widget>[
              Text(
                'Открыть в отзывах',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textDark,
                ),
              ),
              Icon(Icons.arrow_forward, size: 16, color: AppTheme.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

/// «Ответы партнёров»: врезка с долей и три строки фактов.
class _ResponsePanel extends StatelessWidget {
  final ResponseStats stats;

  const _ResponsePanel({required this.stats});

  @override
  Widget build(BuildContext context) {
    if (stats.totalReviews == 0) {
      return const AnalyticsPanel(
        title: 'Ответы партнёров',
        child: PanelEmpty('Отвечать пока не на что'),
      );
    }

    final share = stats.totalWithResponse / stats.totalReviews;

    return AnalyticsPanel(
      title: 'Ответы партнёров',
      expandChild: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Container(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            decoration: AppTheme.canonPanelDecoration(
              radius: AppTheme.radiusMedium,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  spacing: 8,
                  children: <Widget>[
                    Text(
                      formatCount(stats.totalWithResponse),
                      style: AppTheme.canonMetricValue.copyWith(fontSize: 22),
                    ),
                    Expanded(
                      child: Text(
                        'из ${formatCount(stats.totalReviews)} отзывов '
                        'получили ответ',
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppTheme.textSecondary,
                        ),
                        maxLines: 2,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                ClipRRect(
                  borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
                  child: Container(
                    height: 8,
                    color: AppTheme.backgroundPrimary,
                    child: FractionallySizedBox(
                      alignment: Alignment.centerLeft,
                      widthFactor: share,
                      child: const ColoredBox(color: AppTheme.primaryOrange),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          _StatRow(
            icon: Icons.percent,
            label: 'Доля отзывов с ответом',
            value: formatShare(stats.totalWithResponse, stats.totalReviews),
          ),
          _StatRow(
            icon: Icons.schedule,
            label: 'Среднее время ответа',
            value: _formatHours(stats.avgResponseTimeHours),
          ),
          _StatRow(
            icon: Icons.mark_chat_unread_outlined,
            label: 'Отзывов без ответа',
            value: formatCount(stats.totalWithoutResponse),
            last: true,
          ),
          const Spacer(),
          const SizedBox(height: 14),
          // Вывод, а не пересказ трёх строк выше: числа отвечают «сколько»,
          // сноска — «и что это значит». Есть в кадре, и был пропущен.
          PanelFootnote(_responseVerdict(stats)),
        ],
      ),
    );
  }

  /// «18,4 ч», «45 мин», «2,1 д» — с русской запятой.
  static String _formatHours(double hours) {
    if (hours <= 0) return '—';
    if (hours < 1) {
      final minutes = (hours * 60).round();
      // 0,996 ч округляется до шестидесяти минут — это уже час.
      if (minutes >= 60) return '${formatDecimal(1)} ч';
      return '$minutes мин';
    }
    if (hours < 24) return '${formatDecimal(hours)} ч';
    return '${formatDecimal(hours / 24)} д';
  }

  /// «Партнёры отвечают в среднем за 18 часов, но только на каждый четвёртый
  /// отзыв».
  ///
  /// Порядковое числительное считается из доли, а не пишется руками: «каждый
  /// четвёртый» при 23% верно, а при 60% было бы враньём. Когда доля такова,
  /// что порядковое перестаёт читаться, фраза сворачивается к проценту.
  static String _responseVerdict(ResponseStats stats) {
    final hours = stats.avgResponseTimeHours;
    final answered = stats.totalWithResponse;

    if (answered == 0) return 'Ни на один отзыв партнёры пока не ответили';

    final pace = hours <= 0
        ? 'Партнёры отвечают'
        : hours < 1
            ? 'Партнёры отвечают в среднем за ${(hours * 60).round()} минут'
            : hours < 24
                ? 'Партнёры отвечают в среднем за '
                    '${countWithNoun(hours.round(), 'час', 'часа', 'часов')}'
                : 'Партнёры отвечают в среднем за '
                    '${countWithNoun((hours / 24).round(), 'день', 'дня', 'дней')}';

    const ordinals = <int, String>{
      2: 'второй',
      3: 'третий',
      4: 'четвёртый',
      5: 'пятый',
      6: 'шестой',
      7: 'седьмой',
      8: 'восьмой',
      9: 'девятый',
      10: 'десятый',
    };
    final ordinal = ordinals[(stats.totalReviews / answered).round()];

    if (ordinal == null) {
      return '$pace — на ${formatShare(answered, stats.totalReviews)} отзывов';
    }
    return '$pace, но только на каждый $ordinal отзыв';
  }
}

class _StatRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool last;

  const _StatRow({
    required this.icon,
    required this.label,
    required this.value,
    this.last = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: last
          ? null
          : const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppTheme.borderLight)),
            ),
      child: Row(
        spacing: 10,
        children: <Widget>[
          Icon(icon, size: 18, color: AppTheme.textGrey),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 13,
                color: AppTheme.textSecondary,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(
            value,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: AppTheme.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}
