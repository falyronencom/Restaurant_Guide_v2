import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

/// Screen for "Отказанные" — rejected establishments (history from audit log).
///
/// Three-panel layout: Sidebar (from AdminShell) | Card List | Detail Panel.
/// Purely informational — no action buttons. Shows rejection reasons
/// prominently in the detail panel.
class RejectedScreen extends StatefulWidget {
  const RejectedScreen({super.key});

  @override
  State<RejectedScreen> createState() => _RejectedScreenState();
}

class _RejectedScreenState extends State<RejectedScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<RejectedProvider>().loadRejectedEstablishments();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // Middle panel: card list
        SizedBox(
          width: 400,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Row(
                  children: [
                    const Icon(Icons.swap_vert, size: 20),
                    const SizedBox(width: 8),
                    const Text(
                      'По дате отказа',
                      style: TextStyle(fontSize: 16),
                    ),
                    const Spacer(),
                    Consumer<RejectedProvider>(
                      builder: (_, provider, __) {
                        if (provider.totalCount > 0) {
                          return Text(
                            '${provider.totalCount}',
                            style: TextStyle(
                              fontSize: 14,
                              color: Colors.grey.shade600,
                            ),
                          );
                        }
                        return const SizedBox.shrink();
                      },
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),

              // Card list
              Expanded(child: _RejectedCardList()),
            ],
          ),
        ),
        const VerticalDivider(width: 1, thickness: 1),

        // Right panel: detail with rejection reasons
        Expanded(child: _DetailPanel()),
      ],
    );
  }
}

// =============================================================================
// Card List
// =============================================================================

class _RejectedCardList extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<RejectedProvider>();

    if (provider.isLoadingList) {
      return const Center(child: CircularProgressIndicator());
    }

    if (provider.listError != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              provider.listError!,
              style: const TextStyle(color: Colors.red),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => provider.loadRejectedEstablishments(),
              child: const Text('Повторить'),
            ),
          ],
        ),
      );
    }

    if (provider.rejections.isEmpty) {
      return const Center(
        child: Text(
          'Нет отклонённых заведений',
          style: TextStyle(fontSize: 16, color: Colors.grey),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: provider.rejections.length,
      itemBuilder: (context, index) {
        final item = provider.rejections[index];
        final isSelected =
            provider.selectedId == item.establishmentId;
        return _RejectedCard(
          item: item,
          isSelected: isSelected,
          onTap: () => provider.selectEstablishment(item),
        );
      },
    );
  }
}

// =============================================================================
// Card Widget
// =============================================================================

class _RejectedCard extends StatelessWidget {
  final RejectedEstablishmentItem item;
  final bool isSelected;
  final VoidCallback onTap;

  const _RejectedCard({
    required this.item,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('dd.MM.yyyy');
    final dateStr = item.rejectionDate != null
        ? dateFormat.format(item.rejectionDate!)
        : '';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            height: 116,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: isSelected
                    ? const Color(0xFFEC723D)
                    : Colors.transparent,
                width: isSelected ? 1.5 : 1,
              ),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x08D35620),
                  blurRadius: 15,
                  spreadRadius: 2,
                  offset: Offset(4, 4),
                ),
                BoxShadow(
                  color: Color(0x08D35620),
                  blurRadius: 15,
                  spreadRadius: 2,
                  offset: Offset(-4, -4),
                ),
              ],
            ),
            child: Row(
              children: [
                // Thumbnail
                ClipRRect(
                  borderRadius: const BorderRadius.horizontal(
                    left: Radius.circular(10),
                  ),
                  child: SizedBox(
                    width: 107,
                    height: 116,
                    child: item.thumbnailUrl != null
                        ? Image.network(
                            item.thumbnailUrl!,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) =>
                                _placeholderImage(),
                          )
                        : _placeholderImage(),
                  ),
                ),

                // Info
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Name + rejection date
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                item.name,
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w500,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            Text(
                              dateStr,
                              style: const TextStyle(
                                fontSize: 13,
                                color: Color(0xFFABABAB),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 2),

                        // Category
                        if (item.categories.isNotEmpty)
                          Text(
                            item.categories.first.toLowerCase(),
                            style: const TextStyle(fontSize: 15),
                          ),

                        const Spacer(),

                        // Bottom: city + current status
                        Row(
                          children: [
                            if (item.city != null)
                              Expanded(
                                child: Text(
                                  item.city!,
                                  style: const TextStyle(fontSize: 14),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            _CurrentStatusBadge(
                              status: item.currentStatus,
                              label: item.statusLabel,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _placeholderImage() {
    return Container(
      color: const Color(0xFFF5F5F5),
      child: const Center(
        child: Icon(Icons.restaurant, color: Color(0xFFD2D2D2), size: 36),
      ),
    );
  }
}

// =============================================================================
// Current Status Badge
// =============================================================================

class _CurrentStatusBadge extends StatelessWidget {
  final String status;
  final String label;

  const _CurrentStatusBadge({required this.status, required this.label});

  @override
  Widget build(BuildContext context) {
    Color bgColor;
    Color textColor;

    switch (status) {
      case 'pending':
        bgColor = const Color(0x1AF06B32);
        textColor = const Color(0xFFF06B32);
        break;
      case 'draft':
      default:
        bgColor = const Color(0x1AABABAB);
        textColor = const Color(0xFFABABAB);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: textColor,
        ),
      ),
    );
  }
}

// =============================================================================
// Detail Panel
// =============================================================================

class _DetailPanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<RejectedProvider>();

    // Get rejection notes from the selected rejection item
    final rejectionNotes = provider.selectedRejection?.rejectionNotes;

    return ModerationDetailPanel(
      mode: DetailPanelMode.readonly,
      detail: provider.selectedDetail,
      isLoadingDetail: provider.isLoadingDetail,
      detailError: provider.detailError,
      selectedId: provider.selectedId,
      rejectionNotes: rejectionNotes,
    );
  }
}
