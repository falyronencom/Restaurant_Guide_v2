import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Страж палитры кокарды.
///
/// Среднее кольцо знака обязано быть СВЕТЛЕЕ центра сцены, а не равным ему:
/// кольцо цвета фона превращает кокарду в две разрозненные фигуры. Три полосы
/// — цвета иконки приложения (константы решения CAT-C-1.4).
void main() {
  test('светлое кольцо светлее центра сцены', () {
    expect(
      AppTheme.cockadeRing.computeLuminance(),
      greaterThan(AppTheme.splashBgInner.computeLuminance()),
      reason: 'кольцо ${AppTheme.cockadeRing} не светлее фона '
          '${AppTheme.splashBgInner} — знак сольётся со сценой',
    );
  });

  test('три полосы кокарды — цвета иконки', () {
    expect(AppTheme.cockadeCornflower, const Color(0xFF3F63B8));
    expect(AppTheme.cockadeRing, const Color(0xFFFBF7EE));
    expect(AppTheme.cockadeAccent, const Color(0xFFE8742B));
  });

  test('вспышка белая, волна — тёплый песок', () {
    expect(AppTheme.cockadeFlash, const Color(0xFFFFFFFF));
    expect(AppTheme.cockadeWave, const Color(0xFFC0AE8C));
  });
}
