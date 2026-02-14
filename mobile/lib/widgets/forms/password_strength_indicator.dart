import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';

/// Visual password strength indicator
/// Shows weak/medium/strong with color-coded bars and text
class PasswordStrengthIndicator extends StatelessWidget {
  final String password;

  const PasswordStrengthIndicator({
    super.key,
    required this.password,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (password.isEmpty) {
      return const SizedBox.shrink();
    }

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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(4),
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
        const SizedBox(height: 4),
        Text(
          _getPasswordRequirementsText(password),
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }

  /// Get text describing missing password requirements
  String _getPasswordRequirementsText(String password) {
    final missing = <String>[];

    if (password.length < 8) {
      missing.add('8 символов');
    }
    if (!RegExp(r'[A-Z]').hasMatch(password)) {
      missing.add('заглавная буква');
    }
    if (!RegExp(r'[a-z]').hasMatch(password)) {
      missing.add('строчная буква');
    }
    if (!RegExp(r'[0-9]').hasMatch(password)) {
      missing.add('цифра');
    }

    if (missing.isEmpty) {
      return 'Пароль соответствует всем требованиям';
    }

    return 'Необходимо: ${missing.join(', ')}';
  }
}
