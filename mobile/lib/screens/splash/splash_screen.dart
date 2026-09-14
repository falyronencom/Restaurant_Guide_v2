import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/splash/painters/cockade_painter.dart';
import 'package:restaurant_guide_mobile/screens/splash/splash_easing.dart';
import 'package:restaurant_guide_mobile/screens/splash/widgets/wordmark_widget.dart';

/// Splash animation phases.
enum SplashPhase { intro, loop, outro }

/// Animated splash screen — the NIRIVIO cockade, grammar **A+** at tempo 0.75×,
/// gloss material, light stage (SDL CAT-C-1.4, lab «Заставка NIRIVIO» v7).
///
/// Three thin rings converge on the centre of a beige stage, land as the
/// glossy cockade with one haptic impact, a wave leaves the sign, then the
/// wordmark, the accent rule and the tagline settle in. Visuals: see
/// [CockadePainter] and [WordmarkWidget]; the numbers live in the brief §10.
///
/// The screen also doubles as the app's load gate (contract unchanged since
/// the previous splashes): it watches [AuthProvider.isLoading] to learn when
/// the session has been restored.
/// - Intro: the choreography plays once (2.8 s) — the minimum on-screen time.
/// - Loop: if the session is not ready when the intro finishes, the sign holds
///   while soft waves leave it every 1.1 s until auth is ready (or the 10 s
///   timeout fires).
/// - Outro: everything fades out (460 ms), then we navigate to `/home`
///   (authenticated) or `/auth/method-selection` (guest).
///
/// Reduce Motion (`MediaQuery.disableAnimations`): no flight, no impact — the
/// assembled sign and text appear in one 200 ms fade, the intro lasts 1 s, the
/// loop holds still; gate and navigation are the same.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with TickerProviderStateMixin {
  // ── Clock: ms from intro start ─────────────────────────────────────────────
  // The lab is specified in base seconds at 1×; the ratified tempo is 0.75×,
  // so every lab time is multiplied by 4/3 here (.30 → 400, .85 → 1133 …).
  static const int _introMs = 2800; // lab 2.10 s
  static const double _flightStartMs = 400; // .30
  static const double _landMs = 1133.3; // .85 — the sign is on stage
  static const double _settleMs = 1320; // .99 — overshoot spent
  static const double _shadowMs = 1253.3; // .94
  static const double _flashEndMs = 1466.7; // 1.10
  static const double _waveStartMs = 1160; // .87
  static const double _waveEndMs = 2106.7; // 1.58
  static const double _wordStartMs = 1266.7; // .95
  static const double _wordEndMs = 1733.3; // 1.30
  static const double _ruleStartMs = 1546.7; // 1.16
  static const double _ruleEndMs = 1813.3; // 1.36
  static const double _tagStartMs = 1706.7; // 1.28
  static const double _tagEndMs = 2080; // 1.56
  static const int _loopWaveStartMs = 2107; // 1.58 — gate waves if not ready

  /// One haptic impact at the landing point. Android is fired a little early:
  /// its motor lags the visual by roughly that much.
  static const int _impactMs = 1130;
  static const int _androidImpactLeadMs = 30;

  static const int _wavePeriodMs = 1100;
  static const int _reducedIntroMs = 1000; // Reduce Motion: minimum on screen
  static const int _reducedFadeMs = 200; // Reduce Motion: single fade-in
  static const int _outroMs = 460;
  static const Duration _timeout = Duration(seconds: 10);

  // ── Geometry: lab grid 390×844, C = (195, 352), R = 62 ─────────────────────
  static const double _radiusPerWidth = 62 / 390;
  static const double _radiusCap = 72;
  static const double _centerPerHeight = 352 / 844;
  static const double _stageCenterLift = 30; // gradient centre 30 grid px above C

  // ── State ───────────────────────────────────────────────────────────────────
  SplashPhase _phase = SplashPhase.intro;
  bool _authReady = false;
  bool _introComplete = false;
  bool _navigated = false;
  bool _introStarted = false;
  bool _impactFired = false;
  bool _reduceMotion = false;

  // ── Controllers ───────────────────────────────────────────────────────────────
  late final AnimationController _introCtrl; // drives the whole choreography
  late final AnimationController _waveCtrl; // waiting-loop waves, 1.1 s period
  late final AnimationController _outroCtrl; // fade-out before navigation
  late final Animation<double> _outroFade; // 1→0

  Timer? _timeoutTimer;
  VoidCallback? _authListener;

  // dispose() may not use context.read: ancestor lookup on a deactivated
  // widget throws when the tree is torn down (e.g. test teardown), so the
  // provider reference is cached while the widget is still in the tree.
  AuthProvider? _authProvider;

  @override
  void initState() {
    super.initState();
    _initControllers();
    _startTimeout();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _listenToAuth();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _authProvider = context.read<AuthProvider>();
    if (!_introStarted) {
      _introStarted = true;
      // Read once, before the first frame: durations, the flight and the
      // impact all branch on it, so a toggle mid-intro is not honoured.
      _reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
      _startIntro();
    }
  }

  @override
  void dispose() {
    _introCtrl.dispose();
    _waveCtrl.dispose();
    _outroCtrl.dispose();
    _timeoutTimer?.cancel();
    if (_authListener != null) {
      _authProvider?.removeListener(_authListener!);
    }
    super.dispose();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SETUP
  // ══════════════════════════════════════════════════════════════════════════

  void _initControllers() {
    _introCtrl = AnimationController(
      duration: const Duration(milliseconds: _introMs),
      vsync: this,
    );
    _waveCtrl = AnimationController(
      duration: const Duration(milliseconds: _wavePeriodMs),
      vsync: this,
    );
    _outroCtrl = AnimationController(
      duration: const Duration(milliseconds: _outroMs),
      vsync: this,
    );
    _outroFade = Tween<double>(begin: 1.0, end: 0.0).animate(
      CurvedAnimation(parent: _outroCtrl, curve: Curves.easeIn),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE TRANSITIONS
  // ══════════════════════════════════════════════════════════════════════════

  void _startIntro() {
    _introCtrl.duration = Duration(
      milliseconds: _reduceMotion ? _reducedIntroMs : _introMs,
    );
    _introCtrl.addListener(_onIntroTick);
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
    _introCtrl.forward();
  }

  /// Per-frame marks of the intro: the single haptic impact at landing and
  /// the start of the waiting waves if the session is still loading.
  void _onIntroTick() {
    if (_reduceMotion) return;
    // Exact elapsed time while ticking; on the completing tick the controller
    // has already stopped and the value (1.0) stands in for it.
    final Duration? elapsed = _introCtrl.lastElapsedDuration;
    final double ms = elapsed != null
        ? elapsed.inMicroseconds / Duration.microsecondsPerMillisecond
        : _introCtrl.value * _introMs;

    if (!_impactFired && ms >= _impactMark) {
      _impactFired = true;
      _fireImpact();
    }
    if (!_waveCtrl.isAnimating && !_authReady && ms >= _loopWaveStartMs) {
      _waveCtrl.repeat();
    }
  }

  int get _impactMark => defaultTargetPlatform == TargetPlatform.android
      ? _impactMs - _androidImpactLeadMs
      : _impactMs;

  void _fireImpact() {
    // Fire-and-forget. A system with haptics switched off answers silently;
    // a platform without the channel must not surface an async error either.
    unawaited(HapticFeedback.mediumImpact().catchError((Object _) {}));
  }

  void _startLoop() {
    if (!mounted) return;
    // The sign holds; the waves keep leaving it (driven by _waveCtrl) until
    // auth is ready or the timeout fires. Reduce Motion holds still.
    if (!_reduceMotion && !_waveCtrl.isAnimating) _waveCtrl.repeat();
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
      body: LayoutBuilder(
        builder: (context, constraints) {
          final Size size = constraints.biggest;
          return DecoratedBox(
            decoration: BoxDecoration(gradient: _stageGradient(size)),
            child: AnimatedBuilder(
              animation: Listenable.merge([_introCtrl, _waveCtrl, _outroCtrl]),
              builder: (context, _) => _buildScene(size),
            ),
          );
        },
      ),
    );
  }

  static double _radiusFor(Size size) =>
      math.min(size.width * _radiusPerWidth, _radiusCap);

  /// Warm beige radial wash — lab `bg()`: centred 30 grid px above the sign,
  /// reaching 0.72·H, stops 0 / .55 / 1.
  RadialGradient _stageGradient(Size size) {
    final double shortest = size.shortestSide > 0 ? size.shortestSide : 1;
    final double height = size.height > 0 ? size.height : 1;
    final double cy = size.height * _centerPerHeight -
        _stageCenterLift * _radiusFor(size) / CockadePainter.gridRadius;
    return RadialGradient(
      center: Alignment(0, cy / height * 2 - 1),
      radius: .72 * size.height / shortest,
      colors: const [
        AppTheme.splashBgInner,
        AppTheme.splashBgMid,
        AppTheme.splashBgOuter,
      ],
      stops: const [0, .55, 1],
    );
  }

  Widget _buildScene(Size size) {
    final double radius = _radiusFor(size);
    final Offset center = Offset(size.width / 2, size.height * _centerPerHeight);
    final double g = _phase == SplashPhase.outro ? _outroFade.value : 1.0;

    double? flight;
    bool landed;
    double scale;
    double shadow;
    double flash;
    double? wave;
    double? loopPhase;
    double opacity;
    double wordT;
    double lineT;
    double tagT;

    if (_reduceMotion) {
      // No flight: the assembled sign and text fade in together.
      final double fade = SplashEasing.span(
          _introCtrl.value * _reducedIntroMs, 0, _reducedFadeMs.toDouble());
      flight = null;
      landed = true;
      scale = 1;
      shadow = 1;
      flash = 0;
      wave = null;
      loopPhase = null;
      opacity = fade * g;
      wordT = 1;
      lineT = 1;
      tagT = 1;
    } else {
      // Lab `drawSoft(x)` with x in app milliseconds.
      final double ms = _introCtrl.value * _introMs;
      double span(double a, double b) => SplashEasing.span(ms, a, b);

      landed = ms >= _landMs;
      flight = (ms > _flightStartMs && !landed)
          ? SplashEasing.inOutCubic(span(_flightStartMs, _landMs))
          : null;
      final double ip = span(_landMs, _settleMs);
      scale = ip < 1 ? 1 + .09 * (1 - SplashEasing.outBack(ip)) : 1.0;
      shadow = span(_landMs, _shadowMs);
      flash = landed ? 1 - span(_landMs, _flashEndMs) : 0.0;
      final double wv = span(_waveStartMs, _waveEndMs);
      wave = (landed && wv > 0 && wv < 1) ? SplashEasing.outCubic(wv) : null;
      loopPhase = _waveCtrl.isAnimating ? _waveCtrl.value : null;
      opacity = g;
      wordT = span(_wordStartMs, _wordEndMs);
      lineT = span(_ruleStartMs, _ruleEndMs);
      tagT = span(_tagStartMs, _tagEndMs);
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        CustomPaint(
          painter: CockadePainter(
            center: center,
            radius: radius,
            flight: flight,
            landed: landed,
            scale: scale,
            shadow: shadow,
            flash: flash,
            wave: wave,
            loopPhase: loopPhase,
            opacity: opacity,
          ),
        ),
        WordmarkWidget(
          center: center,
          radius: radius,
          wordT: wordT,
          lineT: lineT,
          tagT: tagT,
          globalOpacity: opacity,
        ),
      ],
    );
  }
}
