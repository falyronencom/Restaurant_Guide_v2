import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/auth/email_verification_screen.dart';
import 'package:restaurant_guide_mobile/utils/error_helpers.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';
import 'package:restaurant_guide_mobile/widgets/forms/custom_text_field.dart';
import 'package:restaurant_guide_mobile/widgets/forms/password_strength_indicator.dart';
import 'package:restaurant_guide_mobile/widgets/forms/submit_button.dart';
import 'package:restaurant_guide_mobile/widgets/forms/error_banner.dart';

/// Email Registration Screen
/// User enters name, email, password to create account
class EmailRegistrationScreen extends StatefulWidget {
  const EmailRegistrationScreen({super.key});

  @override
  State<EmailRegistrationScreen> createState() =>
      _EmailRegistrationScreenState();
}

class _EmailRegistrationScreenState extends State<EmailRegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  bool _isLoading = false;
  String? _errorMessage;

  /// Плашка отказа стоит над полями, а кнопка «Продолжить» — внизу формы:
  /// после отказа экран прокручивается к плашке, иначе её можно не увидеть.
  final _errorBannerKey = GlobalKey();

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  /// Handle form submission
  Future<void> _handleSubmit() async {
    // Clear previous error
    setState(() {
      _errorMessage = null;
    });

    // Validate form
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final authProvider = context.read<AuthProvider>();

      final name = normalizeName(_nameController.text);
      final ok = await authProvider.registerWithEmail(
        email: _emailController.text.trim(),
        password: _passwordController.text,
        name: name,
      );

      if (!mounted) return;

      // Отказ сервера (почта или номер заняты, имя не прошло правило, лимит
      // попыток, нет связи) провайдер не бросает, а возвращает `false` с
      // текстом в `errorMessage`. Раньше результат не читался, и экран при
      // любом отказе открывал ввод кода от письма, которого не было
      // (проход тестировщика 17.10, Х1). Теперь — остаёмся на форме.
      if (!ok) {
        _showError(authProvider.errorMessage ??
            'Не удалось зарегистрироваться. Попробуйте ещё раз.');
        return;
      }

      // Check if auto-login succeeded
      if (authProvider.isAuthenticated) {
        // Главный экран, а поверх него — ввод кода из письма регистрации,
        // как на сайте; «Позже» и «назад» возвращают на главный. Раньше
        // открывался сразу главный, и подтвердить почту можно было только из
        // «Профиля», который слал новое письмо, — код первого письма гас, и
        // человек видел «Неверный код» (сводка находок, группа Б, 30.10).
        final navigator = Navigator.of(context);
        navigator.pushNamedAndRemoveUntil('/home', (route) => false);
        if (authProvider.currentUser?.emailVerified != true) {
          navigator.pushNamed(
            '/auth/email-verification',
            arguments: {EmailVerificationScreen.codeJustSentArg: true},
          );
        }
      } else {
        // Navigate to email verification screen
        // Pass name to update profile after verification
        Navigator.pushNamed(
          context,
          '/auth/email-verification',
          arguments: {
            'email': _emailController.text.trim(),
            'name': name,
            EmailVerificationScreen.codeJustSentArg: true,
          },
        );
      }
    } catch (e) {
      if (mounted) _showError(getHumanErrorMessage(e));
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _showError(String message) {
    setState(() => _errorMessage = message);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final banner = _errorBannerKey.currentContext;
      if (banner == null) return;
      Scrollable.ensureVisible(
        banner,
        duration: const Duration(milliseconds: 300),
        alignment: 0.1,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: AppBar(
        backgroundColor: AppTheme.backgroundWarm,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.textDark),
          onPressed: () => Navigator.pop(context),
        ),
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
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 32),

                // Section header
                Text(
                  'О вас',
                  style: theme.textTheme.headlineMedium?.copyWith(
                    fontSize: 22,
                    fontWeight: FontWeight.w500,
                    height: 1.18, // 26/22
                  ),
                ),

                const SizedBox(height: 8),

                // Description
                Text(
                  'Введите свои данные, имя и почта будут видны для остальных пользователей',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontSize: 15,
                    height: 1.53, // 23/15
                  ),
                ),

                const SizedBox(height: 32),

                // Error banner
                if (_errorMessage != null)
                  Padding(
                    key: _errorBannerKey,
                    padding: const EdgeInsets.only(bottom: 16),
                    child: ErrorBanner(
                      message: _errorMessage!,
                      onDismiss: () {
                        setState(() {
                          _errorMessage = null;
                        });
                      },
                    ),
                  ),

                // Name field
                CustomTextField(
                  controller: _nameController,
                  label: 'Имя',
                  keyboardType: TextInputType.name,
                  textInputAction: TextInputAction.next,
                  validator: validateName,
                  enabled: !_isLoading,
                ),

                const SizedBox(height: 18),

                // Email field
                CustomTextField(
                  controller: _emailController,
                  label: 'Почта',
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  validator: validateEmail,
                  enabled: !_isLoading,
                ),

                const SizedBox(height: 18),

                // Password field
                CustomTextField(
                  controller: _passwordController,
                  label: 'Пароль',
                  obscureText: true,
                  textInputAction: TextInputAction.next,
                  validator: validatePassword,
                  enabled: !_isLoading,
                ),

                // Требования к паролю — видны с пустого поля, отмечаются по
                // мере ввода; полоса надёжности — с первого символа.
                ValueListenableBuilder(
                  valueListenable: _passwordController,
                  builder: (context, value, child) {
                    return PasswordStrengthIndicator(
                      password: value.text,
                    );
                  },
                ),

                const SizedBox(height: 18),

                // Confirm password field
                CustomTextField(
                  controller: _confirmPasswordController,
                  label: 'Подтвердите пароль',
                  obscureText: true,
                  textInputAction: TextInputAction.done,
                  validator: (value) => validatePasswordMatch(
                    value,
                    _passwordController.text,
                  ),
                  enabled: !_isLoading,
                  onFieldSubmitted: (_) => _handleSubmit(),
                ),

                const SizedBox(height: 48),

                // Submit button
                SubmitButton(
                  label: 'Продолжить',
                  onPressed: _handleSubmit,
                  isLoading: _isLoading,
                ),

                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
