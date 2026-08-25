import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Футер пагинации: сколько показано из скольких и куда перейти.
///
/// Заведён на этапе 4 внутри колонки каталога, вынесен наружу на этапе 5:
/// тот же футер рисуют кадр 06 (журнал действий) и кадр 07 (отзывы), и три
/// копии разошлись бы так же, как разошлись три карточки списков до этапа 4.
///
/// Показывается и на единственной странице: «Показано 1–18 из 18» отвечает на
/// вопрос «это всё?», который иначе остаётся открытым. На перелистывании НЕ
/// снимается — иначе полоса номеров исчезает прямо под курсором в момент
/// нажатия; о ходе загрузки сообщает полоска `busy` в шапке экрана.
class AdminPagination extends StatelessWidget {
  final int page;
  final int totalPages;
  final int totalCount;
  final int perPage;

  /// Сколько записей реально на текущей странице. Не выводится из [perPage]:
  /// последняя страница короче, а страницу может опустошить действие модератора.
  final int shownOnPage;

  final ValueChanged<int>? onPageChanged;

  final _PaginationLayout _layout;

  /// Узкая колонка (420px и уже): диапазон и полоса номеров друг под другом.
  ///
  /// Замерено на этапе 4: полоса забирает до 310 из 388 пикселей внутренней
  /// ширины, и «Показано 181–200 из 365» в остаток не влезает — на трёх и
  /// более страницах подпись переносилась в две-три строки.
  const AdminPagination.narrow({
    super.key,
    required this.page,
    required this.totalPages,
    required this.totalCount,
    required this.perPage,
    required this.shownOnPage,
    this.onPageChanged,
  }) : _layout = _PaginationLayout.narrow;

  /// Футер во всю ширину экрана: диапазон слева, полоса номеров справа.
  ///
  /// Режимы НЕ взаимозаменяемы, как и у [AdminEmptyState]: выбор за
  /// вызывающим, потому что ограничение, из-за которого появился двухуровневый
  /// вид, — это ширина ЕГО колонки, а не свойство самого футера.
  const AdminPagination.wide({
    super.key,
    required this.page,
    required this.totalPages,
    required this.totalCount,
    required this.perPage,
    required this.shownOnPage,
    this.onPageChanged,
  }) : _layout = _PaginationLayout.wide;

  bool get _isWide => _layout == _PaginationLayout.wide;

  @override
  Widget build(BuildContext context) {
    final first = (page - 1) * perPage + 1;

    // Верх диапазона не может превышать общее число: страницу может опустошить
    // действие модератора, и тогда `shownOnPage` уже не соответствует `page`.
    //
    // Границы сводятся по одной, а не через `clamp`. `clamp(first, totalCount)`
    // бросает `ArgumentError`, когда счётчик успел упасть ниже начала страницы
    // (`clamp(21, 20)`), — и футер валил бы сборку целого экрана вместо того,
    // чтобы показать пусть вырожденный, но диапазон.
    var last = first + shownOnPage - 1;
    if (last > totalCount) last = totalCount;
    if (last < first) last = first;

    return Container(
      padding: _isWide
          ? const EdgeInsets.symmetric(horizontal: 24, vertical: 14)
          : const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppTheme.borderLight)),
      ),
      child: _isWide ? _wideRow(first, last) : _narrowColumn(first, last),
    );
  }

  Widget _wideRow(int first, int last) {
    return Row(
      children: [
        Expanded(child: _range(first, last, fontSize: 13)),
        if (totalPages > 1) _pager(),
      ],
    );
  }

  Widget _narrowColumn(int first, int last) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _range(first, last, fontSize: 12),
        if (totalPages > 1) ...[
          const SizedBox(height: 8),
          _pager(),
        ],
      ],
    );
  }

  Widget _range(int first, int last, {required double fontSize}) {
    return Text.rich(
      TextSpan(
        style: TextStyle(fontSize: fontSize, color: AppTheme.textSecondary),
        children: <InlineSpan>[
          const TextSpan(text: 'Показано '),
          TextSpan(
            text: '$first–$last',
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: AppTheme.textDark,
            ),
          ),
          TextSpan(text: ' из $totalCount'),
        ],
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }

  /// Полоса перелистывания. При единственной странице не рисуется вовсе:
  /// диапазон уже сказал всё, а три неактивных контрола ничего не добавляют.
  Widget _pager() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _StepButton(
          icon: Icons.chevron_left,
          enabled: page > 1,
          onTap: () => onPageChanged?.call(page - 1),
        ),
        for (final entry in pageEntries(page, totalPages))
          if (entry == null)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 2),
              child: Text(
                '…',
                style: TextStyle(fontSize: 13, color: AppTheme.textGrey),
              ),
            )
          else
            _PageButton(
              page: entry,
              isCurrent: entry == page,
              onTap: () => onPageChanged?.call(entry),
            ),
        _StepButton(
          icon: Icons.chevron_right,
          enabled: page < totalPages,
          onTap: () => onPageChanged?.call(page + 1),
        ),
      ],
    );
  }
}

