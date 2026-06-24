import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

double _lerp(double a, double b, double t) => a + (b - a) * t;

/// The text block beneath the splash ornament: the «NIRIVIO» wordmark, an
/// orange accent rule, and the «Вкусное рядом» tagline.
///
/// The three elements reveal independently during the bloom (see the design
/// handoff timing table) and are driven by externally-eased progress values:
///   [wordT] — wordmark fade + letter-tracking expansion (−0.02em → 0.25em);
///   [lineT] — accent rule scaleX 0 → 1;
///   [tagT]  — tagline fade (→ 0.85) + slide up.
/// [globalOpacity] is the outro fade. [unit] = sceneSide / 300, so the text
/// scales in lockstep with the ornament (design viewBox units → logical px).
class WordmarkWidget extends StatelessWidget {
  final double unit;
  final double wordT;
  final double lineT;
  final double tagT;
  final double globalOpacity;

  const WordmarkWidget({
    super.key,
    required this.unit,
    required this.wordT,
    required this.lineT,
    required this.tagT,
    this.globalOpacity = 1.0,
  });

  @override
  Widget build(BuildContext context) {
    final double wordSize = 29 * unit;
    // Tracking expands as the wordmark reveals — the signature brand gesture.
    final double letterSpacing = _lerp(-0.02, 0.25, wordT) * wordSize;
    final double tagSize = 12 * unit;
    final double tagSpacing = 0.25 * tagSize;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // NIRIVIO — left padding mirrors the trailing tracking so glyphs stay
        // optically centered (design: padding-left: .25em).
        Opacity(
          opacity: (wordT * globalOpacity).clamp(0.0, 1.0),
          child: Padding(
            padding: EdgeInsets.only(left: math.max(0.0, letterSpacing)),
            child: Text(
              'NIRIVIO',
              style: GoogleFonts.josefinSans(
                fontSize: wordSize,
                fontWeight: FontWeight.w600,
                color: AppTheme.ornamentWordmark,
                letterSpacing: letterSpacing,
              ),
            ),
          ),
        ),
        SizedBox(height: 16 * unit),
        Opacity(
          opacity: (lineT * globalOpacity).clamp(0.0, 1.0),
          child: Transform.scale(
            scaleX: lineT.clamp(0.0, 1.0),
            scaleY: 1.0,
            child: Container(
              width: 46 * unit,
              height: math.max(1.5, 2 * unit),
              color: AppTheme.ornamentAccent,
            ),
          ),
        ),
        SizedBox(height: 15 * unit),
        Opacity(
          opacity: (tagT * 0.85 * globalOpacity).clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(0, _lerp(8, 0, tagT) * unit),
            child: Padding(
              padding: EdgeInsets.only(left: tagSpacing),
              child: Text(
                'Вкусное рядом',
                style: GoogleFonts.josefinSans(
                  fontSize: tagSize,
                  fontWeight: FontWeight.w300,
                  color: AppTheme.ornamentTagline,
                  letterSpacing: tagSpacing,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
