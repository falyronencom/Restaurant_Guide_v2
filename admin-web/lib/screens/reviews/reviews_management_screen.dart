import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/users/users_screen.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_filter_dropdown.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_column_message.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/separated_wrap.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_search_decoration.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Путь экрана. Ссылки несут отбор: `?author=<id>` — отзывы одного человека
/// (кнопка «Отзывы автора» в его карточке), `?rating=1-2` — низкие оценки
/// («Открыть в отзывах →» из аналитики).
const String kReviewsPath = '/settings/reviews';

/// Адрес отзывов одного человека.
String authorReviewsLocation(String userId) =>
    Uri(path: kReviewsPath, queryParameters: <String, String>{'author': userId})
        .toString();

/// Оценка из адреса: «3» — одна, «1-2» — диапазон. Неверное — `null`.
(int, int)? parseRatingParam(String? raw) {
  final text = raw?.trim();
  if (text == null || text.isEmpty) return null;
  final match = RegExp(r'^([1-5])(?:-([1-5]))?$').firstMatch(text);
  if (match == null) return null;
  final min = int.parse(match.group(1)!);
  final max = int.parse(match.group(2) ?? match.group(1)!);
  return min <= max ? (min, max) : null;
}

/// Ширина содержимого экрана (без меню слева), начиная с которой экран
/// сжимает колонку и поиск. Окно 1150 даёт ≈ 890, 1024 — ≈ 764 (решение
/// Координатора А: минимум окна 1024; обрезки видны уже на 1150).
const double kReviewsNarrowWidth = 1000;

/// «Отзывы» — кадр 07.
///
/// Экран разбора, а не таблица: слева колонка 420 с карточками, справа панель
/// с самим отзывом. Общее с кадром 06 — шапка, фильтры-пилюли и футер
/// пагинации; различие в том, что здесь читают текст, а не сканируют строки.
class ReviewsManagementScreen extends StatefulWidget {
  /// Отбор из адреса — см. [kReviewsPath].
  final String? initialAuthorId;
  final String? initialRating;

  const ReviewsManagementScreen({
    super.key,
    this.initialAuthorId,
    this.initialRating,
  });

  @override
  State<ReviewsManagementScreen> createState() =>
      _ReviewsManagementScreenState();
}

class _ReviewsManagementScreenState extends State<ReviewsManagementScreen> {
  final _searchController = TextEditingController();
  late final AdminReviewsProvider _provider;

  /// Один тост на одну неудачу — общее средство П1.
  final _listFailure = AdminErrorToastReporter();

  @override
  void initState() {
    super.initState();
    _provider = context.read<AdminReviewsProvider>();
    _provider.addListener(_onProviderChanged);
    // Провайдер переживает уход с экрана, и поиск с ним: поле показывает
    // то, по чему отобран список, а не пустоту (проход по панели 20.10,
    // A2-18).
    _searchController.text = _provider.searchQuery;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _applyRoute();
    });
  }

  @override
  void didUpdateWidget(ReviewsManagementScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialAuthorId != oldWidget.initialAuthorId ||
        widget.initialRating != oldWidget.initialRating) {
      _applyRoute();
    }
  }

  void _applyRoute() {
    final rating = parseRatingParam(widget.initialRating);
    final author = widget.initialAuthorId?.trim();
    _provider.applyRoute(
      authorId: author == null || author.isEmpty ? null : author,
      ratingMin: rating?.$1,
      ratingMax: rating?.$2,
    );
  }

  @override
  void dispose() {
    _provider.removeListener(_onProviderChanged);
    _listFailure.dispose();
    _searchController.dispose();
    super.dispose();
  }

  /// Неудача загрузки при непустом списке не должна пропадать молча.
  ///
  /// Таких неудач две: перелистывание и перечитка после действия. Вторая
  /// опаснее — само действие прошло, вернулся `true`, и без сообщения
  /// модератор видит прежние строки и считает, что ничего не случилось.
  /// Компактное сообщение показывается только при пустом списке, иначе оно
  /// снесло бы уже показанные строки.
  void _onProviderChanged() {
    // Пустой список — сообщение в колонке, не тост.
    final message = _provider.reviews.isEmpty ? null : _provider.listError;
    _listFailure.report(
      this,
      key: message,
      title: 'Список не обновился',
      message: '${asSentence(message ?? '')} Отзывы на экране остались от '
          'прошлой загрузки.',
      onRetry: () => _provider.loadReviews(page: _provider.currentPage),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) =>
          _build(context, narrow: constraints.maxWidth < kReviewsNarrowWidth),
    );
  }

  Widget _build(BuildContext context, {required bool narrow}) {
    final provider = context.watch<AdminReviewsProvider>();
    final reviews = context.read<AdminReviewsProvider>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AdminScreenHeader(
          title: 'Отзывы',
          subtitle: _subtitle(provider),
          busy: provider.isLoadingList && provider.reviews.isNotEmpty,
          actions: <Widget>[
            _SearchField(
              controller: _searchController,
              width: narrow ? 190 : 260,
              isSearchMode: provider.searchQuery.isNotEmpty,
              onSubmit: reviews.search,
              onClear: _clearSearch,
            ),
            AdminFilterDropdown<String>(
              value: provider.statusFilter,
              emptyLabel: 'Все статусы',
              options: const <AdminFilterOption<String>>[
                AdminFilterOption<String>(value: null, label: 'Все статусы'),
                AdminFilterOption<String>(value: 'visible', label: 'Видимые'),
                AdminFilterOption<String>(value: 'hidden', label: 'Скрытые'),
                AdminFilterOption<String>(value: 'deleted', label: 'Удалённые'),
              ],
              onChanged: reviews.setStatusFilter,
            ),
            // Диапазон «1–2» — пункт настоящий: сервер с 21.10 принимает
            // rating_min / rating_max, и ссылка из аналитики приходит с ним
            // (осмотр панели 20.10, п. 31). Остальное — по одной оценке.
            AdminFilterDropdown<String>(
              value: _ratingKey(provider),
              emptyLabel: 'Любая оценка',
              options: <AdminFilterOption<String>>[
                const AdminFilterOption<String>(
                    value: null, label: 'Любая оценка'),
                const AdminFilterOption<String>(
                    value: '1-2', label: 'Низкие: 1–2 звезды'),
                for (var star = 5; star >= 1; star--)
                  AdminFilterOption<String>(
                    value: '$star',
                    label: '$star ${plural(star, 'звезда', 'звезды', 'звёзд')}',
                  ),
              ],
              onChanged: (key) {
                final range = parseRatingParam(key);
                reviews.setRatingRange(range?.$1, range?.$2);
              },
            ),
          ],
        ),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _ReviewListColumn(
                width: narrow ? 340 : 420,
                onClearSearch: _clearSearch,
                onResetFilters: _resetFilters,
              ),
              const Expanded(child: _DetailPanel()),
            ],
          ),
        ),
      ],
    );
  }

  /// Ключ пункта оценки: «1-2», «3» или `null`.
  static String? _ratingKey(AdminReviewsProvider provider) {
    final min = provider.ratingMin;
    final max = provider.ratingMax;
    if (min == null) return null;
    return min == max ? '$min' : '$min-$max';
  }

  /// Снимает поиск целиком — и фильтр, и текст в поле.
  ///
  /// Одной точкой на весь экран: сбросить поиск можно тремя способами
  /// (крестик в поле, строка пустого состояния, кнопка «Сбросить фильтры»), и
  /// каждый из них обязан очистить обе половины. Иначе поле шапки продолжает
  /// показывать запрос, которого в выборке уже нет.
  void _clearSearch() {
    _searchController.clear();
    context.read<AdminReviewsProvider>().clearSearch();
  }

  /// Снимает все фильтры разом — и в провайдере, и в поле поиска.
  void _resetFilters() {
    _searchController.clear();
    context.read<AdminReviewsProvider>().resetFilters();
  }

  /// «1 240 отзывов · 12 скрыто · средний рейтинг 4,3».
  ///
  /// Все три величины считаются бэкендом по ОДНОЙ выборке, поэтому под
  /// фильтром подпись описывает отфильтрованное, а не раздел целиком.
  String? _subtitle(AdminReviewsProvider provider) {
    if (provider.reviews.isEmpty) return null;

    final parts = <String>[
      countWithNoun(provider.totalCount, 'отзыв', 'отзыва', 'отзывов'),
      if (provider.hiddenCount > 0)
        '${formatCount(provider.hiddenCount)} скрыто',
      if (provider.averageRating != null)
        'средний рейтинг ${formatDecimal(provider.averageRating!)}',
    ];

    return parts.join(' · ');
  }
}

