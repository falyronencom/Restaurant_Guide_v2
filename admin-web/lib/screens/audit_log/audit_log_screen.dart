import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/moderation_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_filter_dropdown.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_empty_state.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// «Журнал действий» — кадр 06, образец таблицы канона.
///
/// Таблица здесь не одна из многих, а эталон: шапка на бежевом, строка 52,
/// типы данных различаются шрифтом, а не цветом (id и время моноширинным и
/// приглушённым), разворот уходит в бежевую панель. Дальше по этому образцу
/// строятся остальные табличные экраны.
class AuditLogScreen extends StatefulWidget {
  const AuditLogScreen({super.key});

  @override
  State<AuditLogScreen> createState() => _AuditLogScreenState();
}

class _AuditLogScreenState extends State<AuditLogScreen> {
  late final AuditLogProvider _provider;

  /// Ошибка, о которой уже сказали тостом. Провайдер уведомляет много раз за
  /// одну неудачу, а тост должен появиться один.
  String? _reportedError;
  VoidCallback? _dismissToast;

  @override
  void initState() {
    super.initState();
    _provider = context.read<AuditLogProvider>();
    _provider.addListener(_onProviderChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _provider.loadEntries();
    });
  }

  @override
  void dispose() {
    _provider.removeListener(_onProviderChanged);
    _dismissToast?.call();
    super.dispose();
  }

  /// Неудача перелистывания не должна пропадать молча.
  ///
  /// Карточка ошибки занимает всю область и потому показывается, только когда
  /// показывать больше нечего. Если же строки на экране есть, а следующая
  /// страница не пришла, то без тоста модератор видит лишь то, что нажатие
  /// «ничего не сделало», — и заключает, что сломана кнопка.
  void _onProviderChanged() {
    final message = _provider.error;

    if (message == null) {
      _reportedError = null;
      return;
    }
    if (_provider.entries.isEmpty) return; // покажется карточка
    if (message == _reportedError) return;

    _reportedError = message;
    // Через кадр: уведомление может прийти в момент сборки, а вставлять
    // оверлей на этой фазе нельзя.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _dismissToast?.call();
      _dismissToast = showAdminErrorToast(
        context,
        title: 'Страница не загрузилась',
        message: '$message. Записи на экране остались от прошлой страницы.',
        onRetry: () => _provider.loadEntries(page: _provider.currentPage),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AuditLogProvider>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AdminScreenHeader(
          title: 'Журнал действий',
          subtitle: _subtitle(provider),
          // Перелистывание не подменяет таблицу скелетоном: записи остаются
          // читаемыми, о загрузке сообщает полоска по кромке шапки.
          busy: provider.isLoading && provider.entries.isNotEmpty,
          actions: <Widget>[
            PeriodSelector(
              currentPeriod: provider.period,
              onPeriodChanged: (selection) =>
                  context.read<AuditLogProvider>().setPeriod(
                        selection.period,
                        from: selection.from,
                        to: selection.to,
                      ),
            ),
          ],
        ),
        const _FilterBar(),
        Expanded(child: _Content(provider: provider)),
      ],
    );
  }

  /// «348 записей за 30 дней · последняя 4 минуты назад».
  ///
  /// Обе величины уже загружены: счётчик приходит в `meta`, а «последняя» —
  /// это верх первой страницы, потому что журнал отдаётся от новых к старым.
  /// Отдельного запроса ради подписи не нужно.
  String? _subtitle(AuditLogProvider provider) {
    // Подпись гаснет, только когда таблицы нет вовсе — на первой загрузке и
    // на ошибке, занявшей всю область.
    //
    // Снимать её на ЛЮБОЙ ошибке нельзя: неудача перелистывания оставляет
    // строки на экране, а шапка без подписи центрирует заголовок — и тот
    // прыгает по вертикали. Немотивированный сдвиг вёрстки читается как
    // поломка убедительнее, чем сама ошибка.
    if (provider.entries.isEmpty) return null;

    final count = countWithNoun(
      provider.totalCount,
      'запись',
      'записи',
      'записей',
    );
    final period = switch (provider.period) {
      '7d' => 'за 7 дней',
      '30d' => 'за 30 дней',
      '90d' => 'за 90 дней',
      _ => 'за выбранный период',
    };

    final latest = provider.latestAt;
    if (latest == null) return '$count $period';
    return '$count $period · последняя ${formatRelativePast(latest)}';
  }
}

