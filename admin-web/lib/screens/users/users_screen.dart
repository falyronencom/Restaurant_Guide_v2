import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/providers/admin_users_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/reviews/reviews_management_screen.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_column_message.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_filter_dropdown.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_search_decoration.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';

/// Путь экрана. Ссылка из отзыва добавляет `?user=<id>`.
const String kUsersPath = '/settings/users';

/// Адрес карточки человека — для перехода «к автору» из отзыва.
String userCardLocation(String userId) =>
    Uri(path: kUsersPath, queryParameters: <String, String>{'user': userId})
        .toString();

/// Что блокировка делает — одной фразой в диалоге и в подсказке.
const String kBlockConsequences =
    'Человек не сможет войти, его сеансы и уведомления на телефоне '
    'прекратятся, а все его видимые отзывы скроются, и рейтинг заведений '
    'пересчитается без них.';

/// Чего блокировка НЕ делает и что увидит сам человек (проход по панели
/// 20.10, A2-22). Сверено с кодом 21.10: вход ищет только включённые учётки
/// (`authService.verifyCredentials` — `AND is_active = true`), и приложение
/// показывает общий отказ входа; брони блокировка не трогает, а новую
/// выключенная учётка не создаст (`bookingModel.createBooking`).
const String kBlockWhatTheyNotice =
    'Сам человек причину не узнает: при входе по паролю он увидит «Неверный '
    'email/телефон или пароль». Его брони у заведений останутся как есть, '
    'новые он сделать не сможет.';

/// Ширина содержимого экрана, с которой поиск и колонка сжимаются — как у
/// «Отзывов» ([kReviewsNarrowWidth]).
const double kUsersNarrowWidth = kReviewsNarrowWidth;

/// Статус карточки заведения словами — в карточке партнёра.
String establishmentStatusWord(String status) => switch (status) {
      'active' => 'в каталоге',
      'pending' => 'на модерации',
      'suspended' => 'приостановлена',
      'draft' => 'черновик',
      'rejected' => 'отклонена',
      'archived' => 'в архиве',
      _ => 'статус не распознан',
    };

/// «Пользователи» — найти человека, заблокировать, разблокировать, сбросить
/// имя (проход тестировщика 17.10, п. 8; решение Координатора В9).
///
/// Раскладка отзывов: слева колонка 420 со строками, справа карточка.
class UsersScreen extends StatefulWidget {
  /// Человек, которого открыть сразу, — по ссылке из отзыва.
  final String? initialUserId;

  const UsersScreen({super.key, this.initialUserId});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  final _searchController = TextEditingController();
  late final AdminUsersProvider _provider;

  /// Сбой перечитки при данных на экране — тостом (пункт A2-07). Действие
  /// перечитывает и список, и карточку; сеть мигнула — и «Активен» с кнопкой
  /// «Заблокировать» оставались под подписью «Пользователь заблокирован».
  final _listFailure = AdminErrorToastReporter();
  final _detailFailure = AdminErrorToastReporter();

