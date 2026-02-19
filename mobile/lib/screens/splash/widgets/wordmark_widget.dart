import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Displays the "NIRIVIO" wordmark with "Вкусное рядом" slogan beneath it.
/// Uses Josefin Sans font via google_fonts package.
///
/// [shimmerGlow] controls the subtle glow pulse during loop phase (0.0–1.0).
class WordmarkWidget extends StatelessWidget {
  final double shimmerGlow;

  const WordmarkWidget({super.key, this.shimmerGlow = 0.0});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // "NIRIVIO" — weight 600, white, wide letter-spacing
        Text(
          'NIRIVIO',
          style: GoogleFonts.josefinSans(
            fontSize: 42,
            fontWeight: FontWeight.w600,
            color: Colors.white,
            letterSpacing: 42 * 0.3, // 0.3em
            shadows: [
              // Base text shadow for depth (always present)
              const Shadow(
                offset: Offset(2, 3),
                blurRadius: 0,
                color: AppTheme.primaryOrangeDark,
              ),
              // Shimmer glow (pulses during loop)
              Shadow(
                offset: Offset.zero,
                blurRadius: 10 * shimmerGlow,
                color: Colors.white.withValues(alpha: 0.22 * shimmerGlow),
              ),
            ],
          ),
        ),
        const SizedBox(height: 9),
        // "Вкусное рядом" — weight 200, semi-transparent white
        Text(
          'Вкусное рядом',
          style: GoogleFonts.josefinSans(
            fontSize: 10,
            fontWeight: FontWeight.w200,
            color: Colors.white.withValues(alpha: 0.65),
            letterSpacing: 10 * 0.42, // 0.42em
          ),
        ),
      ],
    );
  }
}
