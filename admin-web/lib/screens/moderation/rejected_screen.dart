import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_catalog_list.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

/// Экран «Отказанные» — история отказов из журнала аудита.
///
/// Список приходит не из таблицы заведений, а из `audit_log`, но запросом
/// `SELECT DISTINCT ON (e.id)` с условием `AND e.status = 'rejected'`
/// (`backend/src/models/auditLogModel.js`). Отсюда два следствия, которые
/// легко прочесть неверно:
///
/// - в списке одна строка на заведение, а не на каждый отказ, поэтому
///   `totalCount` — это число заведений, а не число отказов;
/// - `currentStatus` у всех строк один и тот же, `rejected`: заведения,
///   вернувшиеся в черновик, из выборки уже выпали. Показывать этот статус
///   на карточках нечего — он не различает записи, а только повторяется.
class RejectedScreen extends StatefulWidget {
  const RejectedScreen({super.key});

  @override
  State<RejectedScreen> createState() => _RejectedScreenState();
}

class _RejectedScreenState extends State<RejectedScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<RejectedProvider>().loadRejectedEstablishments();
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<RejectedProvider>();

    return Column(
      children: [
        AdminScreenHeader(
          title: 'Отказанные',
          subtitle: _subtitle(provider),
          busy: provider.isLoadingList && provider.rejections.isNotEmpty,
        ),
        Expanded(
          child: Row(
            children: [
              ModerationCatalogList(
                sectionTitle: 'История отказов',
                // Порядок один и задан на бэкенде (`ORDER BY rejection_date
                // DESC`), поэтому подпись остаётся подписью.
                sortCaption: 'по дате отказа',
                itemCount: provider.rejections.length,
                itemBuilder: (context, index) =>
                    _card(context, provider, provider.rejections[index]),
                isLoading: provider.isLoadingList,
                error: provider.listError,
                onRetry: () => context
                    .read<RejectedProvider>()
                    .loadRejectedEstablishments(),
                emptyTitle: 'Отказов не было',
                emptyMessage: 'Ни одна заявка ещё не отклонялась — история '
                    'пуста, и это хорошая новость.',
                page: provider.currentPage,
                totalPages: provider.totalPages,
                totalCount: provider.totalCount,
                perPage: RejectedProvider.perPage,
                onPageChanged: (page) => context
                    .read<RejectedProvider>()
                    .loadRejectedEstablishments(page: page),
              ),
              const Expanded(child: _DetailPanel()),
            ],
          ),
        ),
      ],
    );
  }

  /// «18 заведений с отказом · последний 09.08.2026».
  ///
  /// Не «18 отказов»: запрос отдаёт по одной строке на заведение
  /// (`DISTINCT ON (e.id)`), и повторные отказы одного и того же заведения в
  /// это число не входят. Макет обещал вторую величину «12 заявок вернулись в
  /// черновики», но она непредставима: вернувшиеся в черновик из выборки
  /// выпадают по условию `e.status = 'rejected'`, и счётчик всегда был бы
  /// нулём. Вместо выдуманного числа — дата последнего отказа: список
  /// отсортирован по ней, и она отвечает «насколько это свежее».
  String? _subtitle(RejectedProvider provider) {
    if (provider.listError != null) return null;
    if (provider.isLoadingList && provider.totalCount == 0) return null;

    final total = provider.totalCount;
    if (total == 0) return 'История пуста';

    final head = countWithNoun(
      total,
      'заведение с отказом',
      'заведения с отказом',
      'заведений с отказом',
    );

    final latest = provider.rejections.isEmpty
        ? null
        : provider.rejections.first.rejectionDate;
    if (latest == null || provider.currentPage != 1) return head;

    return '$head · последний ${_formatDate(latest)}';
  }

  static String _formatDate(DateTime value) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(value.day)}.${two(value.month)}.${value.year}';
  }

  Widget _card(
    BuildContext context,
    RejectedProvider provider,
    RejectedEstablishmentItem item,
  ) {
    // Считаем так же, как панель разбора: заполненные причины. Иначе
    // карточка обещала бы «3 причины», а в панели их оказалось бы две.
    final reasons = item.rejectionNotes?.values
            .where((value) => value != null && value.toString().trim().isNotEmpty)
            .length ??
        0;

    return ModerationCatalogCard(
      name: item.name,
      date: item.rejectionDate,
      subtitle: _typeAndCity(item),
      thumbnailUrl: item.thumbnailUrl,
      categories: item.categories,
      cuisines: item.cuisines,
      isSelected: provider.selectedId == item.establishmentId,
      onTap: () =>
          context.read<RejectedProvider>().selectEstablishment(item),
      footer: reasons == 0
          ? null
          : Text(
              countWithNoun(reasons, 'причина', 'причины', 'причин'),
              style: const TextStyle(
                fontSize: 12,
                color: AppTheme.textTertiary,
              ),
            ),
    );
  }

  static String? _typeAndCity(RejectedEstablishmentItem item) {
    final parts = <String>[
      if (item.categories.isNotEmpty) item.categories.first.toLowerCase(),
      if (item.city != null) item.city!,
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

class _DetailPanel extends StatelessWidget {
  const _DetailPanel();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<RejectedProvider>();

    // Get rejection notes from the selected rejection item
    final rejectionNotes = provider.selectedRejection?.rejectionNotes;

    return ModerationDetailPanel(
      mode: DetailPanelMode.readonly,
      detail: provider.selectedDetail,
      isLoadingDetail: provider.isLoadingDetail,
      detailError: provider.detailError,
      selectedId: provider.selectedId,
      rejectionNotes: rejectionNotes,
    );
  }
}