  @override
  void initState() {
    super.initState();
    _provider = context.read<AdminUsersProvider>();
    _provider.addListener(_onProviderChanged);
    // Поиск живёт в провайдере и после ухода с экрана — поле показывает его
    // (проход по панели 20.10, A2-18).
    _searchController.text = _provider.searchQuery;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _provider.loadUsers();
      _applyLink();
    });
  }

  /// Номер из адреса: открыть человека (только номер в формате сервера) или,
  /// если ссылки нет, убрать «не найден» от прошлой — провайдер живёт
  /// дольше экрана.
  void _applyLink() {
    final id = widget.initialUserId;
    if (id != null && id.isNotEmpty) {
      _provider.openUserFromLink(id);
    } else {
      _provider.forgetRejectedLink();
    }
  }

  @override
  void didUpdateWidget(UsersScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final id = widget.initialUserId;
    if (id != oldWidget.initialUserId) {
      // После кадра, как в initState: didUpdateWidget идёт внутри сборки, и
      // уведомление провайдера отсюда терялось — справа оставалось прежнее
      // («не найден» от прошлой ссылки поверх загруженного человека).
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && widget.initialUserId == id) _applyLink();
      });
    }
  }

  @override
  void dispose() {
    _provider.removeListener(_onProviderChanged);
    _listFailure.dispose();
    _detailFailure.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _onProviderChanged() {
    // Пустой список показывает сообщение в колонке, пустая карточка — своё.
    final listError =
        _provider.users.isEmpty ? null : _provider.listError;
    _listFailure.report(
      this,
      key: listError,
      title: 'Список не обновился',
      message: '${asSentence(listError ?? '')} '
          'Строки на экране остались от прошлой загрузки.',
      onRetry: () => _provider.loadUsers(page: _provider.currentPage),
    );

    final detailError =
        _provider.selectedUser == null ? null : _provider.detailError;
    _detailFailure.report(
      this,
      key: detailError,
      title: 'Карточка не обновилась',
      message: '${asSentence(detailError ?? '')} '
          'Карточка на экране может быть устаревшей.',
      onRetry: _provider.retryDetail,
    );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) =>
          _build(context, narrow: constraints.maxWidth < kUsersNarrowWidth),
    );
  }

  Widget _build(BuildContext context, {required bool narrow}) {
    final provider = context.watch<AdminUsersProvider>();
    // Просмотрщику сервер поиск людей не даёт (поиск по имени отвечал бы,
    // зарегистрирован ли человек), поэтому поле ему не показывается.
    final canSearch = context.watch<AuthProvider>().canModerate;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AdminScreenHeader(
          title: 'Пользователи',
          subtitle: provider.users.isEmpty
              ? null
              : countWithNoun(
                  provider.totalCount, 'человек', 'человека', 'человек'),
          busy: provider.isLoadingList && provider.users.isNotEmpty,
          actions: <Widget>[
            if (canSearch)
              _SearchField(
                controller: _searchController,
                width: narrow ? 150 : 300,
                isSearchMode: provider.searchQuery.isNotEmpty,
                onSubmit: provider.search,
                onClear: _clearSearch,
              ),
            // Подписаны: «Все» без подписи не говорило, все — кто (осмотр
            // панели 20.10, п. 35). «Удалённые» — отдельно от
            // «Заблокированных» (A2-05).
            AdminFilterDropdown<String>(
              key: const ValueKey<String>('users-status-filter'),
              label: 'Состояние',
              value: provider.statusFilter,
              emptyLabel: 'любое',
              options: const <AdminFilterOption<String>>[
                AdminFilterOption<String>(value: null, label: 'любое'),
                AdminFilterOption<String>(value: 'active', label: 'Активные'),
                AdminFilterOption<String>(
                    value: 'blocked', label: 'Заблокированные'),
                AdminFilterOption<String>(value: 'deleted', label: 'Удалённые'),
              ],
              onChanged: provider.setStatusFilter,
            ),
            AdminFilterDropdown<String>(
              key: const ValueKey<String>('users-role-filter'),
              label: 'Роль',
              value: provider.roleFilter,
              emptyLabel: 'любая',
              options: const <AdminFilterOption<String>>[
                AdminFilterOption<String>(value: null, label: 'любая'),
                AdminFilterOption<String>(value: 'user', label: 'Пользователи'),
                AdminFilterOption<String>(value: 'partner', label: 'Партнёры'),
                AdminFilterOption<String>(
                    value: 'panel', label: 'Учётные записи панели'),
              ],
              onChanged: provider.setRoleFilter,
            ),
          ],
        ),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _UserListColumn(
                width: narrow ? 340 : 420,
                onResetFilters: _resetFilters,
              ),
              const Expanded(child: _UserPanel()),
            ],
          ),
        ),
      ],
    );
  }

  void _clearSearch() {
    _searchController.clear();
    _provider.clearSearch();
  }

  void _resetFilters() {
    _searchController.clear();
    _provider.resetFilters();
  }
}