// =============================================================================
// Полоса фильтров
// =============================================================================

class _FilterBar extends StatelessWidget {
  const _FilterBar();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AuditLogProvider>();
    final audit = context.read<AuditLogProvider>();

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 14, 24, 14),
      child: Row(
        spacing: 10,
        children: [
          AdminFilterDropdown<String>(
            label: 'Тип действия',
            value: provider.actionFilter,
            emptyLabel: 'Все',
            // Список строится из карты, а не выписывается здесь: выписанный
            // руками он уже отставал от журнала на шесть действий из
            // четырнадцати.
            options: <AdminFilterOption<String>>[
              const AdminFilterOption<String>(value: null, label: 'Все'),
              for (final entry in kAuditActions.entries)
                AdminFilterOption<String>(
                  value: entry.key,
                  label: entry.value,
                ),
            ],
            onChanged: audit.setActionFilter,
          ),
          AdminFilterDropdown<String>(
            label: 'Объект',
            value: provider.entityTypeFilter,
            emptyLabel: 'Все',
            options: <AdminFilterOption<String>>[
              const AdminFilterOption<String>(value: null, label: 'Все'),
              for (final entry in kAuditEntityTypes.entries)
                AdminFilterOption<String>(
                  value: entry.key,
                  label: entry.value,
                ),
            ],
            onChanged: audit.setEntityTypeFilter,
          ),
          if (provider.hasActiveFilters)
            TextButton.icon(
              onPressed: audit.clearFilters,
              icon: const Icon(Icons.close, size: 16),
              label: const Text('Сбросить'),
              style: TextButton.styleFrom(
                minimumSize: const Size(0, AdminFilterDropdown.height),
                padding: const EdgeInsets.symmetric(horizontal: 10),
              ),
            ),
        ],
      ),
    );
  }
}

// =============================================================================
// Тело: скелетон / ошибка / пусто / таблица
// =============================================================================

class _Content extends StatelessWidget {
  final AuditLogProvider provider;

  const _Content({required this.provider});

  @override
  Widget build(BuildContext context) {
    // Скелетон — только когда показывать нечего. На смене страницы и фильтра
    // прежние строки остаются до прихода новых.
    if (provider.isLoading && provider.entries.isEmpty) {
      return const _TableSkeleton();
    }

    final message = provider.error;
    if (message != null && provider.entries.isEmpty) {
      return AdminErrorCard(
        title: 'Журнал не загрузился',
        reason: message,
        message: 'Записи на сервере на месте — не удалось их получить. '
            'Повторите попытку; если не пройдёт и со второго раза, '
            'отправьте код разработчику.',
        technical: 'GET /api/v1/admin/audit-log',
        onRetry: () => context.read<AuditLogProvider>().loadEntries(),
      );
    }

    if (provider.entries.isEmpty) return _empty(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Padding(
          padding: _TableLayout.bodyPadding,
          child: _TableHeader(),
        ),
        Expanded(
          child: ListView.builder(
            padding: _TableLayout.bodyPadding,
            itemCount: provider.entries.length,
            itemBuilder: (context, index) {
              final entry = provider.entries[index];
              return _EntryRow(
                entry: entry,
                isExpanded: provider.expandedEntryId == entry.id,
              );
            },
          ),
        ),
        // Футер показывается и на единственной странице: «Показано 1–18 из
        // 18» отвечает на вопрос «это всё?».
        AdminPagination.wide(
          page: provider.currentPage,
          totalPages: provider.totalPages,
          totalCount: provider.totalCount,
          perPage: AuditLogProvider.perPage,
          shownOnPage: provider.entries.length,
          onPageChanged: (page) =>
              context.read<AuditLogProvider>().loadEntries(page: page),
        ),
      ],
    );
  }

  Widget _empty(BuildContext context) {
    if (!provider.hasActiveFilters) {
      return const AdminEmptyState.section(
        icon: Icons.history,
        title: 'Журнал пуст',
        status: 'записей нет',
        message: 'Сюда попадает каждое действие администратора над заведением, '
            'отзывом, позицией меню или учётной записью. Первая запись '
            'появится после первого такого действия.',
      );
    }

    final audit = context.read<AuditLogProvider>();
    return AdminEmptyState.filtered(
      title: 'Под фильтр ничего не подошло',
      status: 'записей в выборке нет',
      rows: <EmptyStateRow>[
        if (provider.actionFilter != null)
          EmptyStateRow(
            icon: Icons.bolt_outlined,
            text: 'Тип действия: '
                '${kAuditActions[provider.actionFilter] ?? provider.actionFilter!}',
            onRemove: () => audit.setActionFilter(null),
          ),
        if (provider.entityTypeFilter != null)
          EmptyStateRow(
            icon: Icons.category_outlined,
            text: 'Объект: ${auditEntityLabel(provider.entityTypeFilter!)}',
            onRemove: () => audit.setEntityTypeFilter(null),
          ),
        if (provider.period != AuditLogProvider.defaultPeriod)
          EmptyStateRow(
            icon: Icons.schedule,
            text: 'Период: ${_periodRowLabel(provider.period)}',
            onRemove: () => audit.setPeriod(AuditLogProvider.defaultPeriod),
          ),
      ],
      onReset: audit.clearFilters,
      resetHint: 'Вернёт журнал к последним 30 дням без отбора.',
    );
  }

  static String _periodRowLabel(String period) => switch (period) {
        '7d' => '7 дней',
        '30d' => '30 дней',
        '90d' => '90 дней',
        _ => 'выбранный диапазон',
      };
}

