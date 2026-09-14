import 'dart:async';

import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_inline_spinner.dart';

/// Кадр инициализации: держит экран, пока неизвестно, есть ли сессия.
///
/// До 14.09.2026 этого кадра не было: `redirect` возвращал `null`, пока
/// `AuthProvider.isLoading`, и первый кадр строил защищённый маршрут `/`.
/// Дашборд успевал смонтироваться и уйти в сеть четырьмя запросами с
/// неизвестным токеном, получить четыре 401 и быть снесённым редиректом —
/// на каждом холодном старте, включая старт без сессии вовсе. Теперь до
/// ответа об авторизации строится только этот экран.
///
/// Индикатор появляется не сразу. Быстрый путь — одно чтение хранилища, и
/// спиннер на нём успел бы только мигнуть; медленный — заход на `/auth/me`
/// по спящему Railway, и там пустой экран читался бы как зависание. Потолок
/// ожидания задаёт не этот экран, а `AuthProvider.initializationTimeout`:
/// кадр не бывает вечным.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  /// Сколько ждать до появления индикатора.
  ///
  /// Вынесено в константу, потому что это значение — предмет теста: без
  /// задержки сторож не отличил бы «спиннера нет» от «спиннер ещё не успел».
  static const Duration indicatorDelay = Duration(milliseconds: 400);

  /// Высота, зарезервированная под индикатор.
  ///
  /// Место держится с первого кадра: иначе появление спиннера сдвигало бы
  /// вордмарк, и быстрый путь давал бы дёрганье вместо спокойного кадра.
  static const double _indicatorSlot = 14;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  Timer? _indicatorTimer;
  bool _showIndicator = false;

  @override
  void initState() {
    super.initState();
    _indicatorTimer = Timer(SplashScreen.indicatorDelay, () {
      if (mounted) setState(() => _showIndicator = true);
    });
  }

  @override
  void dispose() {
    // Таймер переживает экран: редирект уводит отсюда ровно тогда, когда
    // авторизация ответила, и на быстром пути это происходит до срабатывания.
    _indicatorTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'NIRIVIO',
              textAlign: TextAlign.center,
              style: AppTheme.canonWordmark.copyWith(fontSize: 30, height: 1.1),
            ),
            const SizedBox(height: 24),
            SizedBox(
              height: SplashScreen._indicatorSlot,
              child: _showIndicator ? const AdminInlineSpinner() : null,
            ),
          ],
        ),
      ),
    );
  }
}
