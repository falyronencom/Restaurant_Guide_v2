import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';

/// Требования к паролю и его надёжность — под полем пароля.
///
/// Перечень требований виден сразу, с пустого поля, и отмечает выполненные по
/// мере ввода (проход тестировщика 17.10, п. 21). Раньше до первого символа
/// не было видно ничего, а подсказка говорила только про 8 знаков — о
/// латинских буквах и цифре человек узнавал из отказа. Полоса надёжности
/// появляется с первым символом: у пустого пароля надёжности нет.
class PasswordStrengthIndicator extends StatelessWidget {
  final String password;

  const PasswordStrengthIndicator({
    super.key,
    required this.password,
  });

  /// Цвет выполненного требования.
  static const Color metColor = Color(0xFF2E7D32);

  /// Цвет невыполненного: тёмно-серый, а не светлый — перечень должен
  /// читаться на бежевом фоне, его и не заметили (п. 21).
  static const Color unmetColor = Color(0xFF6B6B6B);

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (password.isNotEmpty) _buildStrengthBar(context),
        const SizedBox(height: 8),
        for (final requirement in passwordRequirements)
          _RequirementRow(
            label: requirement.label,
            met: requirement.isMetBy(password),
          ),
      ],
    );
  }

  Widget _buildStrengthBar(BuildContext context) {
    final theme = Theme.of(context);
    final strength = getPasswordStrength(password);
    final progress = getPasswordStrengthProgress(password);

    // Determine color based on strength
    Color strengthColor;
    String strengthText;

    switch (strength) {
      case PasswordStrength.weak:
        strengthColor = theme.colorScheme.error;
        strengthText = 'Слабый';
        break;
      case PasswordStrength.medium:
        strengthColor = Colors.orange;
        strengthText = 'Средний';
        break;
      case PasswordStrength.strong:
        strengthColor = Colors.green;
        strengthText = 'Надёжный';
        break;
    }

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
              child: LinearProgressIndicator(
                value: progress,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                valueColor: AlwaysStoppedAnimation<Color>(strengthColor),
                minHeight: 6,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Text(
            strengthText,
            style: theme.textTheme.bodySmall?.copyWith(
              color: strengthColor,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Строка перечня: отметка и требование.
class _RequirementRow extends StatelessWidget {
  const _RequirementRow({required this.label, required this.met});

  final String label;
  final bool met;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = met
        ? PasswordStrengthIndicator.metColor
        : PasswordStrengthIndicator.unmetColor;

    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Row(
        children: [
          Icon(
            met ? Icons.check_circle : Icons.radio_button_unchecked,
            size: 16,
            color: color,
            semanticLabel: met ? 'выполнено' : 'не выполнено',
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                fontSize: 13,
                height: 1.15,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
