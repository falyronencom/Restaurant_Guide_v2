import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
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

      await authProvider.registerWithEmail(
        email: _emailController.text.trim(),
        password: _passwordController.text,
        name: _nameController.text.trim(),
      );

      if (!mounted) return;

      // Check if auto-login succeeded (no verification needed)
      if (authProvider.isAuthenticated) {
        // Navigate to home (name already saved during registration)
        Navigator.pushNamedAndRemoveUntil(
          context,
          '/home',
          (route) => false,
        );
      } else {
        // Navigate to email verification screen
        // Pass name to update profile after verification
        Navigator.pushNamed(
          context,
          '/auth/email-verification',
          arguments: {
            'email': _emailController.text.trim(),
            'name': _nameController.text.trim(),
          },
        );
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
                    fontFamily: 'Avenir Next',
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
                    fontFamily: 'Avenir Next',
                    fontSize: 15,
                    height: 1.53, // 23/15
                  ),
                ),

                const SizedBox(height: 32),

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
                  onChanged: (_) {
                    // Rebuild to update password strength indicator
                    setState(() {});
                  },
                ),

                // Password strength indicator
                ValueListenableBuilder(
                  valueListenable: _passwordController,
                  builder: (context, value, child) {
                    return PasswordStrengthIndicator(
                      password: value.text,
                    );
                  },
                ),

                const SizedBox(height: 4),

                // Password helper text
                Text(
                  'Пароль должен быть не менее 8 знаков',
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontFamily: 'Avenir Next',
                    fontSize: 13,
                    height: 1.15, // 15/13
                    color: const Color(0xFFD2D2D2),
                  ),
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
