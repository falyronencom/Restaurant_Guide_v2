import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';

/// Middle panel: filters header + scrollable list of flagged menu items.
class FlaggedMenuItemsListPanel extends StatelessWidget {
  const FlaggedMenuItemsListPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 480,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _FiltersHeader(),
          const Divider(height: 1),
          Expanded(child: _buildContent(context)),
        ],
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    final provider = context.watch<MenuItemsModerationProvider>();

    if (provider.isLoading && provider.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (provider.error != null && provider.items.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              provider.error!,
              style: const TextStyle(color: Colors.red),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => provider.loadFlaggedItems(),
              child: const Text('Повторить'),
            ),
          ],
        ),
      );
    }

    final items = provider.items;
    if (items.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Нет позиций, соответствующих фильтрам',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey),
          ),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: items.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, idx) {
        final item = items[idx];
        final isSelected = provider.selected?.id == item.id;
        return _FlaggedItemCard(
          item: item,
          isSelected: isSelected,
          onTap: () => provider.selectItem(item),
        );
      },
    );
  }
}

// ============================================================================
// Filters
// ============================================================================

class _FiltersHeader extends StatefulWidget {
  const _FiltersHeader();

  @override
  State<_FiltersHeader> createState() => _FiltersHeaderState();
}

class _FiltersHeaderState extends State<_FiltersHeader> {
  final _searchCtrl = TextEditingController();

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<MenuItemsModerationProvider>();
    final cities = provider.availableCities;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.filter_list, size: 18),
              const SizedBox(width: 8),
              const Text('Фильтры',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
              const Spacer(),
              Text(
                '${provider.items.length} из ${provider.totalFromServer}',
                style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
              ),
            ],
          ),
          const SizedBox(height: 12),
          // Search
          TextField(
            controller: _searchCtrl,
            decoration: InputDecoration(
              hintText: 'Поиск по названию / заведению',
              prefixIcon: const Icon(Icons.search, size: 18),
              border: const OutlineInputBorder(),
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 10,
              ),
              suffixIcon: _searchCtrl.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, size: 16),
                      onPressed: () {
                        _searchCtrl.clear();
                        provider.setSearchFilter('');
                        setState(() {});
                      },
                    )
                  : null,
            ),
            onChanged: (v) {
              provider.setSearchFilter(v);
              setState(() {});
            },
          ),
          const SizedBox(height: 8),
          // City + status
          Row(
            children: [
              Expanded(
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Город',
                    border: OutlineInputBorder(),
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String?>(
                      value: provider.cityFilter,
                      isDense: true,
                      isExpanded: true,
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('Все'),
                        ),
                        ...cities.map((c) => DropdownMenuItem<String?>(
                              value: c,
                              child: Text(c),
                            )),
                      ],
                      onChanged: provider.setCityFilter,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Статус',
                    border: OutlineInputBorder(),
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<HiddenStatusFilter>(
                      value: provider.statusFilter,
                      isDense: true,
                      isExpanded: true,
                      items: const [
                        DropdownMenuItem(
                            value: HiddenStatusFilter.all,
                            child: Text('Все')),
                        DropdownMenuItem(
                            value: HiddenStatusFilter.notHidden,
                            child: Text('Активные')),
                        DropdownMenuItem(
                            value: HiddenStatusFilter.hidden,
                            child: Text('Скрытые')),
                      ],
                      onChanged: (v) {
                        if (v != null) provider.setStatusFilter(v);
                      },
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// Card
// ============================================================================

class _FlaggedItemCard extends StatelessWidget {
  final FlaggedMenuItem item;
  final bool isSelected;
  final VoidCallback onTap;

  const _FlaggedItemCard({
    required this.item,
    required this.isSelected,
    required this.onTap,
  });

  static const Color _orange = Color(0xFFDB4F13);

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isSelected ? _orange.withValues(alpha: 0.06) : Colors.white,
      child: InkWell(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(
                color: isSelected ? _orange : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          padding: const EdgeInsets.fromLTRB(13, 12, 16, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      item.itemName,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (item.isHiddenByAdmin)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade200,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        'Скрыто',
                        style: TextStyle(
                          fontSize: 11,
                          color: Colors.grey.shade800,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                item.establishmentName +
                    (item.establishmentCity != null
                        ? ' · ${item.establishmentCity}'
                        : ''),
                style: TextStyle(
                  fontSize: 13,
                  color: Colors.grey.shade700,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (item.flagSnippet.isNotEmpty) ...[
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 6, vertical: 3),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF7E6),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: const Color(0xFFFFB800)),
                  ),
                  child: Text(
                    item.flagSnippet,
                    style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFF7A5B00),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 6),
              Text(
                DateFormat('dd.MM.yyyy').format(item.createdAt),
                style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
