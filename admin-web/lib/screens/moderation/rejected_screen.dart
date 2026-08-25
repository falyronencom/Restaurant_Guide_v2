import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_catalog_list.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/status_dot.dart';

/// Экран «Отказанные» — история отказов из журнала аудита.
///
/// Список приходит не из таблицы заведений, а из `audit_log`: одно заведение
/// может быть отклонено несколько раз, и запись здесь — это отказ, а не
/// заведение. Поэтому у карточки два разных состояния: дата отказа и
/// **текущий** статус заведения, который к моменту просмотра обычно уже
/// «черновик» — партнёр забрал заявку на доработку.
class RejectedScreen extends StatefulWidget {
  const RejectedScreen({super.key});

  @override
  State<RejectedScreen> createState() => _RejectedScreenState();
}

class _RejectedScreenState extends State<RejectedScreen> {
  static const int _perPage = 20;

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
                perPage: _perPage,
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

  /// «18 отказов из журнала аудита · 12 заявок вернулись в черновики».
  String? _subtitle(RejectedProvider provider) {
    if (provider.isLoadingList || provider.listError != null) return null;

    final total = provider.totalCount;
    if (total == 0) return 'История пуста';

    final head =
        '${countWithNoun(total, 'отказ', 'отказа', 'отказов')} из журнала аудита';

    // Вторая величина считается по загруженным записям, поэтому называется
    // только когда загружена вся история. Иначе получилось бы «12 из 18»,
    // выданное за «12 из всех», — а это уже неправда.
    if (provider.rejections.length < total) return head;

    final drafts = provider.rejections
        .where((item) => item.currentStatus == 'draft')
        .length;
    if (drafts == 0) return head;

    return '$head · ${countWithNoun(drafts, 'заявка вернулась', 'заявки вернулись', 'заявок вернулись')} в черновики';
  }

  Widget _card(
    BuildContext context,
    RejectedProvider provider,
    RejectedEstablishmentItem item,
  ) {
    final reasons = item.rejectionNotes?.length ?? 0;

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
      footer: Row(
        children: [
          if (reasons > 0)
            Text(
              countWithNoun(reasons, 'причина', 'причины', 'причин'),
              style: const TextStyle(
                fontSize: 12,
                color: AppTheme.textTertiary,
              ),
            ),
          const Spacer(),
          StatusDot.labelled(item.currentStatus),
        ],
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
