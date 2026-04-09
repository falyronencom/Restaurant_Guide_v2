import 'dart:async';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Animated placeholder hints that cycle every 3 seconds
const _placeholderHints = [
  'С чего начнём?',
  'кофе рядом',
  'суши на вынос',
  'где позавтракать',
  'пиво недорого',
];

/// Refactored search bar with animated placeholder.
/// Extracted from SearchHomeScreen._buildSearchBar().
class SmartSearchBar extends StatefulWidget {
  final TextEditingController controller;
  final VoidCallback onSubmit;
  final VoidCallback onChevronTap;
  final ValueChanged<bool>? onFocusChanged;

  const SmartSearchBar({
    super.key,
    required this.controller,
    required this.onSubmit,
    required this.onChevronTap,
    this.onFocusChanged,
  });

  @override
  State<SmartSearchBar> createState() => _SmartSearchBarState();
}

class _SmartSearchBarState extends State<SmartSearchBar>
    with SingleTickerProviderStateMixin {
  static const Color _primaryOrange = AppTheme.primaryOrange;
  static const Color _greyText = AppTheme.textGrey;

  final FocusNode _focusNode = FocusNode();
  Timer? _hintTimer;
  int _currentHintIndex = 0;
  bool _isFocused = false;

  late AnimationController _fadeController;
  late Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChange);

    _fadeController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
    _fadeAnimation = Tween<double>(begin: 1.0, end: 0.0).animate(
      CurvedAnimation(parent: _fadeController, curve: Curves.easeInOut),
    );

    _startHintCycle();
  }

  @override
  void dispose() {
    _hintTimer?.cancel();
    _focusNode.removeListener(_onFocusChange);
    _focusNode.dispose();
    _fadeController.dispose();
    super.dispose();
  }

  void _onFocusChange() {
    setState(() => _isFocused = _focusNode.hasFocus);
    widget.onFocusChanged?.call(_focusNode.hasFocus);
    if (_focusNode.hasFocus) {
      _hintTimer?.cancel();
    } else if (widget.controller.text.isEmpty) {
      _startHintCycle();
    }
  }

  void _startHintCycle() {
    _hintTimer?.cancel();
    _hintTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted || _isFocused) return;
      _fadeController.forward().then((_) {
        if (!mounted) return;
        setState(() {
          _currentHintIndex = (_currentHintIndex + 1) % _placeholderHints.length;
        });
        _fadeController.reverse();
      });
    });
  }

  void _handleSubmit() {
    if (widget.controller.text.trim().isNotEmpty) {
      widget.onSubmit();
    } else {
      widget.onChevronTap();
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasText = widget.controller.text.trim().isNotEmpty;

    return Row(
      children: [
        // Search input field
        Expanded(
          child: Container(
            height: 64,
            decoration: const BoxDecoration(
              color: Color(0xFFF5F5F5),
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(9),
                bottomLeft: Radius.circular(9),
              ),
            ),
            child: Stack(
              alignment: Alignment.centerLeft,
              children: [
                // Animated placeholder (shown when empty and unfocused)
                if (!_isFocused && widget.controller.text.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: ListenableBuilder(
                      listenable: _fadeController,
                      builder: (context, _) => Opacity(
                        opacity: 1.0 - _fadeAnimation.value,
                        child: Text(
                          _placeholderHints[_currentHintIndex],
                          style: const TextStyle(
                            fontSize: 18,
                            color: _greyText,
                            fontWeight: FontWeight.w400,
                          ),
                        ),
                      ),
                    ),
                  ),
                // Actual text field
                TextField(
                  controller: widget.controller,
                  focusNode: _focusNode,
                  style: const TextStyle(
                    fontSize: 18,
                    color: AppTheme.textPrimary,
                  ),
                  decoration: InputDecoration(
                    hintText: _isFocused ? 'Введите запрос...' : '',
                    hintStyle: const TextStyle(
                      fontSize: 18,
                      color: _greyText,
                      fontWeight: FontWeight.w400,
                    ),
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 20,
                    ),
                  ),
                  onSubmitted: (_) => _handleSubmit(),
                  onChanged: (_) => setState(() {}),
                ),
              ],
            ),
          ),
        ),
        // Search/chevron button
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _handleSubmit,
          child: Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: _primaryOrange,
              borderRadius: BorderRadius.only(
                topRight: Radius.circular(9),
                bottomRight: Radius.circular(9),
              ),
            ),
            child: Center(
              child: Icon(
                hasText ? Icons.search : Icons.chevron_right,
                color: AppTheme.textOnPrimary,
                size: 30,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