// =============================================================================
// Поиск
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
        key: const ValueKey<String>('users-search'),
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
          hint: 'Почта, телефон или имя',
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

class _UserListColumn extends StatelessWidget {
  /// 420 на широком окне, 340 — на узком (см. [kUsersNarrowWidth]).
  final double width;
  final VoidCallback onResetFilters;

  const _UserListColumn({required this.width, required this.onResetFilters});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AdminUsersProvider>();

    return Container(
      width: width,
      decoration: const BoxDecoration(
        border: Border(right: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const SizedBox(height: 12),
          Expanded(child: _body(context, provider)),
          if (provider.users.isNotEmpty)
            AdminPagination.narrow(
              page: provider.currentPage,
              totalPages: provider.totalPages,
              totalCount: provider.totalCount,
              perPage: AdminUsersProvider.perPage,
              shownOnPage: provider.users.length,
              onPageChanged: (page) =>
                  context.read<AdminUsersProvider>().loadUsers(page: page),
            ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, AdminUsersProvider provider) {
    if (provider.isLoadingList && provider.users.isEmpty) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2));
    }

    final message = provider.listError;
    if (message != null && provider.users.isEmpty) {
      return AdminColumnMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Список не загрузился',
        message: message,
        onAction: () => context.read<AdminUsersProvider>().loadUsers(),
      );
    }

    if (provider.users.isEmpty) {
      if (!provider.hasActiveFilters) {
        return const AdminColumnMessage(
          icon: Icons.people_outline,
          title: 'Пользователей пока нет',
          message: 'Здесь появятся все, кто зарегистрировался.',
        );
      }
      return AdminColumnMessage(
        icon: Icons.filter_alt_off_outlined,
        title: 'Никого не нашлось',
        message: provider.searchQuery.isNotEmpty
            ? 'По запросу «${provider.searchQuery}» никого нет.'
            : 'Под выбранный фильтр никто не подошёл.',
        actionLabel: 'Сбросить фильтры',
        onAction: onResetFilters,
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: provider.users.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final user = provider.users[index];
        return _UserRow(
          user: user,
          isSelected: provider.selectedId == user.id,
          onTap: () => context.read<AdminUsersProvider>().openUser(user.id),
        );
      },
    );
  }
}

class _UserRow extends StatelessWidget {
  final AdminUser user;
  final bool isSelected;
  final VoidCallback onTap;