// =============================================================================
// Раскладка таблицы
// =============================================================================

/// Ширины колонок кадра 06: `168px 467px 260px 200px 36px` при внутренней
/// ширине 1132.
///
/// Дата, администратор и шеврон закреплены в пикселях: их содержимое не
/// растёт от ширины окна, и «плавающая» дата на широком экране разъезжается с
/// соседней строкой. Действие и объект тянутся в исходной пропорции 467:260 —
/// именно они переполняются длинными названиями.
abstract final class _TableLayout {
  static const double dateWidth = 168;
  static const int actionFlex = 467;
  static const int objectFlex = 260;
  static const double adminWidth = 200;
  static const double chevronWidth = 36;

  static const double headerHeight = 40;
  static const double rowHeight = 52;

  static const EdgeInsets bodyPadding = EdgeInsets.symmetric(horizontal: 24);
  static const EdgeInsets cellPadding = EdgeInsets.symmetric(horizontal: 14);

  static Widget row({
    required Widget date,
    required Widget action,
    required Widget object,
    required Widget admin,
    required Widget trailing,
  }) {
    return Row(
      children: <Widget>[
        SizedBox(width: dateWidth, child: _cell(date)),
        Expanded(flex: actionFlex, child: _cell(action)),
        Expanded(flex: objectFlex, child: _cell(object)),
        SizedBox(width: adminWidth, child: _cell(admin)),
        SizedBox(width: chevronWidth, child: trailing),
      ],
    );
  }

  static Widget _cell(Widget child) =>
      Padding(padding: cellPadding, child: child);
}

class _TableHeader extends StatelessWidget {
  const _TableHeader();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: _TableLayout.headerHeight,
      decoration: BoxDecoration(
        color: AppTheme.backgroundWarm,
        borderRadius: BorderRadius.circular(AppTheme.radiusControl),
      ),
      child: _TableLayout.row(
        date: const _HeaderCell('Дата и время'),
        action: const _HeaderCell('Действие'),
        object: const _HeaderCell('Объект'),
        admin: const _HeaderCell('Администратор'),
        trailing: const SizedBox.shrink(),
      ),
    );
  }
}

class _HeaderCell extends StatelessWidget {
  final String text;

  const _HeaderCell(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: AppTheme.canonTableHeader,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }
}

// =============================================================================
// Строка журнала
// =============================================================================

class _EntryRow extends StatelessWidget {
  final AuditLogEntry entry;
  final bool isExpanded;

  const _EntryRow({required this.entry, required this.isExpanded});

