import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';

/// Строка проверяемого поля: слева лейбл и значение, справа вердикт.
///
/// Раньше строка была вертикальной и просторной — лейбл 18/w500 над значением,
/// под ним три кнопки 50×50. На четырнадцать полей это давало экран, по
/// которому надо было долго скроллить, чтобы понять, что ещё не проверено.
/// Канон делает её горизонтальной и плотной: лейбл 12, значение 15/600,
/// вердикт-группа 34×34 у правого края.
///
/// Подсветка состояния выходит за паддинг списка на 12px — поэтому контейнер
/// вкладки держит паддинг 12, а строка добавляет свои 12 изнутри. Текст в
/// итоге стоит на 24 от края панели, а заливка — на 12. Отрицательных
/// отступов, как в вёрстке, во Flutter не бывает: `Container.margin` их
/// запрещает.
///
/// Строка живёт только в режиме модерации. В режиме чтения вкладки панели
/// возвращают сетку определений, не доходя до списка строк, а причины отказа
/// собраны в блок над вкладками — поэтому вердикт-группа здесь безусловна, и
/// ветки «только чтение» у строки нет.
class ModerationFieldReview extends StatelessWidget {
  final String fieldName;
  final String label;
  final bool isRequired;

  /// Значение поля. Рамок у него быть не должно — рамка означает ввод.
  final Widget child;

  const ModerationFieldReview({
    super.key,
    required this.fieldName,
    required this.label,
    this.isRequired = false,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final state = context.watch<ModerationProvider>().getFieldState(fieldName);
    final comment = state.comment;
    final background = switch (state.status) {
      FieldReviewStatus.approved => AppTheme.successTint(0.06),
      FieldReviewStatus.rejected => AppTheme.errorTint(0.06),
      _ => null,
    };

    final hasComment = comment != null && comment.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(AppTheme.radiusControl),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                spacing: 16,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _Label(label: label, isRequired: isRequired),
                        const SizedBox(height: 3),
                        child,
                      ],
                    ),
                  ),
                  _VerdictGroup(
                    fieldName: fieldName,
                    label: label,
                    state: state,
                  ),
                ],
              ),
              if (hasComment) ...[
                const SizedBox(height: 11),
                _CommentBlock(text: comment),
              ],
            ],
          ),
        ),
        // Разделитель уже подсветки: он отбит на 24 от края панели, а заливка
        // строки — на 12.
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 12),
          child: Divider(height: 1, thickness: 1, color: AppTheme.borderLight),
        ),
      ],
    );
  }
}

class _Label extends StatelessWidget {
  final String label;
  final bool isRequired;

  const _Label({required this.label, required this.isRequired});

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        text: label,
        style: AppTheme.canonFieldLabel,
        children: isRequired
            ? const [
                TextSpan(
                  text: ' *',
                  style: TextStyle(color: AppTheme.primaryOrange),
                ),
              ]
            : null,
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }
}

/// Три кнопки 34×34: одобрить, отклонить, прокомментировать.
class _VerdictGroup extends StatelessWidget {
  final String fieldName;
  final String label;
  final FieldReviewState state;

  const _VerdictGroup({
    required this.fieldName,
    required this.label,
    required this.state,
  });

  @override
  Widget build(BuildContext context) {
    final provider = context.read<ModerationProvider>();
    final approved = state.status == FieldReviewStatus.approved;
    final rejected = state.status == FieldReviewStatus.rejected;
    final commented = state.comment != null && state.comment!.isNotEmpty;

    return Row(
      mainAxisSize: MainAxisSize.min,
      spacing: 6,
      children: [
        _VerdictButton(
          icon: Icons.check,
          isActive: approved,
          activeColor: AppTheme.successStrong,
          tooltip: 'Одобрить',
          // Повторное нажатие снимает вердикт — иначе ошибочный клик
          // нечем отменить.
          onTap: () => approved
              ? provider.resetField(fieldName)
              : provider.approveField(fieldName),
        ),
        _VerdictButton(
          icon: Icons.close,
          isActive: rejected,
          activeColor: AppTheme.errorStrong,
          tooltip: 'Отклонить',
          onTap: () => rejected
              ? provider.resetField(fieldName)
              : _ask(
                  context,
                  provider,
                  title: 'Отклонить: $label',
                  hint: 'Причина отклонения — уйдёт партнёру',
                  confirm: 'Отклонить',
                  danger: true,
                  // Пустая причина партнёру не уходит (её отбрасывает отказ),
                  // а поле при этом краснело: обещание «уйдёт партнёру» не
                  // сбывалось (пункт A1-11).
                  requireText: true,
                  onSave: (text) => provider.rejectField(fieldName, comment: text),
                ),
        ),
        _VerdictButton(
          icon: Icons.chat_bubble_outline,
          isActive: commented,
          activeColor: AppTheme.primaryOrange,
          tooltip: 'Комментарий',
          onTap: () => _ask(
            context,
            provider,
            title: 'Комментарий: $label',
            // Заметка сохраняется с одобрением и видна в карточке потом
            // (блок «Заметки модерации»). С отказом уходят только причины
            // отклонённых полей — их читает партнёр, и заметка для своих
            // туда не попадает (пункт A1-12).
            hint: 'Заметка для модераторов — сохранится при одобрении',
            confirm: 'Сохранить',
            danger: false,
            onSave: (text) => provider.commentField(fieldName, text),
          ),
        ),
      ],
    );
  }

