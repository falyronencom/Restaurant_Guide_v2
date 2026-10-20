import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Неизвестный адрес панели — устаревшая закладка или опечатка.
///
/// До 20.10.2026 здесь была стандартная страница `go_router`: «Page Not
/// Found», текст исключения и «Go to home page» (проход по панели
/// модератора, пункт A3-25). Раскладка — как у кадра инициализации: вордмарк
/// по центру, под ним объяснение и один выход.
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                'NIRIVIO',
                textAlign: TextAlign.center,
                style:
                    AppTheme.canonWordmark.copyWith(fontSize: 30, height: 1.1),
              ),
              const SizedBox(height: 24),
              const Text(
                'Такой страницы нет',
                textAlign: TextAlign.center,
                style: AppTheme.canonSubsectionHeader,
              ),
              const SizedBox(height: 8),
              const Text(
                'Возможно, ссылка устарела или в адресе опечатка.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: AppTheme.textSecondary),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () => context.go('/'),
                style: AppTheme.canonCtaL(),
                child: const Text('На главную'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
