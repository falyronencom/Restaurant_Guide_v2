import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_list_panel.dart';

/// Main screen for "Ожидают просмотра" — pending moderation.
///
/// Three-panel layout: Sidebar (from AdminShell) | Card List | Detail Panel.
/// Loads pending list on init, provides ModerationProvider to children.
class PendingModerationScreen extends StatefulWidget {
  const PendingModerationScreen({super.key});

  @override
  State<PendingModerationScreen> createState() =>
      _PendingModerationScreenState();
}

class _PendingModerationScreenState extends State<PendingModerationScreen> {
  @override
  void initState() {
    super.initState();
    // Load pending establishments after first frame
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ModerationProvider>().loadPendingEstablishments();
    });
  }

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        // Middle panel: card list
        ModerationListPanel(),
        VerticalDivider(width: 1, thickness: 1),
        // Right panel: detail with tabs
        Expanded(
          child: ModerationDetailPanel(),
        ),
      ],
    );
  }
}