// =============================================================================
// Поиск в слоте шапки
// =============================================================================

class _SearchField extends StatelessWidget {
  final TextEditingController controller;
  final double width;
  final bool isSearchMode;
  final ValueChanged<String> onSubmit;
  final VoidCallback onClear;

  const _SearchField({
    required this.controller,
    required this.width,
    required this.isSearchMode,
    required this.onSubmit,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: AdminFilterDropdown.height,
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
        decoration: adminSearchDecoration(
          hint: 'Текст отзыва',
          suffixIcon: isSearchMode
              ? IconButton(
                  icon: const Icon(Icons.close, size: 17),
                  color: AppTheme.textSecondary,
                  onPressed: onClear,
                  tooltip: 'Сбросить поиск',
                )
              : null,
        ),
      ),
    );
  }
}

// =============================================================================
// Колонка списка
// =============================================================================

class _ReviewListColumn extends StatelessWidget {
  /// 420 на широком окне, 340 — на узком (см. [kReviewsNarrowWidth]).
  final double width;

  /// Сброс принадлежит экрану: текст поиска живёт в контроллере его шапки.
  final VoidCallback onClearSearch;
  final VoidCallback onResetFilters;

  const _ReviewListColumn({
    required this.width,
    required this.onClearSearch,
    required this.onResetFilters,
  });

  static const Map<String, String> _sortCaptions = <String, String>{
    'newest': 'сначала новые',
    'oldest': 'сначала старые',
    'rating_high': 'оценка по убыванию',
    'rating_low': 'оценка по возрастанию',
  };

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AdminReviewsProvider>();

    return Container(
      width: width,
      decoration: const BoxDecoration(
        border: Border(right: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _SectionHeader(
            caption: _sortCaptions[provider.sort] ?? 'сначала новые',
            currentSort: provider.sort,
            onSortChanged: context.read<AdminReviewsProvider>().setSort,
          ),
          if (provider.authorId != null) const _AuthorBar(),
          Expanded(child: _body(context, provider)),
          // Футер держится и на ошибке: строки от прошлой страницы на экране,
          // и убрать под ними полосу номеров значит отнять единственный
          // способ уйти с неё.
          if (provider.reviews.isNotEmpty)
            AdminPagination.narrow(
              page: provider.currentPage,
              totalPages: provider.totalPages,
              totalCount: provider.totalCount,
              perPage: AdminReviewsProvider.perPage,
              shownOnPage: provider.reviews.length,
              onPageChanged: (page) => context
                  .read<AdminReviewsProvider>()
                  .loadReviews(page: page),
            ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, AdminReviewsProvider provider) {
    // Скелетон — только когда показывать нечего. На смене страницы прежние
    // карточки остаются до прихода новых.
    if (provider.isLoadingList && provider.reviews.isEmpty) {
      return const _ListSkeleton();
    }

    final message = provider.listError;
    if (message != null && provider.reviews.isEmpty) {
      // Компактное сообщение, а не витринная `AdminErrorCard`: та шириной 400
      // и рассчитана на всю область экрана, в колонке 420 она вылезает за
      // край. Те же грабли уже находили на кадре 05.
      return AdminColumnMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Отзывы не загрузились',
        message: message,
        onAction: () => context.read<AdminReviewsProvider>().loadReviews(),
      );
    }

    if (provider.reviews.isEmpty) return _empty(context, provider);

    // Отметки — только под фильтром автора и только у того, кто действует:
    // «Скрыть выбранные» сделано для отзывов одного человека (A2-09).
    final canCheck = provider.authorId != null &&
        context.watch<AuthProvider>().canModerate;

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: provider.reviews.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final review = provider.reviews[index];
        final hideable = review.isVisible && !review.isDeleted;
        return _ReviewCard(
          review: review,
          isSelected: provider.selectedId == review.id,
          checked: canCheck && hideable
              ? provider.checkedIds.contains(review.id)
              : null,
          onChecked: () =>
              context.read<AdminReviewsProvider>().toggleChecked(review.id),
          onTap: () =>
              context.read<AdminReviewsProvider>().selectReview(review.id),
        );
      },
    );
  }

