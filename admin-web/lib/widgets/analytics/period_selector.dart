import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Сегмент-контрол периода: «7 дней · 30 дней · 90 дней · Период».
///
/// Живёт в слоте действий шапки экрана, а не в теле — период относится ко
/// всему разделу, а не к отдельной вкладке или карточке.
///
/// Раньше это был ряд отдельных чипов-пилюль. Разница не косметическая:
/// сегмент-контрол показывает, что варианты взаимоисключающие и вместе
/// образуют одну шкалу, а россыпь чипов читается как независимые фильтры.
class PeriodSelector extends StatefulWidget {
  final String currentPeriod;
  final ValueChanged<PeriodSelection> onPeriodChanged;

  const PeriodSelector({
    super.key,
    required this.currentPeriod,
    required this.onPeriodChanged,
  });

  @override
  State<PeriodSelector> createState() => _PeriodSelectorState();
}

class _PeriodSelectorState extends State<PeriodSelector> {
  static const _periods = <(String, String)>[
    ('7d', '7 дней'),
    ('30d', '30 дней'),
    ('90d', '90 дней'),
    ('custom', 'Период'),
  ];

  DateTimeRange? _customRange;

  @override
  Widget build(BuildContext context) {
    final range = _customRange;
    final showRange = widget.currentPeriod == 'custom' && range != null;

    return Row(
      mainAxisSize: MainAxisSize.min,
      spacing: 10,
      children: [
        if (showRange)
          Text(
            '${_formatDate(range.start)} — ${_formatDate(range.end)}',
            style: const TextStyle(
              fontSize: 12,
              color: AppTheme.textSecondary,
            ),
          ),
        Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            color: AppTheme.backgroundWarm,
            borderRadius: BorderRadius.circular(AppTheme.radiusControl),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            spacing: 2,
            children: [
              for (final (code, label) in _periods)
                _Segment(
                  label: label,
                  selected: widget.currentPeriod == code,
                  onTap: () => _onSelect(code),
                ),
            ],
          ),
        ),
      ],
    );
  }

  void _onSelect(String code) {
    if (code == 'custom') {
      _showDateRangePicker();
    } else {
      widget.onPeriodChanged(PeriodSelection(period: code));
    }
  }

  Future<void> _showDateRangePicker() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: now,
      initialDateRange: _customRange ??
          DateTimeRange(
            start: now.subtract(const Duration(days: 30)),
            end: now,
          ),
      locale: const Locale('ru'),
    );

    if (picked == null) return;

    setState(() => _customRange = picked);
    widget.onPeriodChanged(PeriodSelection(
      period: 'custom',
      from: picked.start,
      to: picked.end,
    ));
  }

  String _formatDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}.'
      '${d.month.toString().padLeft(2, '0')}.${d.year}';
}

class _Segment extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Segment({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppTheme.radiusSmall);

    return DecoratedBox(
      decoration: selected
          ? BoxDecoration(
              color: AppTheme.backgroundPrimary,
              borderRadius: radius,
              boxShadow: AppTheme.segmentActiveShadow,
            )
          : const BoxDecoration(),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: radius,
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 6),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: selected
                    ? AppTheme.primaryOrangeDark
                    : AppTheme.textSecondary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Выбранный период: код и, для произвольного, границы диапазона.
class PeriodSelection {
  final String period;
  final DateTime? from;
  final DateTime? to;

  const PeriodSelection({
    required this.period,
    this.from,
    this.to,
  });
}
