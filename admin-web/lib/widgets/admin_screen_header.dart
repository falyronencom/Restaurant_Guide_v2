import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Шапка экрана — 72px, нижняя граница, слот действий справа.
///
/// Единственная шапка админки. Заголовок называет раздел, подпись под ним
/// объясняет состояние: «0 из 1 240 подходят под фильтр», «старейшая заявка
/// ждёт 9 дней». Подпись не обязательна, но если её нечем наполнить —
/// лучше пусто, чем приблизительно.
///
/// [actions] — сегмент-контрол периода, поиск, чипы фильтров. По канону это
/// именно слот шапки: внутрь тела вкладки такие контролы не опускаются.
class AdminScreenHeader extends StatelessWidget {
  final String title;
  final String? subtitle;

  /// Виджет-индикатор рядом с подписью — спиннер фоновой загрузки и т.п.
  final Widget? subtitleLeading;
  final List<Widget> actions;

  /// Идёт фоновое обновление: по нижней кромке шапки бежит полоса 2px.
  /// Данные при этом остаются на экране и читаемыми — подменять их
  /// скелетоном на обновлении нельзя, это первичная загрузка так делает.
  final bool busy;

  const AdminScreenHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.subtitleLeading,
    this.actions = const <Widget>[],
    this.busy = false,
  });

  static const double height = 72;

  @override
  Widget build(BuildContext context) {
    final subtitleText = subtitle;

    return Stack(
      children: [
        _bar(context, subtitleText),
        if (busy)
          const Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SizedBox(
              height: 2,
              child: LinearProgressIndicator(
                minHeight: 2,
                color: AppTheme.primaryOrange,
                backgroundColor: AppTheme.backgroundWarm,
              ),
            ),
          ),
      ],
    );
  }

  /// Меньше этого заголовок не сжимается, сколько бы ни было действий
  /// справа (короткий — не сжимается вовсе). Раньше действия брали своё
  /// целиком, и на узком окне заголовок сжимался до нуля — исчезал вовсе
  /// (проход по панели модератора, 20.10, A3-11).
  ///
  /// Уступает место первым заголовок, а не действия: обрезанный заголовок
  /// показывает себя подсказкой, а обрезанное действие — например, начало
  /// своего периода у «Панели управления» — мышью было бы не достать
  /// (ревью фазы 3.5, волна 3). 160 — около девяти букв заголовка.
  static const double titleMinWidth = 160;

  static const double _padding = 24;
  static const double _gap = 16;

  Widget _bar(BuildContext context, String? subtitleText) {
    final titleWidth = _textWidth(context, title, AppTheme.canonScreenTitle);
    return Container(
      height: height,
      padding: const EdgeInsets.symmetric(horizontal: _padding),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppTheme.borderLight)),
      ),
      child: CustomMultiChildLayout(
        delegate: _HeaderLayout(
          titleKeep: math.min(titleWidth, titleMinWidth),
          gap: _gap,
        ),
        children: <Widget>[
          LayoutId(
            id: _HeaderSlot.title,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _EllipsisWithHint(
                  text: title,
                  style: AppTheme.canonScreenTitle,
                ),
                if (subtitleText != null || subtitleLeading != null) ...[
                  const SizedBox(height: 3),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    spacing: 8,
                    children: [
                      if (subtitleLeading != null) subtitleLeading!,
                      if (subtitleText != null)
                        Flexible(
                          child: _EllipsisWithHint(
                            text: subtitleText,
                            style: AppTheme.canonScreenSubtitle,
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          if (actions.isNotEmpty)
            LayoutId(
              id: _HeaderSlot.actions,
              // Обычно действия целиком. Прокрутка вбок — только когда и
              // заголовок уже сжат до [titleMinWidth]; тогда её можно и
              // протянуть мышью: колесо без Shift вбок не крутит.
              child: ScrollConfiguration(
                behavior: ScrollConfiguration.of(context).copyWith(
                  dragDevices: PointerDeviceKind.values.toSet(),
                ),
                child: SingleChildScrollView(
                  key: const ValueKey<String>('screen-header-actions'),
                  scrollDirection: Axis.horizontal,
                  reverse: true,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    spacing: 10,
                    children: actions,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  static double _textWidth(BuildContext context, String text, TextStyle style) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: DefaultTextStyle.of(context).style.merge(style),
      ),
      maxLines: 1,
      textDirection: TextDirection.ltr,
      textScaler: MediaQuery.textScalerOf(context),
    )..layout();
    final width = painter.width;
    painter.dispose();
    return width.ceilToDouble();
  }
}

enum _HeaderSlot { title, actions }

/// Раскладка шапки: сначала действия — целиком, если рядом остаётся
/// [titleKeep] заголовку, иначе в остатке (с прокруткой); заголовку — всё,
/// что слева от них.
class _HeaderLayout extends MultiChildLayoutDelegate {
  final double titleKeep;
  final double gap;

  _HeaderLayout({required this.titleKeep, required this.gap});

  @override
  void performLayout(Size size) {
    var actionsWidth = 0.0;
    if (hasChild(_HeaderSlot.actions)) {
      final room = math.max(0.0, size.width - gap - titleKeep);
      final actions = layoutChild(
        _HeaderSlot.actions,
        BoxConstraints(maxWidth: room, maxHeight: size.height),
      );
      actionsWidth = actions.width;
      positionChild(
        _HeaderSlot.actions,
        Offset(size.width - actions.width, (size.height - actions.height) / 2),
      );
    }
    final titleRoom =
        math.max(0.0, size.width - (actionsWidth > 0 ? actionsWidth + gap : 0));
    layoutChild(
      _HeaderSlot.title,
      BoxConstraints(
        maxWidth: titleRoom,
        minHeight: size.height,
        maxHeight: size.height,
      ),
    );
    positionChild(_HeaderSlot.title, Offset.zero);
  }

  @override
  bool shouldRelayout(_HeaderLayout oldDelegate) =>
      oldDelegate.titleKeep != titleKeep || oldDelegate.gap != gap;
}

/// Строка с многоточием, которая при обрезке показывает полный текст
/// подсказкой при наведении (A3-11; П1 № 7 — «… · не удалось обновить»;
/// П7 № 7 — «средний рей…» на 1024). Влезла целиком — подсказки нет.
class _EllipsisWithHint extends StatelessWidget {
  final String text;
  final TextStyle style;

  const _EllipsisWithHint({required this.text, required this.style});

  @override
  Widget build(BuildContext context) {
    final line = Text(
      text,
      style: style,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        final painter = TextPainter(
          text: TextSpan(
        text: text,
        style: DefaultTextStyle.of(context).style.merge(style),
      ),
          maxLines: 1,
          textDirection: TextDirection.ltr,
          textScaler: MediaQuery.textScalerOf(context),
        )..layout(maxWidth: constraints.maxWidth);
        final cut = painter.didExceedMaxLines;
        painter.dispose();
        if (!cut) return line;
        return Tooltip(message: text, child: line);
      },
    );
  }
}
