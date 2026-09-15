import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Стеклянный чип-действие поверх фото-героя карточки заведения.
///
/// Адрес, телефон и сайт говорят одним языком: рамка с подложкой читается как
/// кнопка. Подчёркивание текста этой работы не делало — тестировщики тапали
/// мимо адреса и телефона, хотя тап там был.
///
/// Высота не меньше [minTapHeight]: у прежних строк адреса и телефона зона
/// тапа равнялась высоте текста, около 19 dp при рекомендованных платформой 44.
class GlassActionChip extends StatelessWidget {
  const GlassActionChip({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.maxLines = 1,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  /// Длинный адрес переносится на вторую строку, а не режется многоточием.
  final int maxLines;

  /// Минимальная зона тапа.
  static const double minTapHeight = 44;

  static const Color _foreground = AppTheme.backgroundWarm;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: minTapHeight),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(minTapHeight / 2),
          border: Border.all(color: Colors.white.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: _foreground),
            const SizedBox(width: 8),
            // Flexible, а не голый Text: в Wrap чипу достаётся вся ширина
            // строки, и длинный адрес без него уезжает за край экрана.
            Flexible(
              child: Text(
                label,
                maxLines: maxLines,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 15,
                  color: _foreground,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
