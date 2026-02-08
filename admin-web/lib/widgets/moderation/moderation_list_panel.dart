import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';

/// Middle panel: scrollable list of establishment cards pending review.
///
/// Matches Figma card layout: thumbnail, name, category, cuisine tag,
/// address, date. Orange border on selected card.
class ModerationListPanel extends StatelessWidget {
  const ModerationListPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ModerationProvider>();

    return SizedBox(
      width: 400,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Sort header
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(
              children: [
                const Icon(Icons.swap_vert, size: 20),
                const SizedBox(width: 8),
                const Text(
                  'Сортировка',
                  style: TextStyle(fontSize: 16),
                ),
                const Spacer(),
                if (provider.totalCount > 0)
                  Text(
                    '${provider.totalCount}',
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.grey.shade600,
                    ),
                  ),
              ],
            ),
          ),
          const Divider(height: 1),

          // List content
          Expanded(
            child: _buildContent(context, provider),
          ),
        ],
      ),
    );
  }

  Widget _buildContent(BuildContext context, ModerationProvider provider) {
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
              onPressed: () => provider.loadPendingEstablishments(),
              child: const Text('Повторить'),
            ),
          ],
        ),
      );
    }

    if (provider.establishments.isEmpty) {
      return const Center(
        child: Text(
          'Нет заведений на модерации',
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
        return _EstablishmentCard(
          item: item,
          isSelected: isSelected,
          onTap: () => provider.selectEstablishment(item.id),
        );
      },
    );
  }
}

/// Single establishment card in the pending list
class _EstablishmentCard extends StatelessWidget {
  final EstablishmentListItem item;
  final bool isSelected;
  final VoidCallback onTap;

  const _EstablishmentCard({
    required this.item,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('dd.MM.yyyy');
    final dateStr = item.updatedAt != null
        ? dateFormat.format(item.updatedAt!)
        : '';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        elevation: 0,
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
                        // Name + date row
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
                            style: const TextStyle(
                              fontSize: 15,
                              color: Colors.black,
                            ),
                          ),

                        // Cuisine tag
                        if (item.cuisines.isNotEmpty)
                          Text(
                            '{${item.cuisines.first.toLowerCase()}}',
                            style: const TextStyle(
                              fontSize: 13,
                              color: Color(0xFFABABAB),
                            ),
                          ),

                        const Spacer(),

                        // Address (city)
                        if (item.city != null)
                          Text(
                            item.city!,
                            style: const TextStyle(
                              fontSize: 14,
                              color: Colors.black,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
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
