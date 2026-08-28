import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/category_icons.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/moderation_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_column_message.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/status_dot.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Очередь позиций с флагом — левая колонка экрана «Позиции меню».
///
/// Ширина 420: карточка несёт четыре строки (название с датой, заведение с
/// городом, состояние, причина флага), и в 360 они начинают обрезаться.
/// Фильтры и счётчики живут в шапке экрана, здесь остаётся порядок разбора
/// и футер страниц.
class FlaggedMenuItemsListPanel extends StatelessWidget {
  const FlaggedMenuItemsListPanel({super.key});

  static const double width = 420;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<MenuItemsModerationProvider>();

    return Container(
      width: width,
      decoration: const BoxDecoration(
        border: Border(right: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const _QueueHeader(),
          Expanded(child: _buildBody(context, provider)),
          // Футер показывается только там, где есть что листать и что считать.
          // На пустой выборке диапазон «Показано 1–1 из 0» был бы неправдой.
          if (provider.hasLoaded && provider.items.isNotEmpty)
            AdminPagination.narrow(
              page: provider.page,
              totalPages: provider.pages,
              totalCount: provider.loadedTotal,
              perPage: provider.loadedPerPage,
              shownOnPage: provider.items.length,
              onPageChanged: provider.goToPage,
            ),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context, MenuItemsModerationProvider provider) {
    if (provider.isFirstLoad) return const _QueueSkeleton();

    if (provider.error != null && !provider.hasLoaded) {
      return AdminColumnMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Очередь не загрузилась',
        message: provider.error!,
        onAction: () => provider.refresh(),
      );
    }

    if (provider.items.isEmpty) {
      // Пусто по фильтру и пусто по существу — разные сообщения: в первом
      // случае есть что сбросить, во втором сбрасывать нечего.
      if (provider.loadedNarrowed) {
        return AdminColumnMessage(
          icon: Icons.filter_alt_off_outlined,
          title: 'Ничего не нашлось',
          message: 'Под выбранными фильтрами позиций нет.',
          onAction: () => provider.resetNarrowingFilters(),
          actionLabel: 'Сбросить фильтры',
        );
      }
      return AdminColumnMessage(
        icon: Icons.done_all,
        title: _emptyTitle(provider.loadedVisibility),
        message: _emptyMessage(provider.loadedVisibility),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: provider.items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final item = provider.items[index];
        return _FlaggedItemCard(
          // Ключ на ПРЯМОМ ребёнке списка: сверка идёт по верхнему уровню, и
          // ключ, спрятанный внутри карточки, состояние не переносит, а
          // уничтожает. Урок кадра 04.
          key: ValueKey<String>(item.id),
          item: item,
          isSelected: provider.selectedId == item.id,
          onTap: () => provider.selectItem(item.id),
        );
      },
    );
  }

  String _emptyTitle(MenuItemVisibility visibility) => switch (visibility) {
        MenuItemVisibility.visible => 'Очередь разобрана',
        MenuItemVisibility.hidden => 'Скрытых позиций нет',
        MenuItemVisibility.all => 'Позиций с флагом нет',
      };

  String _emptyMessage(MenuItemVisibility visibility) => switch (visibility) {
        MenuItemVisibility.visible =>
          'Неразобранных позиций с флагом не осталось. Скрытые видны в отборе «Скрытые».',
        MenuItemVisibility.hidden =>
          'Ни одна позиция с флагом не скрыта модератором.',
        MenuItemVisibility.all =>
          'Проверка не пометила ни одной позиции меню.',
      };
}

/// Шапка колонки: что за список и в каком он порядке.
class _QueueHeader extends StatelessWidget {
  const _QueueHeader();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.fromLTRB(16, 14, 16, 10),
      child: Row(
        children: <Widget>[
          Text('ОЧЕРЕДЬ', style: AppTheme.canonMetricLabel),
          Spacer(),
          // Подпись, а не меню: бэкенд отдаёт очередь единственным порядком
          // (`created_at DESC, position ASC, id DESC`), и стрелка обещала бы
          // выбор, которого нет. В кадре она нарисована — отступление на одну
          // иконку, как на кадре 05. Порядок «текст, потом иконка» — из кадра.
          Text(
            'сначала новые',
            style: TextStyle(fontSize: 12, color: AppTheme.textTertiary),
          ),
          SizedBox(width: 6),
          Icon(Icons.swap_vert, size: 16, color: AppTheme.textSecondary),
        ],
      ),
    );
  }
}

/// Карточка позиции в очереди.
class _FlaggedItemCard extends StatelessWidget {
  final FlaggedMenuItem item;
  final bool isSelected;
  final VoidCallback onTap;

