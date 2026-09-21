import 'package:flutter/material.dart';

/// Заголовок, подбирающий кегль под фактическую ширину колонки.
///
/// Зачем. Ширина экрана у устройств разная (411dp у Pixel 9a, 384dp у Samsung
/// A72, 375dp у iPhone mini, 360dp у типового бюджетника), а кегли в макете
/// заданы числом. Всё остальное в раскладке — фото, поля, резервы — тоже
/// фиксировано, поэтому текстовой колонке достаётся остаток, и сжимается она
/// непропорционально сильно. Один кегль на все ширины подобрать нельзя: он либо
/// мелкий на широких экранах, либо не влезает на узких.
///
/// Логика: держим [style].fontSize там, где название влезает, и опускаем его
/// шагом [step] до [minFontSize] там, где нет. Ключевое — длинное слово
/// НИКОГДА не рвётся посередине («Осмоловк / а»): вместо разрыва уменьшается
/// кегль, а если и на полу слово не влезло — строка одна и с многоточием.
///
/// Три условия, без которых подбор врёт (все три нарушались до 21.09.2026):
///
/// 1. **Мерить тем же стилем, каким рисуется.** `Text` сливает [style] с
///    `DefaultTextStyle` экрана, и тема приложения приносит туда межбуквенный
///    интервал 0.1. Замер «голым» стилем занижал ширину на 0.1 dp на знак:
///    «МонеМане» на iPhone mini мерилась в 104.92 dp при колонке 105 и
///    рисовалась в 105.72 — «МонеМан / е».
/// 2. **Пересчитывать, когда догрузился шрифт.** google_fonts поднимает даже
///    вшитый шрифт асинхронно, при первом использовании; первый замер может
///    прийтись на подстановочный шрифт. Абзац после загрузки перекладывается
///    сам, а решение о кегле — нет, если его не пересчитать.
/// 3. **На полу — многоточие в одну строку.** При двух строках Flutter не
///    ставит многоточие, если слово просто не влезает в ширину: он рвёт его по
///    буквам на вторую строку.
class AdaptiveTitle extends StatefulWidget {
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
  State<AdaptiveTitle> createState() => _AdaptiveTitleState();
}

class _AdaptiveTitleState extends State<AdaptiveTitle> {
  @override
  void initState() {
    super.initState();
    PaintingBinding.instance.systemFonts.addListener(_onFontsChanged);
  }

  @override
  void dispose() {
    PaintingBinding.instance.systemFonts.removeListener(_onFontsChanged);
    super.dispose();
  }

  /// Шрифт догрузился — прежний кегль подобран по другому шрифту.
  void _onFontsChanged() {
    if (mounted) setState(() {});
  }

  /// Стиль, которым `Text` будет рисовать на самом деле — той же сборкой, что
  /// и в `Text.build`: слияние с `DefaultTextStyle` и системный «жирный текст».
  TextStyle _renderedStyle(BuildContext context) {
    var effective = widget.style;
    if (effective.inherit) {
      effective = DefaultTextStyle.of(context).style.merge(effective);
    }
    if (MediaQuery.boldTextOf(context)) {
      effective = effective.merge(const TextStyle(fontWeight: FontWeight.bold));
    }
    return effective;
  }

  @override
  Widget build(BuildContext context) {
    final rendered = _renderedStyle(context);
    final baseSize = widget.style.fontSize ?? rendered.fontSize ?? 20.0;
    final textScaler = MediaQuery.textScalerOf(context);
    final direction = Directionality.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final maxWidth = constraints.maxWidth;
        var size = baseSize;
        while (size > widget.minFontSize) {
          final candidate = rendered.copyWith(fontSize: size);
          if (_longestWordFits(candidate, maxWidth, textScaler, direction) &&
              _fitsInLines(candidate, maxWidth, textScaler, direction)) {
            break;
          }
          size -= widget.step;
        }

        // На полу слово так и не влезло — две строки дали бы разрыв по буквам.
        final wordFits = _longestWordFits(
            rendered.copyWith(fontSize: size), maxWidth, textScaler, direction);

        return Text(
          widget.text,
          style: widget.style.copyWith(fontSize: size),
          maxLines: wordFits ? widget.maxLines : 1,
          softWrap: wordFits,
          overflow: TextOverflow.ellipsis,
        );
      },
    );
  }

  /// Самое длинное слово умещается в строку целиком — иначе Flutter разорвёт
  /// его по буквам, тот самый дефект «Осмоловк / а».
  bool _longestWordFits(
    TextStyle candidate,
    double maxWidth,
    TextScaler textScaler,
    TextDirection direction,
  ) {
    if (maxWidth <= 0 || !maxWidth.isFinite) return true;

    final painter = TextPainter(
      textDirection: direction,
      textScaler: textScaler,
    );
    try {
      for (final word in widget.text.split(RegExp(r'\s+'))) {
        if (word.isEmpty) continue;
        painter.text = TextSpan(text: word, style: candidate);
        painter.layout();
        if (painter.width > maxWidth) return false;
      }
      return true;
    } finally {
      painter.dispose();
    }
  }

  /// Весь текст помещается в [AdaptiveTitle.maxLines] строк.
  bool _fitsInLines(
    TextStyle candidate,
    double maxWidth,
    TextScaler textScaler,
    TextDirection direction,
  ) {
    if (maxWidth <= 0 || !maxWidth.isFinite) return true;

    final painter = TextPainter(
      text: TextSpan(text: widget.text, style: candidate),
      textDirection: direction,
      textScaler: textScaler,
      maxLines: widget.maxLines,
    );
    try {
      painter.layout(maxWidth: maxWidth);
      return !painter.didExceedMaxLines;
    } finally {
      painter.dispose();
    }
  }
}
