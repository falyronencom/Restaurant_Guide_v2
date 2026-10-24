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
      // Блоки — равными долями и прижаты к верху. Раньше левый стоял по своему
      // содержимому, а правый ужимался в остаток: подпись «9 проверок чисты»
      // резалась многоточием, а у блока с пояснением строка числа уезжала
      // вверх относительно соседа без пояснения — числа стояли на разной
      // высоте (замечание Координатора К-5). Теперь у обоих блоков одна
      // форма — число, подпись, строка пояснения, — и числа на одной линии.
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(child: _blocks(red, clean)),
          if (showPriceNote)
            const SizedBox(
              width: 200,
              child: Text(
                // Обещание «подключается на импорте 500 заведений» было без
                // срока и на внутреннем языке (Ч39): статистике цен нужна
                // выборка, и её пока нет — это и сказано.
                'Проверка цен включится, когда заведений станет '
                'достаточно для сравнения',
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
    if (red.isEmpty) {
      // Ноль красных не показывается красным нулём: «0 сигналов требуют
      // внимания» сообщает ровно обратное тому, чем является.
      return _SummaryBlock(
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
      );
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
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
            // Какие именно — названия красных проверок: так у блока та же
            // форма, что у соседнего, и числа стоят на одной линии.
            note: red.map((s) => s.title).join(', '),
          ),
        ),
        if (clean.isNotEmpty) ...<Widget>[
          const SizedBox(width: 24),
          Container(width: 1, height: 44, color: AppTheme.beigeDivider),
          const SizedBox(width: 24),
          Expanded(
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
      crossAxisAlignment: CrossAxisAlignment.start,
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
        Expanded(
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
                      maxLines: 2,
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
                // Одна строка — высота сводки постоянна, и скелетон её
                // обещает честно; полный список — при наведении.
                Tooltip(
                  message: noteText,
                  waitDuration: const Duration(milliseconds: 400),
                  child: Text(
                    noteText,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                    ),
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
