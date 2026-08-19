import 'dart:async';

import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Тост ошибки действия — правый нижний угол, поверх экрана.
///
/// Ключевое отличие от [AdminErrorCard]: работа на экране **не сбрасывается**.
/// Не сработала одна операция — заполненная форма, выбранная карточка и
/// проставленные вердикты остаются на месте. Поэтому тост, а не подмена
/// содержимого: подменять нечего, всё цело.
///
/// Ставится через [showAdminErrorToast].
class AdminErrorToast extends StatelessWidget {
  /// Что не получилось: «Отзыв не скрыт».
  final String title;

  /// Следствие для пользователя, а не код: «Сервер отклонил запрос.
  /// Отзыв всё ещё виден в приложении».
  final String message;

  final VoidCallback? onRetry;
  final String retryLabel;
  final VoidCallback? onDismiss;

  const AdminErrorToast({
    super.key,
    required this.title,
    required this.message,
    this.onRetry,
    this.retryLabel = 'Ещё раз',
    this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 380),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: AppTheme.backgroundPrimary,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          border: Border.all(color: AppTheme.errorTint(0.35)),
          boxShadow: const [
            BoxShadow(
              color: Color(0x1A000000),
              blurRadius: 20,
              offset: Offset(0, 6),
            ),
          ],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 10,
          children: [
            const Icon(Icons.error_outline, size: 19, color: AppTheme.errorRed),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    message,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.4,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            if (onRetry != null)
              OutlinedButton(
                onPressed: () {
                  onDismiss?.call();
                  onRetry!.call();
                },
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.textDark,
                  side: const BorderSide(color: AppTheme.strokeGrey),
                  minimumSize: const Size(0, 30),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                  ),
                  textStyle: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                child: Text(retryLabel),
              ),
          ],
        ),
      ),
    );
  }
}

/// Показывает [AdminErrorToast] в правом нижнем углу окна.
///
/// Возвращает функцию досрочного снятия — пригодится, если экран уходит
/// раньше, чем истечёт [duration].
VoidCallback showAdminErrorToast(
  BuildContext context, {
  required String title,
  required String message,
  VoidCallback? onRetry,
  String retryLabel = 'Ещё раз',
  Duration duration = const Duration(seconds: 8),
}) {
  final overlay = Overlay.of(context);
  Timer? timer;
  OverlayEntry? entry;
  var removed = false;

  void remove() {
    if (removed) return;
    removed = true;
    timer?.cancel();
    entry?.remove();
  }

  entry = OverlayEntry(
    builder: (_) => Positioned(
      right: 24,
      bottom: 24,
      child: Material(
        type: MaterialType.transparency,
        child: AdminErrorToast(
          title: title,
          message: message,
          onRetry: onRetry,
          retryLabel: retryLabel,
          onDismiss: remove,
        ),
      ),
    ),
  );

  overlay.insert(entry);
  // Тост держится дольше обычного снекбара: ошибка действия требует решения,
  // а не просто уведомляет. Кнопка «Ещё раз» должна дождаться человека.
  timer = Timer(duration, remove);

  return remove;
}
