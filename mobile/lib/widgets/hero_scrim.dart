import 'package:flutter/material.dart';

/// Затемнение под текстом на фото-герое карточки заведения.
///
/// Текст поверх фото (название, тип, кухня, часы, чипы адреса и телефона)
/// лежит на произвольной обложке. Проход тестировщика 17.10 (п. 48): на светлой
/// обложке кремовый текст не читался — прежний градиент в 333 dp доходил до
/// чёрного 0,6 только у самого низа и вовсе не доставал до названия.
///
/// Затемнение описано точками «расстояние от низа героя → непрозрачность
/// чёрного», а не цветами градиента: от этих же точек считает контраст тест
/// ([alphaAt]) — на самой светлой обложке, белой, при 4,5 : 1 для обычного
/// текста и 3 : 1 для крупного. Точки убывают с расстоянием — чем дальше от
/// низа, тем фото чище.
class HeroScrim extends StatelessWidget {
  const HeroScrim({super.key});

  /// Расстояние от нижней границы героя, dp.
  static const List<double> distances = [0, 250, 340, 450, 620];

  /// Непрозрачность чёрного на этом расстоянии.
  static const List<double> alphas = [0.85, 0.78, 0.64, 0.52, 0.0];

  /// Высота полосы затемнения.
  static double get height => distances.last;

  /// Непрозрачность чёрного на расстоянии [distanceFromBottom] от низа героя;
  /// выше полосы — ноль. Между точками — линейно, как рисует [LinearGradient].
  static double alphaAt(double distanceFromBottom) {
    if (distanceFromBottom >= distances.last) return 0;
    if (distanceFromBottom <= distances.first) return alphas.first;
    for (var i = 1; i < distances.length; i++) {
      if (distanceFromBottom <= distances[i]) {
        final t = (distanceFromBottom - distances[i - 1]) /
            (distances[i] - distances[i - 1]);
        return alphas[i - 1] + (alphas[i] - alphas[i - 1]) * t;
      }
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    // LinearGradient идёт сверху вниз: расстояние от низа переворачиваем.
    final top = distances.length - 1;
    final colors = <Color>[
      for (var i = top; i >= 0; i--)
        Colors.black.withValues(alpha: alphas[i]),
    ];
    final stops = <double>[
      for (var i = top; i >= 0; i--) 1 - distances[i] / height,
    ];
    return IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: colors,
            stops: stops,
          ),
        ),
        child: const SizedBox.expand(),
      ),
    );
  }
}
