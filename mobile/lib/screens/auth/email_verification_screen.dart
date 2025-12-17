import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/widgets/forms/error_banner.dart';

/// Email Verification Screen
/// User enters 6-digit code sent to email
class EmailVerificationScreen extends StatefulWidget {
  const EmailVerificationScreen({super.key});

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
  int _resendTimer = 12;
  Timer? _timer;

  String? _email;
  String? _name;

  @override
  void initState() {
    super.initState();
    _startResendTimer();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Get arguments passed from registration screen
    final args =
        ModalRoute.of(context)?.settings.arguments as Map<String, dynamic>?;
    if (args != null) {
      _email = args['email'] as String?;
      _name = args['name'] as String?;
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

  /// Start resend code timer
  void _startResendTimer() {
    _timer?.cancel();
    setState(() {
      _resendTimer = 12;
    });

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

    try {
      final authProvider = context.read<AuthProvider>();

      // Verify the code
      await authProvider.verifyCode(code: code);

      // If name was collected during registration, update profile
      if (_name != null && _name!.isNotEmpty && mounted) {
        try {
          await authProvider.updateProfile(name: _name);
        } catch (e) {
          // Profile update failed but verification succeeded
          // Log error but continue with navigation
          debugPrint('Profile update failed: $e');
        }
      }

      // Navigate to home screen
      if (mounted) {
        Navigator.pushNamedAndRemoveUntil(
          context,
          '/home',
          (route) => false,
        );
      }
    } catch (e) {
      setState(() {
        _errorMessage = e.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  /// Handle resend verification code
  Future<void> _handleResendCode() async {
    if (_resendTimer > 0) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final authProvider = context.read<AuthProvider>();

      // Re-register to get new verification code
      await authProvider.registerWithEmail(
        email: _email ?? '',
        password: '', // Password not needed for resend
      );

      _startResendTimer();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Код отправлен повторно'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      setState(() {
        _errorMessage = e.toString();
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 32),

              // Section header
              Text(
                'Верификация почты',
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
                'Мы прислали письмо на вашу почту с кодом подтверждения, проверяйте папку спам',
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontFamily: 'Avenir Next',
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
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: List.generate(6, (index) {
                  return _CodeInputBox(
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

              const SizedBox(height: 32),

              // Resend code timer/button
              Center(
                child: TextButton(
                  onPressed: _resendTimer == 0 ? _handleResendCode : null,
                  child: Text(
                    _resendTimer > 0
                        ? 'Прислать код повторно через 00:${_resendTimer.toString().padLeft(2, '0')}'
                        : 'Прислать код повторно',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontFamily: 'Avenir Next',
                      fontSize: 13,
                      height: 1.15, // 15/13
                      color: _resendTimer > 0
                          ? const Color(0xFF5F5F5F).withValues(alpha: 0.7)
                          : const Color(0xFFDB4F13),
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 32),

              // Submit button
              ElevatedButton(
                onPressed: _isLoading ? null : _handleVerification,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFF06B32),
                  minimumSize: const Size(double.infinity, 48),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
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
                        'Подтвердить',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontFamily: 'Avenir Next',
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFFF4F1EC),
                        ),
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

  const _CodeInputBox({
    required this.controller,
    required this.focusNode,
    this.isFirst = false,
    required this.onChanged,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 50,
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
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(
              color: Color(0xFFD2D2D2),
              width: 1.13,
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(
              color: Color(0xFFD2D2D2),
              width: 1.13,
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(
              color: Color(0xFFF06B32),
              width: 1.13,
            ),
          ),
          errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: BorderSide(
              color: Theme.of(context).colorScheme.error,
              width: 1.13,
            ),
          ),
          focusedErrorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: BorderSide(
              color: Theme.of(context).colorScheme.error,
              width: 2,
            ),
          ),
          disabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(11),
            borderSide: const BorderSide(
              color: Color(0xFFD2D2D2),
              width: 1.13,
            ),
          ),
        ),
        onChanged: onChanged,
      ),
    );
  }
}