  const _UserRow({
    required this.user,
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
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: isSelected
              ? AppTheme.canonSelectedCardDecoration()
              : BoxDecoration(
                  color: AppTheme.backgroundWarm,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  border: Border.all(color: Colors.transparent, width: 1.5),
                ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            spacing: 5,
            children: <Widget>[
              Row(
                spacing: 8,
                children: <Widget>[
                  Expanded(
                    child: Text(
                      displayUserName(user),
                      style: user.name?.trim().isNotEmpty == true
                          ? const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.textPrimary,
                            )
                          : const TextStyle(
                              fontSize: 14, color: AppTheme.textGrey),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (!user.isActive) _StateChip(user: user),
                ],
              ),
              Text(
                [
                  if (user.contact != null) user.contact!,
                  actorRoleLabel(user.role) ?? user.role,
                  countWithNoun(user.reviewCount, 'отзыв', 'отзыва', 'отзывов'),
                ].join(' · '),
                style: const TextStyle(
                    fontSize: 12, color: AppTheme.textSecondary),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Имя на экране: пустое у просмотрщика — «скрыто», а не «без имени».
String displayUserName(AdminUser user) {
  final name = user.name?.trim();
  if (name != null && name.isNotEmpty) return name;
  return user.viewerRedacted ? kRedactedForViewerLabel : 'Без имени';
}

/// Метка выключенной учётки: «заблокирован» или «учётка удалена» — разное:
/// удалённую не разблокируют (проход по панели 20.10, A2-05).
class _StateChip extends StatelessWidget {
  final AdminUser user;

  const _StateChip({required this.user});

  @override
  Widget build(BuildContext context) {
    final deleted = user.isDeleted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: deleted ? AppTheme.backgroundWarm : AppTheme.errorTint(0.10),
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Text(
        deleted ? 'учётная запись удалена' : 'заблокирован',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: deleted ? AppTheme.textSecondary : AppTheme.errorRed,
        ),
      ),
    );
  }
}

// =============================================================================
// Карточка человека
// =============================================================================

class _UserPanel extends StatelessWidget {
  const _UserPanel();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AdminUsersProvider>();
    final user = provider.selectedUser;

    if (user == null) {
      if (provider.isLoadingDetail) {
        return const Center(child: CircularProgressIndicator(strokeWidth: 2));
      }
      final error = provider.detailError;
      if (error != null) {
        return AdminColumnMessage(
          icon: Icons.cloud_off_outlined,
          title: 'Карточка не загрузилась',
          message: error,
          onAction: provider.retryDetail,
        );
      }
      if (provider.linkRejected) {
        return const AdminColumnMessage(
          key: ValueKey<String>('user-link-rejected'),
          icon: Icons.person_off_outlined,
          title: 'Пользователь не найден',
          message: 'В ссылке нет правильного номера человека. '
              'Найдите его поиском в списке слева.',
        );
      }
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Выберите человека слева',
            style: TextStyle(fontSize: 15, color: AppTheme.textSecondary),
          ),
        ),
      );
    }

    final canModerate = context.watch<AuthProvider>().canModerate;

    return Padding(
      padding: const EdgeInsets.all(24),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 18,
          children: <Widget>[
            _Heading(user: user),
            _Facts(user: user),
            if (user.blockEntries.isNotEmpty)
              _BlockHistory(entries: user.blockEntries)
            else if (user.isBlocked)
              const Text(
                'Записи о блокировке в журнале нет — её ставили до того, как '
                'панель и скрипт оператора начали её записывать.',
                key: ValueKey<String>('user-block-unrecorded'),
                style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
              ),
            if (canModerate) _Actions(provider: provider, user: user),
          ],
        ),
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  final AdminUser user;

  const _Heading({required this.user});

  @override
  Widget build(BuildContext context) {
    return Row(
      spacing: 10,
      children: <Widget>[
        Flexible(
          child: Text(
            displayUserName(user),
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: AppTheme.textPrimary,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (!user.isActive) _StateChip(user: user),
      ],
    );
  }
}

class _Facts extends StatelessWidget {
  final AdminUser user;

  const _Facts({required this.user});

  @override
  Widget build(BuildContext context) {
    final hidden = user.hiddenReviewCount;
    final reviews =
        countWithNoun(user.reviewCount, 'отзыв', 'отзыва', 'отзывов');

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: Wrap(
        spacing: 28,
        runSpacing: 14,
        children: <Widget>[
          _Fact(
            label: 'Почта или телефон',
            value: user.contact ??
                (user.viewerRedacted
                    ? kRedactedForViewerLabel
                    : user.isDeleted
                        ? 'стёрты при удалении учётной записи'
                        : 'не указаны'),
            muted: user.contact == null,
          ),
          _Fact(label: 'Роль', value: actorRoleLabel(user.role) ?? user.role),
          _Fact(
            label: 'Состояние',
            value: user.isDeleted
                ? 'Учётная запись удалена'
                : user.isActive
                    ? 'Активен'
                    : 'Заблокирован',
          ),
          _Fact(
            label: 'Отзывы',
            value: hidden == null
                ? (user.viewerRedacted ? '$reviews видно' : reviews)
                : hidden == 0
                    ? reviews
                    : '$reviews, из них скрыто ${formatCount(hidden)}',
          ),
          if (user.establishmentCount > 0)
            _Fact(
              label: 'Карточки заведений',
              value: user.liveEstablishmentCount == user.establishmentCount
                  ? formatCount(user.establishmentCount)
                  : '${formatCount(user.establishmentCount)}, в каталоге или '
                      'на модерации ${formatCount(user.liveEstablishmentCount)}',
            ),
          // Чьи это заведения — по названию (осмотр панели 20.10, п. 35).
          // Просмотрщику сервер списка не даёт.
          if (user.establishments?.isNotEmpty == true)
            _Fact(
              label: user.establishments!.length < user.establishmentCount
                  ? 'Заведения (первые ${user.establishments!.length})'
                  : 'Заведения',
              value: user.establishments!
                  .map((card) => [
                        card.name.trim().isEmpty ? 'Без названия' : card.name,
                        if (card.city?.trim().isNotEmpty == true) card.city!,
                        establishmentStatusWord(card.status),
                      ].join(' · '))
                  .join('\n'),
            ),
          if (user.createdAt != null)
            _Fact(
              label: 'Зарегистрирован',
              value: formatDateLocal(user.createdAt!),
            ),
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  final String label;
  final String value;
  final bool muted;

  const _Fact({required this.label, required this.value, this.muted = false});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(label, style: AppTheme.canonFieldLabel),
        const SizedBox(height: 4),
        Text(
          value,
          style: muted ? AppTheme.canonFieldValueEmpty : AppTheme.canonFieldValue,
        ),
      ],
    );
  }
}

/// Кто, когда и за что блокировал и разблокировал — новые сверху. После
/// разблокировки причина блокировки остаётся видна (проход по панели 20.10,
/// A2-15; осмотр п. 35).
class _BlockHistory extends StatelessWidget {
  final List<AdminUserBlockAction> entries;

  const _BlockHistory({required this.entries});

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey<String>('user-block-history'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: 8,
      children: <Widget>[
        Text(
          entries.length == 1 ? 'Блокировка' : 'История блокировок',
          style: AppTheme.canonFieldLabel,
        ),
        for (final entry in entries) _BlockEntry(action: entry),
      ],
    );
  }
}

class _BlockEntry extends StatelessWidget {
  final AdminUserBlockAction action;

  const _BlockEntry({required this.action});

  @override
  Widget build(BuildContext context) {
    final when = action.createdAt;
    final who = action.adminName?.trim();
    final head = [
      action.isBlock ? 'Заблокирован' : 'Разблокирован',
      if (when != null) '${formatDateLocal(when)}, ${formatTimeLocal(when)}',
      if (action.byOperator)
        'оператор скриптом'
      else if (who != null && who.isNotEmpty)
        who,
    ].join(' · ');
    final reason = action.reason?.trim();
    final hidden = action.hiddenReviews;
    final restored = action.restoredReviews;
    final count = action.isBlock
        ? (hidden == null || action.byOperator
            ? null
            : 'скрыто отзывов: ${formatCount(hidden)}')
        : (restored == null ? null : 'возвращено отзывов: ${formatCount(restored)}');

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: action.isBlock ? AppTheme.errorTint(0.06) : AppTheme.backgroundWarm,
        borderRadius: BorderRadius.circular(AppTheme.radiusControl),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 4,
        children: <Widget>[
          Text(head, style: AppTheme.canonFieldLabel),
          if (reason != null && reason.isNotEmpty)
            Text('Причина: $reason', style: AppTheme.canonFieldValue),
          if (count != null)
            Text(
              count,
              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
            ),
        ],
      ),
    );
  }
}

// =============================================================================
// Действия
// =============================================================================

/// Почему кнопка блокировки человеку не служит — те же доводы, что в отказе
/// сервера.
String protectionText(AdminUserProtection protection) => switch (protection) {
      AdminUserProtection.panelAccount =>
        'Это учётная запись панели. Её включает и отключает оператор, '
            'не эта кнопка.',
      AdminUserProtection.serviceAccount =>
        'Это служебная учётная запись платформы — ей принадлежат карточки '
            'каталога. '
            'Её не блокируют и не переименовывают.',
      AdminUserProtection.partnerWithEstablishments =>
        'У этого партнёра есть карточки заведений в каталоге или на '
            'модерации. Его блокировка решает и их судьбу — это отдельное '
            'решение, этой кнопкой его не заблокировать.',
    };

class _Actions extends StatelessWidget {
  final AdminUsersProvider provider;
  final AdminUser user;