  const _FlaggedItemCard({
    super.key,
    required this.item,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          decoration: isSelected
              ? AppTheme.canonSelectedCardDecoration()
              : BoxDecoration(
                  color: AppTheme.backgroundWarm,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  // Прозрачная рамка той же ширины, что у выбранной: без неё
                  // выбор раздвигает карточку и весь список под ней прыгает.
                  border: Border.all(color: Colors.transparent, width: 1.5),
                ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _titleRow(),
              const SizedBox(height: 5),
              _venueRow(),
              const SizedBox(height: 9),
              _FlagChip(item: item, isSelected: isSelected),
            ],
          ),
        ),
      ),
    );
  }

  Widget _titleRow() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          child: Text(
            item.itemName,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: AppTheme.textPrimary,
              height: 1.3,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(width: 8),
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text(
            formatDayMonthShort(item.createdAt),
            style: const TextStyle(fontSize: 11, color: AppTheme.gray500),
          ),
        ),
      ],
    );
  }

  Widget _venueRow() {
    final asset = iconAssetForEstablishment(
      categories: item.establishmentCategories,
      cuisines: item.establishmentCuisines,
    );
    final city = item.establishmentCity;
    final status = item.establishmentStatus;

    return Row(
      children: <Widget>[
        // Иконка предметная: набор в админке неполный, и непокрытая категория
        // отдаёт null — рисуется нейтральный глиф, а не чужая иконка.
        if (asset != null)
          SvgPicture.asset(
            asset,
            width: 13,
            height: 13,
            colorFilter: const ColorFilter.mode(
              AppTheme.textSecondary,
              BlendMode.srcIn,
            ),
          )
        else
          const Icon(Icons.storefront_outlined,
              size: 13, color: AppTheme.textSecondary),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            city == null || city.isEmpty
                ? item.establishmentName
                : '${item.establishmentName} · $city',
            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        // Состояние заведения подписывается только когда оно НЕ «опубликовано»:
        // очередь состоит в основном из активных, и слово у каждой карточки
        // стало бы шумом. А вот «на модерации» и «приостановлено» меняют цену
        // разбора — этих блюд сейчас никто не видит.
        if (status != null && status.isNotEmpty && status != 'active') ...<Widget>[
          const SizedBox(width: 8),
          // Общий виджет, а не своя копия: слово и цвет статуса заданы в одном
          // месте (`StatusDot`), и расходиться им между экранами незачем.
          StatusDot.labelled(status),
        ],
        if (item.isHiddenByAdmin) ...<Widget>[
          const SizedBox(width: 8),
          const _HiddenBadge(),
        ],
      ],
    );
  }
}

/// Причина флага — русской подписью, с числом там, где оно коротко.
class _FlagChip extends StatelessWidget {
  final FlaggedMenuItem item;
  final bool isSelected;

  const _FlagChip({required this.item, required this.isSelected});

  @override
  Widget build(BuildContext context) {
    final reason = item.sanityReason;
    if (reason == null) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        // На выбранной карточке фон белый, поэтому чип берёт бежевую пару
        // disclaimer'а; на невыбранной наоборот — белый на бежевом. Ровно так
        // нарисовано в кадре.
        color: isSelected ? AppTheme.disclaimerBg : AppTheme.backgroundPrimary,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(Icons.error_outline, size: 13, color: AppTheme.disclaimerText),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              sanityFlagLabel(reason),
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppTheme.disclaimerText,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// «Скрыто» — бейдж на карточке.
class _HiddenBadge extends StatelessWidget {
  const _HiddenBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: AppTheme.beigeDivider,
        borderRadius: BorderRadius.circular(6),
      ),
      child: const Text(
        'скрыто',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: AppTheme.textSecondary,
        ),
      ),
    );
  }
}

/// Скелетон очереди: карточки той же геометрии, что и настоящие.
class _QueueSkeleton extends StatelessWidget {
  const _QueueSkeleton();

  /// Высота настоящей карточки при однострочных полях — подмена скелетона
  /// настоящим списком не должна сдвигать очередь.
  static const double cardHeight = 100;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: 5,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, __) => Container(
        height: cardHeight,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        decoration: BoxDecoration(
          color: AppTheme.backgroundWarm,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          // Та же прозрачная рамка 1.5, что у настоящей карточки: без неё
          // геометрия расходится на три пикселя, и список дёргается в момент
          // подмены скелетона данными.
          border: Border.all(color: Colors.transparent, width: 1.5),
        ),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SkeletonBlock.line(widthFactor: .58, height: 15, shade: SkeletonShade.strong),
            SizedBox(height: 9),
            SkeletonBlock.line(widthFactor: .44, height: 13),
            Spacer(),
            SkeletonBlock(width: 132, height: 21, radius: AppTheme.radiusSmall),
          ],
        ),
      ),
    );
  }
}
