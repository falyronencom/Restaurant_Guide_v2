import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Сервис входа, чья кнопка сейчас ждёт ответа.
enum SocialSignIn { google, yandex }

/// Кнопки входа через сервисы — одни и те же на «Входе» и «Регистрации».
///
/// До 17.10.2026 у экранов были свои копии: на «Входе» серая плашка с буквой
/// «G» вместо значка, другое скругление и белый фон, на «Регистрации» — без
/// значков и с крутилкой в кнопке Google при нажатии на Яндекс; кнопка Apple
/// на одном экране молчала, на другом отвечала «скоро» (проход тестировщика
/// 17.10, пп. 17, 37). Входа через Apple нет — кнопки нет. Официальных
/// значков Google и Яндекса в приложении нет, поэтому кнопки без значков:
/// единый вид лучше разнобоя.
class SocialSignInButtons extends StatelessWidget {
  const SocialSignInButtons({
    super.key,
    required this.onGoogle,
    required this.onYandex,
    this.inProgress,
    this.enabled = true,
  });

  final VoidCallback onGoogle;
  final VoidCallback onYandex;

  /// Чья кнопка ждёт ответа: в ней крутилка, остальные кнопки выключены.
  final SocialSignIn? inProgress;

  /// `false` — кнопки выключены (идёт другой вход).
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final active = enabled && inProgress == null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Или используйте:',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontSize: 15,
            height: 1.53, // 23/15
            color: Colors.black.withValues(alpha: 0.7),
          ),
        ),
        const SizedBox(height: 16),
        _button(
          context,
          label: 'Продолжить с Google',
          onPressed: active ? onGoogle : null,
          loading: inProgress == SocialSignIn.google,
        ),
        const SizedBox(height: 12),
        _button(
          context,
          label: 'Продолжить с Яндекс',
          onPressed: active ? onYandex : null,
          loading: inProgress == SocialSignIn.yandex,
        ),
      ],
    );
  }

  Widget _button(
    BuildContext context, {
    required String label,
    required VoidCallback? onPressed,
    required bool loading,
  }) {
    final theme = Theme.of(context);
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(double.infinity, 48),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        backgroundColor: AppTheme.backgroundPrimary,
        side: const BorderSide(color: AppTheme.textPrimary, width: 1),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        ),
      ),
      child: loading
          ? const SizedBox(
              height: 20,
              width: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontSize: 15,
                height: 1.33, // 20/15
                color: AppTheme.textPrimary,
              ),
            ),
    );
  }
}
