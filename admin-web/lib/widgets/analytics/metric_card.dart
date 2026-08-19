import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Карточка метрики дашборда — инструментальная, белая с тёплой тенью.
///
/// Устройство сверху вниз: плитка иконки и лейбл, крупное число с дельтой
/// на одной базовой линии, сноска. Дельта и сноска отвечают на разные
/// вопросы: дельта — «куда движется», сноска — «что за этим стоит прямо
/// сейчас» («7 ожидают модерации»).
///
/// У метрики может не быть дельты вовсе: «Модерация» показывает размер
/// очереди, и сравнивать её с прошлым периодом бессмысленно — там уместна
/// нейтральная приписка [valueNote] («в очереди»), а не выдуманный процент.
class MetricCard extends StatelessWidget {
  /// Material-глиф. Взаимоисключающ с [brandIcon].
  final IconData? icon;

  /// Имя файла брендовой иконки без расширения — «restaurant», «cafe».
  /// Перекрашивается в брендовый тёмный, поэтому контур должен быть
  /// одноцветным.
  final String? brandIcon;

  final String label;
  final String value;

  /// Процент изменения к прошлому периоду. null — дельты нет.
  final double? changePercent;

  /// Нейтральная приписка вместо дельты.
  final String? valueNote;

  final String? footnote;

  const MetricCard({
    super.key,
    this.icon,
    this.brandIcon,
    required this.label,
    required this.value,
    this.changePercent,
    this.valueNote,
    this.footnote,
  }) : assert(
          (icon == null) != (brandIcon == null),
          'нужен ровно один источник иконки',
        );

  @override
  Widget build(BuildContext context) {
    final note = footnote;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            spacing: 10,
            children: [
              _IconTile(icon: icon, brandIcon: brandIcon),
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  style: AppTheme.canonMetricLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            spacing: 9,
            children: [
              Flexible(
                child: Text(
                  value,
                  style: AppTheme.canonMetricValue,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              _trailing(),
            ],
          ),
          if (note != null) ...[
            const SizedBox(height: 8),
            Text(
              note,
              style: const TextStyle(
                fontSize: 12,
                color: AppTheme.textTertiary,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }

  Widget _trailing() {
    final delta = changePercent;
    final note = valueNote;

    if (delta != null) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 3),
        child: Text(
          formatDelta(delta),
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: delta == 0
                ? AppTheme.textGrey
                : delta > 0
                    ? AppTheme.statusGreen
                    : AppTheme.errorRed,
          ),
        ),
      );
    }

    if (note != null) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Text(
          note,
          style: const TextStyle(fontSize: 12, color: AppTheme.textGrey),
        ),
      );
    }

    return const SizedBox.shrink();
  }
}

/// Плитка 32×32 на бежевом с иконкой брендового тёмного цвета.
class _IconTile extends StatelessWidget {
  final IconData? icon;
  final String? brandIcon;

  const _IconTile({this.icon, this.brandIcon});

  @override
  Widget build(BuildContext context) {
    final name = brandIcon;

    return Container(
      width: 32,
      height: 32,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppTheme.backgroundWarm,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: name != null
          ? SvgPicture.asset(
              'assets/icons/$name.svg',
              width: 17,
              height: 17,
              colorFilter: const ColorFilter.mode(
                AppTheme.primaryOrangeDark,
                BlendMode.srcIn,
              ),
            )
          : Icon(icon, size: 18, color: AppTheme.primaryOrangeDark),
    );
  }
}