  Widget _empty(BuildContext context, AdminReviewsProvider provider) {
    if (!provider.hasActiveFilters) {
      return const AdminColumnMessage(
        icon: Icons.rate_review_outlined,
        title: 'Отзывов пока нет',
        message: 'Здесь появятся отзывы посетителей — все сразу, включая '
            'скрытые и удалённые.',
      );
    }

    // Перечисляем, что именно отсекло: пустой список под фильтром без этого
    // выглядит как пустой раздел.
    final active = <String>[
      if (provider.authorId != null)
        'автор ${provider.authorName ?? 'из карточки'}',
      if (provider.searchQuery.isNotEmpty) 'поиск «${provider.searchQuery}»',
      if (provider.statusFilter != null)
        _statusFilterLabel(provider.statusFilter!),
      if (provider.ratingFilter != null)
        'оценка ${provider.ratingFilter}'
      else if (provider.ratingMin != null)
        'оценка ${provider.ratingMin}–${provider.ratingMax}',
    ];

    return AdminColumnMessage(
      icon: Icons.filter_alt_off_outlined,
      title: 'Под фильтр ничего не подошло',
      message: 'Выбрано: ${active.join(', ')}.',
      actionLabel: 'Сбросить фильтры',
      onAction: onResetFilters,
    );
  }

  static String _statusFilterLabel(String status) => switch (status) {
        'visible' => 'видимые',
        'hidden' => 'скрытые',
        'deleted' => 'удалённые',
        _ => status,
      };
}

/// Полоса фильтра «отзывы одного человека»: чьи, снять отбор, а у того, кто
/// действует, — отметить видимые и скрыть выбранные разом с одной причиной
/// (проход по панели 20.10, A2-09: тестовые отзывы стороннего тестировщика).
class _AuthorBar extends StatelessWidget {
  const _AuthorBar();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AdminReviewsProvider>();
    final canModerate = context.watch<AuthProvider>().canModerate;
    final name = provider.authorName;
    final checked = provider.checkedIds.length;
    final hideable = provider.hideableOnPage;
    final allChecked = hideable.isNotEmpty &&
        hideable.every((r) => provider.checkedIds.contains(r.id));
    final busy = provider.isSubmitting;

    return Container(
      key: const ValueKey<String>('reviews-author-bar'),
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 10),
      decoration: BoxDecoration(
        color: AppTheme.brandTint(0.06),
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 6,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.person_outline,
                  size: 16, color: AppTheme.textSecondary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  name == null ? 'Отзывы одного автора' : 'Отзывы автора: $name',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textPrimary,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                key: const ValueKey<String>('reviews-author-clear'),
                tooltip: 'Показать отзывы всех авторов',
                icon: const Icon(Icons.close, size: 17),
                color: AppTheme.textSecondary,
                visualDensity: VisualDensity.compact,
                onPressed: () => provider.setAuthor(null),
              ),
            ],
          ),
          if (canModerate)
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                TextButton(
                  key: const ValueKey<String>('reviews-check-all'),
                  onPressed:
                      hideable.isEmpty || busy ? null : provider.toggleAllOnPage,
                  child: Text(allChecked
                      ? 'Снять отметки на странице'
                      : 'Отметить видимые на странице'),
                ),
                FilledButton.icon(
                  key: const ValueKey<String>('reviews-hide-checked'),
                  onPressed: checked == 0 || busy
                      ? null
                      : () => _confirmHideChecked(context, provider),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTheme.primaryOrangeDark,
                  ),
                  icon: const Icon(Icons.visibility_off, size: 17),
                  label: Text(checked == 0
                      ? 'Скрыть выбранные'
                      : 'Скрыть выбранные ($checked)'),
                ),
              ],
            ),
          if (canModerate && provider.batchError != null)
            Text(
              provider.batchError!,
              key: const ValueKey<String>('reviews-batch-error'),
              style: const TextStyle(fontSize: 12, color: AppTheme.errorRed),
            )
          else if (canModerate && provider.batchResult != null)
            Text(
              provider.batchResult!,
              key: const ValueKey<String>('reviews-batch-result'),
              style:
                  const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmHideChecked(
    BuildContext context,
    AdminReviewsProvider provider,
  ) async {
    final count = provider.checkedIds.length;
    if (count > AdminReviewsProvider.batchMax) {
      showAdminErrorToast(
        context,
        title: 'Слишком много сразу',
        message: 'За один раз можно скрыть не больше '
            '${AdminReviewsProvider.batchMax} отзывов — снимите часть отметок.',
      );
      return;
    }
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => _ReasonDialog(
        title:
            'Скрыть ${countWithNoun(count, 'отзыв', 'отзыва', 'отзывов')}?',
        body: '$kHideConsequences $kNoNewReviewNote Показать отзыв снова '
            'можно по одному.',
        confirm: 'Скрыть',
        required: true,
      ),
    );
    if (reason == null || reason.isEmpty) return;
    await provider.hideChecked(reason);
  }
}

/// Шапка секции: чем является список и в каком он порядке.
class _SectionHeader extends StatelessWidget {
  final String caption;
  final String currentSort;
  final ValueChanged<String> onSortChanged;

  const _SectionHeader({
    required this.caption,
    required this.currentSort,
    required this.onSortChanged,
  });

