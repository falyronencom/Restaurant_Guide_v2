import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/widgets/canon_app_bar.dart';

/// News screen - shows latest updates and promotions
/// Full implementation in future phases
class NewsScreen extends StatelessWidget {
  const NewsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: CanonAppBar(title: 'Новости'),
      body: Center(
        child: Padding(
          padding: EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.newspaper,
                size: 80,
                color: AppTheme.primaryOrange,
              ),
              SizedBox(height: 24),
              Text(
                'Новости и акции',
                style: AppTheme.canonSheetTitle,
              ),
              SizedBox(height: 16),
              Text(
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
