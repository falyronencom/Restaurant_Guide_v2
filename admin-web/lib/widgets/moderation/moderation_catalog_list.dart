import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:restaurant_guide_admin_web/config/category_icons.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Вариант порядка для меню сортировки.
class CatalogSortOption {
  final String value;
  final String label;

  const CatalogSortOption({required this.value, required this.label});
}

/// Колонка каталога — общая для «Одобренных», «Отказанных» и «Приостановленных».
///
/// До редизайна каждый из трёх экранов держал свою карточку и свой список, по
/// полторы сотни строк каждый, и расходились они уже заметно. Кадры 11–13
/// задают один каркас: шапка секции с порядком, карточки, футер пагинации.
/// Различия между экранами настоящие, но узкие — заголовок, подпись порядка и
/// нижняя строка карточки, — поэтому они вынесены в параметры, а не в три копии.
class ModerationCatalogList extends StatelessWidget {
  /// Заголовок секции: «Каталог», «История отказов», «Приостановлены».
  final String sectionTitle;

  /// Подпись порядка справа в шапке секции.
  final String sortCaption;

  /// Варианты порядка. `null` — порядок на бэкенде один, и подпись остаётся
  /// подписью: раскрывающийся список обещал бы выбор, которого нет. Там, где
  /// варианты есть, за той же подписью стоит настоящее меню — правило одно,
  /// а вид у обоих случаев общий.
  final List<CatalogSortOption>? sortOptions;
  final String? currentSort;
  final ValueChanged<String>? onSortChanged;

  final int itemCount;
  final IndexedWidgetBuilder itemBuilder;

  final bool isLoading;
  final String? error;
  final VoidCallback onRetry;

  /// Пустой список: заголовок называет раздел, а не «нет данных».
  final String emptyTitle;
  final String emptyMessage;

  final int page;
  final int totalPages;
  final int totalCount;
  final int perPage;
  final ValueChanged<int>? onPageChanged;

  const ModerationCatalogList({
    super.key,
    required this.sectionTitle,
    required this.sortCaption,
    this.sortOptions,
    this.currentSort,
    this.onSortChanged,
    required this.itemCount,
    required this.itemBuilder,
    this.isLoading = false,
    this.error,
    required this.onRetry,
    required this.emptyTitle,
    required this.emptyMessage,
    this.page = 1,
    this.totalPages = 1,
    this.totalCount = 0,
    this.perPage = 20,
    this.onPageChanged,
  });

  static const double width = 420;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      decoration: const BoxDecoration(
        border: Border(right: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SectionHeader(
            title: sectionTitle,
            sortCaption: sortCaption,
            options: sortOptions,
            currentSort: currentSort,
            onSortChanged: onSortChanged,
          ),
          Expanded(child: _body()),
          // Футер показывается и на единственной странице: «Показано 1–18 из
          // 18» отвечает на вопрос «это всё?», который иначе остаётся открытым.
          //
          // На перелистывании он НЕ снимается: иначе полоса номеров исчезает
          // прямо под курсором в момент нажатия. Об этом же говорит канон
          // шапки экрана — данные остаются на месте, о ходе загрузки сообщает
          // полоска `busy`, а скелетон бывает только у первой загрузки.
          if (error == null && totalCount > 0 && itemCount > 0)
            _CatalogPagination(
              page: page,
              totalPages: totalPages,
              totalCount: totalCount,
              perPage: perPage,
              shownOnPage: itemCount,
              onPageChanged: onPageChanged,
            ),
        ],
      ),
    );
  }

  Widget _body() {
    // Скелетон — только когда показывать нечего. На смене страницы прежние
    // карточки остаются до прихода новых.
    if (isLoading && itemCount == 0) return const _CatalogSkeleton();

    final message = error;
    if (message != null) {
      return _CatalogMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Список не загрузился',
        message: message,
        onRetry: onRetry,
      );
    }

    if (itemCount == 0) {
      // Пусто на странице ещё не значит пусто в разделе. Такое случается,
      // когда действие модератора убрало последнюю запись открытой страницы:
      // раздел не опустел, опустела страница, и говорить «здесь ничего нет»
      // было бы неправдой ровно там, где остальное никуда не делось.
      if (totalCount > 0) {
        return _CatalogMessage(
          icon: Icons.refresh,
          title: 'Страница опустела',
          message: 'Последняя запись на этой странице обработана. '
              'Остальные записи раздела на месте.',
          onRetry: onRetry,
        );
      }

      return _CatalogMessage(
        icon: Icons.inbox_outlined,
        title: emptyTitle,
        message: emptyMessage,
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: itemCount,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: itemBuilder,
    );
  }
}

