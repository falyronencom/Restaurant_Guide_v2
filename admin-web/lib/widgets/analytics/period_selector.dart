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

  /// Применённый произвольный диапазон, если он есть.
  ///
  /// Приходит снаружи, а не хранится в `State`: контрол пересоздаётся при
  /// каждом входе в раздел, а применённое окно живёт в провайдере уровня
  /// приложения. Своя копия переживала не то — вернувшись в раздел,
  /// пользователь видел подсвеченный «Период» без дат, а пикер открывался
  /// засеянным последними 30 днями вместо выбранного окна: одно неосторожное
  /// «Готово» молча сдвигало период.
  final DateTimeRange? customRange;

  final ValueChanged<PeriodSelection> onPeriodChanged;

  const PeriodSelector({
    super.key,
    required this.currentPeriod,
    this.customRange,
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

  @override
  Widget build(BuildContext context) {
    final range = widget.customRange;
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
      initialDateRange: widget.customRange ??
          DateTimeRange(
            start: now.subtract(const Duration(days: 30)),
            end: now,
          ),
      locale: const Locale('ru'),
    );

    // Пикер идёт по корневому навигатору и живёт дольше своего вызова: за это
    // время маршрут может смениться — редиректом по истёкшей сессии или
    // кнопкой «назад» браузера. Обращаться к чужому состоянию после этого
    // нельзя.
    if (picked == null || !mounted) return;

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

  /// Границы имеют силу только у произвольного периода.
  ///
  /// Это не придирка к типам, а закрытый дефект. Провайдеры хранили границы
  /// отдельным полем и затирали его только непустым значением, а сервис и
  /// бэкенд предпочитают `from`/`to` коду периода. Выбрать «Период» 01.08–25.08,
  /// затем «7 дней» — и подсвечено «7 дней», а данные остались августовские.
  /// Здесь такое состояние невыразимо: при пресете границ просто нет.
  bool get isCustom => period == 'custom' && from != null && to != null;

  /// Нижняя граница на провод — датой без времени.
  ///
  /// Именно датой: полная метка ушла бы наивной строкой, и Node разобрал бы её
  /// по поясу процесса. В проде процесс живёт в UTC и совпадение случайное —
  /// у разработчика окно уезжало на его смещение. Дата же читается как сутки
  /// UTC везде одинаково, а сутками UTC бэкенд и меряет.
  String? get fromParam => isCustom ? _isoDay(from!) : null;

  /// Верхняя граница — последний день окна, ВКЛЮЧИТЕЛЬНО. Бэкенд сам сдвигает
  /// её на полночь следующих суток.
  String? get toParam => isCustom ? _isoDay(to!) : null;

  /// Ключ периода: по нему видно, что вкладка отстала от выбранного окна.
  String get key => isCustom ? 'custom:$fromParam|$toParam' : period;

  /// Диапазон для контрола и пикера. `null` — период задан пресетом.
  DateTimeRange? get range =>
      isCustom ? DateTimeRange(start: from!, end: to!) : null;

  static String _isoDay(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${d.year}-${two(d.month)}-${two(d.day)}';
  }

  /// «сравнение с предыдущими 30 днями» — вторая половина подписи шапки.
  String get comparisonLabel => switch (period) {
        '7d' => 'сравнение с предыдущими 7 днями',
        '30d' => 'сравнение с предыдущими 30 днями',
        '90d' => 'сравнение с предыдущими 90 днями',
        _ => 'сравнение с предыдущим периодом',
      };
}
