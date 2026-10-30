import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:restaurant_guide_admin_web/config/category_icons.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_column_message.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/media/network_thumbnail.dart';
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
  /// Заголовок секции: «Каталог», «Отклонённые заявки», «Приостановленные».
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
          // Двухуровневый вид — не украшение: в колонке 420 диапазон и полоса
          // номеров в один ряд не помещаются, замерено на этапе 4. Почему
          // выбор режима оставлен вызывающему — см. `AdminPagination`.
          if (error == null && totalCount > 0 && itemCount > 0)
            AdminPagination.narrow(
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
      return AdminColumnMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Список не загрузился',
        message: message,
        onAction: onRetry,
      );
    }

    if (itemCount == 0) {
      // Пусто на странице ещё не значит пусто в разделе. Такое случается,
      // когда действие модератора убрало последнюю запись открытой страницы:
      // раздел не опустел, опустела страница, и говорить «здесь ничего нет»
      // было бы неправдой ровно там, где остальное никуда не делось.
      if (totalCount > 0) {
        return AdminColumnMessage(
          icon: Icons.refresh,
          title: 'Страница опустела',
          message: 'Последняя запись на этой странице обработана. '
              'Остальные записи раздела на месте.',
          onAction: onRetry,
        );
      }

      return AdminColumnMessage(
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

  /// Дата — моноширинным, как всякая табличная величина.
  final DateTime? date;

  /// Что это за дата: «опубликовано», «отклонено», «приостановлено» (Ч17,
  /// 20.10: без подписи было непонятно, заявка это, одобрение или создание).
  final String? dateLabel;

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
    this.dateLabel,
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

  /// Высота содержимого — на 8 выше миниатюры: с 21.10.2026 у карточки
  /// четыре строки (название, тип и город, подписанная дата, нижняя строка),
  /// и в 80 нижний чип «Приостановленных» вылезал на 4 px (замер на 1024 и
  /// 1150, Ч17). Миниатюра остаётся квадратом 80 у верхнего края.
  static const double contentHeight = thumbSide + 8;

  /// Рамка есть у обеих карточек — у выбранной брендовая, у прочих
  /// прозрачная. Одинаковая ширина держит список на месте при выборе.
  static const double borderWidth = 1.5;

  /// Рамка входит в высоту: `Container` вжимает содержимое внутрь рамки,
  /// а не рисует её поверх.
  static const double height = contentHeight + padding * 2 + borderWidth * 2;

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
              // Рамка той же ширины, что у выбранной: без неё выбор
              // карточки сдвигает список под ней.
              : AppTheme.listCardDecoration(borderWidth: borderWidth),
          child: SizedBox(
            height: contentHeight,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
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

    // Название — на всю ширину строки: дата раньше стояла справа от него и
    // забирала место, которого названию не хватало (Ч16). Дата с подписью —
    // своей строкой под типом и городом. Полное название — подсказкой.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Tooltip(
          message: name,
          waitDuration: const Duration(milliseconds: 400),
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
        if (caption != null) ...[
          const SizedBox(height: 2),
          Text(
            caption,
            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
        if (stamp != null) ...[
          const SizedBox(height: 2),
          Text.rich(
            TextSpan(
              children: <InlineSpan>[
                if (dateLabel != null) TextSpan(text: '$dateLabel '),
                TextSpan(
                  text: formatDateLocal(stamp),
                  style: AppTheme.mono(fontSize: 11, color: AppTheme.textGrey),
                ),
              ],
            ),
            style: const TextStyle(fontSize: 11, color: AppTheme.textGrey),
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
            ? NetworkThumbnail(url: source, fallback: _fallback())
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
        decoration: AppTheme.listCardDecoration(
          borderWidth: ModerationCatalogCard.borderWidth,
        ),
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