  static const List<(String, String)> _options = <(String, String)>[
    ('newest', 'Сначала новые'),
    ('oldest', 'Сначала старые'),
    ('rating_high', 'Оценка по убыванию'),
    ('rating_low', 'Оценка по возрастанию'),
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
      child: Row(
        children: <Widget>[
          Text('Отзывы'.toUpperCase(), style: AppTheme.canonTableHeader),
          const Spacer(),
          // Меню настоящее: бэкенд принимает четыре порядка.
          PopupMenuButton<String>(
            tooltip: 'Порядок списка',
            position: PopupMenuPosition.under,
            initialValue: currentSort,
            onSelected: onSortChanged,
            itemBuilder: (_) => <PopupMenuEntry<String>>[
              for (final (value, label) in _options)
                PopupMenuItem<String>(value: value, child: Text(label)),
            ],
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  caption,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textTertiary,
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(
                  Icons.swap_vert,
                  size: 16,
                  color: AppTheme.textSecondary,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Статус отзыва
// =============================================================================

/// Три состояния отзыва человеческим языком.
///
/// Ключи здесь не машинные — состояние выводится из двух флагов проекции, а не
/// приходит кодом, поэтому карте кодов взяться неоткуда. Порядок проверки
/// важен: удалённый тоже невидим, но называть его «скрытым» нельзя.
enum ReviewState { visible, hidden, deleted }

ReviewState reviewStateOf(AdminReviewItem review) {
  if (review.isDeleted) return ReviewState.deleted;
  if (!review.isVisible) return ReviewState.hidden;
  return ReviewState.visible;
}

extension _ReviewStateLook on ReviewState {
  String get cardLabel => switch (this) {
        ReviewState.visible => '',
        ReviewState.hidden => 'скрыт',
        ReviewState.deleted => 'удалён',
      };

  String get panelLabel => switch (this) {
        ReviewState.visible => 'виден в приложении',
        ReviewState.hidden => 'скрыт от посетителей',
        ReviewState.deleted => 'удалён',
      };

  Color get color => switch (this) {
        ReviewState.visible => AppTheme.statusGreen,
        // Скрытие — не ошибка и не успех: канон отдаёт ему disclaimer-пару.
        ReviewState.hidden => AppTheme.disclaimerText,
        ReviewState.deleted => AppTheme.errorRed,
      };

  Color get chipBackground => switch (this) {
        ReviewState.visible => Colors.transparent,
        ReviewState.hidden => AppTheme.disclaimerBg,
        ReviewState.deleted => AppTheme.errorTint(0.10),
      };
}

// =============================================================================
// Карточка отзыва
// =============================================================================

class _ReviewCard extends StatelessWidget {
  final AdminReviewItem review;
  final bool isSelected;
  final VoidCallback onTap;

  /// Отметка для «Скрыть выбранные»; `null` — отметки у карточки нет.
  final bool? checked;
  final VoidCallback onChecked;

  const _ReviewCard({
    required this.review,
    required this.isSelected,
    required this.onTap,
    required this.checked,
    required this.onChecked,
  });

  @override
  Widget build(BuildContext context) {
    final state = reviewStateOf(review);
    final muted = state != ReviewState.visible;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: isSelected
              ? AppTheme.canonSelectedCardDecoration()
              // Рамка той же ширины, что у выбранной: без неё выбор
              // карточки сдвигает список под ней.
              : AppTheme.listCardDecoration(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _authorRow(state),
              if (review.authorBlocked) ...<Widget>[
                const SizedBox(height: 4),
                const _AuthorBlockedChip(),
              ],
              const SizedBox(height: 6),
              _placeRow(),
              const SizedBox(height: 8),
              Text(
                review.viewerRedacted
                    ? kRedactedForViewerLabel
                    : review.content?.trim().isNotEmpty == true
                        ? review.content!.trim()
                        : 'Отзыв без текста — только оценка',
                style: TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  color: muted ? AppTheme.textTertiary : AppTheme.textDark,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              if (review.hasPartnerResponse) ...[
                const SizedBox(height: 7),
                const Row(
                  mainAxisSize: MainAxisSize.min,
                  spacing: 5,
                  children: <Widget>[
                    Icon(Icons.reply, size: 13, color: AppTheme.textSecondary),
                    Text(
                      'партнёр ответил',
                      style: TextStyle(
                        fontSize: 11,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _authorRow(ReviewState state) {
    final name = review.authorName?.trim();
    final hasName = name != null && name.isNotEmpty;

    final mark = checked;

    return Row(
      spacing: 8,
      children: <Widget>[
        if (mark != null)
          SizedBox(
            width: 22,
            height: 22,
            child: Checkbox(
              key: ValueKey<String>('review-check-${review.id}'),
              value: mark,
              onChanged: (_) => onChecked(),
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
            ),
          )
        else
          _Avatar(
            label: hasName ? name : review.authorEmail,
            muted: !hasName,
          ),
        Expanded(
          child: Text(
            hasName
                ? name
                : review.viewerRedacted
                    ? kRedactedForViewerLabel
                    : (review.authorEmail ?? 'Аноним'),
            // Без имени показывается адрес — величина техническая, и
            // моноширинный отличает её от имени раньше, чем прочтёшь.
            // Скрытое от просмотрщика — не адрес и не имя: обычный серый.
            style: !hasName && review.viewerRedacted
                ? const TextStyle(fontSize: 14, color: AppTheme.textGrey)
                : hasName
                ? TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: state == ReviewState.deleted
                        ? AppTheme.textSecondary
                        : AppTheme.textPrimary,
                    decoration: state == ReviewState.deleted
                        ? TextDecoration.lineThrough
                        : null,
                  )
                : AppTheme.mono(fontSize: 12, color: AppTheme.textDark),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (state != ReviewState.visible) _StateChip(state: state),
        Text(
          formatDayMonthShort(review.createdAt),
          style: AppTheme.mono(fontSize: 11, color: AppTheme.textGrey),
        ),
      ],
    );
  }

  Widget _placeRow() {
    return Row(
      spacing: 6,
      children: <Widget>[
        const Icon(Icons.storefront, size: 14, color: AppTheme.textGrey),
        Expanded(
          child: Text(
            _place(review) ?? 'заведение не указано',
            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        _Stars(value: review.rating, size: 14),
      ],
    );
  }
}

String? _place(AdminReviewItem review) {
  final parts = <String>[
    if (review.establishmentName?.trim().isNotEmpty == true)
      review.establishmentName!.trim(),
    if (review.establishmentCity?.trim().isNotEmpty == true)
      review.establishmentCity!.trim(),
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}

/// «автор заблокирован» — у карточки и в панели (проход по панели 20.10,
/// A2-11): «Показать» на таком отзыве вернёт его гостям при выключенном авторе.
class _AuthorBlockedChip extends StatelessWidget {
  const _AuthorBlockedChip();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: AppTheme.errorTint(0.10),
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: const Text(
        'автор заблокирован',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: AppTheme.errorRed,
        ),
      ),
    );
  }
}

class _StateChip extends StatelessWidget {
  final ReviewState state;

  const _StateChip({required this.state});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: state.chipBackground,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Text(
        state.cardLabel,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: state.color,
        ),
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  final String? label;
  final bool muted;

  const _Avatar({required this.label, required this.muted});

  @override
  Widget build(BuildContext context) {
    final trimmed = label?.trim() ?? '';

    return Container(
      width: 22,
      height: 22,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: muted ? AppTheme.textGrey : AppTheme.primaryOrangeDark,
        shape: BoxShape.circle,
      ),
      child: Text(
        trimmed.isEmpty ? '?' : trimmed.characters.first.toUpperCase(),
        style: const TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: AppTheme.textOnPrimary,
        ),
      ),
    );
  }
}

class _Stars extends StatelessWidget {
  final int value;
  final double size;

  const _Stars({required this.value, required this.size});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (var i = 1; i <= 5; i++)
          Icon(
            Icons.star,
            size: size,
            color: i <= value ? AppTheme.primaryOrange : AppTheme.strokeGrey,
          ),
      ],
    );
  }
}

class _ListSkeleton extends StatelessWidget {
  const _ListSkeleton();

  static const int _cards = 6;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: _cards,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, __) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: AppTheme.listCardDecoration(),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            SkeletonBlock.line(widthFactor: 0.5, shade: SkeletonShade.strong),
            SizedBox(height: 10),
            SkeletonBlock.line(widthFactor: 0.68, shade: SkeletonShade.weak),
            SizedBox(height: 10),
            SkeletonBlock.line(widthFactor: 0.94),
            SizedBox(height: 6),
            SkeletonBlock.line(widthFactor: 0.72),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// Панель разбора
// =============================================================================

class _DetailPanel extends StatelessWidget {
  const _DetailPanel();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AdminReviewsProvider>();
    final review = provider.selectedReview;

    if (review == null) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.rate_review_outlined,
                size: 34,
                color: AppTheme.textGrey,
              ),
              SizedBox(height: 12),
              Text(
                'Выберите отзыв слева',
                style: TextStyle(fontSize: 15, color: AppTheme.textSecondary),
              ),
            ],
          ),
        ),
      );
    }

    final state = reviewStateOf(review);
    // Просмотрщику действий не показываем: сервер ответил бы 403, а кнопка,
    // обещающая то, что не выполнится, читается как поломка.
    final canModerate = context.watch<AuthProvider>().canModerate;

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                spacing: 18,
                children: <Widget>[
                  _Heading(review: review, state: state),
                  if (state == ReviewState.hidden && !review.viewerRedacted)
                    _HiddenNote(review: review),
                  // Ключ по id: раскрытый длинный текст не переезжает на
                  // соседний отзыв при выборе другого.
                  _Quote(key: ValueKey<String>('quote-${review.id}'), review: review),
                  // Карточка списка пишет «партнёр ответил»; у скрытого от
                  // просмотрщика ответ не пришёл — блок говорит, что он скрыт,
                  // а не пропадает молча.
                  if (review.hasPartnerResponse &&
                      (review.partnerResponse != null ||
                          review.viewerRedacted))
                    _PartnerResponse(review: review),
                  _Facts(review: review),
                  // К автору — на экран «Пользователи»: оттуда модератор
                  // блокирует человека или сбрасывает имя (проход
                  // тестировщика 17.10, п. 8). У скрытого отзыва просмотрщику
                  // сервер автора не называет — и ссылки нет.
                  if (review.authorId != null)
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: <Widget>[
                        TextButton.icon(
                          key: const ValueKey<String>('review-author-link'),
                          onPressed: () =>
                              context.go(userCardLocation(review.authorId!)),
                          icon: const Icon(Icons.person_outline, size: 18),
                          label: const Text('Открыть автора'),
                        ),
                        // Все отзывы этого человека — здесь же, с отметками
                        // для «Скрыть выбранные» (A2-09).
                        if (provider.authorId != review.authorId)
                          TextButton.icon(
                            key: const ValueKey<String>('review-author-reviews'),
                            onPressed: () => provider.setAuthor(
                              review.authorId,
                              name: review.authorName,
                            ),
                            icon: const Icon(Icons.filter_list, size: 18),
                            label: const Text('Все отзывы автора'),
                          ),
                      ],
                    ),
                ],
              ),
            ),
          ),
          if (canModerate) ...<Widget>[
            const SizedBox(height: 18),
            _Actions(provider: provider, review: review, state: state),
          ],
        ],
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  final AdminReviewItem review;
  final ReviewState state;

  const _Heading({required this.review, required this.state});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // Заголовок панели — заведение, а не «Детали отзыва»: разбирают
        // отзыв всегда о чём-то, и это «что-то» здесь главное.
        Text(
          review.establishmentName?.trim().isNotEmpty == true
              ? review.establishmentName!.trim()
              : 'Заведение не указано',
          style: AppTheme.canonSectionHeader.copyWith(height: 1.1),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 8),
        // Сегменты переносятся целиком, а не усекаются: на окне 1150 усечение
        // съедало дату и статус («отзыв от 9 октя…», «виден в прило…» —
        // осмотр панели 20.10, п. 32). Каждый сегмент — неразрывный, так что
        // строка ломается только между ними, и «·» на месте переноса не
        // остаётся висеть в конце строки (находка П7 № 6).
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            SeparatedWrap(
              key: const ValueKey<String>('review-facts'),
              spacing: 8,
              runSpacing: 4,
              separator: const _Dot(),
              items: <Widget>[
                Row(
                  mainAxisSize: MainAxisSize.min,
                  spacing: 8,
                  children: <Widget>[
                    const Icon(Icons.storefront,
                        size: 15, color: AppTheme.textGrey),
                    if (review.establishmentCity?.trim().isNotEmpty == true)
                      _segment(review.establishmentCity!.trim()),
                  ],
                ),
                _segment(
                  'отзыв от ${formatDayMonthLocal(review.createdAt)}, '
                  '${formatTimeLocal(review.createdAt)}',
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  spacing: 8,
                  children: <Widget>[
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: state.color,
                        shape: BoxShape.circle,
                      ),
                    ),
                    _segment(state.panelLabel),
                  ],
                ),
              ],
            ),
            if (review.authorBlocked) const _AuthorBlockedChip(),
          ],
        ),
      ],
    );
  }

  Widget _segment(String text) => Text(
        text,
        style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary),
        softWrap: false,
      );
}

