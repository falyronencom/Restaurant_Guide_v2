import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

/// Screen for "Одобренные" — approved (active) establishments.
///
/// Three-panel layout: Sidebar (from AdminShell) | Card List | Detail Panel.
/// Supports:
/// - Filtering by city and sorting
/// - Search across all statuses (Approach A: integrated into this screen)
/// - Suspend action on active establishments
/// - Unsuspend action on suspended establishments found via search
class ApprovedScreen extends StatefulWidget {
  const ApprovedScreen({super.key});

  @override
  State<ApprovedScreen> createState() => _ApprovedScreenState();
}

class _ApprovedScreenState extends State<ApprovedScreen> {
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ApprovedProvider>().loadActiveEstablishments();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // Middle panel: card list with search/filter
        SizedBox(
          width: 400,
          child: Column(
            children: [
              // Search field
              _SearchHeader(
                controller: _searchController,
                onSearch: (query) {
                  context.read<ApprovedProvider>().searchEstablishments(query);
                },
                onClear: () {
                  _searchController.clear();
                  context.read<ApprovedProvider>().clearSearch();
                },
              ),

              // Sort / filter row
              _FilterBar(),

              const Divider(height: 1),

              // Card list
              Expanded(child: _CardList()),
            ],
          ),
        ),
        const VerticalDivider(width: 1, thickness: 1),

        // Right panel: detail
        Expanded(child: _DetailPanel()),
      ],
    );
  }
}

// =============================================================================
// Search Header
// =============================================================================

class _SearchHeader extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onSearch;
  final VoidCallback onClear;

  const _SearchHeader({
    required this.controller,
    required this.onSearch,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ApprovedProvider>();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: TextField(
        controller: controller,
        decoration: InputDecoration(
          hintText: 'Поиск заведений...',
          hintStyle: const TextStyle(
            fontSize: 15,
            color: Color(0xFFABABAB),
          ),
          prefixIcon:
              const Icon(Icons.search, color: Color(0xFFABABAB), size: 20),
          suffixIcon: provider.isSearchMode
              ? IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: onClear,
                )
              : null,
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: Color(0xFFD2D2D2)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: Color(0xFFD2D2D2)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: Color(0xFFF06B32)),
          ),
        ),
        onSubmitted: onSearch,
      ),
    );
  }
}

// =============================================================================
// Filter Bar
// =============================================================================

class _FilterBar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ApprovedProvider>();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Row(
        children: [
          const Icon(Icons.swap_vert, size: 20),
          const SizedBox(width: 4),
          // Sort dropdown
          DropdownButton<String>(
            value: provider.sort,
            underline: const SizedBox.shrink(),
            isDense: true,
            style: const TextStyle(fontSize: 14, color: Colors.black),
            items: const [
              DropdownMenuItem(value: 'newest', child: Text('Новые')),
              DropdownMenuItem(value: 'oldest', child: Text('Старые')),
              DropdownMenuItem(value: 'rating', child: Text('Рейтинг')),
              DropdownMenuItem(value: 'views', child: Text('Просмотры')),
            ],
            onChanged: (v) {
              if (v != null) provider.setSort(v);
            },
          ),
          const Spacer(),
          if (provider.isSearchMode)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0x1AF06B32),
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Text(
                'Все статусы',
                style: TextStyle(
                  fontSize: 12,
                  color: Color(0xFFF06B32),
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          if (!provider.isSearchMode && provider.totalCount > 0)
            Text(
              '${provider.totalCount}',
              style: TextStyle(fontSize: 14, color: Colors.grey.shade600),
            ),
        ],
      ),
    );
  }
}

// =============================================================================
// Card List
// =============================================================================

class _CardList extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ApprovedProvider>();

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
              onPressed: () => provider.loadActiveEstablishments(),
              child: const Text('Повторить'),
            ),
          ],
        ),
      );
    }

    if (provider.establishments.isEmpty) {
      return Center(
        child: Text(
          provider.isSearchMode
              ? 'Ничего не найдено'
              : 'Нет одобренных заведений',
          style: const TextStyle(fontSize: 16, color: Colors.grey),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: provider.establishments.length,
      itemBuilder: (context, index) {
        final item = provider.establishments[index];
        final isSelected = provider.selectedId == item.id;
        return _ApprovedCard(
          item: item,
          isSelected: isSelected,
          isSearchMode: provider.isSearchMode,
          onTap: () => provider.selectEstablishment(item.id),
        );
      },
    );
  }
}

