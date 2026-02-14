import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';

/// Specialized phone input field for Belarus phone numbers
/// Automatically formats input as: +375 XX XXX XX XX
class PhoneInputField extends StatefulWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final String? Function(String?)? validator;
  final bool enabled;
  final bool autofocus;
  final FocusNode? focusNode;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onEditingComplete;
  final ValueChanged<String>? onFieldSubmitted;

  const PhoneInputField({
    super.key,
    required this.controller,
    this.label = 'Номер телефона',
    this.hint,
    this.validator,
    this.enabled = true,
    this.autofocus = false,
    this.focusNode,
    this.textInputAction,
    this.onChanged,
    this.onEditingComplete,
    this.onFieldSubmitted,
  });

  @override
  State<PhoneInputField> createState() => _PhoneInputFieldState();
}

class _PhoneInputFieldState extends State<PhoneInputField> {
  @override
  void initState() {
    super.initState();
    // Set initial value with country code if empty
    if (widget.controller.text.isEmpty) {
      widget.controller.text = '+375 ';
    }
    widget.controller.addListener(_formatPhoneNumber);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_formatPhoneNumber);
    super.dispose();
  }

  /// Format phone number as user types
  void _formatPhoneNumber() {
    final text = widget.controller.text;

    // Extract only digits (except leading +)
    String digitsOnly = text.replaceAll(RegExp(r'[^\d]'), '');

    // Ensure it starts with 375
    if (!digitsOnly.startsWith('375')) {
      if (digitsOnly.isEmpty) {
        digitsOnly = '375';
      } else if (digitsOnly.startsWith('3')) {
        if (digitsOnly.length >= 3 && digitsOnly.substring(0, 3) != '375') {
          digitsOnly = '375';
        }
      } else {
        digitsOnly = '375$digitsOnly';
      }
    }

    // Limit to 12 digits (375 + 9 digits)
    if (digitsOnly.length > 12) {
      digitsOnly = digitsOnly.substring(0, 12);
    }

    // Format: +375 XX XXX XX XX
    String formatted = '+375';
    if (digitsOnly.length > 3) {
      formatted += ' ${digitsOnly.substring(3, digitsOnly.length > 5 ? 5 : digitsOnly.length)}';
    }
    if (digitsOnly.length > 5) {
      formatted += ' ${digitsOnly.substring(5, digitsOnly.length > 8 ? 8 : digitsOnly.length)}';
    }
    if (digitsOnly.length > 8) {
      formatted += ' ${digitsOnly.substring(8, digitsOnly.length > 10 ? 10 : digitsOnly.length)}';
    }
    if (digitsOnly.length > 10) {
      formatted += ' ${digitsOnly.substring(10, 12)}';
    }

    // Update text only if changed
    if (formatted != text) {
      widget.controller.value = TextEditingValue(
        text: formatted,
        selection: TextSelection.collapsed(
          offset: formatted.length,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return TextFormField(
      controller: widget.controller,
      focusNode: widget.focusNode,
      keyboardType: TextInputType.phone,
      enabled: widget.enabled,
      autofocus: widget.autofocus,
      textInputAction: widget.textInputAction,
      validator: widget.validator ?? validateBelarusPhone,
      onChanged: widget.onChanged,
      onEditingComplete: widget.onEditingComplete,
      onFieldSubmitted: widget.onFieldSubmitted,
      style: theme.textTheme.bodyLarge,
      inputFormatters: [
        // Only allow digits and +
        FilteringTextInputFormatter.allow(RegExp(r'[\d\+\s]')),
      ],
      decoration: InputDecoration(
        labelText: widget.label,
        hintText: widget.hint ?? '+375 29 123 45 67',
        prefixIcon: Icon(
          Icons.phone,
          color: theme.colorScheme.primary,
        ),
        filled: true,
        fillColor: widget.enabled
            ? theme.colorScheme.surface
            : theme.colorScheme.surfaceContainerHighest,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(
            color: theme.colorScheme.outline,
            width: 1,
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(
            color: theme.colorScheme.outline,
            width: 1,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(
            color: theme.colorScheme.primary,
            width: 2,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(
            color: theme.colorScheme.error,
            width: 1,
          ),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(
            color: theme.colorScheme.error,
            width: 2,
          ),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(
            color: theme.colorScheme.outline,
            width: 1,
          ),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        errorMaxLines: 2,
      ),
    );
  }
}
