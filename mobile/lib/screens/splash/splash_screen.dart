import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/splash/painters/pin_painter.dart';
import 'package:restaurant_guide_mobile/screens/splash/painters/halo_painter.dart';
import 'package:restaurant_guide_mobile/screens/splash/widgets/cloud_field.dart';
import 'package:restaurant_guide_mobile/screens/splash/widgets/wordmark_widget.dart';

/// Splash animation phases.
enum SplashPhase { intro, loop, outro }

/// Animated splash screen with three phases:
/// - Intro (2.2s): wordmark slides in, pin drops with bounce, loading fades in
/// - Loop (indefinite): pin hovers, halo pulses, shimmer on wordmark
/// - Outro (0.85s): everything fades out, white flash, navigate to next screen
///
/// Listens to [AuthProvider.isLoading] to determine when data is ready.
/// Minimum duration = intro length. Maximum = 10s timeout.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with TickerProviderStateMixin {
  // ── State ──────────────────────────────────────────────────────────────────
  SplashPhase _phase = SplashPhase.intro;
  bool _authReady = false;
  bool _introComplete = false;
  bool _navigated = false;

  // ── Animation Controllers ──────────────────────────────────────────────────
  late final AnimationController _introCtrl;
  late final AnimationController _loopCtrl;
  late final AnimationController _outroCtrl;
  late final AnimationController _cloudCtrl;

  // ── Intro Animations ───────────────────────────────────────────────────────
  late final Animation<double> _wordmarkFade;
  late final Animation<double> _wordmarkSlideY;
  late final Animation<double> _pinDropY;
  late final Animation<double> _pinScaleIntro;
  late final Animation<double> _pinFadeIntro;
  late final Animation<double> _loadingFade;

  // ── Loop Animations ────────────────────────────────────────────────────────
  late final Animation<double> _pinHoverY;
  late final Animation<double> _haloScaleX;
  late final Animation<double> _haloOpacity;
  late final Animation<double> _shimmerGlow;

  // ── Outro Animations ───────────────────────────────────────────────────────
  late final Animation<double> _outroFade;
  late final Animation<double> _outroWordmarkSlideY;
  late final Animation<double> _outroPinSlideY;
  late final Animation<double> _outroPinScale;
  late final Animation<double> _flashOpacity;

  // ── Loading Dots ───────────────────────────────────────────────────────────
  Timer? _dotsTimer;
  int _dotCount = 0;

  // ── Timeout ────────────────────────────────────────────────────────────────
  Timer? _timeoutTimer;

  // ── Auth Listener ──────────────────────────────────────────────────────────
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
    _loopCtrl.dispose();
    _outroCtrl.dispose();
    _cloudCtrl.dispose();
    _dotsTimer?.cancel();
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
      duration: const Duration(milliseconds: 2200),
      vsync: this,
    );
    _loopCtrl = AnimationController(
      duration: const Duration(milliseconds: 2800),
      vsync: this,
    );
    _outroCtrl = AnimationController(
      duration: const Duration(milliseconds: 850),
      vsync: this,
    );
    _cloudCtrl = AnimationController(
      duration: const Duration(milliseconds: 30000),
      vsync: this,
    );
  }

  void _buildAnimations() {
    // ── INTRO (2200ms total) ──────────────────────────────────────────────

    // Wordmark: fade+slide in, starts at 0.2s, 0.6s duration
    // Interval: 0.2/2.2 = 0.091 → 0.8/2.2 = 0.364
    _wordmarkFade = CurvedAnimation(
      parent: _introCtrl,
      curve: const Interval(0.091, 0.364, curve: Curves.easeOutCubic),
    );
    _wordmarkSlideY = Tween<double>(begin: -14, end: 0).animate(
      CurvedAnimation(
        parent: _introCtrl,
        curve: const Interval(0.091, 0.364, curve: Curves.easeOutCubic),
      ),
    );

    // Pin: drop+scale, starts at 0.8s, 0.85s duration
    // Interval: 0.8/2.2 = 0.364 → 1.65/2.2 = 0.75
    // Elastic overshoot curve
    _pinDropY = Tween<double>(begin: -55, end: 0).animate(
      CurvedAnimation(
        parent: _introCtrl,
        curve: const Interval(0.364, 0.75, curve: Curves.elasticOut),
      ),
    );
    _pinScaleIntro = Tween<double>(begin: 0.82, end: 1.0).animate(
      CurvedAnimation(
        parent: _introCtrl,
        curve: const Interval(0.364, 0.75, curve: Curves.elasticOut),
      ),
    );
    _pinFadeIntro = CurvedAnimation(
      parent: _introCtrl,
      curve: const Interval(0.364, 0.45, curve: Curves.easeIn),
    );

    // Loading text: fade in at 1.5s
    // Interval: 1.5/2.2 = 0.682 → 2.0/2.2 = 0.909
    _loadingFade = CurvedAnimation(
      parent: _introCtrl,
      curve: const Interval(0.682, 0.909, curve: Curves.easeIn),
    );

    // ── LOOP (2800ms, reverse:true → 5600ms full cycle) ──────────────────

    _pinHoverY = Tween<double>(begin: 0, end: -9).animate(
      CurvedAnimation(parent: _loopCtrl, curve: Curves.easeInOut),
    );
    _haloScaleX = Tween<double>(begin: 1.0, end: 0.6).animate(
      CurvedAnimation(parent: _loopCtrl, curve: Curves.easeInOut),
    );
    _haloOpacity = Tween<double>(begin: 1.0, end: 0.4).animate(
      CurvedAnimation(parent: _loopCtrl, curve: Curves.easeInOut),
    );
    _shimmerGlow = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _loopCtrl, curve: Curves.easeInOut),
    );

    // ── OUTRO (850ms) ────────────────────────────────────────────────────

    _outroFade = Tween<double>(begin: 1.0, end: 0.0).animate(
      CurvedAnimation(
        parent: _outroCtrl,
        curve: const Interval(0.0, 0.6, curve: Curves.easeIn),
      ),
    );
    _outroWordmarkSlideY = Tween<double>(begin: 0, end: -10).animate(
      CurvedAnimation(
        parent: _outroCtrl,
        curve: const Interval(0.0, 0.6, curve: Curves.easeIn),
      ),
    );
    _outroPinSlideY = Tween<double>(begin: 0, end: -35).animate(
      CurvedAnimation(
        parent: _outroCtrl,
        curve: const Interval(0.0, 0.7, curve: Curves.easeIn),
      ),
    );
    _outroPinScale = Tween<double>(begin: 1.0, end: 0.88).animate(
      CurvedAnimation(
        parent: _outroCtrl,
        curve: const Interval(0.0, 0.7, curve: Curves.easeIn),
      ),
    );
    _flashOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _outroCtrl,
        curve: const Interval(0.3, 1.0, curve: Curves.easeOut),
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE TRANSITIONS
  // ══════════════════════════════════════════════════════════════════════════

  void _startIntro() {
    _cloudCtrl.repeat();
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
    setState(() => _phase = SplashPhase.loop);
    _loopCtrl.repeat(reverse: true);
    _startDots();
  }

  void _startOutro() {
    if (!mounted || _phase == SplashPhase.outro) return;
    setState(() => _phase = SplashPhase.outro);
    _loopCtrl.stop();
    _stopDots();
    _outroCtrl.forward();

    _outroCtrl.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        _navigate();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AUTH LISTENER
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
    // If still in intro, _introComplete callback will trigger outro
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TIMEOUT
  // ══════════════════════════════════════════════════════════════════════════

  void _startTimeout() {
    _timeoutTimer = Timer(const Duration(seconds: 10), () {
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
  // LOADING DOTS
  // ══════════════════════════════════════════════════════════════════════════

  void _startDots() {
    _dotsTimer = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (!mounted) return;
      setState(() => _dotCount = (_dotCount + 1) % 4);
    });
  }

  void _stopDots() {
    _dotsTimer?.cancel();
    _dotsTimer = null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BUILD
  // ══════════════════════════════════════════════════════════════════════════

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          // Layer 0: Radial gradient background
          _buildBackground(),

          // Layer 1: Back clouds (slowest)
          CloudField(layer: 0, driftAnimation: _cloudCtrl),

          // Layer 2: Mid clouds
          CloudField(layer: 1, driftAnimation: _cloudCtrl),

          // Layer 3: Center content (wordmark + pin + halo + loading)
          _buildCenterContent(),

          // Layer 4: Front clouds (fastest)
          CloudField(layer: 2, driftAnimation: _cloudCtrl),

          // Layer 5: White flash overlay (outro)
          _buildWhiteFlash(),
        ],
      ),
    );
  }

  Widget _buildBackground() {
    return Container(
      decoration: const BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0.0, -0.2),
          radius: 1.2,
          colors: [
            AppTheme.primaryOrangeLight,
            AppTheme.primaryOrange,
            AppTheme.primaryOrangeDark,
          ],
          stops: [0.0, 0.48, 1.0],
        ),
      ),
    );
  }

  Widget _buildCenterContent() {
    return AnimatedBuilder(
      animation: Listenable.merge([_introCtrl, _loopCtrl, _outroCtrl]),
      builder: (context, child) {
        // Compute animation values based on current phase
        double wordmarkOpacity = 1.0;
        double wordmarkY = 0.0;
        double pinY = 0.0;
        double pinScale = 1.0;
        double pinOpacity = 1.0;
        double haloSX = 1.0;
        double haloOp = 1.0;
        double shimmer = 0.0;
        double loadingOpacity = 1.0;

        switch (_phase) {
          case SplashPhase.intro:
            wordmarkOpacity = _wordmarkFade.value;
            wordmarkY = _wordmarkSlideY.value;
            pinY = _pinDropY.value;
            pinScale = _pinScaleIntro.value;
            pinOpacity = _pinFadeIntro.value;
            loadingOpacity = _loadingFade.value;
            break;

          case SplashPhase.loop:
            pinY = _pinHoverY.value;
            haloSX = _haloScaleX.value;
            haloOp = _haloOpacity.value;
            shimmer = _shimmerGlow.value;
            break;

          case SplashPhase.outro:
            wordmarkOpacity = _outroFade.value;
            wordmarkY = _outroWordmarkSlideY.value;
            pinOpacity = _outroFade.value;
            pinY = _outroPinSlideY.value;
            pinScale = _outroPinScale.value;
            loadingOpacity = 0.0;
            break;
        }

        return Center(
          child: Padding(
            padding: const EdgeInsets.only(top: 40),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Wordmark
                Transform.translate(
                  offset: Offset(0, wordmarkY),
                  child: Opacity(
                    opacity: wordmarkOpacity.clamp(0.0, 1.0),
                    child: WordmarkWidget(shimmerGlow: shimmer),
                  ),
                ),

                const SizedBox(height: 36),

                // Pin + Halo
                SizedBox(
                  width: 100,
                  height: 160,
                  child: Stack(
                    alignment: Alignment.topCenter,
                    children: [
                      // Halo beneath pin
                      Positioned(
                        bottom: 0,
                        child: CustomPaint(
                          size: const Size(90, 18),
                          painter: HaloPainter(
                            opacity: haloOp * pinOpacity,
                            scaleX: haloSX,
                            color: AppTheme.primaryOrangeDark,
                          ),
                        ),
                      ),
                      // Pin
                      Transform.translate(
                        offset: Offset(0, pinY),
                        child: Transform.scale(
                          scale: pinScale,
                          child: Opacity(
                            opacity: pinOpacity.clamp(0.0, 1.0),
                            child: CustomPaint(
                              size: const Size(80, 130),
                              painter: PinPainter(
                                bodyColor: Colors.white,
                                cutoutColor: AppTheme.primaryOrange,
                                shadowColor: AppTheme.primaryOrangeDark,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 24),

                // Loading text
                Opacity(
                  opacity: loadingOpacity.clamp(0.0, 1.0),
                  child: Text(
                    _phase == SplashPhase.loop
                        ? 'загрузка${'.' * _dotCount}'
                        : (_phase == SplashPhase.intro ? 'загрузка' : ''),
                    style: GoogleFonts.josefinSans(
                      fontSize: 13,
                      fontWeight: FontWeight.w200,
                      color: Colors.white.withValues(alpha: 0.6),
                      letterSpacing: 13 * 0.38,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildWhiteFlash() {
    return AnimatedBuilder(
      animation: _outroCtrl,
      builder: (context, child) {
        final opacity =
            _phase == SplashPhase.outro ? _flashOpacity.value : 0.0;
        if (opacity <= 0.0) return const SizedBox.shrink();
        return Container(color: Colors.white.withValues(alpha: opacity));
      },
    );
  }
}
