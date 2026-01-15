import 'package:flutter/material.dart';

/// Map screen - temporary placeholder while Yandex MapKit compatibility is being resolved
/// The full implementation with Yandex Maps will be restored once the plugin is updated
class MapScreen extends StatelessWidget {
  const MapScreen({super.key});

  // Colors
  static const Color _primaryOrange = Color(0xFFFD5F1B);
  static const Color _creamBackground = Color(0xFFF4F1EC);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _creamBackground,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Map icon
                Container(
                  width: 120,
                  height: 120,
                  decoration: BoxDecoration(
                    color: _primaryOrange.withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.map_outlined,
                    size: 64,
                    color: _primaryOrange,
                  ),
                ),

                const SizedBox(height: 32),

                // Title
                const Text(
                  'Карта скоро будет доступна',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w600,
                    color: Colors.black87,
                  ),
                  textAlign: TextAlign.center,
                ),

                const SizedBox(height: 16),

                // Description
                Text(
                  'Мы работаем над интеграцией карты Яндекс.\n'
                  'Пока вы можете найти заведения через поиск или список на главной.',
                  style: TextStyle(
                    fontSize: 16,
                    color: Colors.grey[600],
                    height: 1.5,
                  ),
                  textAlign: TextAlign.center,
                ),

                const SizedBox(height: 32),

                // Location indicator (decorative)
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.location_on,
                      color: _primaryOrange.withValues(alpha: 0.5),
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Минск, Беларусь',
                      style: TextStyle(
                        fontSize: 14,
                        color: Colors.grey[500],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
