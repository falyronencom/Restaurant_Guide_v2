import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

/// Screen for "Приостановленные" — suspended establishments.
///
/// Three-panel layout: Sidebar (from AdminShell) | Card List | Detail Panel.
/// Shows suspended establishments with reasons and dates.
/// The detail panel includes "Возобновить" (unsuspend) button.
class SuspendedScreen extends StatefulWidget {
  const SuspendedScreen({super.key});

  @override
  State<SuspendedScreen> createState() => _SuspendedScreenState();
}

class _SuspendedScreenState extends State<SuspendedScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SuspendedProvider>().loadSuspendedEstablishments();
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
                      'По дате приостановки',
                      style: TextStyle(fontSize: 16),
                    ),
                    const Spacer(),
                    Consumer<SuspendedProvider>(
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
              Expanded(child: _SuspendedCardList()),
            ],
          ),
        ),
        const VerticalDivider(width: 1, thickness: 1),

        // Right panel: detail with unsuspend action
        Expanded(child: _DetailPanel()),
      ],
    );
  }
}

// =============================================================================
// Card List
// =============================================================================

class _SuspendedCardList extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<SuspendedProvider>();

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
              onPressed: () => provider.loadSuspendedEstablishments(),
              child: const Text('Повторить'),
            ),
          ],
        ),
      );
    }

    if (provider.establishments.isEmpty) {
      return const Center(
        child: Text(
          'Нет приостановленных заведений',
          style: TextStyle(fontSize: 16, color: Colors.grey),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: provider.establishments.length,
      itemBuilder: (context, index) {
        final item = provider.establishments[index];
        final isSelected = provider.selectedId == item.id;
        return _SuspendedCard(
          item: item,
          isSelected: isSelected,
          onTap: () => provider.selectEstablishment(item.id),
        );
      },
    );
  }
}

// =============================================================================
// Card Widget
// =============================================================================

class _SuspendedCard extends StatelessWidget {
  final SuspendedEstablishmentItem item;
  final bool isSelected;
  final VoidCallback onTap;

  const _SuspendedCard({
    required this.item,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('dd.MM.yyyy');
    final dateStr = item.suspendedAt != null
        ? dateFormat.format(item.suspendedAt!)
        : item.updatedAt != null
            ? dateFormat.format(item.updatedAt!)
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
                        // Name + suspension date
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

                        // Suspend reason (amber text)
                        if (item.suspendReason != null &&
                            item.suspendReason!.isNotEmpty)
                          Text(
                            item.suspendReason!,
                            style: const TextStyle(
                              fontSize: 14,
                              color: Color(0xFFFF9500),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),

                        const Spacer(),

                        // Bottom: city + suspended badge
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
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0x1AFF9500),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: const Text(
                                'Приостановлено',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: Color(0xFFFF9500),
                                ),
                              ),
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
// Detail Panel
// =============================================================================

class _DetailPanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<SuspendedProvider>();

    return ModerationDetailPanel(
      mode: DetailPanelMode.suspended,
      detail: provider.selectedDetail,
      isLoadingDetail: provider.isLoadingDetail,
      detailError: provider.detailError,
      selectedId: provider.selectedId,
      onUnsuspend: () => provider.unsuspendEstablishment(),
    );
  }
}
