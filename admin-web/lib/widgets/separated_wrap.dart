import 'dart:math' as math;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// Строка фактов через разделитель — «Минск · отзыв от 9 октября · виден в
/// приложении», — которая переносится целыми фактами, а разделитель рисует
/// только между фактами на одной строке.
///
/// Зачем не `Wrap` (проход по панели модератора, 20.10; находка П7 № 6):
/// в `Wrap` разделитель — такой же ребёнок, как факт, и на переносе он
/// оставался последним в строке — «Минск ·», а дата уезжала вниз. Здесь
/// разделитель на месте переноса не рисуется вовсе: строка кончается фактом,
/// следующая начинается фактом.
class SeparatedWrap extends MultiChildRenderObjectWidget {
  final double spacing;
  final double runSpacing;

  SeparatedWrap({
    super.key,
    required List<Widget> items,
    required Widget separator,
    this.spacing = 8,
    this.runSpacing = 4,
  }) : super(children: <Widget>[
          for (var i = 0; i < items.length; i++) ...<Widget>[
            if (i > 0) separator,
            items[i],
          ],
        ]);

  @override
  RenderSeparatedWrap createRenderObject(BuildContext context) =>
      RenderSeparatedWrap(spacing: spacing, runSpacing: runSpacing);

  @override
  void updateRenderObject(
    BuildContext context,
    RenderSeparatedWrap renderObject,
  ) {
    renderObject
      ..spacing = spacing
      ..runSpacing = runSpacing;
  }
}

class _SeparatedWrapParentData extends ContainerBoxParentData<RenderBox> {
  /// Разделитель на месте переноса: не рисуется и не ловит касаний.
  bool hidden = false;
}

/// Дети чередуются: факт, разделитель, факт, … — чётные места у фактов.
class RenderSeparatedWrap extends RenderBox
    with
        ContainerRenderObjectMixin<RenderBox, _SeparatedWrapParentData>,
        RenderBoxContainerDefaultsMixin<RenderBox, _SeparatedWrapParentData> {
  RenderSeparatedWrap({required double spacing, required double runSpacing})
      : _spacing = spacing,
        _runSpacing = runSpacing;

  double _spacing;
  double get spacing => _spacing;
  set spacing(double value) {
    if (value == _spacing) return;
    _spacing = value;
    markNeedsLayout();
  }

  double _runSpacing;
  double get runSpacing => _runSpacing;
  set runSpacing(double value) {
    if (value == _runSpacing) return;
    _runSpacing = value;
    markNeedsLayout();
  }

  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! _SeparatedWrapParentData) {
      child.parentData = _SeparatedWrapParentData();
    }
  }

  List<RenderBox> get _children {
    final list = <RenderBox>[];
    var child = firstChild;
    while (child != null) {
      list.add(child);
      child = childAfter(child);
    }
    return list;
  }

  /// Раскладка по строкам: какие дети в какой строке и какие разделители
  /// пропали на переносе. [sizeOf] — настоящий замер или «сухой».
  ({Size size, List<List<RenderBox>> runs, Set<RenderBox> hidden}) _arrange(
    BoxConstraints constraints,
    Size Function(RenderBox child, BoxConstraints constraints) sizeOf,
  ) {
    final maxWidth = constraints.maxWidth;
    final childConstraints = BoxConstraints(maxWidth: maxWidth);
    final children = _children;
    final sizes = <RenderBox, Size>{
      for (final child in children) child: sizeOf(child, childConstraints),
    };

    final runs = <List<RenderBox>>[];
    final hidden = <RenderBox>{};
    var run = <RenderBox>[];
    var x = 0.0;
    for (var i = 0; i < children.length; i += 2) {
      final item = children[i];
      final itemWidth = sizes[item]!.width;
      if (i == 0) {
        run.add(item);
        x = itemWidth;
        continue;
      }
      final separator = children[i - 1];
      final together =
          x + spacing + sizes[separator]!.width + spacing + itemWidth;
      if (together <= maxWidth) {
        run
          ..add(separator)
          ..add(item);
        x = together;
      } else {
        hidden.add(separator);
        runs.add(run);
        run = <RenderBox>[item];
        x = itemWidth;
      }
    }
    if (run.isNotEmpty) runs.add(run);

    var width = 0.0;
    var height = 0.0;
    for (var r = 0; r < runs.length; r++) {
      final line = runs[r];
      var lineWidth = 0.0;
      var lineHeight = 0.0;
      for (var j = 0; j < line.length; j++) {
        final size = sizes[line[j]]!;
        lineWidth += size.width + (j > 0 ? spacing : 0);
        lineHeight = math.max(lineHeight, size.height);
      }
      width = math.max(width, lineWidth);
      height += lineHeight + (r > 0 ? runSpacing : 0);
    }
    return (
      size: constraints.constrain(Size(width, height)),
      runs: runs,
      hidden: hidden,
    );
  }

  @override
  Size computeDryLayout(covariant BoxConstraints constraints) =>
      _arrange(constraints, (child, c) => child.getDryLayout(c)).size;

  @override
  void performLayout() {
    final arranged = _arrange(constraints, (child, c) {
      child.layout(c, parentUsesSize: true);
      return child.size;
    });

    for (final child in _children) {
      (child.parentData! as _SeparatedWrapParentData).hidden =
          arranged.hidden.contains(child);
    }

    var y = 0.0;
    for (final line in arranged.runs) {
      final lineHeight = line.fold<double>(
          0, (height, child) => math.max(height, child.size.height));
      var x = 0.0;
      for (var j = 0; j < line.length; j++) {
        final child = line[j];
        if (j > 0) x += spacing;
        (child.parentData! as _SeparatedWrapParentData).offset =
            Offset(x, y + (lineHeight - child.size.height) / 2);
        x += child.size.width;
      }
      y += lineHeight + runSpacing;
    }
    size = arranged.size;
  }

  @override
  double computeMinIntrinsicWidth(double height) => _children.fold<double>(
      0, (width, child) => math.max(width, child.getMinIntrinsicWidth(height)));

  @override
  double computeMaxIntrinsicWidth(double height) {
    final children = _children;
    if (children.isEmpty) return 0;
    return children.fold<double>(
            0, (width, child) => width + child.getMaxIntrinsicWidth(height)) +
        spacing * (children.length - 1);
  }

  @override
  double computeMinIntrinsicHeight(double width) =>
      computeDryLayout(BoxConstraints(maxWidth: width)).height;

  @override
  double computeMaxIntrinsicHeight(double width) =>
      computeDryLayout(BoxConstraints(maxWidth: width)).height;

  @override
  void paint(PaintingContext context, Offset offset) {
    var child = firstChild;
    while (child != null) {
      final data = child.parentData! as _SeparatedWrapParentData;
      if (!data.hidden) context.paintChild(child, offset + data.offset);
      child = data.nextSibling;
    }
  }

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) {
    var child = lastChild;
    while (child != null) {
      final data = child.parentData! as _SeparatedWrapParentData;
      if (!data.hidden) {
        final hit = result.addWithPaintOffset(
          offset: data.offset,
          position: position,
          hitTest: (result, transformed) =>
              child!.hitTest(result, position: transformed),
        );
        if (hit) return true;
      }
      child = data.previousSibling;
    }
    return false;
  }
}