  @override
  Widget build(BuildContext context) {
    final tone = auditActionTone(entry.action);
    final accent = _toneColor(tone);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Material(
          color: Colors.transparent,
          child: InkWell(
            // Нажимается вся строка, а не один шеврон: попасть в цель 36px
            // ради «посмотреть подробности» — работа, которой можно не быть.
            // Шеврон остаётся указателем на то, что подробности есть.
            onTap: () =>
                context.read<AuditLogProvider>().toggleExpanded(entry.id),
            child: Container(
              height: _TableLayout.rowHeight,
              decoration: BoxDecoration(
                color: isExpanded ? AppTheme.brandTint(0.04) : null,
                // У раскрытой строки нижней границы нет: под ней сразу панель,
                // и линия отрезала бы её от собственной строки.
                border: isExpanded
                    ? null
                    : const Border(
                        bottom: BorderSide(color: AppTheme.borderLight),
                      ),
              ),
              child: _TableLayout.row(
                date: _DateCell(createdAt: entry.createdAt),
                action: _ActionCell(summary: entry.summary, dotColor: accent),
                object: _ObjectCell(entry: entry),
                admin: _AdminCell(entry: entry),
                trailing: Center(
                  child: Icon(
                    isExpanded ? Icons.expand_less : Icons.expand_more,
                    size: 18,
                    color: isExpanded
                        ? AppTheme.primaryOrangeDark
                        : AppTheme.textGrey,
                  ),
                ),
              ),
            ),
          ),
        ),
        if (isExpanded) _EntryDetails(entry: entry, accent: accent),
      ],
    );
  }
}

/// Цвет точки действия. Шкала — направление ограничения, см. [AuditActionTone].
Color _toneColor(AuditActionTone tone) => switch (tone) {
      AuditActionTone.allowing => AppTheme.statusGreen,
      AuditActionTone.restricting => AppTheme.errorRed,
      AuditActionTone.neutral => AppTheme.textSecondary,
    };

class _DateCell extends StatelessWidget {
  final DateTime createdAt;

  const _DateCell({required this.createdAt});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      spacing: 7,
      children: <Widget>[
        Flexible(
          child: Text(
            formatDayMonthLocal(createdAt),
            style: const TextStyle(fontSize: 13, color: AppTheme.textDark),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        // Время — величина табличная, а не текст: моноширинным оно встаёт в
        // колонку по разрядам и читается сверху вниз одним движением.
        Text(
          formatTimeLocal(createdAt),
          style: AppTheme.mono(fontSize: 12, color: AppTheme.textGrey),
        ),
      ],
    );
  }
}

class _ActionCell extends StatelessWidget {
  final String summary;
  final Color dotColor;

  const _ActionCell({required this.summary, required this.dotColor});

