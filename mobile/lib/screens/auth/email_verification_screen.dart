import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/widgets/forms/error_banner.dart';

/// Email Verification Screen
/// User enters 6-digit code sent to email
class EmailVerificationScreen extends StatefulWidget {
  const EmailVerificationScreen({super.key});

  /// Подсказка над «Прислать код повторно» — слово Координатора 30.10.2026:
  /// пока у домена nirivio.by нет сайта, письмо с кодом попадает в «Спам».
  /// Те же слова — на сайте (`web/src/components/auth/VerifyEmailForm.tsx`).
  static const String spamHint = 'Не пришёл код? Проверьте папку «Спам».';

  static const Key spamHintKey = ValueKey<String>('verify-spam-hint');

  /// Строка под заголовком. Экран не знает, дошло ли письмо: из «Профиля» он
  /// открывается без нового письма, а повтор может не уйти. Поэтому строка
  /// не говорит «мы прислали» — слово Координатора 30.10.2026; те же слова
  /// на сайте (`VerifyEmailForm.tsx`).
  static const String codeLetterHint =
      'Код подтверждения приходит письмом на вашу почту.';

  /// Под «Позже» — как на сайте; слово Координатора 30.10.2026.
  static const String laterHint = 'Подтвердить почту можно потом в профиле.';

  /// Аргумент маршрута: письмо с кодом только что ушло (регистрация) — до
  /// повтора идёт отсчёт. Из «Профиля» письма не было, повтор доступен сразу:
  /// код письма регистрации мог давно истечь.
  static const String codeJustSentArg = 'codeJustSent';

  @override
  State<EmailVerificationScreen> createState() =>
      _EmailVerificationScreenState();
}

class _EmailVerificationScreenState extends State<EmailVerificationScreen> {
  final List<TextEditingController> _codeControllers =
      List.generate(6, (_) => TextEditingController());
  final List<FocusNode> _focusNodes = List.generate(6, (_) => FocusNode());

  bool _isLoading = false;
  String? _errorMessage;
  int _resendTimer = 0;
  Timer? _timer;

