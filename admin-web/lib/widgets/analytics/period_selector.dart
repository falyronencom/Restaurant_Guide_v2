import 'package:flutter/material.dart';

/// Reusable period selector for analytics screens.
/// Row of chips: "7 дней", "30 дней", "90 дней", "Произвольный".
/// Emits [onPeriodChanged] with period code and optional date range.
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
  static const _periods = [
    ('7d', '7 дней'),
    ('30d', '30 дней'),
    ('90d', '90 дней'),
    ('custom', 'Произвольный'),
  ];

  DateTimeRange? _customRange;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final (code, label) in _periods) ...[
          _PeriodChip(
            label: label,
            selected: widget.currentPeriod == code,
            onTap: () => _onSelect(code),
          ),
          const SizedBox(width: 8),
        ],
        if (widget.currentPeriod == 'custom' && _customRange != null)
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Text(
              '${_formatDate(_customRange!.start)} — ${_formatDate(_customRange!.end)}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.grey[600],
                  ),
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

    if (picked != null) {
      setState(() => _customRange = picked);
      widget.onPeriodChanged(PeriodSelection(
        period: 'custom',
        from: picked.start,
        to: picked.end,
      ));
    }
  }

  String _formatDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';
}

class _PeriodChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _PeriodChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? const Color(0xFFF06B32) : Colors.grey[200],
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : Colors.grey[700],
              fontSize: 13,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ),
    );
  }
}

/// Represents a period selection result
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
