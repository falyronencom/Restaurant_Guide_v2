import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/screens/splash/splash_easing.dart';

/// The text block beneath the splash cockade: the «NIRIVIO» wordmark, an
/// orange accent rule, and the «Вкусное рядом» tagline.
///
/// Positions follow the «Заставка NIRIVIO» lab grid (390×844, R = 62): the
/// wordmark sits on an alphabetic baseline 146 grid px below the sign centre,
/// the rule is centred 188 below, the tagline baseline is 220 below; every
/// distance and size scales with [radius]. The three reveals are driven by
/// linear progress values (the lab's `span`): opacity follows them directly,
/// motion — the wordmark drop, letter-tracking, rule width — goes through
/// `outCubic`, exactly as in the lab's `drawSoft`.
///
/// Fonts are the bundled ones only (`google_fonts/`, runtime fetching off):
/// Josefin Sans SemiBold for the wordmark (the lab's Regular cut is not
/// bundled and is not added), Nunito Sans Regular for the tagline — as in the
/// lab. Josefin Sans has no Cyrillic at all, so the previous Josefin Light
/// tagline was silently drawn by the system fallback font on devices and not
/// drawn at all in test renders.
class WordmarkWidget extends StatelessWidget {
  /// Sign centre C, logical px.
  final Offset center;

  /// Outer disc radius R, logical px.
  final double radius;

  /// Wordmark reveal, 0..1 (lab: `span(x, .95, 1.30)`).
  final double wordT;

  /// Rule reveal, 0..1 (lab: `span(x, 1.16, 1.36)`).
  final double lineT;

  /// Tagline reveal, 0..1 (lab: `span(x, 1.28, 1.56)`).
  final double tagT;

  /// Outro fade multiplier.
  final double globalOpacity;

  const WordmarkWidget({
    super.key,
    required this.center,
    required this.radius,
    required this.wordT,
    required this.lineT,
    required this.tagT,
    this.globalOpacity = 1.0,
  });

  // ── Lab grid (R = 62), distances from the sign centre ─────────────────────
  static const double _grid = 62;
  static const double _wordBaseline = 146; // 498 − 352
  static const double _ruleY = 188; // 540 − 352
  static const double _tagBaseline = 220; // 572 − 352
  static const double _wordSize = 33;
  static const double _tagSize = 13;
  static const double _ruleWidth = 62;
  static const double _ruleHeight = 2;
  static const double _wordDrop = 7; // the wordmark settles up by 7 px
  static const double _wordTrackFrom = .5; // tracking .5 → 8 px
  static const double _wordTrackSpan = 7.5;
  static const double _tagTrackFrom = 1; // tracking 1 → 3.2 px
  static const double _tagTrackSpan = 2.2;

  @override
  Widget build(BuildContext context) {
    final double u = radius / _grid;
    final double wordE = SplashEasing.outCubic(wordT);
    final double lineE = SplashEasing.outCubic(lineT);
    final double tagE = SplashEasing.outCubic(tagT);

    final double wordSpacing = (_wordTrackFrom + _wordTrackSpan * wordE) * u;
    final double tagSpacing = (_tagTrackFrom + _tagTrackSpan * tagE) * u;
    final double ruleHeight = math.max(1.5, _ruleHeight * u);

    return Stack(
      children: [
        _onBaseline(
          baseline: center.dy + (_wordBaseline + _wordDrop * (1 - wordE)) * u,
          opacity: wordT,
          spacing: wordSpacing,
          text: Text(
            'NIRIVIO',
            style: GoogleFonts.josefinSans(
              fontSize: _wordSize * u,
              fontWeight: FontWeight.w600,
              color: AppTheme.splashWordmark,
              letterSpacing: wordSpacing,
            ),
          ),
        ),
        Positioned(
          top: center.dy + _ruleY * u - ruleHeight / 2,
          left: 0,
          right: 0,
          child: Center(
            child: Opacity(
              opacity: (lineT * globalOpacity).clamp(0.0, 1.0),
              child: Container(
                width: _ruleWidth * u * lineE,
                height: ruleHeight,
                decoration: BoxDecoration(
                  color: AppTheme.cockadeAccent,
                  borderRadius: BorderRadius.circular(ruleHeight),
                ),
              ),
            ),
          ),
        ),
        _onBaseline(
          baseline: center.dy + _tagBaseline * u,
          opacity: tagT,
          spacing: tagSpacing,
          text: Text(
            'Вкусное рядом',
            style: GoogleFonts.nunitoSans(
              fontSize: _tagSize * u,
              fontWeight: FontWeight.w400,
              color: AppTheme.splashTagline,
              letterSpacing: tagSpacing,
            ),
          ),
        ),
      ],
    );
  }

  /// Centres [text] horizontally with its alphabetic baseline at [baseline]
  /// from the top of the stage — the lab draws text with
  /// `textBaseline = "alphabetic"` at a fixed y, and centres the glyph run.
  /// Flutter adds [spacing] after every glyph including the last, so the same
  /// amount of left padding keeps the run (not the box) optically centred.
  Widget _onBaseline({
    required double baseline,
    required double opacity,
    required double spacing,
    required Text text,
  }) {
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: Baseline(
        baseline: baseline,
        baselineType: TextBaseline.alphabetic,
        child: Center(
          child: Opacity(
            opacity: (opacity * globalOpacity).clamp(0.0, 1.0),
            child: Padding(
              padding: EdgeInsets.only(left: math.max(0.0, spacing)),
              child: text,
            ),
          ),
        ),
      ),
    );
  }
}
