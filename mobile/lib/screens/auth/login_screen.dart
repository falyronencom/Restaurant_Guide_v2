import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:restaurant_guide_mobile/config/environment.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/utils/error_helpers.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';
import 'package:restaurant_guide_mobile/widgets/forms/custom_text_field.dart';
import 'package:restaurant_guide_mobile/widgets/forms/error_banner.dart';
import 'package:restaurant_guide_mobile/widgets/forms/social_sign_in_buttons.dart';
import 'package:restaurant_guide_mobile/widgets/forms/submit_button.dart';

/// Login Screen
/// User enters email and password to sign in
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  /// Страница восстановления пароля на сайте. Своего экрана сброса в
  /// приложении нет, а на сайте сброс работает целиком, и ссылка из письма
  /// ведёт туда же; новый пароль подходит и в приложении.
  static String forgotPasswordUrl({String? siteBaseUrl}) {
    final base = siteBaseUrl ?? Environment.siteBaseUrl;
    final trimmed =
        base.endsWith('/') ? base.substring(0, base.length - 1) : base;
    return '$trimmed/forgot-password';
  }

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _isLoading = false;
  SocialSignIn? _oauthInProgress;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  /// После входа — назад к экрану, с которого открыли вход: профиль,
  /// карточка заведения (гость вошёл, чтобы забронировать, — и вернулся к
  /// брони). Экраны входа и регистрации по пути снимаются. Если под ними
  /// ничего нет — это «Регистрация» первого запуска, корень стека, — на
  /// главный экран: раньше вход возвращал гостя на «Регистрацию», а «Назад»
  /// там закрывал приложение (Galaxy A72, 10.10.2026).
  void _leaveAfterLogin() {
    final navigator = Navigator.of(context);
    var onlyAuthScreens = true;
    navigator.popUntil((route) {
      if (!(route.settings.name?.startsWith('/auth/') ?? false)) {
        onlyAuthScreens = false;
        return true;
      }
      return route.isFirst;
    });
    if (onlyAuthScreens) {
      navigator.pushNamedAndRemoveUntil('/home', (route) => false);
    }
  }

  /// Вход — только по почте (и через Google / Яндекс). Номер телефона поле
  /// не принимает: сервер ищет вход по почте, номер в этом поле он отклонял,
  /// и человек видел «Проверьте введённые данные.» (решение Координатора
  /// 19.10.2026: вход и регистрация по номеру — после появления СМС).
  String? _validateEmail(String? value) => validateEmail(value?.trim());

  /// «Забыли пароль?» — страница восстановления на сайте, в браузере.
  /// Браузер не открылся — плашка с адресом (текст — слово Координатора
  /// 30.10.2026).
  Future<void> _openForgotPassword() async {
    final url = LoginScreen.forgotPasswordUrl();
    final messenger = ScaffoldMessenger.of(context);
    var opened = false;
    try {
      opened = await launchUrl(Uri.parse(url),
          mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (!opened) {
      messenger.showSnackBar(
        SnackBar(
          content: Text('Не удалось открыть браузер. Восстановить пароль '
              'можно на сайте: $url'),
          behavior: SnackBarBehavior.floating,
        ),
      );
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

      final success = await authProvider.login(
        emailOrPhone: _emailController.text.trim(),
        password: _passwordController.text,
      );

      if (success && mounted) {
        _leaveAfterLogin();
      } else if (!success && mounted) {
        setState(() {
          _errorMessage = authProvider.errorMessage ??
              'Неверная почта или пароль.';
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = getHumanErrorMessage(e);
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _handleGoogleSignIn() async {
    setState(() {
      _oauthInProgress = SocialSignIn.google;
      _errorMessage = null;
    });

    try {
      final authProvider = context.read<AuthProvider>();
      final success = await authProvider.loginWithGoogle();

      if (success && mounted) {
        _leaveAfterLogin();
      } else if (!success && mounted) {
        setState(() {
          _errorMessage =
              authProvider.errorMessage ?? 'Ошибка входа через Google';
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = getHumanErrorMessage(e);
        });
      }
    } finally {
      if (mounted) {
        setState(() => _oauthInProgress = null);
      }
    }
  }

  Future<void> _handleYandexSignIn() async {
    setState(() {
      _oauthInProgress = SocialSignIn.yandex;
      _errorMessage = null;
    });

    try {
      final authProvider = context.read<AuthProvider>();
      final success = await authProvider.loginWithYandex();

      if (success && mounted) {
        _leaveAfterLogin();
      } else if (!success && mounted) {
        setState(() {
          _errorMessage =
              authProvider.errorMessage ?? 'Ошибка входа через Яндекс';
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = getHumanErrorMessage(e);
        });
      }
    } finally {
      if (mounted) {
        setState(() => _oauthInProgress = null);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isAnyLoading = _isLoading || _oauthInProgress != null;

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
          'Вход в профиль',
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

                // Welcome message
                Text(
                  'С возвращением!',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontSize: 16,
                    height: 1.25, // 20/16
                  ),
                ),
                Text(
                  'Введите свои данные, чтобы продолжить',
                  style: theme.textTheme.bodyMedium?.copyWith(
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

                // Email field
                CustomTextField(
                  controller: _emailController,
                  label: 'Почта',
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  validator: _validateEmail,
                  enabled: !isAnyLoading,
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
                  enabled: !isAnyLoading,
                  onFieldSubmitted: (_) => _handleSubmit(),
                ),

                const SizedBox(height: 16),

                // Forgot password link
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: isAnyLoading
                        ? null
                        : _openForgotPassword,
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(0, 0),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text(
                      'Забыли пароль?',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontSize: 15,
                        height: 1.33, // 20/15
                        color: AppTheme.strokeGrey,
                        decoration: TextDecoration.underline,
                        decorationColor: AppTheme.strokeGrey,
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 32),

                // Login button
                SubmitButton(
                  label: 'Войти',
                  onPressed: isAnyLoading ? null : _handleSubmit,
                  isLoading: _isLoading,
                ),

                const SizedBox(height: 48),

                SocialSignInButtons(
                  onGoogle: _handleGoogleSignIn,
                  onYandex: _handleYandexSignIn,
                  inProgress: _oauthInProgress,
                  enabled: !_isLoading,
                ),

                const SizedBox(height: 32),

                // Registration link
                Center(
                  child: TextButton(
                    onPressed: isAnyLoading
                        ? null
                        : () {
                            Navigator.pushNamed(
                                context, '/auth/method-selection');
                          },
                    child: RichText(
                      text: TextSpan(
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontSize: 13,
                          height: 1.15, // 15/13
                          color: const Color(0xFF5F5F5F).withValues(alpha: 0.7),
                        ),
                        children: const [
                          TextSpan(text: 'Еще нету профиля? '),
                          TextSpan(
                            text: 'Регистрация',
                            style: TextStyle(
                              color: AppTheme.textPrimary,
                              decoration: TextDecoration.underline,
                              decorationColor: AppTheme.textPrimary,
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
