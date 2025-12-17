import 'package:flutter/material.dart';

/// Method Selection Screen
/// User chooses registration method: Email, Phone, or OAuth
class MethodSelectionScreen extends StatelessWidget {
  const MethodSelectionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: const Color(0xFFF4F1EC),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF4F1EC),
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF3E3E3E)),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Регистрация',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontFamily: 'Unbounded',
            fontSize: 25,
            fontWeight: FontWeight.w400,
            color: const Color(0xFFDB4F13),
          ),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 32),

              // Description
              Text(
                'Войдите в аккаунт и начните свое путешествие по миру гастраномии',
                style: theme.textTheme.bodyLarge?.copyWith(
                  fontSize: 16,
                  height: 1.25,
                ),
              ),

              const SizedBox(height: 48),

              // Email button
              OutlinedButton(
                onPressed: () {
                  Navigator.pushNamed(context, '/auth/email-registration');
                },
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  side: const BorderSide(
                    color: Color(0xFFDB4F13),
                    width: 1,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: Text(
                  'Почта',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                    color: const Color(0xFFDB4F13),
                  ),
                ),
              ),

              const SizedBox(height: 18),

              // Phone button
              OutlinedButton(
                onPressed: () {
                  Navigator.pushNamed(context, '/auth/phone-registration');
                },
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  side: const BorderSide(
                    color: Color(0xFFDB4F13),
                    width: 1,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: Text(
                  'Номер телефона',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                    color: const Color(0xFFDB4F13),
                  ),
                ),
              ),

              const SizedBox(height: 48),

              // OAuth section
              Text(
                'Или используйте:',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontSize: 15,
                  color: Colors.black.withOpacity(0.7),
                ),
              ),

              const SizedBox(height: 16),

              // Google button
              OutlinedButton(
                onPressed: () {
                  // TODO: Implement Google OAuth
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Google OAuth coming soon'),
                    ),
                  );
                },
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  side: const BorderSide(
                    color: Colors.black,
                    width: 1,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(11),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // TODO: Add Google logo icon
                    Text(
                      'Продолжить с Google',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontSize: 15,
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 12),

              // Apple button
              ElevatedButton(
                onPressed: () {
                  // TODO: Implement Apple OAuth
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Apple OAuth coming soon'),
                    ),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(11),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // TODO: Add Apple logo icon
                    Text(
                      'Продолжить с Apple',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontSize: 15,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),

              const Spacer(),

              // Login link
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'Уже есть профиль? ',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 13,
                      color: const Color(0xFF5F5F5F).withOpacity(0.7),
                    ),
                  ),
                  GestureDetector(
                    onTap: () {
                      Navigator.pushNamed(context, '/auth/login');
                    },
                    child: Text(
                      'Войти',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontSize: 13,
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
