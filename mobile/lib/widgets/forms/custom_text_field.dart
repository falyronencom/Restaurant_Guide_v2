import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Reusable text input field with consistent styling
/// Supports labels, hints, validation, icons, and various input types
class CustomTextField extends StatefulWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final TextInputType keyboardType;
  final String? Function(String?)? validator;
  final bool obscureText;
  final Widget? suffixIcon;
  final Widget? prefixIcon;
  final bool enabled;
  final bool autofocus;
  final int? maxLength;
  final FocusNode? focusNode;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onEditingComplete;
  final ValueChanged<String>? onFieldSubmitted;
  final List<TextInputFormatter>? inputFormatters;
  final int maxLines;
  final TextCapitalization textCapitalization;
  final bool autocorrect;

  const CustomTextField({
    super.key,
    required this.controller,
    required this.label,
    this.hint,
    this.keyboardType = TextInputType.text,
    this.validator,
    this.obscureText = false,
    this.suffixIcon,
    this.prefixIcon,
    this.enabled = true,
    this.autofocus = false,
    this.maxLength,
    this.focusNode,
    this.textInputAction,
    this.onChanged,
    this.onEditingComplete,
    this.onFieldSubmitted,
    this.inputFormatters,
    this.maxLines = 1,
    this.textCapitalization = TextCapitalization.none,
    this.autocorrect = true,
  });

  @override
  State<CustomTextField> createState() => _CustomTextFieldState();
}

class _CustomTextFieldState extends State<CustomTextField> {
  bool _obscureText = false;

  @override
  void initState() {
    super.initState();
    _obscureText = widget.obscureText;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return TextFormField(
      controller: widget.controller,
      focusNode: widget.focusNode,
      keyboardType: widget.keyboardType,
      obscureText: _obscureText,
      enabled: widget.enabled,
      autofocus: widget.autofocus,
      maxLength: widget.maxLength,
      maxLines: widget.maxLines,
      textInputAction: widget.textInputAction,
      textCapitalization: widget.textCapitalization,
      autocorrect: widget.autocorrect,
      inputFormatters: widget.inputFormatters,
      validator: widget.validator,
      onChanged: widget.onChanged,
      onEditingComplete: widget.onEditingComplete,
      onFieldSubmitted: widget.onFieldSubmitted,
      style: theme.textTheme.bodyLarge,
      decoration: InputDecoration(
        labelText: widget.label,
        hintText: widget.hint,
        prefixIcon: widget.prefixIcon,
        suffixIcon: widget.obscureText
            ? IconButton(
                icon: Icon(
                  _obscureText ? Icons.visibility_off : Icons.visibility,
                  color: theme.colorScheme.secondary,
                ),
                onPressed: () {
                  setState(() {
                    _obscureText = !_obscureText;
                  });
                },
              )
            : widget.suffixIcon,
        filled: true,
        fillColor: widget.enabled
            ? theme.colorScheme.surface
            : theme.colorScheme.surfaceContainerHighest.withOpacity(0.3),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          borderSide: BorderSide(
            color: theme.colorScheme.outline,
            width: 1,
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          borderSide: BorderSide(
            color: theme.colorScheme.outline,
            width: 1,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          borderSide: BorderSide(
            color: theme.colorScheme.primary,
            width: 2,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          borderSide: BorderSide(
            color: theme.colorScheme.error,
            width: 1,
          ),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          borderSide: BorderSide(
            color: theme.colorScheme.error,
            width: 2,
          ),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          borderSide: BorderSide(
            color: theme.colorScheme.outline.withOpacity(0.5),
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