  const _Actions({required this.provider, required this.user});

  @override
  Widget build(BuildContext context) {
    final protection = user.protection;
    final busy = provider.isSubmitting;
    final error = provider.submitError;
    final done = provider.lastResult;
    final isSelf = context.watch<AuthProvider>().currentUser?.id == user.id;
    final nameAlreadyReset = user.name == 'Пользователь';
    final hasReviews = user.reviewCount > 0;

    // Отзывы человека — на экране «Отзывы», где их можно отметить и скрыть
    // разом (проход по панели 20.10, A2-09).
    final reviewsLink = hasReviews
        ? TextButton.icon(
            key: const ValueKey<String>('user-author-reviews'),
            onPressed: () => context.go(authorReviewsLocation(user.id)),
            icon: const Icon(Icons.rate_review_outlined, size: 18),
            label: Text(
              'Отзывы автора (${formatCount(user.reviewCount)})',
            ),
          )
        : null;

    // Удалённая учётка — без кнопок: сервер всегда откажет (A2-05).
    if (user.isDeleted) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: 10,
        children: <Widget>[
          const Text(
            'Учётную запись удалил её владелец. Удалённую учётную запись не '
            'блокируют, не '
            'включают и не переименовывают: почта, телефон и имя стёрты, '
            'войти в неё нельзя.',
            key: ValueKey<String>('user-deleted-note'),
            style: TextStyle(
                fontSize: 13, height: 1.45, color: AppTheme.textSecondary),
          ),
          if (reviewsLink != null) reviewsLink,
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 10,
      children: <Widget>[
        if (protection != null)
          Text(
            protectionText(protection),
            key: const ValueKey<String>('user-protection'),
            style: const TextStyle(
                fontSize: 13, height: 1.45, color: AppTheme.textSecondary),
          ),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            if (protection == null && !isSelf)
              user.isActive
                  ? ElevatedButton.icon(
                      key: const ValueKey<String>('user-block'),
                      onPressed: busy
                          ? null
                          : () => _ask(context, _ReasonDialog.block,
                              (answer) => provider.block(answer.reason)),
                      style: AppTheme.canonCtaL(
                          backgroundColor: AppTheme.errorRed),
                      icon: const Icon(Icons.block, size: 19),
                      label: const Text('Заблокировать'),
                    )
                  : OutlinedButton.icon(
                      key: const ValueKey<String>('user-unblock'),
                      onPressed: busy
                          ? null
                          : () => _ask(
                              context,
                              _ReasonDialog.unblock,
                              (answer) => provider.unblock(
                                answer.reason,
                                restoreReviews: answer.restoreReviews,
                              ),
                            ),
                      style: AppTheme.canonCtaOutlined(),
                      icon: const Icon(Icons.lock_open, size: 19),
                      label: const Text('Разблокировать'),
                    ),
            if (user.canResetName && !isSelf)
              OutlinedButton.icon(
                key: const ValueKey<String>('user-reset-name'),
                onPressed: busy || nameAlreadyReset
                    ? null
                    : () => _ask(context, _ReasonDialog.resetName,
                        (answer) => provider.resetName(answer.reason)),
                style: AppTheme.canonCtaOutlined(),
                icon: const Icon(Icons.badge_outlined, size: 19),
                label: const Text('Сбросить имя'),
              ),
            if (reviewsLink != null) reviewsLink,
            if (busy)
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
        // Серая кнопка без слов не объясняет, почему нельзя (A2-17).
        if (user.canResetName && !isSelf && nameAlreadyReset)
          const Text(
            'Имя уже «Пользователь» — сбрасывать нечего.',
            key: ValueKey<String>('user-name-already-reset'),
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
        if (error != null)
          Text(
            error,
            key: const ValueKey<String>('user-action-error'),
            style: const TextStyle(fontSize: 13, color: AppTheme.errorRed),
          )
        else if (done != null)
          Text(
            done,
            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
      ],
    );
  }

  Future<void> _ask(
    BuildContext context,
    _ReasonDialog kind,
    Future<bool> Function(_ReasonAnswer answer) act,
  ) async {
    final answer = await showDialog<_ReasonAnswer>(
      context: context,
      builder: (_) => kind,
    );
    if (answer == null || answer.reason.isEmpty) return;
    await act(answer);
  }
}

/// Что модератор ответил в диалоге: причину и — у разблокировки — вернуть ли
/// отзывы.
class _ReasonAnswer {
  final String reason;
  final bool restoreReviews;

  const _ReasonAnswer(this.reason, {this.restoreReviews = true});
}

/// Диалог с обязательной причиной. Контроллер — у самого диалога: освобождать
/// его по закрытию future слишком рано (см. `_DeleteReviewDialog`).
class _ReasonDialog extends StatefulWidget {
  final String title;
  final String body;
  final String confirm;
  final bool destructive;

  /// Предложить «Вернуть отзывы, скрытые блокировкой» — у разблокировки.
  final bool offerRestore;

  const _ReasonDialog({
    required this.title,
    required this.body,
    required this.confirm,
    this.destructive = false,
    this.offerRestore = false,
  });

  static const _ReasonDialog block = _ReasonDialog(
    title: 'Заблокировать пользователя?',
    body: '$kBlockConsequences\n\n$kBlockWhatTheyNotice',
    confirm: 'Заблокировать',
    destructive: true,
  );

  /// Если блокировку ставил скрипт оператора, списка скрытых отзывов нет —
  /// и возвращать нечего; диалог говорит об этом заранее (A2-06).
  static const _ReasonDialog unblock = _ReasonDialog(
    title: 'Разблокировать пользователя?',
    body: 'Человек снова сможет войти. Отзывы, скрытые модератором по одному, '
        'останутся скрытыми в любом случае. Если блокировку ставил оператор '
        'скриптом, список скрытых отзывов не записан — они останутся как есть.',
    confirm: 'Разблокировать',
    offerRestore: true,
  );

  static const _ReasonDialog resetName = _ReasonDialog(
    title: 'Сбросить имя?',
    body: 'Имя станет «Пользователь» — и в профиле, и на всех прошлых отзывах. '
        'Потом человек сможет назвать себя заново.',
    confirm: 'Сбросить имя',
  );

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _controller = TextEditingController();

  /// Вернуть отзывы, скрытые блокировкой. По умолчанию — да: так задумана
  /// разблокировка; снять — если блокировали за сами отзывы, иначе вернётся
  /// и тот отзыв, из-за которого блокировали.
  bool _restore = true;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reason = _controller.text.trim();

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
              key: const ValueKey<String>('user-reason'),
              controller: _controller,
              autofocus: true,
              maxLength: 500,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Причина (обязательно)',
              ),
            ),
            if (widget.offerRestore)
              CheckboxListTile(
                key: const ValueKey<String>('user-restore-reviews'),
                value: _restore,
                onChanged: (value) => setState(() => _restore = value ?? true),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: const Text('Вернуть отзывы, скрытые блокировкой'),
                subtitle: const Text(
                  'Снимите, если блокировали за сами отзывы: тогда они '
                  'останутся скрытыми.',
                ),
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
          key: const ValueKey<String>('user-reason-confirm'),
          style: widget.destructive
              ? FilledButton.styleFrom(backgroundColor: AppTheme.errorRed)
              : null,
          // Без причины подтвердить нельзя: сервер всё равно откажет, а
          // кнопка, которая ничего не делает, читается как поломка.
          onPressed: reason.isEmpty
              ? null
              : () => Navigator.of(context)
                  .pop(_ReasonAnswer(reason, restoreReviews: _restore)),
          child: Text(widget.confirm),
        ),
      ],
    );
  }
}
