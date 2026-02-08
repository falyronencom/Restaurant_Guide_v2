import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_sidebar.dart';

/// Main layout shell with sidebar + content area
/// Used as ShellRoute builder — sidebar persists across navigation
class AdminShell extends StatelessWidget {
  final Widget child;

  const AdminShell({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Row(
        children: [
          const AdminSidebar(),
          const VerticalDivider(width: 1, thickness: 1),
          Expanded(
            child: Container(
              color: const Color(0xFFF9F9F9),
              child: child,
            ),
          ),
        ],
      ),
    );
  }
}
