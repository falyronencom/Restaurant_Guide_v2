import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Тело вкладки аналитики: отступы, состояния, арифметика высот.
///
/// Высоты рядов заданы явно, а не подобраны содержимым. Причина та же, что на
/// дашборде: внутренняя раскладка карточки метрики фиксирована, и предсказуемая
/// высота верхнего ряда позволяет отдать остаток окна графику, а не оставить
/// его болтаться в середине.
class AnalyticsTabScaffold extends StatelessWidget {
  static const double padding = 24;
  static const double gap = 16;

  /// Высота ряда метрик: рамка 1 + отступ 18 + плитка 32 + зазор 14 +
  /// число 30 + отступ 18 + рамка 1. Сноски у метрик аналитики нет — приписка
  /// стоит на базовой линии числа.
  ///
  /// Рамка входит в арифметику не для красоты: `canonCardDecoration` рисует её
  /// внутри коробки, и без этих двух пикселей карточка переполняется ровно на
  /// два — то есть на глаз почти незаметно, а в тесте падает.
  static const double metricsHeight = 114;

  final bool isLoading;
  final String? error;
  final bool hasData;
  final VoidCallback onRetry;
  final String errorTitle;
  final Widget skeleton;

  /// [restHeight] — что осталось окну под рядом метрик, без отступов и зазора.
  final Widget Function(BuildContext context, double restHeight) builder;

  const AnalyticsTabScaffold({
    super.key,
    required this.isLoading,
    required this.error,
    required this.hasData,
    required this.onRetry,
    required this.errorTitle,
    required this.skeleton,
    required this.builder,
  });

  @override
  Widget build(BuildContext context) {
    if (!hasData) {
      if (error != null) {
        return AdminErrorCard(
          title: errorTitle,
          reason: error!,
          message: 'Данные на месте — недоступна только сводка по ним. '
              'Попробуйте ещё раз через минуту.',
          onRetry: onRetry,
        );
      }
      return Padding(
        padding: const EdgeInsets.all(padding),
        child: skeleton,
      );
    }

    // Фоновое обновление приглушает содержимое, но не убирает его: числа
    // остаются читаемыми, а о загрузке сообщает полоска по кромке шапки.
    return Opacity(
      opacity: isLoading ? 0.75 : 1,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final rest = constraints.maxHeight - padding * 2 - metricsHeight - gap;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(padding),
            child: builder(context, rest),
          );
        },
      ),
    );
  }

  /// Высота нижнего ряда: остаток окна, но не меньше того, во что помещается
  /// самая высокая карточка ряда.
  static double panelsHeight(double restHeight, double chartHeight,
          {required double minimum}) =>
      math.max(minimum, restHeight - chartHeight - gap);
}

/// Скелетон вкладки: ряд метрик, полоса графика, ряд карточек.
class AnalyticsTabSkeleton extends StatelessWidget {
  /// Фиксированная высота графика — когда растёт нижний ряд (кадр 08).
  final double? chartHeight;

  /// Фиксированная высота нижнего ряда — когда растёт график (кадр 10).
  final double? panelsHeight;

  final int panelsInRow;

  /// Ровно одна из высот задана: скелетон обязан повторять ту раскладку,
  /// которая придёт. Обещав другую, он сдвигает содержимое при появлении
  /// данных — тот же довод, по которому у карточки метрики заведён отдельный
  /// флаг сноски.
  const AnalyticsTabSkeleton({
    super.key,
    this.chartHeight,
    this.panelsHeight,
    required this.panelsInRow,
  }) : assert(
          (chartHeight == null) != (panelsHeight == null),
          'фиксируется ровно один из двух блоков',
        );

  @override
  Widget build(BuildContext context) {
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
              for (var i = 0; i < 4; i++)
                Expanded(
                  child: Opacity(
                    // Последняя карточка притушена — видно, что ряд
                    // продолжается, а не обрывается.
                    opacity: i == 3 ? 0.55 : 1,
                    child: const MetricCardSkeleton(),
                  ),
                ),
            ],
          ),
        ),
        if (chartHeight != null)
          SizedBox(height: chartHeight, child: const _PanelSkeleton())
        else
          const Expanded(child: _PanelSkeleton()),
        // Нижний ряд растёт, когда фиксирован график, и наоборот. Без
        // `Expanded` в свободном случае ряд остался бы без границ по высоте,
        // а внутри карточек стоит растягивающийся блок.
        if (panelsHeight != null)
          SizedBox(height: panelsHeight, child: _panelsRow())
        else
          Expanded(child: _panelsRow()),
      ],
    );
  }

  Widget _panelsRow() => Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AnalyticsTabScaffold.gap,
        children: <Widget>[
          for (var i = 0; i < panelsInRow; i++)
            Expanded(
              child: Opacity(
                opacity: i == panelsInRow - 1 ? 0.55 : 1,
                child: const _PanelSkeleton(),
              ),
            ),
        ],
      );
}

class _PanelSkeleton extends StatelessWidget {
  const _PanelSkeleton();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SkeletonBlock(
            width: 160,
            height: 18,
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
    );
  }
}
