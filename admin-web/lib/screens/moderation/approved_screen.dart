import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_catalog_list.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/status_dot.dart';

/// Экран «Одобренные» — каталог опубликованных заведений.
///
/// Поиск живёт в шапке экрана, а не над списком: он ищет по **всем** статусам,
/// то есть относится не к этой колонке, а к экрану. По канону слот шапки для
/// того и заведён.
class ApprovedScreen extends StatefulWidget {
  const ApprovedScreen({super.key});

  @override
  State<ApprovedScreen> createState() => _ApprovedScreenState();
}

class _ApprovedScreenState extends State<ApprovedScreen> {
  final _searchController = TextEditingController();

  /// Размер страницы совпадает с умолчанием сервиса. Расходиться им нельзя:
  /// из него считается «Показано 1–20 из 365».
  static const int _perPage = 20;

  static const List<CatalogSortOption> _sortOptions = <CatalogSortOption>[
    CatalogSortOption(value: 'newest', label: 'Сначала новые'),
    CatalogSortOption(value: 'oldest', label: 'Сначала старые'),
    CatalogSortOption(value: 'rating', label: 'По рейтингу'),
    CatalogSortOption(value: 'views', label: 'По просмотрам'),
  ];

  static const Map<String, String> _sortCaptions = <String, String>{
    'newest': 'сначала новые',
    'oldest': 'сначала старые',
    'rating': 'по рейтингу',
    'views': 'по просмотрам',
  };

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ApprovedProvider>().loadActiveEstablishments();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ApprovedProvider>();

    return Column(
      children: [
        AdminScreenHeader(
          title: 'Одобренные',
          subtitle: _subtitle(context, provider),
          actions: <Widget>[
            _SearchField(
              controller: _searchController,
              isSearchMode: provider.isSearchMode,
              onSubmit: (query) =>
                  context.read<ApprovedProvider>().searchEstablishments(query),
              onClear: () {
                _searchController.clear();
                context.read<ApprovedProvider>().clearSearch();
              },
            ),
          ],
        ),
        Expanded(
          child: Row(
            children: [
              ModerationCatalogList(
                sectionTitle: provider.isSearchMode ? 'Найденное' : 'Каталог',
                // В режиме поиска порядок задаёт не экран: сервис ищет по
                // совпадению и параметр сортировки не принимает. Меню здесь
                // обещало бы управление, которого нет.
                sortCaption: provider.isSearchMode
                    ? 'по совпадению'
                    : _sortCaptions[provider.sort] ?? 'сначала новые',
                sortOptions: provider.isSearchMode ? null : _sortOptions,
                currentSort: provider.sort,
                onSortChanged: provider.isSearchMode
                    ? null
                    : (value) =>
                        context.read<ApprovedProvider>().setSort(value),
                itemCount: provider.establishments.length,
                itemBuilder: (context, index) {
                  final item = provider.establishments[index];
                  return _card(context, provider, item);
                },
                isLoading: provider.isLoadingList,
                error: provider.listError,
                onRetry: () =>
                    context.read<ApprovedProvider>().loadActiveEstablishments(),
                emptyTitle: provider.isSearchMode
                    ? 'Ничего не найдено'
                    : 'Каталог пуст',
                emptyMessage: provider.isSearchMode
                    ? 'По запросу нет совпадений ни в одном статусе.'
                    : 'Одобренных заведений пока нет — они появятся здесь '
                        'после первой публикации.',
                page: provider.currentPage,
                totalPages: provider.totalPages,
                totalCount: provider.totalCount,
                perPage: _perPage,
                onPageChanged: (page) => context
                    .read<ApprovedProvider>()
                    .loadActiveEstablishments(page: page),
              ),
              const Expanded(child: _DetailPanel()),
            ],
          ),
        ),
      ],
    );
  }

  /// «365 заведений опубликовано · 11 приостановлено».
  String? _subtitle(BuildContext context, ApprovedProvider provider) {
    if (provider.isLoadingList || provider.listError != null) return null;

    if (provider.isSearchMode) {
      final found = provider.totalCount;
      return found == 0
          ? 'Совпадений нет'
          : 'Найдено ${countWithNoun(found, 'заведение', 'заведения', 'заведений')}';
    }

    final published =
        '${formatCount(provider.totalCount)} ${plural(provider.totalCount, 'заведение', 'заведения', 'заведений')} опубликовано';

    // Приостановленные показываются рядом намеренно: это тот же каталог, из
    // которого они временно изъяты, и знать их число полезно именно здесь.
    final suspended = context.watch<BadgesProvider>().badges?.establishmentsSuspended;
    if (suspended == null || suspended == 0) return published;

    return '$published · ${formatCount(suspended)} приостановлено';
  }

  Widget _card(
    BuildContext context,
    ApprovedProvider provider,
    EstablishmentListItem item,
  ) {
    final active = item is ActiveEstablishmentItem ? item : null;
    final found = item is SearchResultItem ? item : null;

    return ModerationCatalogCard(
      name: item.name,
      date: active?.publishedAt ?? found?.publishedAt ?? item.updatedAt,
      subtitle: _typeAndCity(item),
      thumbnailUrl: item.thumbnailUrl,
      categories: item.categories,
      cuisines: item.cuisines,
      isSelected: provider.selectedId == item.id,
      onTap: () => context.read<ApprovedProvider>().selectEstablishment(item.id),
      footer: active != null
          ? _ActiveMetrics(item: active)
          // Поиск идёт по всем статусам, поэтому у найденного показывается
          // его статус: иначе непонятно, почему заведение нашлось в каталоге,
          // но выглядит иначе.
          : found != null
              ? StatusDot.labelled(found.status)
              : null,
    );
  }

  static String? _typeAndCity(EstablishmentListItem item) {
    final parts = <String>[
      if (item.categories.isNotEmpty) item.categories.first.toLowerCase(),
      if (item.city != null) item.city!,
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

/// Метрики опубликованного заведения одной строкой.
class _ActiveMetrics extends StatelessWidget {
  final ActiveEstablishmentItem item;

  const _ActiveMetrics({required this.item});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // Оценка — единственная величина с брендовым акцентом: она первая,
        // по которой судят о заведении.
        const Icon(Icons.star, size: 14, color: AppTheme.primaryOrange),
        const SizedBox(width: 4),
        Text(
          formatDecimal(item.averageRating),
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        const SizedBox(width: 14),
        _Metric(icon: Icons.visibility_outlined, value: item.viewCount),
        const SizedBox(width: 14),
        _Metric(icon: Icons.favorite_border, value: item.favoriteCount),
      ],
    );
  }
}

