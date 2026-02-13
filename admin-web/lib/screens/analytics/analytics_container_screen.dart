import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/establishments_analytics_tab.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/reviews_analytics_tab.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/users_analytics_tab.dart';

/// Container screen for analytics tabs: Заведения, Пользователи, Отзывы и оценки.
/// Uses TabBar/TabBarView for tab navigation within the analytics section.
class AnalyticsContainerScreen extends StatefulWidget {
  const AnalyticsContainerScreen({super.key});

  @override
  State<AnalyticsContainerScreen> createState() =>
      _AnalyticsContainerScreenState();
}

class _AnalyticsContainerScreenState extends State<AnalyticsContainerScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  static const _tabs = [
    Tab(text: 'Заведения'),
    Tab(text: 'Пользователи'),
    Tab(text: 'Отзывы и оценки'),
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _tabs.length, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header + tabs
        Container(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Статистика и аналитика',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF1A1A1A),
                ),
              ),
              const SizedBox(height: 16),
              TabBar(
                controller: _tabController,
                isScrollable: true,
                labelColor: const Color(0xFFF06B32),
                unselectedLabelColor: Colors.grey[600],
                indicatorColor: const Color(0xFFF06B32),
                indicatorWeight: 3,
                labelStyle: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
                unselectedLabelStyle: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w400,
                ),
                tabs: _tabs,
                tabAlignment: TabAlignment.start,
              ),
            ],
          ),
        ),
        const Divider(height: 1),

        // Tab content
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: const [
              EstablishmentsAnalyticsTab(),
              UsersAnalyticsTab(),
              ReviewsAnalyticsTab(),
            ],
          ),
        ),
      ],
    );
  }
}
