import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/environment.dart';

/// Restaurant Guide Belarus v2.0 Mobile Application
/// Entry point for the Flutter application
void main() {
  // Ensure Flutter bindings are initialized
  WidgetsFlutterBinding.ensureInitialized();

  runApp(const RestaurantGuideApp());
}

/// Root application widget
class RestaurantGuideApp extends StatelessWidget {
  const RestaurantGuideApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Restaurant Guide Belarus',
      debugShowCheckedModeBanner: false,

      // Theme will be configured in Phase B
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF6B35), // Orange primary color
        ),
        useMaterial3: true,
      ),

      // Home screen - placeholder for Phase A
      home: const PlaceholderHomeScreen(),
    );
  }
}

/// Placeholder home screen for Phase A validation
/// Will be replaced with proper navigation in Phase E
class PlaceholderHomeScreen extends StatelessWidget {
  const PlaceholderHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Restaurant Guide Belarus'),
        backgroundColor: const Color(0xFFFF6B35),
        foregroundColor: Colors.white,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.restaurant,
                size: 80,
                color: Color(0xFFFF6B35),
              ),
              const SizedBox(height: 24),
              const Text(
                'Restaurant Guide Belarus',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              const Text(
                'Mobile Application v2.0',
                style: TextStyle(
                  fontSize: 16,
                  color: Colors.grey,
                ),
              ),
              const SizedBox(height: 32),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.grey[100],
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Phase A: Project Structure Complete',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 12),
                    _buildStatusRow('Environment', Environment.environmentName),
                    _buildStatusRow('API Base URL', Environment.apiBaseUrl),
                    _buildStatusRow('Flutter', 'Ready'),
                    _buildStatusRow('Platform', 'Android & iOS'),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Foundation architecture established.\nProceeding to Phase B: Design System.',
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(
            '$label: ',
            style: const TextStyle(
              color: Colors.grey,
              fontSize: 14,
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