/// Почему отзыв скрыт — по журналу (проход по панели 20.10, A2-11): сам
/// модератор и его причина или блокировка автора и её причина. Записи нет —
/// так и сказано, причина не выдумывается.
class _HiddenNote extends StatelessWidget {
  final AdminReviewItem review;

  const _HiddenNote({required this.review});

  @override
  Widget build(BuildContext context) {
    final reason = review.hiddenReason?.trim();
    final head = switch (review.hiddenBy) {
      ReviewHiddenBy.moderator => 'Скрыт модератором',
      ReviewHiddenBy.block => 'Скрыт блокировкой автора',
      null => 'Скрыт — записи о том, кто и почему, в журнале нет',
    };

    return Container(
      key: const ValueKey<String>('review-hidden-note'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.disclaimerBg,
        borderRadius: BorderRadius.circular(AppTheme.radiusControl),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 2,
        children: <Widget>[
          Text(
            head,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppTheme.disclaimerText,
            ),
          ),
          if (review.hiddenBy != null)
            Text(
              reason == null || reason.isEmpty
                  ? 'Причина не указана'
                  : 'Причина: $reason',
              style: const TextStyle(fontSize: 13, color: AppTheme.textDark),
            ),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot();

  @override
  Widget build(BuildContext context) => const Text(
        '·',
        style: TextStyle(fontSize: 14, color: AppTheme.textGrey),
      );
}

/// Текст отзыва в панели: длинный — свёрнут до [_Quote.collapsedLines]
/// строк с «…» и кнопкой «Показать полностью» (осмотр панели 20.10, п. 33).
class _Quote extends StatefulWidget {
  final AdminReviewItem review;

  const _Quote({super.key, required this.review});

  static const int collapsedLines = 8;

  @override
  State<_Quote> createState() => _QuoteState();
}

class _QuoteState extends State<_Quote> {
  bool _expanded = false;

  static const TextStyle _textStyle = TextStyle(
    fontFamily: AppTheme.fontCardTitleFamily,
    fontSize: 16,
    fontWeight: FontWeight.w600,
    height: 1.6,
    color: AppTheme.textDark,
  );

  @override
  Widget build(BuildContext context) {
    final review = widget.review;
    final text = review.content?.trim();

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: AppTheme.canonPanelDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            spacing: 10,
            children: <Widget>[
              _Stars(value: review.rating, size: 20),
              Text('${review.rating} из 5', style: AppTheme.canonFieldValue),
              const Spacer(),
              if (review.isEdited)
                const Row(
                  mainAxisSize: MainAxisSize.min,
                  spacing: 5,
                  children: <Widget>[
                    Icon(Icons.edit, size: 15, color: AppTheme.textTertiary),
                    // Без даты: `updated_at` бьётся и действиями модератора,
                    // и выдать её за правку автора значило бы соврать.
                    Text(
                      'изменён автором',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppTheme.textTertiary,
                      ),
                    ),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 14),
          if (review.viewerRedacted || text == null || text.isEmpty)
            Text(
              review.viewerRedacted
                  ? kRedactedForViewerLabel
                  : 'Автор оставил только оценку, без текста',
              style: _textStyle.copyWith(color: AppTheme.textGrey),
            )
          else
            LayoutBuilder(
              builder: (context, constraints) =>
                  _text(context, text, constraints.maxWidth),
            ),
        ],
      ),
    );
  }

  /// Длинный ли текст, решает раскладка, а не число знаков: восемь строк на
  /// узкой панели и на широкой — разное количество слов.
  Widget _text(BuildContext context, String text, double width) {
    final painter = TextPainter(
      text: TextSpan(text: text, style: _textStyle),
      maxLines: _Quote.collapsedLines,
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
    )..layout(maxWidth: width);
    final long = painter.didExceedMaxLines;
    painter.dispose();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          text,
          key: const ValueKey<String>('review-quote-text'),
          style: _textStyle,
          maxLines: long && !_expanded ? _Quote.collapsedLines : null,
          overflow: long && !_expanded ? TextOverflow.ellipsis : null,
        ),
        if (long)
          TextButton(
            key: const ValueKey<String>('review-quote-toggle'),
            onPressed: () => setState(() => _expanded = !_expanded),
            style: TextButton.styleFrom(padding: EdgeInsets.zero),
            child: Text(_expanded ? 'Свернуть' : 'Показать полностью'),
          ),
      ],
    );
  }
}