/// Шапка секции: чем является список и в каком он порядке.
class _SectionHeader extends StatelessWidget {
  final String title;
  final String sortCaption;
  final List<CatalogSortOption>? options;
  final String? currentSort;
  final ValueChanged<String>? onSortChanged;

  const _SectionHeader({
    required this.title,
    required this.sortCaption,
    this.options,
    this.currentSort,
    this.onSortChanged,
  });

  @override
  Widget build(BuildContext context) {
    final items = options;
    final caption = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          sortCaption,
          style: const TextStyle(fontSize: 12, color: AppTheme.textTertiary),
        ),
        const SizedBox(width: 8),
        const Icon(Icons.swap_vert, size: 16, color: AppTheme.textSecondary),
      ],
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
      child: Row(
        children: [
          Text(title, style: AppTheme.canonTableHeader),
          const Spacer(),
          if (items == null || onSortChanged == null)
            caption
          else
            PopupMenuButton<String>(
              tooltip: 'Порядок списка',
              position: PopupMenuPosition.under,
              initialValue: currentSort,
              onSelected: onSortChanged,
              itemBuilder: (_) => <PopupMenuEntry<String>>[
                for (final option in items)
                  PopupMenuItem<String>(
                    value: option.value,
                    child: Text(option.label),
                  ),
              ],
              child: caption,
            ),
        ],
      ),
    );
  }
}

/// Карточка каталога. Каркас общий, нижняя строка задаётся экраном.
class ModerationCatalogCard extends StatelessWidget {
  final String name;

  /// Дата в правом верхнем углу — моноширинным, как всякая табличная величина.
  final DateTime? date;

  /// «ресторан · Минск».
  final String? subtitle;

  final String? thumbnailUrl;
  final List<String> categories;
  final List<String> cuisines;

  /// Нижняя строка: метрики у одобренных, причины и статус у отказанных.
  final Widget? footer;

  final bool isSelected;
  final VoidCallback onTap;

  const ModerationCatalogCard({
    super.key,
    required this.name,
    this.date,
    this.subtitle,
    this.thumbnailUrl,
    this.categories = const <String>[],
    this.cuisines = const <String>[],
    this.footer,
    required this.isSelected,
    required this.onTap,
  });

  /// Сторона миниатюры. Она же задаёт высоту содержимого карточки — поэтому
  /// изображение здесь в принципе не может растянуть строку, каким бы ни было
  /// его соотношение сторон.
  static const double thumbSide = 80;
  static const double padding = 12;

  /// Рамка есть у обеих карточек — у выбранной брендовая, у прочих
  /// прозрачная. Одинаковая ширина держит список на месте при выборе.
  static const double borderWidth = 1.5;

