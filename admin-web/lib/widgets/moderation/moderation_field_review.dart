import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';

/// Reusable widget for reviewing a single moderable field.
///
/// Displays field label, value content, and three action buttons
/// (approve, reject, comment). Maintains visual state via ModerationProvider.
/// Used 14 times across 4 moderation tabs.
class ModerationFieldReview extends StatelessWidget {
  final String fieldName;
  final String label;
  final bool isRequired;
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
    final provider = context.watch<ModerationProvider>();
    final state = provider.getFieldState(fieldName);

    Color? bgColor;
    if (state.status == FieldReviewStatus.approved) {
      bgColor = const Color(0x1A3FD00D); // green 10%
    } else if (state.status == FieldReviewStatus.rejected) {
      bgColor = const Color(0x1AFF3B30); // red 10%
    }

    return Container(
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(8),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Label row
          Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w500,
                        color: Colors.black,
                      ),
                    ),
                    if (isRequired)
                      const Padding(
                        padding: EdgeInsets.only(left: 4),
                        child: Text(
                          '*',
                          style: TextStyle(
                            color: Color(0xFFF06B32),
                            fontSize: 18,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // Field content
          child,
          const SizedBox(height: 12),

          // Action buttons row
          Row(
            children: [
              _ActionButton(
                icon: Icons.check,
                isActive: state.status == FieldReviewStatus.approved,
                activeColor: const Color(0xFF3FD00D),
                tooltip: 'Одобрить',
                onTap: () {
                  if (state.status == FieldReviewStatus.approved) {
                    provider.resetField(fieldName);
                  } else {
                    provider.approveField(fieldName);
                  }
                },
              ),
              const SizedBox(width: 12),
              _ActionButton(
                icon: Icons.close,
                isActive: state.status == FieldReviewStatus.rejected,
                activeColor: const Color(0xFFFF3B30),
                tooltip: 'Отклонить',
                onTap: () {
                  if (state.status == FieldReviewStatus.rejected) {
                    provider.resetField(fieldName);
                  } else {
                    _showRejectDialog(context, provider);
                  }
                },
              ),
              const SizedBox(width: 12),
              _ActionButton(
                icon: Icons.chat_bubble_outline,
                isActive: state.comment != null && state.comment!.isNotEmpty,
                activeColor: const Color(0xFFF06B32),
                tooltip: 'Комментарий',
                onTap: () => _showCommentDialog(context, provider),
              ),
            ],
          ),

          // Show comment text if present
          if (state.comment != null && state.comment!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                state.comment!,
                style: TextStyle(
                  fontSize: 13,
                  color: Colors.grey.shade700,
                ),
              ),
            ),
          ],

          const SizedBox(height: 8),
          const Divider(color: Color(0xFFD2D2D2), height: 1),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  void _showRejectDialog(BuildContext context, ModerationProvider provider) {
    final controller = TextEditingController(
      text: provider.getFieldState(fieldName).comment ?? '',
    );

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Отклонить: $label'),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(
            hintText: 'Причина отклонения...',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              provider.rejectField(fieldName, comment: controller.text);
              Navigator.pop(ctx);
            },
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFFF3B30),
            ),
            child: const Text('Отклонить'),
          ),
        ],
      ),
    );
  }

  void _showCommentDialog(BuildContext context, ModerationProvider provider) {
    final controller = TextEditingController(
      text: provider.getFieldState(fieldName).comment ?? '',
    );

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Комментарий: $label'),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(
            hintText: 'Ваш комментарий...',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              provider.commentField(fieldName, controller.text);
              Navigator.pop(ctx);
            },
            child: const Text('Сохранить'),
          ),
        ],
      ),
    );
  }
}

/// Single action button (approve / reject / comment)
class _ActionButton extends StatelessWidget {
  final IconData icon;
  final bool isActive;
  final Color activeColor;
  final String tooltip;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.isActive,
    required this.activeColor,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: isActive ? activeColor : null,
            border: Border.all(
              color: isActive ? activeColor : const Color(0xFFD2D2D2),
            ),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(
            icon,
            color: isActive ? Colors.white : const Color(0xFFD2D2D2),
            size: 22,
          ),
        ),
      ),
    );
  }
}