  String? _name;
  bool _argsRead = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_argsRead) return;
    _argsRead = true;
    // Get arguments passed from registration screen.
    // 'email' key is accepted for backwards-compat but not used directly —
    // the resend endpoint operates on the authenticated session.
    final args =
        ModalRoute.of(context)?.settings.arguments as Map<String, dynamic>?;
    if (args != null) {
      _name = args['name'] as String?;
    }
    if (args?[EmailVerificationScreen.codeJustSentArg] == true) {
      _startResendTimer();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (var controller in _codeControllers) {
      controller.dispose();
    }
    for (var node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  /// Start resend code timer. Без setState: зовётся и до первой отрисовки
  /// (из didChangeDependencies), и внутри setState после повтора.
  void _startResendTimer() {
    _timer?.cancel();
    _resendTimer = 12;

    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() {
        if (_resendTimer > 0) {
          _resendTimer--;
        } else {
          timer.cancel();
        }
      });
    });
  }

  /// Get verification code from all text fields
  String _getVerificationCode() {
    return _codeControllers.map((c) => c.text).join();
  }

  /// Handle verification code submission
  Future<void> _handleVerification() async {
    final code = _getVerificationCode();

    if (code.length != 6) {
      setState(() {
        _errorMessage = 'Введите полный код из 6 цифр';
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final authProvider = context.read<AuthProvider>();
    final success = await authProvider.verifyEmailCode(code: code);

    if (!mounted) return;

    if (!success) {
      setState(() {
        _errorMessage =
            authProvider.errorMessage ?? 'Не удалось подтвердить email';
        _isLoading = false;
      });
      return;
    }

    // If name was collected during registration, update profile (best-effort)
    if (_name != null && _name!.isNotEmpty) {
      try {
        await authProvider.updateProfile(name: _name);
      } catch (e) {
        debugPrint('Profile update failed: $e');
      }
    }

    if (!mounted) return;

    Navigator.pushNamedAndRemoveUntil(
      context,
      '/home',
      (route) => false,
    );
  }

  /// Handle resend verification code
  ///
  /// Пока запрос в пути, второе нажатие ничего не делает: два запроса дают два
  /// письма с разными кодами, и код из «не того» письма — «Неверный код».
  /// Проверка здесь, а не только в `onPressed`: два нажатия в одном кадре
  /// приходят раньше, чем кнопка перерисуется выключенной.
  Future<void> _handleResendCode() async {
    if (_resendTimer > 0 || _isLoading) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final authProvider = context.read<AuthProvider>();
    final success = await authProvider.sendEmailVerificationCode();

    if (!mounted) return;

    if (!success) {
      setState(() {
        _errorMessage =
            authProvider.errorMessage ?? 'Не удалось отправить код';
        _isLoading = false;
      });
      return;
    }

    setState(() {
      _startResendTimer();
      _isLoading = false;
    });

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Код отправлен повторно'),
        backgroundColor: Colors.green,
      ),
    );
  }

  /// «Позже»: назад, на экран под этим; если его нет — на главный.
  void _skipForNow() {
    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
    } else {
      navigator.pushNamedAndRemoveUntil('/home', (route) => false);
    }
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 32),

              // Section header
              Text(
                'Верификация почты',
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontSize: 22,
                  fontWeight: FontWeight.w500,
                  height: 1.18, // 26/22
                ),
              ),

              const SizedBox(height: 8),

              // Description
              Text(
                EmailVerificationScreen.codeLetterHint,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontSize: 15,
                  height: 1.53, // 23/15
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

              // Verification code input boxes
              //
              // Клетка — до 50 dp, на узком экране уже (не меньше 36): шесть
              // по 50 не помещались в 272 dp экрана шириной 320, и правая
              // уходила за край (найдено тестом подсказки про «Спам»,
              // 30.10.2026). Между клетками — не меньше 6 dp.
              LayoutBuilder(
                builder: (context, constraints) => Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: List.generate(6, (index) {
                    return _CodeInputBox(
                      width: ((constraints.maxWidth - 5 * 6) / 6)
                          .clamp(36.0, 50.0),
                      controller: _codeControllers[index],
                      focusNode: _focusNodes[index],
                      isFirst: index == 0,
                      onChanged: (value) {
                        if (value.isNotEmpty && index < 5) {
                          // Move to next field
                          _focusNodes[index + 1].requestFocus();
                        } else if (value.isEmpty && index > 0) {
                          // Move to previous field on backspace
                          _focusNodes[index - 1].requestFocus();
                        }

                        // Auto-submit when all 6 digits are entered
                        if (index == 5 && value.isNotEmpty) {
                          _handleVerification();
                        }
                      },
                      enabled: !_isLoading,
                    );
                  }),
                ),
              ),

              const SizedBox(height: 32),

              // Пока у домена nirivio.by нет сайта, письмо с кодом попадает в
              // «Спам» (письмо Координатору, 30.10.2026). Та же строка — над
              // «Отправить код повторно» на сайте (VerifyEmailForm.tsx).
              Text(
                EmailVerificationScreen.spamHint,
                key: EmailVerificationScreen.spamHintKey,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 13,
                  height: 1.38, // 18/13
                  color: const Color(0xFF5F5F5F),
                ),
              ),

              const SizedBox(height: 4),

              // Resend code timer/button
              Center(
                child: TextButton(
                  onPressed: _resendTimer == 0 && !_isLoading
                      ? _handleResendCode
                      : null,
                  child: Text(
                    _resendTimer > 0
                        ? 'Прислать код повторно через 00:${_resendTimer.toString().padLeft(2, '0')}'
                        : 'Прислать код повторно',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 13,
                      height: 1.15, // 15/13
                      color: _resendTimer > 0
                          ? const Color(0xFF5F5F5F).withValues(alpha: 0.7)
                          : AppTheme.primaryOrangeDark,
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 32),

              // Submit button
              ElevatedButton(
                onPressed: _isLoading ? null : _handleVerification,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryOrange,
                  minimumSize: const Size(double.infinity, 48),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                  ),
                ),
                child: _isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(
                              AppTheme.textOnPrimary),
                        ),
                      )
                    : Text(
                        'Подтвердить',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.backgroundWarm,
                        ),
                      ),
              ),

              const SizedBox(height: 16),

              // «Позже» — подтвердить потом: после регистрации под экраном
              // кода лежит главный, из «Профиля» — профиль (как на сайте).
              Center(
                child: TextButton(
                  onPressed: _skipForNow,
                  child: Text(
                    'Позже',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      color: AppTheme.primaryOrangeDark,
                    ),
                  ),
                ),
              ),
              Text(
                EmailVerificationScreen.laterHint,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 13,
                  height: 1.38, // 18/13
                  color: const Color(0xFF5F5F5F),
                ),
              ),

              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}

/// Individual code input box widget
class _CodeInputBox extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isFirst;
  final ValueChanged<String> onChanged;
  final bool enabled;
  final double width;

  const _CodeInputBox({
    required this.controller,
    required this.focusNode,
    this.isFirst = false,
    required this.onChanged,
    this.enabled = true,
    this.width = 50,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: 60,
      child: TextFormField(
        controller: controller,
        focusNode: focusNode,
        enabled: enabled,
        autofocus: isFirst,
        keyboardType: TextInputType.number,
        textAlign: TextAlign.center,
        maxLength: 1,
        style: const TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w600,
        ),
        inputFormatters: [
          FilteringTextInputFormatter.digitsOnly,
        ],
        decoration: InputDecoration(
          counterText: '',
          contentPadding: EdgeInsets.zero,
          filled: false,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            borderSide: const BorderSide(
              color: AppTheme.strokeGrey,
              width: 1.13,
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            borderSide: const BorderSide(
              color: AppTheme.strokeGrey,
              width: 1.13,
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            borderSide: const BorderSide(
              color: AppTheme.primaryOrange,
              width: 1.13,
            ),
          ),
          errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            borderSide: BorderSide(
              color: Theme.of(context).colorScheme.error,
              width: 1.13,
            ),
          ),
          focusedErrorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            borderSide: BorderSide(
              color: Theme.of(context).colorScheme.error,
              width: 2,
            ),
          ),
          disabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            borderSide: const BorderSide(
              color: AppTheme.strokeGrey,
              width: 1.13,
            ),
          ),
        ),
        onChanged: onChanged,
      ),
    );
  }
}