  Future<void> _ask(
    BuildContext context,
    ModerationProvider provider, {
    required String title,
    required String hint,
    required String confirm,
    required bool danger,
    bool requireText = false,
    required ValueChanged<String> onSave,
  }) async {
    final text = await showDialog<String>(
      context: context,
      builder: (_) => _FieldNoteDialog(
        title: title,
        hint: hint,
        confirm: confirm,
        danger: danger,
        requireText: requireText,
        initialText: provider.getFieldState(fieldName).comment ?? '',
      ),
    );
    if (text != null) onSave(text);
  }
}

/// Окно причины у кнопок ✗ и 💬 — отдельным виджетом, потому что оно владеет
/// полем ввода (образец — `_SuspendReasonDialog` в панели модерации).
///
/// Контроллер освобождается в `State.dispose`, то есть после размонтирования
/// окна. Освобождать его по завершении `showDialog` нельзя: future
/// завершается на попе маршрута, а окно ещё уезжает анимацией и перестраивает
/// тронутое поле. Текст возвращается через `pop`, вердикт ставит вызывающий.
class _FieldNoteDialog extends StatefulWidget {
  final String title;
  final String hint;
  final String confirm;
  final bool danger;
  final String initialText;

  /// Без текста кнопка гаснет, а рядом сказано, чего не хватает — как в
  /// окне приостановки.
  final bool requireText;

  const _FieldNoteDialog({
    required this.title,
    required this.hint,
    required this.confirm,
    required this.danger,
    required this.initialText,
    this.requireText = false,
  });

  @override
  State<_FieldNoteDialog> createState() => _FieldNoteDialogState();
}

class _FieldNoteDialogState extends State<_FieldNoteDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialText);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 420,
        child: TextField(
          controller: _controller,
          maxLines: 4,
          autofocus: true,
          decoration: InputDecoration(hintText: widget.hint),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Отмена'),
        ),
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: _controller,
          builder: (context, value, _) {
            final missing = widget.requireText && value.text.trim().isEmpty;
            return Row(
              mainAxisSize: MainAxisSize.min,
              spacing: 10,
              children: <Widget>[
                if (missing)
                  const Text(
                    'Нужна причина',
                    style: TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ElevatedButton(
                  onPressed: missing
                      ? null
                      : () => Navigator.pop(context, _controller.text.trim()),
                  style: AppTheme.canonCtaL(
                    backgroundColor: widget.danger ? AppTheme.errorStrong : null,
                  ),
                  child: Text(widget.confirm),
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _VerdictButton extends StatelessWidget {
  final IconData icon;
  final bool isActive;
  final Color activeColor;
  final String tooltip;
  final VoidCallback onTap;

  const _VerdictButton({
    required this.icon,
    required this.isActive,
    required this.activeColor,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppTheme.radiusControl);

    return Tooltip(
      message: tooltip,
      child: Material(
        color: isActive ? activeColor : Colors.transparent,
        borderRadius: radius,
        child: InkWell(
          borderRadius: radius,
          onTap: onTap,
          child: Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: radius,
              border: isActive
                  ? null
                  : Border.all(color: AppTheme.strokeGrey),
            ),
            child: Icon(
              icon,
              size: 18,
              color: isActive ? AppTheme.textOnPrimary : AppTheme.textGrey,
            ),
          ),
        ),
      ),
    );
  }
}

/// Комментарий к полю: белый блок с красной полосой слева.
class _CommentBlock extends StatelessWidget {
  final String text;

  const _CommentBlock({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: const BoxDecoration(
        color: AppTheme.backgroundPrimary,
        border: Border(
          left: BorderSide(color: AppTheme.errorRed, width: 2),
        ),
        borderRadius: BorderRadius.only(
          topRight: Radius.circular(AppTheme.radiusControl),
          bottomRight: Radius.circular(AppTheme.radiusControl),
        ),
      ),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 13,
          height: 1.5,
          color: AppTheme.textDark,
        ),
      ),
    );
  }
}