class _PartnerResponse extends StatelessWidget {
  final AdminReviewItem review;

  const _PartnerResponse({required this.review});

  @override
  Widget build(BuildContext context) {
    final respondedAt = review.partnerResponseAt;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: AppTheme.backgroundPrimary,
        borderRadius: BorderRadius.horizontal(
          right: Radius.circular(AppTheme.radiusMedium),
        ),
        border: Border(
          left: BorderSide(color: AppTheme.primaryOrange, width: 2),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            spacing: 8,
            children: <Widget>[
              Text(
                'Ответ партнёра'.toUpperCase(),
                style: AppTheme.canonTableHeader,
              ),
              // Дата приходила с бэкенда с самого начала и молча
              // отбрасывалась моделью.
              if (respondedAt != null)
                Text(
                  '${formatDateLocal(respondedAt)} '
                  '${formatTimeLocal(respondedAt)}',
                  style: AppTheme.mono(fontSize: 11, color: AppTheme.textGrey),
                ),
            ],
          ),
          const SizedBox(height: 5),
          Text(
            review.partnerResponse?.trim() ?? kRedactedForViewerLabel,
            style: TextStyle(
              fontSize: 14,
              height: 1.5,
              color: review.partnerResponse == null
                  ? AppTheme.textGrey
                  : AppTheme.textDark,
            ),
          ),
        ],
      ),
    );
  }
}

/// Три колонки, помогающие взвесить отзыв: кто написал, много ли пишет и
/// сколько он значит для оценки заведения.
///
/// Подписи «жалоб на автора нет» из макета здесь нет намеренно: механизма
/// жалоб в модели данных не существует — ни таблицы, ни миграции, — и строка
/// утверждала бы факт о несуществующей сущности. Решение владельца.
class _Facts extends StatelessWidget {
  final AdminReviewItem review;

  const _Facts({required this.review});

