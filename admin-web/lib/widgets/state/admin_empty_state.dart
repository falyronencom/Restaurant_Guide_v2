import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Строка перечня внутри пустого состояния.
///
/// В пустом разделе это «что здесь появится», в пустом результате фильтра —
/// «что именно сейчас включено», и тогда у строки есть [onRemove].
class EmptyStateRow {
  final IconData icon;
  final String text;
  final VoidCallback? onRemove;

  const EmptyStateRow({
    required this.icon,
    required this.text,
    this.onRemove,
  });
}

enum _EmptyMode { section, filtered }

/// Витринная панель пустого состояния — 560px, бежевая, по центру тела.
///
/// Состояний два, и путать их нельзя: раздел, которого ещё нет, и фильтр,
/// который ничего не нашёл. Первое требует объяснить, что появится и от чего
/// это зависит; второе — показать, что именно отсекло, и дать это снять.
/// Общий у них только корпус панели: даже плитка иконки разного режима.
///
/// Заголовок называет раздел — «Нет данных» не говорит, чего именно нет.
class AdminEmptyState extends StatelessWidget {
  final _EmptyMode _mode;
  final IconData icon;
  final String title;
  final String status;
  final List<EmptyStateRow> rows;

  /// Только для [AdminEmptyState.section] — абзац-объяснение.
  final String? message;

  /// Только для [AdminEmptyState.section] — честная зависимость внизу: от чего
  /// реально ждать раздел, а не безадресное «ожидается в обновлениях».
  final String? footnote;

  final VoidCallback? onReset;
  final String resetLabel;
  final String? resetHint;

  /// Раздел ещё не запущен: брендовая плитка, абзац и срок.
  const AdminEmptyState.section({
    super.key,
    required this.icon,
    required this.title,
    required this.status,
    required this.message,
    this.rows = const <EmptyStateRow>[],
    this.footnote,
  })  : _mode = _EmptyMode.section,
        onReset = null,
        resetLabel = '',
        resetHint = null;

  /// Фильтр ничего не нашёл: белая плитка, приглушённый глиф, кнопка сброса.
  const AdminEmptyState.filtered({
    super.key,
    this.icon = Icons.filter_alt_off_outlined,
    required this.title,
    required this.status,
    this.rows = const <EmptyStateRow>[],
    required this.onReset,
    this.resetLabel = 'Сбросить фильтры',
    this.resetHint,
  })  : _mode = _EmptyMode.filtered,
        message = null,
        footnote = null;

  bool get _isSection => _mode == _EmptyMode.section;

  @override
  Widget build(BuildContext context) {
    final messageText = message;
    final footnoteText = footnote;

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Container(
          width: 560,
          padding: const EdgeInsets.all(32),
          decoration: AppTheme.canonPanelDecoration(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _header(),
              if (_isSection && messageText != null) ...[
                const SizedBox(height: 18),
                Text(
                  messageText,
                  style: const TextStyle(
                    fontSize: 15,
                    height: 1.55,
                    color: AppTheme.textDark,
                  ),
                ),
              ],
              if (rows.isNotEmpty) ...[
                SizedBox(height: _isSection ? 16 : 18),
                for (final row in rows) _RowLine(row: row),
              ],
              if (_isSection && footnoteText != null) ...[
                const SizedBox(height: 18),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 8,
                  children: [
                    const Icon(
                      Icons.schedule,
                      size: 16,
                      color: AppTheme.textGrey,
                    ),
                    Expanded(
                      child: Text(
                        footnoteText,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.45,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              if (!_isSection) ...[
                const SizedBox(height: 20),
                _resetRow(),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _header() {
    return Row(
      spacing: 14,
      children: [
        Container(
          width: 56,
          height: 56,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            // Раздел, которого ещё нет, получает брендовую плитку — это
            // обещание. Пустой результат фильтра — белую с серым глифом: он
            // не событие, а следствие того, что настроил сам пользователь.
            color: _isSection
                ? AppTheme.brandTint(0.12)
                : AppTheme.backgroundPrimary,
            borderRadius: BorderRadius.circular(AppTheme.radiusLarge),
          ),
          child: Icon(
            icon,
            size: 28,
            color: _isSection ? AppTheme.primaryOrange : AppTheme.textGrey,
          ),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                title,
                style: AppTheme.canonSheetTitle.copyWith(
                  fontSize: 22,
                  height: 1.15,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                status,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppTheme.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _resetRow() {
    final hint = resetHint;

    return Row(
      spacing: 10,
      children: [
        ElevatedButton.icon(
          onPressed: onReset,
          style: AppTheme.canonCtaL(),
          icon: const Icon(Icons.filter_alt_off_outlined, size: 19),
          label: Text(resetLabel),
        ),
        if (hint != null)
          Flexible(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 210),
              child: Text(
                hint,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.45,
                  color: AppTheme.textSecondary,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Строка перечня: разделитель сверху, значок, текст, необязательный крестик.
class _RowLine extends StatelessWidget {
  final EmptyStateRow row;

  const _RowLine({required this.row});

  @override
  Widget build(BuildContext context) {
    final remove = row.onRemove;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppTheme.beigeDivider)),
      ),
      child: Row(
        spacing: 10,
        children: [
          Icon(row.icon, size: 17, color: AppTheme.textGrey),
          Expanded(
            child: Text(
              row.text,
              style: const TextStyle(fontSize: 14, color: AppTheme.textDark),
            ),
          ),
          if (remove != null)
            Material(
              type: MaterialType.transparency,
              child: InkWell(
                borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
                onTap: remove,
                child: const Padding(
                  padding: EdgeInsets.all(2),
                  child: Icon(
                    Icons.close,
                    size: 16,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
