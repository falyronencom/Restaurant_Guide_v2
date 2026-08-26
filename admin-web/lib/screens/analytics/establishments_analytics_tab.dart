import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/analytics_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/establishments_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/analytics_tab_scaffold.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/analytics_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/canon_line_chart.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/ranked_bar_list.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/share_bar.dart';

/// Вкладка «Заведения» — кадр 08.
class EstablishmentsAnalyticsTab extends StatelessWidget {
  const EstablishmentsAnalyticsTab({super.key});

  /// Категорий в каталоге пятнадцать, в карточку помещается девять. Обрезка
  /// осознанная: карточка отвечает на вопрос «чего в каталоге больше», и
  /// хвост из единичных категорий на него не отвечает. Сколько скрыто —
  /// сказано сноской, молчаливого усечения нет.
  static const int _categoriesShown = 9;

  /// Городов в карточку помещается шесть — просторная строка вдвое выше
  /// плотной. Ограничение обязательно: город приходит свободным текстом из
  /// кабинета партнёра, справочника у него нет, и на каталоге по Беларуси их
  /// заведомо больше шести. Без обрезки карточка не «показывала бы больше»,
  /// а рвалась лентой переполнения поперёк экрана.
  static const int _citiesShown = 6;

  static const double _chartHeight = 216;

  /// Во что помещается самая высокая карточка нижнего ряда — «По категориям»
  /// с девятью строками и сноской. Значение снято замером, а не выведено из
  /// кеглей: высота строки текста зависит от метрик шрифта, и арифметика по
  /// заявленным размерам ошиблась здесь на 21 пиксель — ровно на одну строку.
  ///
  /// В окне ровно 820px (высота кадра) содержимое на пару десятков пикселей
  /// выше видимой области, и страница прокручивается. Это осознанный размен:
  /// либо честная сноска о скрытых категориях, либо ряд впритык. Молчаливое
  /// усечение хуже прокрутки — оно читается как «в каталоге девять категорий».
  static const double _minPanelsHeight = 312;