  /// Уже этой ширины три колонки не помещаются: на окне 1024 карточка ≈ 330,
  /// по ≈ 90 на факт — текст шёл по буквам (A2-03). Тогда факты — друг под
  /// другом во всю ширину.
  static const double rowMinWidth = 520;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < rowMinWidth) {
            return Column(
              key: const ValueKey<String>('review-facts-column'),
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: 14,
              children: <Widget>[_author(), _authorStats(), _establishmentStats()],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 18,
            children: <Widget>[
              Expanded(child: _author()),
              Expanded(child: _authorStats()),
              Expanded(child: _establishmentStats()),
            ],
          );
        },
      ),
    );
  }

  Widget _author() {
    final name = review.authorName?.trim();
    final hasName = name != null && name.isNotEmpty;

    return _Fact(
      label: 'Автор',
      value: Row(
        spacing: 8,
        children: <Widget>[
          _Avatar(
            label: hasName ? name : review.authorEmail,
            muted: !hasName,
          ),
          Expanded(
            child: Text(
              hasName
                  ? name
                  : review.viewerRedacted
                      ? kRedactedForViewerLabel
                      : 'Без имени',
              style: hasName
                  ? AppTheme.canonFieldValue
                  : AppTheme.canonFieldValueEmpty,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      footnote: review.authorEmail,
      footnoteMono: true,
    );
  }

  Widget _authorStats() {
    final count = review.authorReviewCount;
    final average = review.authorAverageRating;

    // Скрыто от просмотрщика — не «нет данных»: число есть, его не показали.
    if (review.viewerRedacted) {
      return const _Fact(
        label: 'Отзывов от автора',
        value: Text(
          kRedactedForViewerLabel,
          style: AppTheme.canonFieldValueEmpty,
        ),
      );
    }

    if (count == null) {
      return const _Fact(label: 'Отзывов от автора', value: _Unknown());
    }

    return _Fact(
      label: 'Отзывов от автора',
      value: Text(
        average == null
            ? formatCount(count)
            : '${formatCount(count)} · средний ${formatDecimal(average)}',
        style: AppTheme.canonFieldValue,
      ),
    );
  }

  Widget _establishmentStats() {
    final average = review.establishmentAverageRating;
    final count = review.establishmentReviewCount;

    if (average == null || count == null || count == 0) {
      return const _Fact(label: 'Рейтинг заведения', value: _Unknown());
    }

    final without = review.ratingWithoutThisReview;

    return _Fact(
      label: 'Рейтинг заведения',
      value: Text(
        '${formatDecimal(average)} из '
        '${countWithNoun(count, 'отзыва', 'отзывов', 'отзывов')}',
        style: AppTheme.canonFieldValue,
      ),
      // Главный вопрос модератора к плохому отзыву — насколько он тянет
      // оценку вниз. Ответ считается из тех же трёх чисел.
      //
      // Один знак после запятой, а не два. `average_rating` — `numeric(3,2)`,
      // то есть уже округлён, и при умножении на `count` ошибка растёт: при
      // «4,10 из 187» истинное значение лежит в [4,106; 4,116], и второй знак
      // был бы гаданием. Совпавшее с исходной оценкой значение печатается
      // словами: повторить то же число — не ответ на вопрос.
      footnote: without == null
          ? null
          : (formatDecimal(without) == formatDecimal(average)
              ? 'без этого отзыва оценка та же'
              : 'без этого отзыва ${formatDecimal(without)}'),
    );
  }
}

class _Fact extends StatelessWidget {
  final String label;
  final Widget value;
  final String? footnote;
  final bool footnoteMono;

  const _Fact({
    required this.label,
    required this.value,
    this.footnote,
    this.footnoteMono = false,
  });

  @override
  Widget build(BuildContext context) {
    final note = footnote?.trim();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(label, style: AppTheme.canonFieldLabel),
        const SizedBox(height: 4),
        value,
        if (note != null && note.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            note,
            style: footnoteMono
                ? AppTheme.mono(fontSize: 11, color: AppTheme.textGrey)
                : const TextStyle(fontSize: 11, color: AppTheme.textGrey),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ],
    );
  }
}

class _Unknown extends StatelessWidget {
  const _Unknown();

  @override
  Widget build(BuildContext context) =>
      const Text('нет данных', style: AppTheme.canonFieldValueEmpty);
}

// =============================================================================
// Действия
// =============================================================================

class _Actions extends StatelessWidget {
  final AdminReviewsProvider provider;
  final AdminReviewItem review;
  final ReviewState state;

  const _Actions({
    required this.provider,
    required this.review,
    required this.state,
  });

  @override
  Widget build(BuildContext context) {
    if (state == ReviewState.deleted) {
      return const Row(
        children: <Widget>[
          Icon(Icons.delete_outline, size: 18, color: AppTheme.textGrey),
          SizedBox(width: 8),
          Text(
            'Отзыв удалён — вернуть его нельзя',
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
        ],
      );
    }

    final reviews = context.read<AdminReviewsProvider>();
    final isVisible = state == ReviewState.visible;
    final error = provider.submitError;

    // Причина сбоя — строкой под кнопками, как у «Пользователей» (пункт
    // A2-01). До 20.10 провайдер её писал, а экран не читал: отзыв на секунду
    // менял вид и тихо возвращался.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 10,
      children: <Widget>[
        _buttons(context, reviews, isVisible),
        // Подсказка — своей строкой под кнопками, а не столбиком рядом с
        // ними: в остатке строки она получала ноль и ломалась по буквам
        // («пересчитае/т» — осмотр панели 20.10, п. 32; F-02, A2-03).
        const Text(
          'Удаление пересчитает рейтинг заведения, и отменить его нельзя',
          key: ValueKey<String>('review-delete-hint'),
          style: TextStyle(
            fontSize: 12,
            height: 1.45,
            color: AppTheme.textTertiary,
          ),
        ),
        if (error != null)
          Text(
            error,
            key: const ValueKey<String>('review-action-error'),
            style: const TextStyle(fontSize: 13, color: AppTheme.errorRed),
          ),
      ],
    );
  }

  Widget _buttons(
    BuildContext context,
    AdminReviewsProvider reviews,
    bool isVisible,
  ) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: <Widget>[
        OutlinedButton.icon(
          key: const ValueKey<String>('review-visibility'),
          onPressed: provider.isSubmitting
              ? null
              : () {
                  if (isVisible) {
                    _confirmHide(context, reviews);
                  } else {
                    _confirmShow(context, reviews);
                  }
                },
          style: AppTheme.canonCtaOutlined(),
          icon: Icon(
            isVisible ? Icons.visibility_off : Icons.visibility,
            size: 19,
          ),
          label: Text(isVisible ? 'Скрыть отзыв' : 'Показать отзыв'),
        ),
        ElevatedButton.icon(
          key: const ValueKey<String>('review-delete'),
          onPressed: provider.isSubmitting
              ? null
              : () => _confirmDelete(context, reviews),
          // Заливка ошибки, а не контур: удаление необратимо и должно
          // выглядеть тяжелее скрытия, а не так же.
          style: AppTheme.canonCtaL(backgroundColor: AppTheme.errorRed),
          icon: const Icon(Icons.delete_outline, size: 19),
          label: const Text('Удалить'),
        ),
        if (provider.isSubmitting)
          const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
      ],
    );
  }

  Future<void> _confirmHide(
    BuildContext context,
    AdminReviewsProvider reviews,
  ) async {
    // Про оценку сказано намеренно. Скрытие исключает отзыв из рейтинга
    // ровно так же, как удаление (`updateEstablishmentAggregates`
    // фильтрует `is_visible = true`), то есть модератор, скрывающий
    // единицу, поднимает публичную оценку заведения. Прежний текст
    // обещал только исчезновение из приложения — о последствии для
    // рейтинга модератор мог не знать.
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _ReasonDialog(
        title: 'Скрыть отзыв?',
        body: '$kHideConsequences $kNoNewReviewNote Показать отзыв снова '
            'можно в любой момент — оценка вернётся вместе с ним.',
        confirm: 'Скрыть',
        required: true,
      ),
    );
    if (reason == null || reason.isEmpty) return;
    reviews.setVisibility(visible: false, reason: reason);
  }

  /// «Показать» на отзыве заблокированного автора — с вопросом: отзыв
  /// вернётся гостям при выключенном авторе, а разблокировка его потом уже не
  /// тронет — это решение модератора (A2-11, `adminUserService.unblockUser`).
  Future<void> _confirmShow(
    BuildContext context,
    AdminReviewsProvider reviews,
  ) async {
    if (!review.authorBlocked) {
      reviews.setVisibility(visible: true);
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const ValueKey<String>('review-show-blocked-dialog'),
        title: const Text('Автор заблокирован. Показать отзыв?'),
        content: const SizedBox(
          width: 440,
          child: Text(
            'Отзыв вернётся в приложение и в оценку заведения, хотя автор '
            'заблокирован. Разблокировка автора этот отзыв уже не тронет: '
            'показать его — ваше решение.',
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Показать'),
          ),
        ],
      ),
    );
    if (confirmed == true) reviews.setVisibility(visible: true);
  }

  Future<void> _confirmDelete(
    BuildContext context,
    AdminReviewsProvider reviews,
  ) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _ReasonDialog(
        title: 'Удалить отзыв?',
        body: 'Отзыв будет удалён, рейтинг заведения пересчитан. '
            '$kNoNewReviewNote Это действие нельзя отменить.',
        confirm: 'Удалить',
        destructive: true,
        required: false,
      ),
    );

    // `null` — диалог закрыли, не подтвердив (крестик, барьер, Escape,
    // «Отмена»). Пустая строка — подтвердили без причины.
    if (reason == null) return;
    reviews.deleteReview(reason.isEmpty ? null : reason);
  }
}

