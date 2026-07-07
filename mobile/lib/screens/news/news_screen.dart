import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/widgets/canon_app_bar.dart';

/// News screen - shows latest updates and promotions
/// Full implementation in future phases
class NewsScreen extends StatelessWidget {
  const NewsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: const CanonAppBar(title: 'Новости'),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.newspaper,
                size: 80,
                color: AppTheme.primaryOrange,
              ),
              const SizedBox(height: 24),
              Text(
                'Новости и акции',
                style: AppTheme.canonSheetTitle,
              ),
              const SizedBox(height: 16),
              const Text(
                'Актуальные новости от заведений\nи специальные предложения',
                style: TextStyle(fontSize: 15, color: AppTheme.textGrey),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