  @override
  Widget build(BuildContext context) {
    return Consumer<EstablishmentsAnalyticsProvider>(
      builder: (context, provider, _) {
        return AnalyticsTabScaffold(
          isLoading: provider.isLoading,
          error: provider.error,
          hasData: provider.data != null,
          onRetry: provider.load,
          errorTitle: 'Статистика заведений не загрузилась',
          skeleton: const AnalyticsTabSkeleton(
            chartHeight: _chartHeight,
            panelsInRow: 3,
          ),
          builder: (context, restHeight) => _content(
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
    EstablishmentsAnalyticsData data,
    double chartHeight,
    double panelsHeight,
  ) {
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
                  icon: Icons.storefront_outlined,
                  label: 'Всего заведений',
                  value: formatCount(data.total),
                ),
              ),
              Expanded(
                child: MetricCard(
                  icon: Icons.check_circle_outline,
                  label: 'Активных',
                  value: formatCount(data.active),
                  valueNote: '${formatShare(data.active, data.total)} каталога',
                ),
              ),
              Expanded(
                child: MetricCard(
                  icon: Icons.add_business_outlined,
                  label: 'Новых за период',
                  value: formatCount(data.newInPeriod),
                  changePercent: data.changePercent,
                ),
              ),
              Expanded(
                child: MetricCard(
                  icon: Icons.pending_actions_outlined,
                  label: 'На модерации',
                  value: formatCount(data.pending),
                  // Дельты нет намеренно: очередь — остаток работы, а не рост.
                  valueNote: 'очередь на просмотр',
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          height: chartHeight,
          child: AnalyticsPanel(
            title: 'Создание заведений',
            titleGap: 12,
            expandChild: true,
            titleTrailing: const <Widget>[
              ChartLegend(
                color: AppTheme.primaryOrange,
                label: 'новые заведения, в день',
              ),
            ],
            child: CanonLineChart(
              data: data.creationTimeline,
              aggregation: data.aggregation,
              emptyMessage: 'За выбранный период заведений не создавали',
            ),
          ),
        ),
        SizedBox(
          height: panelsHeight,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AnalyticsTabScaffold.gap,
            children: <Widget>[
              Expanded(child: _StatusPanel(data: data)),
              Expanded(child: _CityPanel(data: data, shown: _citiesShown)),
              Expanded(
                child: _CategoryPanel(
                  data: data,
                  shown: _categoriesShown,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// «По статусу»: полоса долей и легенда числами.
class _StatusPanel extends StatelessWidget {
  final EstablishmentsAnalyticsData data;

  const _StatusPanel({required this.data});

  @override
  Widget build(BuildContext context) {
    // Порядок канонический, а не пришедший с бэкенда: тот сортирует по
    // убыванию количества, и шкала перекладывалась бы при каждом изменении
    // данных. Незнакомые коды дописываются в конец — потерять их нельзя,
    // иначе сумма долей молча перестанет быть целым.
    final counts = <String, int>{
      for (final key in kStatusShares.keys) key: 0,
    };
    for (final item in data.statusDistribution) {
      counts[item.label] = (counts[item.label] ?? 0) + item.count;
    }
    final total = counts.values.fold<int>(0, (a, b) => a + b);

    if (total == 0) {
      return const AnalyticsPanel(
        title: 'По статусу',
        child: PanelEmpty('В каталоге пока нет заведений'),
      );
    }

    return AnalyticsPanel(
      title: 'По статусу',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          ShareBar(
            segments: <ShareSegment>[
              for (final entry in counts.entries)
                ShareSegment(
                  color: statusShareColor(entry.key),
                  value: entry.value,
                ),
            ],
          ),
          const SizedBox(height: 14),
          Column(
            mainAxisSize: MainAxisSize.min,
            spacing: 7,
            children: <Widget>[
              for (final entry in counts.entries)
                ShareLegendRow(
                  color: statusShareColor(entry.key),
                  label: statusShareLabel(entry.key),
                  value: entry.value,
                  total: total,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// «По городу»: ранжированные полосы и вывод о концентрации.
class _CityPanel extends StatelessWidget {
  final EstablishmentsAnalyticsData data;
  final int shown;

  const _CityPanel({required this.data, required this.shown});

  @override
  Widget build(BuildContext context) {
    final cities = data.cityDistribution;

    if (cities.isEmpty) {
      return const AnalyticsPanel(
        title: 'По городу',
        child: PanelEmpty('Ни у одного заведения не указан город'),
      );
    }

    final top = cities.reduce((a, b) => a.count >= b.count ? a : b);
    final hidden = cities.length - shown;

    return AnalyticsPanel(
      title: 'По городу',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          RankedBarList.spacious(
            items: <RankedBarItem>[
              for (final city in cities)
                RankedBarItem(label: city.label, value: city.count),
            ],
            maxItems: shown,
          ),
          const SizedBox(height: 14),
          // Доля считается от всего каталога, а не от суммы по городам: у
          // заведения город может быть не указан, и тогда суммы расходятся,
          // а «52% каталога» обязано означать ровно каталог.
          PanelFootnote(
            hidden > 0
                ? '${top.label} — ${formatShare(top.count, data.total)} каталога'
                    ' · и ещё ${countWithNoun(hidden, 'город', 'города', 'городов')}'
                : '${top.label} — ${formatShare(top.count, data.total)} каталога',
            maxLines: 1,
          ),
        ],
      ),
    );
  }
}

/// «По категориям»: ранжированные полосы, плотная посадка.
class _CategoryPanel extends StatelessWidget {
  final EstablishmentsAnalyticsData data;
  final int shown;

  const _CategoryPanel({required this.data, required this.shown});

  @override
  Widget build(BuildContext context) {
    final categories = data.categoryDistribution;

    if (categories.isEmpty) {
      return const AnalyticsPanel(
        title: 'По категориям',
        child: PanelEmpty('Ни у одного заведения не указана категория'),
      );
    }

    final hidden = categories.length - shown;

    return AnalyticsPanel(
      title: 'По категориям',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          RankedBarList.dense(
            items: <RankedBarItem>[
              for (final category in categories)
                RankedBarItem(label: category.label, value: category.count),
            ],
            maxItems: shown,
          ),
          if (hidden > 0) ...<Widget>[
            const SizedBox(height: 12),
            PanelFootnote(
              'и ещё ${countWithNoun(hidden, 'категория', 'категории', 'категорий')}',
              maxLines: 1,
            ),
          ],
        ],
      ),
    );
  }
}
