import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Одно определение: подпись и значение.
///
/// [value] пустое или `null` — ячейка покажет «не указан» приглушённым. Это
/// не то же самое, что отсутствие ячейки: пустое поле у одобренного заведения
/// само по себе сведение, и прятать его нельзя.
class Definition {
  final String label;
  final String? value;

  /// Значение — величина, а не текст: УНП, идентификатор, координаты.
  /// Такие показываются моноширинным, чтобы отличаться от прозы шрифтом,
  /// а не цветом.
  final bool mono;

  /// Ячейка занимает обе колонки — для длинных значений вроде описания.
  final bool wide;

  /// Произвольное содержимое вместо строки значения.
  final Widget? child;

  const Definition({
    required this.label,
    this.value,
    this.mono = false,
    this.wide = false,
    this.child,
  });
}

/// Двухколоночная сетка определений — режим чтения панели разбора.
///
/// В режиме модерации на этом месте стоят строки полей с вердиктами: там
/// каждое поле — предмет решения. У одобренного или отказанного заведения
/// решать нечего, и та же информация должна читаться, а не опрашиваться,
/// поэтому вердикт-кнопки уходят, а плотность вырастает вдвое.
///
/// Разделитель есть у всех строк, кроме последней: линия под последней
/// строкой отделяла бы сетку от пустоты.
class DefinitionGrid extends StatelessWidget {
  final List<Definition> items;

  const DefinitionGrid({super.key, required this.items});

  static const double columnGap = 40;
  static const EdgeInsets padding = EdgeInsets.fromLTRB(24, 20, 24, 20);

  @override
  Widget build(BuildContext context) {
    final rows = _rows();

    return ListView(
      padding: padding,
      children: <Widget>[
        for (var i = 0; i < rows.length; i++)
          if (_isWideRow(rows[i]))
            // Широкая ячейка ставится БЕЗ Row: обёртка из двух `Expanded`
            // отдала бы половину ширины пустышке во второй колонке, и ячейка
            // вышла бы ровно такой же, как обычная, — то есть широкой только
            // на словах. Заодно не нужен и IntrinsicHeight: выравнивать не с
            // чем, строка одна.
            _Cell(item: rows[i].first, divided: i < rows.length - 1)
          else
            // IntrinsicHeight обязателен: без него `stretch` внутри ListView
            // получает бесконечную высоту и падает на раскладке. Он же
            // выравнивает разделители соседних ячеек, когда подписи разной
            // длины переносятся по-разному. Дорогим он здесь не будет —
            // в ячейках только текст.
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  for (var column = 0; column < 2; column++) ...<Widget>[
                    if (column == 1) const SizedBox(width: columnGap),
                    Expanded(
                      child: column < rows[i].length
                          ? _Cell(
                              item: rows[i][column],
                              divided: i < rows.length - 1,
                            )
                          : const SizedBox.shrink(),
                    ),
                  ],
                ],
              ),
            ),
      ],
    );
  }

  static bool _isWideRow(List<Definition> row) =>
      row.length == 1 && row.first.wide;

  /// Раскладка по строкам. Широкая ячейка занимает строку целиком, поэтому
  /// её нельзя просто сложить в поток по две.
  List<List<Definition>> _rows() {
    final rows = <List<Definition>>[];
    var current = <Definition>[];

    for (final item in items) {
      if (item.wide) {
        if (current.isNotEmpty) {
          rows.add(current);
          current = <Definition>[];
        }
        rows.add(<Definition>[item]);
        continue;
      }

      current.add(item);
      if (current.length == 2) {
        rows.add(current);
        current = <Definition>[];
      }
    }

    if (current.isNotEmpty) rows.add(current);
    return rows;
  }
}

class _Cell extends StatelessWidget {
  final Definition item;
  final bool divided;

  const _Cell({required this.item, required this.divided});

  @override
  Widget build(BuildContext context) {
    final value = item.value?.trim();
    final isEmpty = value == null || value.isEmpty;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        border: divided
            ? const Border(bottom: BorderSide(color: AppTheme.borderLight))
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(item.label, style: AppTheme.canonFieldLabel),
          const SizedBox(height: 3),
          if (item.child != null)
            item.child!
          else if (isEmpty)
            const Text('не указан', style: AppTheme.canonFieldValueEmpty)
          else if (item.mono)
            Text(
              value,
              style: AppTheme.mono(
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: AppTheme.textPrimary,
              ),
            )
          else
            Text(value, style: AppTheme.canonFieldValue),
        ],
      ),
    );
  }
}
