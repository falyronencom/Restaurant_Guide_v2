import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/search_home_screen.dart';
import 'package:restaurant_guide_mobile/screens/news/news_screen.dart';
import 'package:restaurant_guide_mobile/screens/map/map_screen.dart';
import 'package:restaurant_guide_mobile/screens/favorites/favorites_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/profile_screen.dart';

/// Main navigation screen with bottom tab bar
/// Manages tab switching and maintains separate navigation stacks per tab
class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _currentIndex = 0;

  // Track which tabs have been visited (for lazy loading heavy widgets like Map)
  final Set<int> _visitedTabs = {0}; // Start with Search tab visited

  // Navigator keys for each tab to maintain independent navigation stacks
  final List<GlobalKey<NavigatorState>> _navigatorKeys = [
    GlobalKey<NavigatorState>(), // Search
    GlobalKey<NavigatorState>(), // News
    GlobalKey<NavigatorState>(), // Map
    GlobalKey<NavigatorState>(), // Favorites
    GlobalKey<NavigatorState>(), // Profile
  ];

  /// Handle tab selection
  void _onTabSelected(int index) {
    if (index == _currentIndex) {
      // If tapping current tab, pop to root of that tab's navigation stack
      _navigatorKeys[index].currentState?.popUntil((route) => route.isFirst);
    } else {
      setState(() {
        _currentIndex = index;
        _visitedTabs.add(index); // Mark tab as visited for lazy loading
      });
      // Reload favorites when switching to Favorites tab (index 3)
      if (index == 3) {
        _reloadFavoritesIfAuthenticated();
      }
    }
  }

  /// Reload favorites list from server if user is authenticated
  void _reloadFavoritesIfAuthenticated() {
    final authProvider = context.read<AuthProvider>();
    if (authProvider.isAuthenticated) {
      context.read<EstablishmentsProvider>().loadFavorites();
    }
  }

  /// Handle back button press
  Future<bool> _onWillPop() async {
    // Try to pop the current tab's navigation stack
    final currentNavigator = _navigatorKeys[_currentIndex].currentState;
    if (currentNavigator != null && currentNavigator.canPop()) {
      currentNavigator.pop();
      return false; // Don't exit app
    }

    // If on search tab (index 0) and can't pop, allow exit
    if (_currentIndex == 0) {
      return true; // Exit app
    }

    // Otherwise, switch to search tab
    setState(() {
      _currentIndex = 0;
    });
    return false; // Don't exit app
  }

  /// Build navigator for specific tab
  Widget _buildTabNavigator(int index, Widget child) {
    return Navigator(
      key: _navigatorKeys[index],
      onGenerateRoute: (settings) {
        return MaterialPageRoute(
          builder: (context) => child,
          settings: settings,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (!didPop) {
          final shouldPop = await _onWillPop();
          if (shouldPop && context.mounted) {
            Navigator.of(context).pop();
          }
        }
      },
      child: Scaffold(
        body: IndexedStack(
          index: _currentIndex,
          children: [
            _buildTabNavigator(0, const SearchHomeScreen()),
            _buildTabNavigator(1, const NewsScreen()),
            // Lazy load MapScreen - only create when user visits the tab
            // This prevents Yandex Maps from blocking the main thread at startup
            _visitedTabs.contains(2)
                ? _buildTabNavigator(2, const MapScreen())
                : const SizedBox.shrink(),
            _buildTabNavigator(3, const FavoritesScreen()),
            _buildTabNavigator(4, const ProfileScreen()),
          ],
        ),
        bottomNavigationBar: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: _onTabSelected,
          type: BottomNavigationBarType.fixed,
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.search),
              label: 'Поиск',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.newspaper),
              label: 'Новости',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.map),
              label: 'Карта',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.favorite),
              label: 'Избранное',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.person),
              label: 'Профиль',
            ),
          ],
        ),
      ),
    );
  }
}
