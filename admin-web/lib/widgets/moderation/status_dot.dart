import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Статус заведения человеческим языком: точка цвета и подпись.
///
/// Модератор не обязан знать машинные коды. `rejected` на его экране —
/// это дефект, а не сокращение: коду место в базе и в логах, на экране
/// место слову. Карта ниже — единственное место, где перевод задан.
///
/// Набор кодов повторяет CHECK-ограничение таблицы `establishments`
/// (`migrations/production_schema.sql`). Если там появится новый статус, а
/// здесь нет — тест `status_dot_test.dart` это поймает: молча показать
/// незнакомый код хуже, чем упасть на сборке.
class StatusLabel {
  final String label;
  final Color color;

  const StatusLabel(this.label, this.color);
}

/// Канонические статусы заведения. Ключи — то, что приходит с бэкенда.
const Map<String, StatusLabel> kEstablishmentStatuses = <String, StatusLabel>{
  'draft': StatusLabel('черновик', AppTheme.textGrey),
  'pending': StatusLabel('на модерации', AppTheme.primaryOrange),
  'active': StatusLabel('опубликовано', AppTheme.statusGreen),
  'rejected': StatusLabel('отказано', AppTheme.errorRed),
  // Приостановка — не ошибка и не успех: канон отдаёт ей disclaimer-пару.
  'suspended': StatusLabel('приостановлено', AppTheme.disclaimerText),
  'archived': StatusLabel('в архиве', AppTheme.textGrey),
};

/// Точка статуса 7px, при необходимости с подписью.
class StatusDot extends StatelessWidget {
  final String status;
  final bool showLabel;

  const StatusDot(this.status, {super.key}) : showLabel = false;

  const StatusDot.labelled(this.status, {super.key}) : showLabel = true;

  static const double size = 7;

  /// Подпись для кода. Незнакомый код возвращается как есть — так дефект
  /// виден и в интерфейсе, и в тесте, вместо того чтобы прятаться за
  /// вежливым «неизвестно».
  static String labelFor(String status) =>
      kEstablishmentStatuses[status]?.label ?? status;

  static Color colorFor(String status) =>
      kEstablishmentStatuses[status]?.color ?? AppTheme.textGrey;

  @override
  Widget build(BuildContext context) {
    final dot = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: colorFor(status),
        shape: BoxShape.circle,
      ),
    );

    if (!showLabel) return dot;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        dot,
        const SizedBox(width: 6),
        Text(
          labelFor(status),
          style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
        ),
      ],
    );
  }
}
