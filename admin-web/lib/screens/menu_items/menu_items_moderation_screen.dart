import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/menu_items/flagged_menu_items_list_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/menu_items/menu_item_detail_panel.dart';

/// Admin dashboard for flagged (sanity_flag != NULL) menu items.
///
/// Layout: AdminSidebar (global) | FlaggedMenuItemsListPanel | MenuItemDetailPanel.
/// Simpler than establishment moderation — no tabs in the detail panel because
/// a menu item has fewer moderation dimensions than a full establishment.
class MenuItemsModerationScreen extends StatefulWidget {
  const MenuItemsModerationScreen({super.key});

  @override
  State<MenuItemsModerationScreen> createState() =>
      _MenuItemsModerationScreenState();
}

class _MenuItemsModerationScreenState extends State<MenuItemsModerationScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<MenuItemsModerationProvider>().loadFlaggedItems();
    });
  }

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        FlaggedMenuItemsListPanel(),
        VerticalDivider(width: 1, thickness: 1),
        Expanded(child: MenuItemDetailPanel()),
      ],
    );
  }
}
