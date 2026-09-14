/// Easing functions of the «Заставка NIRIVIO» lab, ported verbatim.
///
/// The lab (grammar A+, SDL CAT-C-1.4) drives every reveal with these three
/// polynomial curves plus a linear `span`. They are kept as plain functions —
/// not as Flutter [Curve]s — so the screen, the wordmark and the tests all
/// evaluate exactly the same numbers the prototype did: Flutter's bezier
/// `Curves.easeInOutCubic` is close to the lab's `inOutCubic` but not equal.
class SplashEasing {
  SplashEasing._();

  /// Linear progress of [x] across `[a, b]`, clamped to `0..1`.
  static double span(double x, double a, double b) =>
      ((x - a) / (b - a)).clamp(0.0, 1.0);

  /// `1 − (1 − p)³` — decelerating exit.
  static double outCubic(double p) {
    final double q = 1 - p;
    return 1 - q * q * q;
  }

  /// Symmetric cubic ease — the soft flight of A+ (the sharp `inQuad` entry
  /// of plain A read as a shot at full speed).
  static double inOutCubic(double p) {
    if (p < .5) return 4 * p * p * p;
    final double q = -2 * p + 2;
    return 1 - q * q * q / 2;
  }

  /// Overshoot-and-settle with `c = 2.0` — the landing squash of the sign.
  static double outBack(double p) {
    const double c = 2.0;
    final double q = p - 1;
    return 1 + (c + 1) * q * q * q + c * q * q;
  }
}
