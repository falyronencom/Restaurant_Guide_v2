import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/widgets/forms/error_banner.dart';
import 'package:restaurant_guide_mobile/widgets/forms/social_sign_in_buttons.dart';

/// Method Selection Screen
/// User chooses registration method: Email, Phone, or OAuth
class MethodSelectionScreen extends StatefulWidget {
  const MethodSelectionScreen({super.key});

  @override
  State<MethodSelectionScreen> createState() => _MethodSelectionScreenState();
}

class _MethodSelectionScreenState extends State<MethodSelectionScreen> {
  SocialSignIn? _oauthInProgress;
  String? _errorMessage;

  Future<void> _handleGoogleSignIn() => _signIn(
        SocialSignIn.google,
        (auth) => auth.loginWithGoogle(),
        'Ошибка входа через Google',
      );

  Future<void> _handleYandexSignIn() => _signIn(
        SocialSignIn.yandex,
        (auth) => auth.loginWithYandex(),
        'Ошибка входа через Яндекс',
      );

  /// Вход через сервис. Отказ — красной плашкой над кнопками, как на «Входе»:
  /// раньше здесь была всплывающая строка внизу, а на «Входе» — плашка.
  Future<void> _signIn(
    SocialSignIn provider,
    Future<bool> Function(AuthProvider auth) signIn,
    String fallback,
  ) async {
    setState(() {
      _oauthInProgress = provider;
      _errorMessage = null;
    });

    try {
      final authProvider = context.read<AuthProvider>();
      final success = await signIn(authProvider);

      if (success && mounted) {
        Navigator.of(context)
            .pushNamedAndRemoveUntil('/home', (route) => false);
      } else if (!success && mounted) {
        setState(() => _errorMessage = authProvider.errorMessage ?? fallback);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _errorMessage = fallback);
      }
    } finally {
      if (mounted) {
        setState(() => _oauthInProgress = null);
      }
    }
  }

  /// На главный экран гостем — «Пропустить» первого запуска.
  void _skip() {
    Navigator.of(context).pushNamedAndRemoveUntil('/home', (route) => false);
  }

  @override
  Widget build(BuildContext context) {
    // «Регистрация» первого запуска — корень стека (её открывает заставка),
    // и системное «Назад» здесь закрывало приложение. Ведём туда же, куда
    // «Пропустить» в шапке: на главный экран гостем. Открытая со «Входа» или
    // из профиля — обычный шаг назад.
    // Первый ли это экран своего маршрута, а не «пуст ли весь стек»: экран,
    // перестроенный под открытой поверх регистрацией по почте, иначе счёл
    // бы себя открытым со «Входа» и потерял «Пропустить».
    final isFirstLaunch = ModalRoute.of(context)?.isFirst ?? true;
    return PopScope(
      canPop: !isFirstLaunch,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        _skip();
      },
      child: _buildScreen(context, isFirstLaunch: isFirstLaunch),
    );
  }

  Widget _buildScreen(BuildContext context, {required bool isFirstLaunch}) {
    final theme = Theme.of(context);
    final isOAuthLoading = _oauthInProgress != null;

    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: AppBar(
        backgroundColor: AppTheme.backgroundWarm,
        elevation: 0,
        // Первый запуск: «Назад» некуда, стрелки нет — есть «Пропустить»
        // (проход тестировщика 17.10, пп. 2, 43). Раньше стрелка здесь
        // всегда вела на «Поиск», и открытая из профиля через «Вход»
        // регистрация не возвращала на «Вход» (п. 18).
        automaticallyImplyLeading: false,
        leading: isFirstLaunch
            ? null
            : IconButton(
                icon: const Icon(Icons.arrow_back, color: AppTheme.textDark),
                tooltip: 'Назад',
                onPressed: () => Navigator.of(context).maybePop(),
              ),
        actions: [
          if (isFirstLaunch)
            TextButton(
              onPressed: isOAuthLoading ? null : _skip,
              child: Text(
                'Пропустить',
                style: theme.textTheme.bodyLarge?.copyWith(
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                  color: AppTheme.textDark,
                ),
              ),
            ),
        ],
        title: Text(
          'Регистрация',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontFamily: AppTheme.fontDisplayFamily,
            fontSize: 25,
            fontWeight: FontWeight.w400,
            color: AppTheme.primaryOrangeDark,
          ),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
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
                onPressed: isOAuthLoading
                    ? null
                    : () {
                        Navigator.pushNamed(context, '/auth/email-registration');
                      },
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  side: const BorderSide(
                    color: AppTheme.primaryOrangeDark,
                    width: 1,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                  ),
                ),
                child: Text(
                  'Почта',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.primaryOrangeDark,
                  ),
                ),
              ),

              const SizedBox(height: 18),

              // Phone button
              OutlinedButton(
                onPressed: isOAuthLoading
                    ? null
                    : () {
                        Navigator.pushNamed(context, '/auth/phone-registration');
                      },
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  side: const BorderSide(
                    color: AppTheme.primaryOrangeDark,
                    width: 1,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                  ),
                ),
                child: Text(
                  'Номер телефона',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.primaryOrangeDark,
                  ),
                ),
              ),

              const SizedBox(height: 48),

              if (_errorMessage != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: ErrorBanner(
                    message: _errorMessage!,
                    onDismiss: () => setState(() => _errorMessage = null),
                  ),
                ),

              SocialSignInButtons(
                onGoogle: _handleGoogleSignIn,
                onYandex: _handleYandexSignIn,
                inProgress: _oauthInProgress,
              ),

              const SizedBox(height: 32),

              // Login link
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'Уже есть профиль? ',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 13,
                      color: const Color(0xFF5F5F5F).withValues(alpha: 0.7),
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
