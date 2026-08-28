import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/quality_signals.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';

/// Сводка над сеткой сигналов: сколько проверок красные, сколько чисты.
///
/// **Чего здесь нет и почему.** Кадр рисовал под числом строку «28 заведений
/// затронуто». Двадцать восемь — это сумма счётчиков семи красных карточек, и
/// заведениями из них являются четырнадцать: остальное — позиции меню и задачи
/// распознавания. Да и четырнадцать складывать нельзя: заведение с
/// неканонической первой категорией попадает и в «недостижимы», и в «категории
/// вне канона» — по построению, а не по совпадению. Строка снята (решение
/// владельца, 27.08.2026).
///
/// Соседняя половина той же строки — «4 сигнала висят больше 7 дней» — называла
/// сигналами позиции меню. Величина настоящая, но живёт она на карточке
/// «Флаги без реакции», где написано, чего именно четыре.
class HealthSummaryBar extends StatelessWidget {
  final QualityHealthData data;

  const HealthSummaryBar({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final red = redSignals(data);
    final clean = cleanSignals(data);
    final showPriceNote = data.priceDistributionStatus == 'deferred';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 18),
      decoration: AppTheme.canonPanelDecoration(),
      // Гибкий ребёнок здесь ровно один — левая группа. `Spacer` рядом с
      // `Flexible` не работает: `RenderFlex` делит свободное место по flex, а
      // недобор loose-ребёнка никому не передаёт, и остаток ложится ПОСЛЕ
      // последнего элемента. Сноска про цены уезжала от правого края на 174
      // пикселя, причём сильнее всего в состоянии «всё чисто», где левая группа
      // короче всего.
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(child: _blocks(red, clean)),
          if (showPriceNote)
            const SizedBox(
              width: 190,
              child: Text(
                'Распределение цен подключается на импорте 500 заведений',
                textAlign: TextAlign.right,
                style: TextStyle(
                  fontSize: 12,
                  height: 1.5,
                  color: AppTheme.textSecondary,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _blocks(List<QualitySignal> red, List<QualitySignal> clean) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: <Widget>[
        if (red.isEmpty)
          // Ноль красных не показывается красным нулём: «0 сигналов требуют
          // внимания» сообщает ровно обратное тому, чем является.
          Flexible(
            child: _SummaryBlock(
              icon: Icons.check_circle_outline,
              accent: AppTheme.statusGreen,
              count: kQualitySignals.length,
              label: plural(
                kQualitySignals.length,
                'проверка чиста',
                'проверки чисты',
                'проверок чисты',
              ),
              note: 'Ни один сигнал не требует внимания',
            ),
          )
        else ...<Widget>[
          Flexible(
            child: _SummaryBlock(
              icon: Icons.error_outline,
              accent: AppTheme.errorRed,
              count: red.length,
              label: plural(
                red.length,
                'сигнал требует внимания',
                'сигнала требуют внимания',
                'сигналов требуют внимания',
              ),
            ),
          ),
          if (clean.isNotEmpty) ...<Widget>[
            const SizedBox(width: 28),
            Container(width: 1, height: 44, color: AppTheme.beigeDivider),
            const SizedBox(width: 28),
            Flexible(
              child: _SummaryBlock(
                icon: Icons.check_circle_outline,
                accent: AppTheme.statusGreen,
                count: clean.length,
                label: plural(
                  clean.length,
                  'проверка чиста',
                  'проверки чисты',
                  'проверок чисты',
                ),
                note: clean.map((s) => s.cleanLabel).join(', '),
              ),
            ),
          ],
        ],
      ],
    );
  }
}

class _SummaryBlock extends StatelessWidget {
  final IconData icon;
  final Color accent;
  final int count;
  final String label;
  final String? note;

  const _SummaryBlock({
    required this.icon,
    required this.accent,
    required this.count,
    required this.label,
    this.note,
  });

  @override
  Widget build(BuildContext context) {
    final noteText = note;

    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      spacing: 12,
      children: <Widget>[
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: AppTheme.backgroundPrimary,
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          ),
          child: Icon(icon, size: 22, color: accent),
        ),
        Flexible(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                spacing: 7,
                children: <Widget>[
                  Text(
                    formatCount(count),
                    style: AppTheme.unbounded(
                      fontSize: 26,
                      color: accent,
                      height: 1,
                    ),
                  ),
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
              if (noteText != null) ...<Widget>[
                const SizedBox(height: 3),
                Text(
                  noteText,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