  @override
  Widget build(BuildContext context) {
    return Row(
      spacing: 9,
      children: <Widget>[
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
        ),
        Expanded(
          child: Text(
            summary,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppTheme.textPrimary,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

/// Колонка «Объект»: над чем совершено действие.
///
/// Раньше здесь стоял машинный тип (`establishment`) и обрезанный
/// идентификатор — для модератора это нечитаемо. Имя при этом **уже
/// приходило** в `entity_context` и просто отбрасывалось.
///
/// Тип отдельной строкой не пишется: соседняя колонка уже назвала его словом
/// («Скрыт отзыв», «Скрыта позиция меню»), и повтор занял бы место, которого
/// в строке 52px нет.
class _ObjectCell extends StatelessWidget {
  final AuditLogEntry entry;

  const _ObjectCell({required this.entry});

  @override
  Widget build(BuildContext context) {
    final ctx = entry.entityContext;
    // У отзыва берём автора, а не заведение: моноширинный идентификатор рядом
    // с заголовком — это идентификатор ОТЗЫВА, и имя заведения над ним
    // подталкивало бы скопировать одно, думая про другое. Заведение при этом
    // не теряется — оно в раскрытой строке.
    final name = ctx?['reviewer_name'] ?? ctx?['name'];
    // Обрезается то же значение, что и проверяется: иначе ведущие пробелы из
    // `entity_context` доехали бы до вёрстки и сдвинули колонку.
    final title = name is String && name.trim().isNotEmpty
        ? name.trim()
        : auditEntityLabel(entry.entityType);
    final id = entry.entityId;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      spacing: 7,
      children: <Widget>[
        Flexible(
          child: Text(
            title,
            style: const TextStyle(fontSize: 13, color: AppTheme.textDark),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (id != null)
          Text(
            shortEntityId(id),
            style: AppTheme.mono(fontSize: 11, color: AppTheme.textGrey),
          ),
      ],
    );
  }
}

/// Первые восемь знаков UUID — столько же, сколько показывает `git` у хеша.
/// Идентификатор остаётся на экране, но перестаёт притворяться названием.
String shortEntityId(String id) => id.length <= 8 ? id : id.substring(0, 8);

class _AdminCell extends StatelessWidget {
  final AuditLogEntry entry;

  const _AdminCell({required this.entry});

  @override
  Widget build(BuildContext context) {
    final name = entry.adminName ?? entry.adminEmail;
    // Свои действия помечены брендовым кружком, чужие — серым. Журнал ведут
    // несколько человек, и первый вопрос к незнакомой записи — «это не я ли».
    final currentEmail =
        context.select<AuthProvider, String?>((auth) => auth.currentUser?.email);
    final isSelf = currentEmail != null &&
        entry.adminEmail != null &&
        entry.adminEmail!.toLowerCase() == currentEmail.toLowerCase();

    return Row(
      spacing: 8,
      children: <Widget>[
        Container(
          width: 22,
          height: 22,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isSelf ? AppTheme.primaryOrangeDark : AppTheme.gray500,
            shape: BoxShape.circle,
          ),
          child: Text(
            _initial(name),
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: AppTheme.textOnPrimary,
            ),
          ),
        ),
        Expanded(
          child: Text(
            name ?? 'не указан',
            style: TextStyle(
              fontSize: 13,
              color: name == null ? AppTheme.textGrey : AppTheme.textDark,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  static String _initial(String? name) {
    final trimmed = name?.trim() ?? '';
    return trimmed.isEmpty ? '?' : trimmed.characters.first.toUpperCase();
  }
}

// =============================================================================
// Раскрытая строка
// =============================================================================

/// Подробности записи: слева — над чем действовали, справа — что изменилось.
class _EntryDetails extends StatelessWidget {
  final AuditLogEntry entry;
  final Color accent;

  const _EntryDetails({required this.entry, required this.accent});

  @override
  Widget build(BuildContext context) {
    final contextRows = _contextRows(entry);
    final hasChange = entry.oldData != null || entry.newData != null;

    final columns = <Widget>[
      if (contextRows.isNotEmpty)
        _DetailColumn(
          title: 'Контекст записи',
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppTheme.backgroundPrimary,
              borderRadius: BorderRadius.circular(AppTheme.radiusControl),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              spacing: 8,
              children: contextRows,
            ),
          ),
        ),
      if (hasChange)
        _DetailColumn(
          title: 'Изменение',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            spacing: 8,
            children: <Widget>[
              if (entry.oldData != null)
                _ChangeBlock(
                  label: 'до',
                  data: entry.oldData!,
                  // Прошлое состояние нейтрально: это уже история, и красить
                  // её в цвет действия значило бы обвинять сами данные.
                  accent: AppTheme.textGrey,
                ),
              if (entry.newData != null)
                _ChangeBlock(
                  label: 'после',
                  data: entry.newData!,
                  // Результат берёт цвет действия. Постоянный красный, как в
                  // единственном примере кадра, у одобрения читался бы как
                  // ошибка — а кадр рисует именно скрытие отзыва.
                  accent: accent,
                ),
            ],
          ),
        ),
    ];

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonPanelDecoration(radius: AppTheme.radiusMedium),
      child: columns.isEmpty
          ? const Text(
              'Подробностей у этой записи нет',
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            )
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 18,
              children: <Widget>[
                for (final column in columns) Expanded(child: column),
              ],
            ),
    );
  }

  /// Строки контекста. Состав задаёт бэкенд: у отзыва он присылает автора,
  /// оценку, заведение и начало текста, у заведения — имя и город, у прочих
  /// типов не присылает ничего.
  static List<Widget> _contextRows(AuditLogEntry entry) {
    final ctx = entry.entityContext;
    if (ctx == null) return const <Widget>[];

    final rows = <Widget>[];

    if (entry.entityType == 'review') {
      final reviewer = ctx['reviewer_name'];
      if (reviewer is String && reviewer.trim().isNotEmpty) {
        rows.add(_ContextRow(label: 'Автор', value: Text(reviewer, style: _valueStyle)));
      }

      final rating = ctx['rating'];
      if (rating is num) {
        rows.add(_ContextRow(label: 'Оценка', value: _Rating(rating.toInt())));
      }

      final place = _joinPlace(ctx['establishment_name'], ctx['establishment_city']);
      if (place != null) {
        rows.add(_ContextRow(label: 'Заведение', value: Text(place, style: _valueStyle)));
      }

      final snippet = ctx['text_snippet'];
      if (snippet is String && snippet.trim().isNotEmpty) {
        rows.add(
          _ContextRow(
            label: 'Отзыв',
            // Бэкенд режет текст по 120 знаков и признака обрезки не даёт,
            // поэтому отзыв ровно в 120 знаков от обрезанного не отличить.
            // Многоточие ставится в обоих случаях — ошибиться в сторону
            // «дальше может быть ещё» безопаснее, чем выдать обрывок за
            // полный текст.
            value: Text(
              snippet.length >= 120 ? '$snippet…' : snippet,
              style: const TextStyle(
                fontSize: 13,
                height: 1.5,
                color: AppTheme.textDark,
              ),
            ),
          ),
        );
      }
    } else if (entry.entityType == 'establishment') {
      final place = _joinPlace(ctx['name'], ctx['city']);
      if (place != null) {
        rows.add(_ContextRow(label: 'Заведение', value: Text(place, style: _valueStyle)));
      }
    }

    return rows;
  }

  static String? _joinPlace(Object? name, Object? city) {
    if (name is! String || name.trim().isEmpty) return null;
    final place = name.trim();
    return city is String && city.trim().isNotEmpty
        ? '$place, ${city.trim()}'
        : place;
  }

  static const TextStyle _valueStyle = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w600,
    color: AppTheme.textPrimary,
  );
}

class _DetailColumn extends StatelessWidget {
  final String title;
  final Widget child;

  const _DetailColumn({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(title.toUpperCase(), style: AppTheme.canonTableHeader),
        const SizedBox(height: 10),
        child,
      ],
    );
  }
}

class _ContextRow extends StatelessWidget {
  final String label;
  final Widget value;

  const _ContextRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 10,
      children: <Widget>[
        SizedBox(
          width: 88,
          child: Text(label, style: AppTheme.canonFieldLabel),
        ),
        Expanded(child: value),
      ],
    );
  }
}

class _Rating extends StatelessWidget {
  final int value;

