import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Quick suggestion chips shown when search bar is focused
const _suggestions = [
  'Кофе',
  'Суши',
  'Завтрак',
  'Бизнес-ланч',
  'Рядом со мной',
];

/// Horizontal scrollable suggestion chips.
/// Appears with slide-up animation when search bar gains focus.
class SmartSearchSuggestions extends StatelessWidget {
  final bool visible;
  final ValueChanged<String> onChipTap;

  const SmartSearchSuggestions({
    super.key,
    required this.visible,
    required this.onChipTap,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedSlide(
      offset: visible ? Offset.zero : const Offset(0, 0.5),
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
      child: AnimatedOpacity(
        opacity: visible ? 1.0 : 0.0,
        duration: const Duration(milliseconds: 250),
        child: SizedBox(
          height: 44,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 4),
            itemCount: _suggestions.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              return GestureDetector(
                onTap: () => onChipTap(_suggestions[index]),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Text(
                    _suggestions[index],
                    style: const TextStyle(
                      fontSize: 14,
                      color: AppTheme.textOnPrimary,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
