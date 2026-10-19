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
///
/// [lift] — на сколько текст поднят над привычным местом (кнопка «Меню» под
/// статусом, бриф В3, 18.10.2026): все точки, кроме нижней, поднимаются на
/// столько же, и текст ложится на ту же плотность, что и без кнопки. Верх
/// полосы тогда выходит за героя — его срезает рамка героя, там почти ноль.
class HeroScrim extends StatelessWidget {
  const HeroScrim({super.key, this.lift = 0});

  final double lift;

  /// Расстояние от нижней границы героя, dp.
  static const List<double> distances = [0, 250, 340, 450, 620];

  /// Непрозрачность чёрного на этом расстоянии.
  static const List<double> alphas = [0.85, 0.78, 0.64, 0.52, 0.0];

  /// Точки с подъёмом [lift]: нижняя остаётся у низа героя.
  static List<double> distancesFor(double lift) => [
        distances.first,
        for (final d in distances.skip(1)) d + lift,
      ];

  /// Высота полосы затемнения.
  static double get height => distances.last;

  /// Высота полосы с подъёмом [lift].
  static double heightFor(double lift) => distancesFor(lift).last;

  /// Непрозрачность чёрного на расстоянии [distanceFromBottom] от низа героя;
  /// выше полосы — ноль. Между точками — линейно, как рисует [LinearGradient].
  static double alphaAt(double distanceFromBottom, {double lift = 0}) {
    final points = distancesFor(lift);
    if (distanceFromBottom >= points.last) return 0;
    if (distanceFromBottom <= points.first) return alphas.first;
    for (var i = 1; i < points.length; i++) {
      if (distanceFromBottom <= points[i]) {
        final t = (distanceFromBottom - points[i - 1]) /
            (points[i] - points[i - 1]);
        return alphas[i - 1] + (alphas[i] - alphas[i - 1]) * t;
      }
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    // LinearGradient идёт сверху вниз: расстояние от низа переворачиваем.
    final points = distancesFor(lift);
    final height = points.last;
    final top = points.length - 1;
    final colors = <Color>[
      for (var i = top; i >= 0; i--)
        Colors.black.withValues(alpha: alphas[i]),
    ];
    final stops = <double>[
      for (var i = top; i >= 0; i--) 1 - points[i] / height,
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