// =============================================================================
// Card Widget
// =============================================================================

class _ApprovedCard extends StatelessWidget {
  final EstablishmentListItem item;
  final bool isSelected;
  final bool isSearchMode;
  final VoidCallback onTap;

  const _ApprovedCard({
    required this.item,
    required this.isSelected,
    required this.isSearchMode,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('dd.MM.yyyy');

    // Determine date to show
    DateTime? displayDate;
    if (item is ActiveEstablishmentItem) {
      displayDate = (item as ActiveEstablishmentItem).publishedAt;
    } else if (item is SearchResultItem) {
      displayDate = (item as SearchResultItem).publishedAt;
    }
    displayDate ??= item.updatedAt;

    final dateStr = displayDate != null ? dateFormat.format(displayDate) : '';

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
                        // Name + date
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

                        // Category + metrics for active items
                        if (item is ActiveEstablishmentItem) ...[
                          _buildActiveMetrics(item as ActiveEstablishmentItem),
                        ] else ...[
                          if (item.categories.isNotEmpty)
                            Text(
                              item.categories.first.toLowerCase(),
                              style: const TextStyle(fontSize: 15),
                            ),
                        ],

                        const Spacer(),

                        // Bottom row: city + status badge
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
                            // Status badge in search mode
                            if (isSearchMode && item is SearchResultItem)
                              _StatusBadge(
                                status: (item as SearchResultItem).status,
                                label: (item as SearchResultItem).statusLabel,
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

  Widget _buildActiveMetrics(ActiveEstablishmentItem active) {
    return Row(
      children: [
        if (active.averageRating > 0) ...[
          const Icon(Icons.star, size: 14, color: Color(0xFFF06B32)),
          const SizedBox(width: 2),
          Text(
            active.averageRating.toStringAsFixed(1),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
          const SizedBox(width: 8),
        ],
        Icon(Icons.visibility_outlined,
            size: 14, color: Colors.grey.shade500),
        const SizedBox(width: 2),
        Text(
          '${active.viewCount}',
          style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
        ),
        const SizedBox(width: 8),
        Icon(Icons.favorite_outline, size: 14, color: Colors.grey.shade500),
        const SizedBox(width: 2),
        Text(
          '${active.favoriteCount}',
          style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
        ),
      ],
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
// Status Badge
// =============================================================================

class _StatusBadge extends StatelessWidget {
  final String status;
  final String label;

  const _StatusBadge({required this.status, required this.label});

  @override
  Widget build(BuildContext context) {
    Color bgColor;
    Color textColor;

    switch (status) {
      case 'active':
        bgColor = const Color(0x1A3FD00D);
        textColor = const Color(0xFF3FD00D);
        break;
      case 'suspended':
        bgColor = const Color(0x1AFF9500);
        textColor = const Color(0xFFFF9500);
        break;
      case 'pending':
        bgColor = const Color(0x1AF06B32);
        textColor = const Color(0xFFF06B32);
        break;
      case 'draft':
        bgColor = const Color(0x1AABABAB);
        textColor = const Color(0xFFABABAB);
        break;
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
// Detail Panel (wraps ModerationDetailPanel with mode)
// =============================================================================

class _DetailPanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ApprovedProvider>();

    // Determine mode based on selected establishment status
    final detail = provider.selectedDetail;
    final isSuspended = detail?.status == 'suspended';

    return ModerationDetailPanel(
      mode: isSuspended ? DetailPanelMode.suspended : DetailPanelMode.readonly,
      detail: detail,
      isLoadingDetail: provider.isLoadingDetail,
      detailError: provider.detailError,
      selectedId: provider.selectedId,
      onSuspend: !isSuspended && detail != null
          ? (reason) => provider.suspendEstablishment(reason)
          : null,
      onUnsuspend: isSuspended
          ? () => provider.unsuspendEstablishment()
          : null,
    );
  }
}