class _Metric extends StatelessWidget {
  final IconData icon;
  final int value;

  const _Metric({required this.icon, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppTheme.textGrey),
        const SizedBox(width: 4),
        Text(
          formatCount(value),
          style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
        ),
      ],
    );
  }
}

/// Поиск по всем статусам — компактное поле в слоте шапки.
class _SearchField extends StatelessWidget {
  final TextEditingController controller;
  final bool isSearchMode;
  final ValueChanged<String> onSubmit;
  final VoidCallback onClear;

  const _SearchField({
    required this.controller,
    required this.isSearchMode,
    required this.onSubmit,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 240,
      height: 40,
      child: TextField(
        controller: controller,
        style: const TextStyle(fontSize: 14, color: AppTheme.textDark),
        textAlignVertical: TextAlignVertical.center,
        onSubmitted: (value) {
          final query = value.trim();
          if (query.isEmpty) {
            onClear();
          } else {
            onSubmit(query);
          }
        },
        decoration: InputDecoration(
          hintText: 'Поиск по всем статусам',
          hintStyle: const TextStyle(fontSize: 14, color: AppTheme.textGrey),
          isDense: true,
          contentPadding: EdgeInsets.zero,
          prefixIcon: const Icon(
            Icons.search,
            size: 17,
            color: AppTheme.textTertiary,
          ),
          prefixIconConstraints: const BoxConstraints(minWidth: 38),
          suffixIcon: isSearchMode
              ? IconButton(
                  icon: const Icon(Icons.close, size: 17),
                  color: AppTheme.textSecondary,
                  onPressed: onClear,
                  tooltip: 'Сбросить поиск',
                )
              : null,
          // Компактное поле шапки: рамка r10 и высота 40, как у соседних
          // контролов слота, а не общая форма поля ввода канона.
          border: _border(AppTheme.strokeGrey),
          enabledBorder: _border(AppTheme.strokeGrey),
          focusedBorder: _border(AppTheme.primaryOrange, width: 1.5),
        ),
      ),
    );
  }

  OutlineInputBorder _border(Color color, {double width = 1}) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusControl),
        borderSide: BorderSide(color: color, width: width),
      );
}

class _DetailPanel extends StatelessWidget {
  const _DetailPanel();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ApprovedProvider>();
    // Счётчики очередей берём ДО асинхронного действия: обращаться к
    // context после await нельзя.
    final badges = context.read<BadgesProvider>();

    // Determine mode based on selected establishment status
    final detail = provider.selectedDetail;
    final isSuspended = detail?.status == 'suspended';

    return ModerationDetailPanel(
      mode: isSuspended ? DetailPanelMode.suspended : DetailPanelMode.readonly,
      detail: detail,
      isLoadingDetail: provider.isLoadingDetail,
      detailError: provider.detailError,
      selectedId: provider.selectedId,
      onSuspend: !isSuspended && detail != null
          ? (reason) => provider
              .suspendEstablishment(reason)
              .then((ok) => ok ? badges.load() : null)
          : null,
      onUnsuspend: isSuspended
          ? () => provider
              .unsuspendEstablishment()
              .then((ok) => ok ? badges.load() : null)
          : null,
      onClaim: detail != null
          ? (userId) => provider.claimEstablishment(userId)
          : null,
    );
  }
}
