import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Окраска числа в строке «Требует внимания».
enum AttentionTone {
  /// Есть работа: брендовый тёмный.
  normal,

  /// Требует разбора сейчас: красный.
  critical,

  /// Разобрано, ноль: зелёный.
  clear,
}

/// Строка панели «Требует внимания».
class AttentionItem {
  final int count;
  final String title;

  /// Уточнение под заголовком: «старейшая ждёт 3 дня», «4 старше 7 дней».
  /// null — уточнения нет; приблизительным значением не заполнять.
  final String? note;

  final AttentionTone tone;
  final VoidCallback? onTap;

  const AttentionItem({
    required this.count,
    required this.title,
    this.note,
    this.tone = AttentionTone.normal,
    this.onTap,
  });

  /// Ноль всегда читается как «разобрано», какой бы тон ни просили.
  AttentionTone get effectiveTone =>
      count == 0 ? AttentionTone.clear : tone;
}

/// Панель «Требует внимания» — витринная, справа от графика.
///
/// Отвечает на вопрос, которого не было у прежнего дашборда: не «сколько
/// всего», а «за что браться сейчас». Поэтому она витринная (бежевая, без
/// рамки), а не инструментальная: это не показатель, а список дел.
///
/// Строка без данных не выдумывается — её просто нет в [items].
class AttentionPanel extends StatelessWidget {
  final List<AttentionItem> items;

  const AttentionPanel({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonPanelDecoration(radius: AppTheme.radiusMedium),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Требует внимания',
            style: AppTheme.canonSheetTitle.copyWith(fontSize: 17),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: ListView.separated(
              padding: EdgeInsets.zero,
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _Row(item: items[i]),
            ),
          ),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final AttentionItem item;

  const _Row({required this.item});

  Color get _countColor => switch (item.effectiveTone) {
        AttentionTone.normal => AppTheme.primaryOrangeDark,
        AttentionTone.critical => AppTheme.errorRed,
        AttentionTone.clear => AppTheme.statusGreen,
      };

  @override
  Widget build(BuildContext context) {
    final note = item.note;
    final radius = BorderRadius.circular(AppTheme.radiusControl);

    return Material(
      color: AppTheme.backgroundPrimary,
      borderRadius: radius,
      child: InkWell(
        borderRadius: radius,
        onTap: item.onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            spacing: 12,
            children: [
              ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 26),
                child: Text(
                  formatCount(item.count),
                  style: AppTheme.canonSheetTitle.copyWith(
                    fontSize: 20,
                    height: 1,
                    color: _countColor,
                  ),
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      item.title,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (note != null)
                      Text(
                        note,
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppTheme.textTertiary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
              if (item.onTap != null)
                const Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: AppTheme.textGrey,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
