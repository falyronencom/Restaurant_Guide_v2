import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Сообщение внутри узкой колонки списка: пусто, не нашлось, не загрузилось.
///
/// **Не заменяет `AdminEmptyState` и `AdminErrorCard`, а дополняет их.**
/// Те — витринные, 560 и 400 пикселей, и рассчитаны на всю область экрана. В
/// колонке 420 они не помещаются: `Center` их не сжимает, и колонка уезжает
/// горизонтальной прокруткой или полосатой лентой переполнения. Это уже
/// находили на кадре 05 и решали тем же способом — компактным сообщением по
/// центру колонки.
///
/// Правило простое: область во всю ширину — витринный виджет, колонка списка —
/// этот.
class AdminColumnMessage extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;

  /// Кнопка под сообщением. `null` — действия нет: у пустого раздела кнопке
  /// нечего делать, а «Повторить» там обещало бы, что данные появятся.
  final VoidCallback? onAction;
  final String actionLabel;

  const AdminColumnMessage({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.onAction,
    this.actionLabel = 'Повторить',
  });

  @override
  Widget build(BuildContext context) {
    final action = onAction;

    return Center(
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(icon, size: 32, color: AppTheme.textGrey),
              const SizedBox(height: 12),
              Text(
                title,
                style: AppTheme.canonSubsectionHeader,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 6),
              Text(
                message,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppTheme.textSecondary,
                  height: 1.4,
                ),
                textAlign: TextAlign.center,
              ),
              if (action != null) ...[
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: action,
                  style: AppTheme.canonHeaderAction(),
                  child: Text(actionLabel),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