  const _Rating(this.value);

  @override
  Widget build(BuildContext context) {
    return Row(
      spacing: 6,
      children: <Widget>[
        Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            for (var i = 1; i <= 5; i++)
              Icon(
                Icons.star,
                size: 15,
                color: i <= value ? AppTheme.primaryOrange : AppTheme.strokeGrey,
              ),
          ],
        ),
        Text('$value / 5', style: _EntryDetails._valueStyle),
      ],
    );
  }
}

/// Состояние «до» или «после»: полоса цвета слева и содержимое моноширинным.
class _ChangeBlock extends StatelessWidget {
  final String label;
  final Map<String, dynamic> data;
  final Color accent;

  const _ChangeBlock({
    required this.label,
    required this.data,
    required this.accent,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.backgroundPrimary,
        borderRadius: const BorderRadius.horizontal(
          right: Radius.circular(AppTheme.radiusControl),
        ),
        border: Border(left: BorderSide(color: accent, width: 2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 5),
          SelectableText(
            const JsonEncoder.withIndent('  ').convert(data),
            style: AppTheme.mono(
              fontSize: 12,
              height: 1.55,
              color: AppTheme.textDark,
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Скелетон
// =============================================================================

/// Скелетон повторяет раскладку таблицы: шапка на месте, строки той же высоты.
class _TableSkeleton extends StatelessWidget {
  const _TableSkeleton();

  static const int _rows = 8;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: _TableLayout.bodyPadding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const _TableHeader(),
          // Строки — списком, как и настоящие: в невысоком окне колонка из
          // восьми блоков фиксированной высоты вылезла бы за низ полосатой
          // жёлто-чёрной лентой.
          Expanded(
            child: ListView.builder(
              padding: EdgeInsets.zero,
              itemCount: _rows,
              itemBuilder: (_, __) => SizedBox(
                height: _TableLayout.rowHeight,
                child: _TableLayout.row(
                  date: const SkeletonBlock.line(widthFactor: 0.74),
                  action: const SkeletonBlock.line(
                    widthFactor: 0.44,
                    shade: SkeletonShade.strong,
                  ),
                  object: const SkeletonBlock.line(widthFactor: 0.62),
                  admin: const SkeletonBlock.line(
                    widthFactor: 0.58,
                    shade: SkeletonShade.weak,
                  ),
                  trailing: const SizedBox.shrink(),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
