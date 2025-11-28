import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/environment.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';

/// Restaurant Guide Belarus v2.0 Mobile Application
/// Entry point for the Flutter application
void main() {
  // Ensure Flutter bindings are initialized
  WidgetsFlutterBinding.ensureInitialized();

  runApp(const RestaurantGuideApp());
}

/// Root application widget with state management
class RestaurantGuideApp extends StatelessWidget {
  const RestaurantGuideApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Wrap application in MultiProvider for state management
    return MultiProvider(
      providers: [
        // Authentication provider
        ChangeNotifierProvider(
          create: (_) => AuthProvider(),
        ),

        // Establishments provider
        ChangeNotifierProvider(
          create: (_) => EstablishmentsProvider(),
        ),

        // Additional providers can be added here as needed
      ],
      child: MaterialApp(
        title: 'Restaurant Guide Belarus',
        debugShowCheckedModeBanner: false,

        // Application theme from Phase B
        theme: AppTheme.lightTheme,

        // Home screen - placeholder for validation
        home: const PlaceholderHomeScreen(),
      ),
    );
  }
}

/// Placeholder home screen for Phase A validation
/// Will be replaced with proper navigation in Phase E
class PlaceholderHomeScreen extends StatelessWidget {
  const PlaceholderHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Restaurant Guide Belarus'),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.restaurant,
                size: 80,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: 24),
              Text(
                'Restaurant Guide Belarus',
                style: theme.textTheme.displaySmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Text(
                'Mobile Application v2.0',
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: theme.colorScheme.secondary,
                ),
              ),
              const SizedBox(height: 32),

              // Phase status card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Phase D: State Management Complete',
                        style: theme.textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 12),
                      _buildStatusRow(context, 'Environment', Environment.environmentName),
                      _buildStatusRow(context, 'API Base URL', Environment.apiBaseUrl),
                      _buildStatusRow(context, 'Theme', 'Material 3 Ready'),
                      _buildStatusRow(context, 'Providers', 'Active'),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 16),

              // Provider state demonstration
              Consumer<AuthProvider>(
                builder: (context, authProvider, child) {
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Provider State Demo',
                            style: theme.textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 12),
                          _buildStatusRow(
                            context,
                            'Auth Status',
                            authProvider.isAuthenticated ? 'Authenticated' : 'Not Authenticated',
                          ),
                          _buildStatusRow(
                            context,
                            'Auth Loading',
                            authProvider.isLoading ? 'Yes' : 'No',
                          ),
                          if (authProvider.user != null)
                            _buildStatusRow(
                              context,
                              'User Name',
                              authProvider.userName ?? 'N/A',
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),

              const SizedBox(height: 24),

              // Theme demonstration
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Theme Components Demo',
                        style: theme.textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () {},
                        child: const Text('Primary Button'),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: () {},
                        child: const Text('Outlined Button'),
                      ),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: () {},
                        child: const Text('Text Button'),
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 24),
              Text(
                'State management with Provider established.\nAuth and Establishments providers active.\nProceeding to Phase E: Navigation Framework.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.secondary,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusRow(BuildContext context, String label, String value) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(
            '$label: ',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.secondary,
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
