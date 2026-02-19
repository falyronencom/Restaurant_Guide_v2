import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/utils/error_helpers.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';
import 'package:restaurant_guide_mobile/widgets/forms/custom_text_field.dart';
import 'package:restaurant_guide_mobile/widgets/forms/error_banner.dart';

/// Login Screen
/// User enters email/phone and password to sign in
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailPhoneController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _emailPhoneController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  /// Validate email or phone number
  String? _validateEmailOrPhone(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'Введите email или номер телефона';
    }

    final trimmed = value.trim();

    // Check if it's a phone number (starts with +375 or contains only digits)
    if (trimmed.startsWith('+') || RegExp(r'^\d+$').hasMatch(trimmed)) {
      // Validate as phone
      return validateBelarusPhone(value);
    } else {
      // Validate as email
      return validateEmail(value);
    }
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

      await authProvider.login(
        emailOrPhone: _emailPhoneController.text.trim(),
        password: _passwordController.text,
      );

      // Pop back to the screen that initiated login (e.g. profile tab)
      if (mounted) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    } catch (e) {
      setState(() {
        _errorMessage = getHumanErrorMessage(e);
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

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
          'Вход в профиль',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontFamily: 'Unbounded',
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

                // Welcome message
                Text(
                  'С возвращением!',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontFamily: 'Avenir Next',
                    fontSize: 16,
                    height: 1.25, // 20/16
                  ),
                ),
                Text(
                  'Введите свои данные, чтобы продолжить',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontFamily: 'Avenir Next',
                    fontSize: 16,
                    height: 1.25, // 20/16
                  ),
                ),

                const SizedBox(height: 48),

                // Error banner
                if (_errorMessage != null)
                  Padding(
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

                // Email/Phone field
                CustomTextField(
                  controller: _emailPhoneController,
                  label: 'Почта/Номер телефона',
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  validator: _validateEmailOrPhone,
                  enabled: !_isLoading,
                ),

                const SizedBox(height: 18),

                // Password field
                CustomTextField(
                  controller: _passwordController,
                  label: 'Пароль',
                  obscureText: true,
                  textInputAction: TextInputAction.done,
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Введите пароль';
                    }
                    return null;
                  },
                  enabled: !_isLoading,
                  onFieldSubmitted: (_) => _handleSubmit(),
                ),

                const SizedBox(height: 16),

                // Forgot password link
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: _isLoading
                        ? null
                        : () {
                            // TODO: Navigate to forgot password screen
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                    'Восстановление пароля будет добавлено позже'),
                              ),
                            );
                          },
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(0, 0),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text(
                      'Забыли пароль?',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontFamily: 'Avenir Next',
                        fontSize: 15,
                        height: 1.33, // 20/15
                        color: const Color(0xFFD2D2D2),
                        decoration: TextDecoration.underline,
                        decorationColor: const Color(0xFFD2D2D2),
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 32),

                // Login button
                ElevatedButton(
                  onPressed: _isLoading ? null : _handleSubmit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryOrange,
                    minimumSize: const Size(double.infinity, 48),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 24, vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: _isLoading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            valueColor:
                                AlwaysStoppedAnimation<Color>(Colors.white),
                          ),
                        )
                      : Text(
                          'Войти',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontFamily: 'Avenir Next',
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFFF4F1EC),
                          ),
                        ),
                ),

                const SizedBox(height: 48),

                // Social login divider
                Center(
                  child: Text(
                    'Или используйте:',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontFamily: 'Avenir Next',
                      fontSize: 15,
                      height: 1.53, // 23/15
                      color: Colors.black.withValues(alpha: 0.7),
                    ),
                  ),
                ),

                const SizedBox(height: 16),

                // Google login button
                OutlinedButton(
                  onPressed: null, // Disabled for now
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 45),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 24, vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(11.301),
                    ),
                    side: const BorderSide(color: Colors.black, width: 1),
                    backgroundColor: Colors.white,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Google icon placeholder
                      Container(
                        width: 20,
                        height: 20,
                        decoration: BoxDecoration(
                          color: Colors.grey[300],
                          borderRadius: BorderRadius.circular(2),
                        ),
                        child: const Center(
                          child: Text(
                            'G',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        'Продолжить с Google',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontFamily: 'Avenir Next',
                          fontSize: 15,
                          height: 1.33, // 20/15
                          color: Colors.black,
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 12),

                // Apple login button
                ElevatedButton(
                  onPressed: null, // Disabled for now
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.black,
                    minimumSize: const Size(double.infinity, 45),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 24, vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(11.301),
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Apple icon placeholder
                      const Icon(
                        Icons.apple,
                        color: Colors.white,
                        size: 20,
                      ),
                      const SizedBox(width: 12),
                      Text(
                        'Продолжить с Apple',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontFamily: 'Avenir Next',
                          fontSize: 15,
                          height: 1.33, // 20/15
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 32),

                // Registration link
                Center(
                  child: TextButton(
                    onPressed: _isLoading
                        ? null
                        : () {
                            Navigator.pushNamed(
                                context, '/auth/method-selection');
                          },
                    child: RichText(
                      text: TextSpan(
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontFamily: 'Avenir Next',
                          fontSize: 13,
                          height: 1.15, // 15/13
                          color: const Color(0xFF5F5F5F).withValues(alpha: 0.7),
                        ),
                        children: const [
                          TextSpan(text: 'Еще нету профиля? '),
                          TextSpan(
                            text: 'Регистрация',
                            style: TextStyle(
                              color: Colors.black,
                              decoration: TextDecoration.underline,
                              decorationColor: Colors.black,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
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