  /// Рамка входит в высоту: `Container` вжимает содержимое внутрь рамки,
  /// а не рисует её поверх.
  static const double height = thumbSide + padding * 2 + borderWidth * 2;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        child: Container(
          padding: const EdgeInsets.all(padding),
          decoration: isSelected
              ? AppTheme.canonSelectedCardDecoration()
              : BoxDecoration(
                  color: AppTheme.backgroundWarm,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  // Прозрачная рамка той же ширины: без неё выбор карточки
                  // сдвигает список под ней.
                  border: Border.all(
                    color: Colors.transparent,
                    width: borderWidth,
                  ),
                ),
          child: SizedBox(
            height: thumbSide,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Thumbnail(
                  url: thumbnailUrl,
                  categories: categories,
                  cuisines: cuisines,
                ),
                const SizedBox(width: 12),
                Expanded(child: _body()),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _body() {
    final stamp = date;
    final caption = subtitle;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Expanded(
              child: Text(
                name,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textPrimary,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (stamp != null) ...[
              const SizedBox(width: 8),
              Text(
                formatDateLocal(stamp),
                style: AppTheme.mono(fontSize: 11, color: AppTheme.textGrey),
              ),
            ],
          ],
        ),
        if (caption != null) ...[
          const SizedBox(height: 4),
          Text(
            caption,
            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
        const Spacer(),
        if (footer != null) footer!,
      ],
    );
  }


}

class _Thumbnail extends StatelessWidget {
  final String? url;
  final List<String> categories;
  final List<String> cuisines;

  const _Thumbnail({
    required this.url,
    required this.categories,
    required this.cuisines,
  });

  @override
  Widget build(BuildContext context) {
    final source = url;

    return ClipRRect(
      borderRadius: BorderRadius.circular(AppTheme.radiusControl),
      child: SizedBox(
        width: ModerationCatalogCard.thumbSide,
        height: ModerationCatalogCard.thumbSide,
        child: source != null && source.isNotEmpty
            ? Image.network(
                source,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => _fallback(),
              )
            : _fallback(),
      ),
    );
  }

  Widget _fallback() {
    final asset = iconAssetForEstablishment(
      categories: categories,
      cuisines: cuisines,
    );

    return Container(
      color: AppTheme.beigeDivider,
      alignment: Alignment.center,
      child: asset != null
          ? SvgPicture.asset(
              asset,
              width: 26,
              height: 26,
              colorFilter: const ColorFilter.mode(
                AppTheme.textGrey,
                BlendMode.srcIn,
              ),
            )
          : const Icon(
              Icons.storefront_outlined,
              size: 26,
              color: AppTheme.textGrey,
            ),
    );
  }
}

/// Футер пагинации: сколько показано из скольких и куда перейти.
class _CatalogPagination extends StatelessWidget {
  final int page;
  final int totalPages;
  final int totalCount;
  final int perPage;
  final int shownOnPage;
  final ValueChanged<int>? onPageChanged;

  const _CatalogPagination({
    required this.page,
    required this.totalPages,
    required this.totalCount,
    required this.perPage,
    required this.shownOnPage,
    this.onPageChanged,
  });

  @override
  Widget build(BuildContext context) {
    final first = (page - 1) * perPage + 1;
    // Верх диапазона не может превышать общее число: страницу может опустошить
    // действие модератора, и тогда `shownOnPage` уже не соответствует `page`.
    final last = (first + shownOnPage - 1).clamp(first, totalCount);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppTheme.borderLight)),
      ),
      // Строка диапазона и полоса номеров стоят друг под другом, а не в один
      // ряд, как нарисовано. Замерено: полоса забирает до 310 из 388 пикселей
      // внутренней ширины, и «Показано 181–200 из 365» в остаток не влезает —
      // на трёх и более страницах подпись переносилась в две-три строки.
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text.rich(
            TextSpan(
              style: const TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondary,
              ),
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
          ),
          if (totalPages > 1) ...[
            const SizedBox(height: 8),
            _pager(),
          ],
        ],
      ),
    );
  }

  /// Полоса перелистывания. При единственной странице не рисуется вовсе:
  /// диапазон уже сказал всё, а три неактивных контрола ничего не добавляют.
  Widget _pager() {
    return Row(
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

class _CatalogSkeleton extends StatelessWidget {
  const _CatalogSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: 5,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, __) => Container(
        height: ModerationCatalogCard.height,
        padding: const EdgeInsets.all(ModerationCatalogCard.padding),
        decoration: AppTheme.canonPanelDecoration(radius: AppTheme.radiusMedium),
        child: const Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SkeletonBlock(
              width: ModerationCatalogCard.thumbSide,
              height: ModerationCatalogCard.thumbSide,
              radius: AppTheme.radiusControl,
              shade: SkeletonShade.strong,
            ),
            SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SkeletonBlock.line(widthFactor: .6, height: 13),
                  SizedBox(height: 8),
                  SkeletonBlock.line(widthFactor: .42, height: 11),
                  Spacer(),
                  SkeletonBlock.line(widthFactor: .5, height: 11),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CatalogMessage extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;
  final VoidCallback? onRetry;

  const _CatalogMessage({
    required this.icon,
    required this.title,
    required this.message,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final retry = onRetry;

    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 32, color: AppTheme.textGrey),
            const SizedBox(height: 12),
            Text(
              title,
              style: AppTheme.canonSubsectionHeader,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              message,
              style: const TextStyle(
                fontSize: 13,
                color: AppTheme.textSecondary,
                height: 1.4,
              ),
              textAlign: TextAlign.center,
            ),
            if (retry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: retry,
                style: AppTheme.canonHeaderAction(),
                child: const Text('Повторить'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
