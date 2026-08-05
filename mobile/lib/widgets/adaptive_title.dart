import 'package:flutter/material.dart';

/// Заголовок, подбирающий кегль под фактическую ширину колонки.
///
/// Зачем. Ширина экрана у устройств разная (411dp у Pixel 9a, 384dp у Samsung
/// A72, 360dp у типового бюджетника), а кегли в макете заданы числом. Всё
/// остальное в раскладке — фото, поля, резервы — тоже фиксировано, поэтому
/// текстовой колонке достаётся остаток, и сжимается она непропорционально
/// сильно. Один кегль на все ширины подобрать нельзя: он либо мелкий на
/// широких экранах, либо не влезает на узких.
///
/// Логика: держим [style].fontSize там, где название влезает, и опускаем его
/// шагом [step] до [minFontSize] там, где нет. Ключевое — длинное слово
/// НИКОГДА не рвётся посередине («Осмоловк / а»): вместо разрыва уменьшается
/// кегль, а если и на полу не влезло — ставится многоточие.
///
/// Точность подбора зависит от того, что шрифт уже загружен: пока GoogleFonts
/// тянет его из сети, замер идёт по подстановочному шрифту. Поэтому шрифты
/// вшиты в сборку ассетами, а не качаются в рантайме.
class AdaptiveTitle extends StatelessWidget {
  const AdaptiveTitle({
    super.key,
    required this.text,
    required this.style,
    required this.minFontSize,
    this.maxLines = 2,
    this.step = 0.5,
  });

  final String text;

  /// Базовый стиль; его `fontSize` — верхняя граница подбора.
  final TextStyle style;

  /// Ниже этого кегля не опускаемся — дальше многоточие.
  final double minFontSize;

  final int maxLines;
  final double step;

  @override
  Widget build(BuildContext context) {
    final baseSize = style.fontSize ?? 20.0;
    final textScaler = MediaQuery.textScalerOf(context);
    final direction = Directionality.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final maxWidth = constraints.maxWidth;
        var size = baseSize;
        while (size > minFontSize) {
          if (_fits(style.copyWith(fontSize: size), maxWidth, textScaler,
              direction)) {
            break;
          }
          size -= step;
        }

        return Text(
          text,
          style: style.copyWith(fontSize: size),
          maxLines: maxLines,
          overflow: TextOverflow.ellipsis,
        );
      },
    );
  }

  /// Помещается ли текст в [maxLines] строк, не разрывая слов.
  bool _fits(
    TextStyle candidate,
    double maxWidth,
    TextScaler textScaler,
    TextDirection direction,
  ) {
    if (maxWidth <= 0 || !maxWidth.isFinite) return true;

    final painter = TextPainter(
      textDirection: direction,
      textScaler: textScaler,
      maxLines: maxLines,
    );

    // Самое длинное слово должно умещаться в строку целиком, иначе Flutter
    // разорвёт его по буквам — тот самый дефект «Осмоловк / а».
    for (final word in text.split(RegExp(r'\s+'))) {
      if (word.isEmpty) continue;
      painter.text = TextSpan(text: word, style: candidate);
      painter.layout();
      if (painter.width > maxWidth) {
        painter.dispose();
        return false;
      }
    }

    painter.text = TextSpan(text: text, style: candidate);
    painter.layout(maxWidth: maxWidth);
    final fits = !painter.didExceedMaxLines;
    painter.dispose();
    return fits;
  }
}
