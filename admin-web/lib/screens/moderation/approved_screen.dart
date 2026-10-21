import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_catalog_list.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/status_dot.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';

/// Экран «Одобренные» — каталог опубликованных заведений.
///
/// Поиск живёт в шапке экрана, а не над списком: он ищет по **всем** статусам,
/// то есть относится не к этой колонке, а к экрану. По канону слот шапки для
/// того и заведён.
class ApprovedScreen extends StatefulWidget {
  /// Запрос из адреса (`/moderation/approved?q=…`): экран открывается сразу
  /// с поиском по нему и с текстом в поле — как будто его ввёл модератор.
  final String? initialQuery;

  const ApprovedScreen({super.key, this.initialQuery});

  @override
  State<ApprovedScreen> createState() => _ApprovedScreenState();
}

class _ApprovedScreenState extends State<ApprovedScreen> {
  final _searchController = TextEditingController();
  late final ApprovedProvider _provider;

  /// Сбой действия — тостом (пункт A1-01). До 20.10 провайдер писал
  /// причину, а экран её не читал: окно закрывалось, и ничего не происходило.
  /// Повтора у тоста нет намеренно: кнопка действия рядом, в шапке.
  final _actionFailure = AdminErrorToastReporter();

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
    _provider = context.read<ApprovedProvider>();
    _provider.addListener(_onProviderChanged);
    final query = widget.initialQuery?.trim() ?? '';
    if (query.isNotEmpty) _searchController.text = query;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final approved = context.read<ApprovedProvider>();
      if (query.isNotEmpty) {
        approved.searchEstablishments(query);
      } else {
        approved.loadActiveEstablishments();
      }
    });
  }

  @override
  void dispose() {
    _provider.removeListener(_onProviderChanged);
    _actionFailure.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _onProviderChanged() {
    final reason = _provider.submitError;
    _actionFailure.report(
      this,
      key: reason,
      title: _provider.submitFailureTitle ?? 'Действие не выполнено',
      message: reason ?? '',
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ApprovedProvider>();

    return Column(
      children: [
        AdminScreenHeader(
          // Поиск идёт по всем статусам — и заголовок говорит об этом, а не
          // остаётся «Одобренные» над найденными черновиками (Ч19, 20.10).
          title: provider.isSearchMode ? 'Поиск по всем статусам' : 'Одобренные',
          subtitle: _subtitle(context, provider),
          // Обновление списка показывается полоской в шапке, а не подменой
          // карточек скелетоном: данные остаются читаемыми.
          busy: provider.isLoadingList && provider.establishments.isNotEmpty,
          actions: <Widget>[
            // Действия появляются только при загруженной детали выбранного
            // заведения. Провайдер отдаёт деталь только вместе с её выбором и
            // выполняет действие над показанной карточкой (пакет 2, пункт 4);
            // загрузка и ошибка здесь проверяются, чтобы не показывать
            // кнопки над карточкой, которая ещё не на экране.
            if (provider.selectedDetail != null &&
                !provider.isLoadingDetail &&
                provider.detailError == null)
              _EntityActions(provider: provider),
            _SearchField(
              controller: _searchController,
              isSearchMode: provider.isSearchMode,
              onSubmit: (query) =>
                  context.read<ApprovedProvider>().searchEstablishments(query),
              onClear: () {
                _searchController.clear();
                if (context.read<ApprovedProvider>().isSearchMode) {
                  context.read<ApprovedProvider>().clearSearch();
                }
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
                perPage: ApprovedProvider.perPage,
                // Ветвление обязательно: в режиме поиска перелистывание
                // через loadActiveEstablishments сбросило бы поиск и молча
                // вернуло каталог — страница сменилась бы, а список стал бы
                // отвечать на другой вопрос.
                onPageChanged: (page) {
                  final approved = context.read<ApprovedProvider>();
                  if (provider.isSearchMode) {
                    approved.searchEstablishments(
                      provider.searchQuery,
                      page: page,
                    );
                  } else {
                    approved.loadActiveEstablishments(page: page);
                  }
                },
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
    if (provider.listError != null) return null;
    // Гасим подпись только на первой загрузке. На перелистывании данные
    // остаются на экране, и заголовок не должен мигать вместе с ними.
    if (provider.isLoadingList && provider.totalCount == 0) return null;

    if (provider.isSearchMode) {
      final found = provider.totalCount;
      final query = provider.searchQuery.trim();
      return found == 0
          ? 'По «$query» совпадений нет'
          : 'По «$query» найдено ${countWithNoun(found, 'заведение', 'заведения', 'заведений')}';
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

    final published = active?.publishedAt ?? found?.publishedAt;
    return ModerationCatalogCard(
      name: item.name,
      date: published ?? item.updatedAt,
      // Дата подписана: без подписи было непонятно, заявка это, одобрение
      // или создание (Ч17, 20.10).
      dateLabel: published != null ? 'опубликовано' : 'изменено',
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
        // по которой судят о заведении. Без отзывов её не показываем вовсе:
        // «0,0» под брендовой звездой читается как плохая оценка, хотя
        // означает отсутствие оценок.
        if (item.reviewCount > 0) ...[
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
        ],
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
///
/// Ищет по мере ввода — после паузы, от двух букв; Enter ищет сразу (Ч19,
/// 20.10: прежде поиск шёл только по Enter, и об этом ничего не говорило).
class _SearchField extends StatefulWidget {
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

  /// Пауза после последней буквы: «кофейня» — не семь запросов.
  static const Duration debounce = Duration(milliseconds: 450);

  /// Короче — не ищем: одна буква совпадёт почти со всем каталогом.
  static const int minLength = 2;

  @override
  State<_SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<_SearchField> {
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _run(String value) {
    _debounce?.cancel();
    final query = value.trim();
    if (query.isEmpty) {
      widget.onClear();
    } else if (query.length >= _SearchField.minLength) {
      widget.onSubmit(query);
    }
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(_SearchField.debounce, () {
      if (mounted) _run(value);
    });
    setState(() {}); // крестик очистки появляется и исчезает
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final isSearchMode = widget.isSearchMode;
    return SizedBox(
      width: 240,
      height: 40,
      child: TextField(
        controller: controller,
        style: const TextStyle(fontSize: 14, color: AppTheme.textDark),
        textAlignVertical: TextAlignVertical.center,
        onChanged: _onChanged,
        onSubmitted: _run,
        decoration: InputDecoration(
          hintText: 'Название — во всех статусах',
          hintStyle: const TextStyle(fontSize: 14, color: AppTheme.textGrey),
          isDense: true,
          contentPadding: EdgeInsets.zero,
          prefixIcon: const Icon(
            Icons.search,
            size: 17,
            color: AppTheme.textTertiary,
          ),
          prefixIconConstraints: const BoxConstraints(minWidth: 38),
          suffixIcon: isSearchMode || controller.text.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.close, size: 17),
                  color: AppTheme.textSecondary,
                  onPressed: () {
                    _debounce?.cancel();
                    widget.onClear();
                    setState(() {});
                  },
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

/// Действия над выбранным заведением в слоте шапки.
class _EntityActions extends StatelessWidget {
  final ApprovedProvider provider;

  const _EntityActions({required this.provider});

  @override
  Widget build(BuildContext context) {
    // Просмотрщику действий не показываем: сервер ответил бы 403, а кнопка,
    // обещающая то, что не выполнится, читается как поломка.
    if (!context.watch<AuthProvider>().canModerate) {
      return const SizedBox.shrink();
    }

    // Счётчики очередей берём ДО асинхронного действия: обращаться к
    // context после await нельзя.
    final badges = context.read<BadgesProvider>();
    final detail = provider.selectedDetail;

    // Две независимые паузы (07.10.2026): «Приостановить» — всё, кроме
    // черновика, архива и уже приостановленной модератором (поиском сюда
    // приходят карточки любого статуса, и пауза партнёра тоже);
    // «Возобновить» — только своя приостановка: паузу партнёра включает
    // партнёр. Пока карточка не загружена, решать не по чему — кнопок нет.
    return ModerationEntityActions(
      establishmentName: detail?.name ?? '',
      busy: provider.isSubmitting,
      compact: MediaQuery.sizeOf(context).width <
          ModerationEntityActions.compactBelowWindowWidth,
      unsuspendReturnsTo: detail?.suspendedFrom,
      onSuspend: detail != null && detail.canBeSuspendedByModerator
          ? (reason) => provider
              .suspendEstablishment(reason)
              .then((ok) => ok ? badges.load() : null)
          : null,
      onUnsuspend: detail != null && detail.isSuspendedByModerator
          ? () => provider
              .unsuspendEstablishment()
              .then((ok) => ok ? badges.load() : null)
          : null,
      onClaim: (userId, label) =>
          provider.claimEstablishment(userId, userLabel: label),
    );
  }
}

class _DetailPanel extends StatelessWidget {
  const _DetailPanel();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ApprovedProvider>();
    final detail = provider.selectedDetail;
    final isSuspended = detail?.status == 'suspended';

    return ModerationDetailPanel(
      mode: isSuspended ? DetailPanelMode.suspended : DetailPanelMode.readonly,
      detail: detail,
      isLoadingDetail: provider.isLoadingDetail,
      detailError: provider.detailError,
      selectedId: provider.selectedId,
      listIsEmpty: !provider.isLoadingList &&
          provider.listError == null &&
          provider.totalCount == 0,
      partnerLabel: detail == null ? null : provider.handedTo(detail.id),
      onRetryDetail: provider.selectedId == null
          ? null
          : () => context
              .read<ApprovedProvider>()
              .selectEstablishment(provider.selectedId!),
    );
  }
}
