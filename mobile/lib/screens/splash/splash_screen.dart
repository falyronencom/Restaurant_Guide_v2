import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/splash/painters/ornament_painter.dart';
import 'package:restaurant_guide_mobile/screens/splash/widgets/wordmark_widget.dart';

double _lerp(double a, double b, double t) => a + (b - a) * t;

/// Splash animation phases.
enum SplashPhase { intro, loop, outro }

/// Animated splash screen — NIRIVIO «Ornament Bloom».
///
/// A procedural folk ornament blooms layer-by-layer from the center while a
/// ring of dots rotates continuously around the perimeter; the NIRIVIO wordmark
/// then reveals with expanding letter-tracking and the «Вкусное рядом» tagline.
/// Visuals follow the hi-fi design handoff — see [OrnamentPainter].
///
/// The screen also doubles as the app's load gate (behaviour unchanged from the
/// previous splash): it watches [AuthProvider.isLoading] to learn when the
/// session has been restored.
/// - Intro: the full bloom plays once (~4.3s) — the minimum on-screen time.
/// - Loop: if data is not ready when the bloom finishes, the ornament holds and
///   the ring keeps spinning until auth is ready (or the 10s timeout fires).
/// - Outro: everything fades out, then we navigate to `/home` (authenticated)
///   or `/auth/method-selection` (guest).
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with TickerProviderStateMixin {
  // ── OPEN EDIT (agreed with client) ─────────────────────────────────────────
  // Eyelet colour. Currently the brand orange accent; the client may switch it
  // to the cornflower petal blue after on-device review. Changing this one line
  // to AppTheme.ornamentCornflower (or .ornamentCornLite for a softer blue) is
  // the only edit required.
  static const Color _eyeletColor = AppTheme.ornamentAccent;

  // Reference cycle = 6s ("Динамично" speed); the bloom-in finishes at 72% of
  // it. The remaining 28% (hold + out) is handled by the phase machine, not the
  // intro controller, so the controller runs exactly the bloom span.
  static const int _bloomMs = 4320; // 0.72 * 6000
  static const int _ringSpinMs = 14000; // one revolution, linear, continuous
  static const int _outroMs = 700;
  static const Duration _timeout = Duration(seconds: 10);

  // ── State ───────────────────────────────────────────────────────────────────
  SplashPhase _phase = SplashPhase.intro;
  bool _authReady = false;
  bool _introComplete = false;
  bool _navigated = false;

  // ── Controllers ───────────────────────────────────────────────────────────────
  late final AnimationController _introCtrl; // drives the layered bloom
  late final AnimationController _spinCtrl; // ring rotation, always running
  late final AnimationController _outroCtrl; // fade-out before navigation

  // ── Per-layer reveals (sub-intervals of the bloom) ──────────────────────────
  // Interval bounds = design-cycle % ÷ 0.72 (the bloom span end). Each reveal
  // animates a layer's opacity together with its scale / rotation / tracking.
  late final Animation<double> _ringReveal; //   6%→22%  ease-in-out
  late final Animation<double> _outerReveal; //  6%→27%  cubic(.3,.8,.3,1)
  late final Animation<double> _innerReveal; // 14%→36%  cubic(.3,.8,.3,1)
  late final Animation<double> _centerReveal; // 24%→42% cubic(.2,1.3,.4,1) overshoot
  late final Animation<double> _wordReveal; //  46%→62%  cubic(.2,.7,.2,1)
  late final Animation<double> _lineReveal; //  54%→68%  cubic(.2,.7,.2,1)
  late final Animation<double> _tagReveal; //   58%→72%  ease-in-out
  late final Animation<double> _outroFade; //   1→0

  Timer? _timeoutTimer;
  VoidCallback? _authListener;

  @override
  void initState() {
    super.initState();
    _initControllers();
    _buildAnimations();
    _startIntro();
    _startTimeout();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _listenToAuth();
    });
  }

  @override
  void dispose() {
    _introCtrl.dispose();
    _spinCtrl.dispose();
    _outroCtrl.dispose();
    _timeoutTimer?.cancel();
    if (_authListener != null) {
      context.read<AuthProvider>().removeListener(_authListener!);
    }
    super.dispose();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SETUP
  // ══════════════════════════════════════════════════════════════════════════

  void _initControllers() {
    _introCtrl = AnimationController(
      duration: const Duration(milliseconds: _bloomMs),
      vsync: this,
    );
    _spinCtrl = AnimationController(
      duration: const Duration(milliseconds: _ringSpinMs),
      vsync: this,
    )..repeat();
    _outroCtrl = AnimationController(
      duration: const Duration(milliseconds: _outroMs),
      vsync: this,
    );
  }

  void _buildAnimations() {
    Animation<double> reveal(double begin, double end, Curve curve) {
      return CurvedAnimation(
        parent: _introCtrl,
        curve: Interval(begin, end, curve: curve),
      );
    }

    const Cubic bloomCurve = Cubic(0.3, 0.8, 0.3, 1.0);
    const Cubic overshoot = Cubic(0.2, 1.3, 0.4, 1.0);
    const Cubic textCurve = Cubic(0.2, 0.7, 0.2, 1.0);

    _ringReveal = reveal(0.083, 0.306, Curves.easeInOut);
    _outerReveal = reveal(0.083, 0.375, bloomCurve);
    _innerReveal = reveal(0.194, 0.500, bloomCurve);
    _centerReveal = reveal(0.333, 0.583, overshoot);
    _wordReveal = reveal(0.639, 0.861, textCurve);
    _lineReveal = reveal(0.750, 0.944, textCurve);
    _tagReveal = reveal(0.806, 1.000, Curves.easeInOut);

    _outroFade = Tween<double>(begin: 1.0, end: 0.0).animate(
      CurvedAnimation(parent: _outroCtrl, curve: Curves.easeIn),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE TRANSITIONS
  // ══════════════════════════════════════════════════════════════════════════

  void _startIntro() {
    _introCtrl.forward();

    _introCtrl.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        _introComplete = true;
        if (_authReady) {
          _startOutro();
        } else {
          _startLoop();
        }
      }
    });
  }

  void _startLoop() {
    if (!mounted) return;
    // The ornament is fully bloomed; it simply holds while the ring keeps
    // spinning (driven by _spinCtrl) until auth is ready or the timeout fires.
    setState(() => _phase = SplashPhase.loop);
  }

  void _startOutro() {
    if (!mounted || _phase == SplashPhase.outro) return;
    setState(() => _phase = SplashPhase.outro);
    _outroCtrl.forward();

    _outroCtrl.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        _navigate();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AUTH LISTENER (load gate — unchanged contract)
  // ══════════════════════════════════════════════════════════════════════════

  void _listenToAuth() {
    if (!mounted) return;
    final authProvider = context.read<AuthProvider>();

    if (!authProvider.isLoading) {
      _onAuthReady();
      return;
    }

    _authListener = () {
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      if (!auth.isLoading) {
        auth.removeListener(_authListener!);
        _authListener = null;
        _onAuthReady();
      }
    };
    authProvider.addListener(_authListener!);
  }

  void _onAuthReady() {
    _authReady = true;
    if (_introComplete && _phase == SplashPhase.loop) {
      _startOutro();
    }
    // If still in intro, the intro-complete listener triggers the outro.
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TIMEOUT
  // ══════════════════════════════════════════════════════════════════════════

  void _startTimeout() {
    _timeoutTimer = Timer(_timeout, () {
      if (!mounted || _phase == SplashPhase.outro) return;
      _authReady = true;
      if (_introComplete) {
        _startOutro();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ══════════════════════════════════════════════════════════════════════════

  void _navigate() {
    if (_navigated || !mounted) return;
    _navigated = true;
    _timeoutTimer?.cancel();

    final authProvider = context.read<AuthProvider>();
    final route =
        authProvider.isAuthenticated ? '/home' : '/auth/method-selection';

    Navigator.of(context).pushNamedAndRemoveUntil(
      route,
      (route) => false,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BUILD
  // ══════════════════════════════════════════════════════════════════════════

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: DecoratedBox(
        // Warm beige radial wash (design: radial at 50% 38%).
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0.0, -0.24),
            radius: 1.0,
            colors: [
              AppTheme.splashBgInner,
              AppTheme.splashBgMid,
              AppTheme.splashBgOuter,
            ],
            stops: [0.0, 0.6, 1.0],
          ),
        ),
        child: SizedBox.expand(
          child: AnimatedBuilder(
            animation: Listenable.merge([_introCtrl, _spinCtrl, _outroCtrl]),
            builder: (context, _) => _buildScene(context),
          ),
        ),
      ),
    );
  }

  Widget _buildScene(BuildContext context) {
    final double screenW = MediaQuery.of(context).size.width;
    // Ornament diameter ≈ 0.72 of screen width (handoff: 0.7–0.8), capped on
    // large screens. One viewBox unit (the design's 300-grid) → logical px.
    final double sceneSide = math.min(screenW * 0.72, 360.0);
    final double unit = sceneSide / 300.0;

    final double g = _phase == SplashPhase.outro ? _outroFade.value : 1.0;
    final double centerProgress = _centerReveal.value; // overshoots past 1

    return Align(
      alignment: const Alignment(0.0, -0.08),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: sceneSide,
            height: sceneSide,
            child: CustomPaint(
              painter: OrnamentPainter(
                ringOpacity: _ringReveal.value,
                ringSpin: _spinCtrl.value * 2 * math.pi,
                outerOpacity: _outerReveal.value,
                outerScale: _lerp(0.5, 1.0, _outerReveal.value),
                outerRotation: _lerp(-14, 0, _outerReveal.value) * math.pi / 180,
                innerOpacity: _innerReveal.value,
                innerScale: _lerp(0.4, 1.0, _innerReveal.value),
                innerRotation: _lerp(12, 0, _innerReveal.value) * math.pi / 180,
                centerOpacity: centerProgress,
                centerScale: centerProgress,
                globalOpacity: g,
                eyeletColor: _eyeletColor,
              ),
            ),
          ),
          SizedBox(height: 6 * unit),
          WordmarkWidget(
            unit: unit,
            wordT: _wordReveal.value,
            lineT: _lineReveal.value,
            tagT: _tagReveal.value,
            globalOpacity: g,
          ),
        ],
      ),
    );
  }
}
