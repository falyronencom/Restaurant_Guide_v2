import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/screens/debug/validation_screen.dart';

/// Search home screen - main tab for searching establishments
/// Full implementation in Phase Three
class SearchHomeScreen extends StatelessWidget {
  const SearchHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Поиск заведений'),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.search,
                size: 80,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: 24),
              Text(
                'Поиск заведений',
                style: theme.textTheme.headlineMedium,
              ),
              const SizedBox(height: 16),
              Text(
                'Найдите рестораны, кафе и бары\nпо всей Беларуси',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.secondary,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              Text(
                'Функционал поиска будет реализован\nв Phase Three',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.secondary,
                  fontStyle: FontStyle.italic,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              ElevatedButton.icon(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (context) => const ValidationScreen(),
                    ),
                  );
                },
                icon: const Icon(Icons.science),
                label: const Text('Test Backend Integration'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
