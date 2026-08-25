import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Вариант фильтра. `null` в [value] — «все», снятый фильтр.
class AdminFilterOption<T> {
  final T? value;
  final String label;

  const AdminFilterOption({required this.value, required this.label});
}

/// Фильтр-пилюля канона: h40, r10, значение и шеврон.
///
/// Заменяет `InputDecorator` + `DropdownButton`: материаловское поле ввода
/// обещает ввод, а здесь выбирают из готового списка. Разница видна и на
/// глаз — рамка поля, плавающий лейбл и подчёркивание в каноне админки не
/// встречаются нигде.
///
/// **Активный фильтр отличается от снятого не только текстом.** Брендовая
/// рамка 1.5 и заливка 8% отвечают на вопрос «почему список такой короткий»
/// раньше, чем модератор начнёт перечитывать подписи. Ровно так фильтр
/// нарисован в кадрах 06 и 07.
class AdminFilterDropdown<T> extends StatelessWidget {
  /// Подпись слева от значения: «Тип действия», «Объект». Необязательна —
  /// в кадре 07 фильтры стоят без неё, и значение говорит само за себя
  /// («Все статусы»).
  final String? label;

  final T? value;
  final List<AdminFilterOption<T>> options;
  final ValueChanged<T?> onChanged;

  /// Подпись, когда значение не выбрано.
  final String emptyLabel;

  const AdminFilterDropdown({
    super.key,
    this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    required this.emptyLabel,
  });

  static const double height = 40;

  bool get _isActive => value != null;

  @override
  Widget build(BuildContext context) {
    final labelText = label;
    final selected = options
        .where((option) => option.value == value)
        .map((option) => option.label)
        .firstOrNull;

    final accent = _isActive ? AppTheme.primaryOrangeDark : null;

    return PopupMenuButton<_FilterChoice<T>>(
      tooltip: labelText ?? emptyLabel,
      position: PopupMenuPosition.under,
      initialValue: _FilterChoice<T>(value),
      onSelected: (choice) => onChanged(choice.value),
      itemBuilder: (_) => <PopupMenuEntry<_FilterChoice<T>>>[
        for (final option in options)
          PopupMenuItem<_FilterChoice<T>>(
            value: _FilterChoice<T>(option.value),
            child: Text(option.label),
          ),
      ],
      child: Container(
        height: height,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          color: _isActive ? AppTheme.brandTint(0.08) : null,
          borderRadius: BorderRadius.circular(AppTheme.radiusControl),
          border: Border.all(
            color: _isActive ? AppTheme.primaryOrange : AppTheme.strokeGrey,
            width: _isActive ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          spacing: 8,
          children: [
            if (labelText != null)
              Text(
                labelText,
                style: TextStyle(
                  fontSize: 12,
                  color: accent ?? AppTheme.textSecondary,
                ),
              ),
            Text(
              selected ?? emptyLabel,
              style: TextStyle(
                fontSize: 14,
                // Вес отделяет значение от лейбла. Без лейбла отделять не от
                // чего, и вес остаётся только за активным фильтром — так
                // нарисовано в обоих кадрах.
                fontWeight: (labelText != null || _isActive)
                    ? FontWeight.w600
                    : FontWeight.w400,
                color: accent ?? AppTheme.textDark,
              ),
            ),
            Icon(
              Icons.expand_more,
              size: 18,
              color: accent ?? AppTheme.textSecondary,
            ),
          ],
        ),
      ),
    );
  }
}

/// Обёртка вокруг значения фильтра.
///
/// `PopupMenuButton` считает `null` отказом от выбора и в `onSelected` его не
/// приносит, а «Все» — это ровно `null`. Без обёртки пункт «Все» молча ничего
/// бы не делал: меню закрывалось, фильтр оставался.
class _FilterChoice<T> {
  final T? value;

  const _FilterChoice(this.value);

  @override
  bool operator ==(Object other) =>
      other is _FilterChoice<T> && other.value == value;

  @override
  int get hashCode => value.hashCode;
}
