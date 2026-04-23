import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';

/// Right panel: full details of the selected flagged menu item + admin actions.
class MenuItemDetailPanel extends StatelessWidget {
  const MenuItemDetailPanel({super.key});

  static const Color _orange = Color(0xFFDB4F13);

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<MenuItemsModerationProvider>();
    final selected = provider.selected;

    if (selected == null) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'Выберите позицию слева, чтобы увидеть детали',
            style: TextStyle(color: Colors.grey),
          ),
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildHeader(context, selected),
          const SizedBox(height: 20),
          _buildCoreFields(selected),
          const SizedBox(height: 20),
          _buildSanityFlagSection(selected),
          const SizedBox(height: 20),
          _buildHiddenSection(selected),
          const SizedBox(height: 24),
          _buildActions(context, provider, selected),
          if (provider.actionError != null) ...[
            const SizedBox(height: 12),
            Text(
              provider.actionError!,
              style: const TextStyle(color: Colors.red),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildHeader(BuildContext context, FlaggedMenuItem item) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          item.itemName,
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        Row(
          children: [
            Icon(Icons.store, size: 16, color: Colors.grey.shade700),
            const SizedBox(width: 6),
            Text(
              item.establishmentName,
              style: TextStyle(
                fontSize: 14,
                color: Colors.grey.shade800,
              ),
            ),
            if (item.establishmentCity != null) ...[
              const SizedBox(width: 8),
              Text('·',
                  style: TextStyle(color: Colors.grey.shade500)),
              const SizedBox(width: 8),
              Text(
                item.establishmentCity!,
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey.shade600,
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 2),
        Text(
          'Распарсено ${DateFormat('dd MMMM yyyy, HH:mm', 'ru').format(item.createdAt)}',
          style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
        ),
      ],
    );
  }

  Widget _buildCoreFields(FlaggedMenuItem item) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _labelValue(
            'Цена',
            item.priceByn != null
                ? '${item.priceByn!.toStringAsFixed(2)} BYN'
                : '—',
          ),
          const Divider(height: 16),
          _labelValue('Категория', item.categoryRaw ?? '—'),
          const Divider(height: 16),
          _labelValue(
            'Уверенность распознавания',
            item.confidence != null
                ? '${(item.confidence! * 100).toStringAsFixed(0)}%'
                : '—',
          ),
        ],
      ),
    );
  }

  Widget _buildSanityFlagSection(FlaggedMenuItem item) {
    if (item.sanityFlag == null || item.sanityFlag!.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.green.shade50,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: Colors.green.shade200),
        ),
        child: Row(
          children: [
            Icon(Icons.check_circle_outline,
                size: 18, color: Colors.green.shade700),
            const SizedBox(width: 8),
            Text(
              'Sanity flag снят',
              style:
                  TextStyle(color: Colors.green.shade800, fontSize: 13),
            ),
          ],
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7E6),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: const Color(0xFFFFB800)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.warning_amber_rounded,
                  size: 18, color: Color(0xFF7A5B00)),
              SizedBox(width: 8),
              Text(
                'Sanity flag',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF7A5B00),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SelectableText(
            const JsonEncoder.withIndent('  ').convert(item.sanityFlag),
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 12,
              color: Color(0xFF4A3700),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHiddenSection(FlaggedMenuItem item) {
    if (!item.isHiddenByAdmin) {
      return const SizedBox.shrink();
    }
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: Colors.grey.shade400),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.visibility_off_outlined,
                  size: 18, color: Colors.grey.shade700),
              const SizedBox(width: 8),
              Text(
                'Позиция скрыта из поиска',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Colors.grey.shade800,
                ),
              ),
            ],
          ),
          if (item.hiddenReason != null &&
              item.hiddenReason!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              'Причина: ${item.hiddenReason}',
              style: const TextStyle(fontSize: 13),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildActions(
    BuildContext context,
    MenuItemsModerationProvider provider,
    FlaggedMenuItem item,
  ) {
    final hasFlag = item.sanityFlag != null && item.sanityFlag!.isNotEmpty;

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        if (!item.isHiddenByAdmin)
          ElevatedButton.icon(
            onPressed: provider.isSubmittingAction
                ? null
                : () => _confirmHide(context, provider, item),
            icon: const Icon(Icons.visibility_off_outlined, size: 18),
            label: const Text('Скрыть'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red.shade600,
              foregroundColor: Colors.white,
            ),
          ),
        if (item.isHiddenByAdmin)
          ElevatedButton.icon(
            onPressed: provider.isSubmittingAction
                ? null
                : () => _confirmUnhide(context, provider, item),
            icon: const Icon(Icons.visibility_outlined, size: 18),
            label: const Text('Показать снова'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green.shade700,
              foregroundColor: Colors.white,
            ),
          ),
        if (hasFlag)
          OutlinedButton.icon(
            onPressed: provider.isSubmittingAction
                ? null
                : () => _confirmDismiss(context, provider, item),
            icon: const Icon(Icons.flag_outlined, size: 18),
            label: const Text('Снять флаг'),
            style: OutlinedButton.styleFrom(
              foregroundColor: _orange,
              side: const BorderSide(color: _orange),
            ),
          ),
      ],
    );
  }

  Widget _labelValue(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 200,
          child: Text(
            label,
            style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }

  // ============================================================================
  // Action dialogs
  // ============================================================================

  Future<void> _confirmHide(
    BuildContext context,
    MenuItemsModerationProvider provider,
    FlaggedMenuItem item,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => _HideDialog(itemName: item.itemName),
    );
    if (reason == null) return;

    final ok = await provider.hideItem(item.id, reason);
    messenger.showSnackBar(
      SnackBar(
        content: Text(ok ? 'Позиция скрыта' : 'Ошибка скрытия позиции'),
        backgroundColor: ok ? Colors.green : Colors.red,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _confirmUnhide(
    BuildContext context,
    MenuItemsModerationProvider provider,
    FlaggedMenuItem item,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Показать снова?'),
        content: Text('Позиция «${item.itemName}» вернётся в результаты поиска.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Показать'),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    final ok = await provider.unhideItem(item.id);
    messenger.showSnackBar(
      SnackBar(
        content: Text(ok ? 'Позиция показана' : 'Ошибка'),
        backgroundColor: ok ? Colors.green : Colors.red,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _confirmDismiss(
    BuildContext context,
    MenuItemsModerationProvider provider,
    FlaggedMenuItem item,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Снять флаг?'),
        content: const Text(
            'Sanity flag будет очищен. Статус скрытия и причина скрытия (если есть) останутся без изменений.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Снять флаг'),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    final ok = await provider.dismissFlag(item.id);
    messenger.showSnackBar(
      SnackBar(
        content: Text(ok ? 'Флаг снят' : 'Ошибка'),
        backgroundColor: ok ? Colors.green : Colors.red,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

// ============================================================================
// Hide dialog with required reason (min 10 chars per directive)
// ============================================================================

class _HideDialog extends StatefulWidget {
  final String itemName;
  const _HideDialog({required this.itemName});

  @override
  State<_HideDialog> createState() => _HideDialogState();
}

class _HideDialogState extends State<_HideDialog> {
  final _reasonCtrl = TextEditingController();
  String? _validationError;

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    final reason = _reasonCtrl.text.trim();
    if (reason.length < 10) {
      setState(() =>
          _validationError = 'Минимум 10 символов (сейчас ${reason.length})');
      return;
    }
    Navigator.pop(context, reason);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Скрыть позицию'),
      content: SizedBox(
        width: 480,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Позиция «${widget.itemName}» не будет показываться в результатах поиска.',
              style: const TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _reasonCtrl,
              autofocus: true,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: 'Причина скрытия (минимум 10 символов)',
                border: const OutlineInputBorder(),
                errorText: _validationError,
              ),
              onChanged: (_) {
                if (_validationError != null) {
                  setState(() => _validationError = null);
                }
              },
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Отмена'),
        ),
        ElevatedButton(
          onPressed: _submit,
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.red.shade600,
            foregroundColor: Colors.white,
          ),
          child: const Text('Скрыть'),
        ),
      ],
    );
  }
}