/// Что делает скрытие — общая фраза одиночного и пакетного диалога.
const String kHideConsequences =
    'Отзыв исчезнет из приложения, автор получит уведомление, а оценка '
    'заведения будет пересчитана без него.';

/// Автор не напишет о том же месте снова: сервер считает и скрытый, и
/// удалённый отзыв уже написанным (`reviewModel.findExistingReview` без
/// `is_deleted`, UNIQUE(user_id, establishment_id)) — проход по панели 20.10,
/// A2-10.
const String kNoNewReviewNote =
    'Автор не сможет написать новый отзыв об этом заведении.';

/// Диалог действия над отзывом с причиной — скрыть, скрыть выбранные,
/// удалить. Отдельным виджетом, потому что он владеет контроллером.
///
/// Прежде контроллер жил в вызывающем и освобождался через
/// `showDialog(...).whenComplete(dispose)`. Течи это не давало — `whenComplete`
/// срабатывает на всех путях закрытия, — но освобождало СЛИШКОМ РАНО: future
/// завершается в момент попа маршрута, а маршрут ещё полторы сотни миллисекунд
/// уезжает, и его поддерево живо. Тронутое поле причины перестраивалось уже
/// после `dispose` и роняло «A TextEditingController was used after being
/// disposed» — ровно на основном сценарии «вписал причину, нажал Удалить».
///
/// `State.dispose` вызывается после размонтирования маршрута, то есть тогда,
/// когда поля уже нет. Причина возвращается через `Navigator.pop`.
///
/// Предел причины — как на сервере, 500 знаков (A2-12): длиннее сервер
/// откажет. Причина — для журнала; автор её не видит, и диалог так и говорит.
class _ReasonDialog extends StatefulWidget {
  final String title;
  final String body;
  final String confirm;
  final bool destructive;

  /// Без причины подтвердить нельзя — у скрытия; у удаления причина по
  /// желанию.
  final bool required;

  const _ReasonDialog({
    required this.title,
    required this.body,
    required this.confirm,
    this.destructive = false,
    required this.required,
  });

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _reasonController = TextEditingController();

  @override
  void initState() {
    super.initState();
    if (widget.required) {
      _reasonController.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final empty = _reasonController.text.trim().isEmpty;

    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(widget.body),
            const SizedBox(height: 16),
            TextField(
              key: const ValueKey<String>('review-reason'),
              controller: _reasonController,
              autofocus: widget.required,
              maxLength: AdminReviewsProvider.reasonMaxLength,
              decoration: InputDecoration(
                labelText: widget.required
                    ? 'Причина (обязательно)'
                    : 'Причина (необязательно)',
                helperText: 'Для журнала — автор её не увидит',
              ),
              maxLines: 2,
            ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(
          key: const ValueKey<String>('review-reason-confirm'),
          style: widget.destructive
              ? FilledButton.styleFrom(backgroundColor: AppTheme.errorRed)
              : null,
          onPressed: widget.required && empty
              ? null
              : () => Navigator.of(context).pop(_reasonController.text.trim()),
          child: Text(widget.confirm),
        ),
      ],
    );
  }
}