enum _PaginationLayout { narrow, wide }

/// Номера страниц с многоточиями: первая, соседи текущей, последняя.
///
/// `null` в результате — многоточие. Вынесено наружу и без виджетов, чтобы
/// раскладку можно было проверить таблицей значений, а не разглядыванием.
///
/// Окно вокруг текущей страницы узкое — ровно по соседу с каждой стороны.
/// Расширять его нечем: в колонке 420 полоса номеров и так забирает почти всю
/// ширину футера.
///
/// Многоточие никогда не заменяет одну страницу: слот у «…» тот же, что у
/// номера, поэтому спрятать за ним «5» — потерять сведения, ничего не выиграв.
List<int?> pageEntries(int page, int totalPages) {
  if (totalPages <= 1) return <int?>[1];
  if (totalPages <= 5) {
    return <int?>[for (var i = 1; i <= totalPages; i++) i];
  }

  var from = page - 1;
  if (from < 2) from = 2;
  var to = page + 1;
  if (to > totalPages - 1) to = totalPages - 1;

  // Пропуск ровно в одну страницу разворачивается в саму страницу.
  if (from == 3) from = 2;
  if (to == totalPages - 2) to = totalPages - 1;

  final entries = <int?>[1];
  if (from > 2) entries.add(null);
  for (var i = from; i <= to; i++) {
    entries.add(i);
  }
  if (to < totalPages - 1) entries.add(null);
  entries.add(totalPages);

  return entries;
}

class _PageButton extends StatelessWidget {
  final int page;
  final bool isCurrent;
  final VoidCallback onTap;

  const _PageButton({
    required this.page,
    required this.isCurrent,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 6),
      child: Material(
        color: isCurrent ? AppTheme.primaryOrange : Colors.transparent,
        borderRadius: BorderRadius.circular(AppTheme.radiusControl),
        child: InkWell(
          onTap: isCurrent ? null : onTap,
          borderRadius: BorderRadius.circular(AppTheme.radiusControl),
          child: Container(
            constraints: const BoxConstraints(minWidth: 34),
            height: 34,
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Text(
              '$page',
              style: TextStyle(
                fontSize: 13,
                fontWeight: isCurrent ? FontWeight.w700 : FontWeight.w500,
                color: isCurrent ? AppTheme.textOnPrimary : AppTheme.textDark,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  final IconData icon;
  final bool enabled;
  final VoidCallback onTap;

  const _StepButton({
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 6),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppTheme.radiusControl),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(AppTheme.radiusControl),
          child: Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              border: Border.all(color: AppTheme.strokeGrey),
              borderRadius: BorderRadius.circular(AppTheme.radiusControl),
            ),
            child: Icon(
              icon,
              size: 18,
              // Недоступный шаг приглушается до цвета рамки: кнопка видна,
              // но не зовёт нажать.
              color: enabled ? AppTheme.textDark : AppTheme.strokeGrey,
            ),
          ),
        ),
      ),
    );
  }
}
