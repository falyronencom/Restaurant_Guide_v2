import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_catalog_list.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

/// Экран «Приостановленные» — заведения, временно снятые с публикации.
class SuspendedScreen extends StatefulWidget {
  const SuspendedScreen({super.key});

  @override
  State<SuspendedScreen> createState() => _SuspendedScreenState();
}

class _SuspendedScreenState extends State<SuspendedScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SuspendedProvider>().loadSuspendedEstablishments();
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<SuspendedProvider>();

    return Column(
      children: [
        AdminScreenHeader(
          title: 'Приостановленные',
          subtitle: _subtitle(provider),
          busy: provider.isLoadingList && provider.establishments.isNotEmpty,
        ),
        Expanded(
          child: Row(
            children: [
              ModerationCatalogList(
                sectionTitle: 'Приостановлены',
                // `ORDER BY e.updated_at DESC` на бэкенде, параметра порядка
                // нет — подпись без меню.
                sortCaption: 'сначала новые',
                itemCount: provider.establishments.length,
                itemBuilder: (context, index) =>
                    _card(context, provider, provider.establishments[index]),
                isLoading: provider.isLoadingList,
                error: provider.listError,
                onRetry: () => context
                    .read<SuspendedProvider>()
                    .loadSuspendedEstablishments(),
                emptyTitle: 'Приостановленных нет',
                emptyMessage: 'Все заведения каталога опубликованы — снимать '
                    'с показа никого не потребовалось.',
                page: provider.currentPage,
                totalPages: provider.totalPages,
                totalCount: provider.totalCount,
                perPage: SuspendedProvider.perPage,
                onPageChanged: (page) => context
                    .read<SuspendedProvider>()
                    .loadSuspendedEstablishments(page: page),
              ),
              const Expanded(child: _DetailPanel()),
            ],
          ),
        ),
      ],
    );
  }

  String? _subtitle(SuspendedProvider provider) {
    if (provider.listError != null) return null;
    // Гасим подпись только на первой загрузке. На перелистывании данные
    // остаются на экране, и заголовок не должен мигать вместе с ними.
    if (provider.isLoadingList && provider.totalCount == 0) return null;

    final total = provider.totalCount;
    if (total == 0) return 'Приостановленных нет';

    return '${countWithNoun(total, 'заведение снято', 'заведения сняты', 'заведений снято')} с показа';
  }

  Widget _card(
    BuildContext context,
    SuspendedProvider provider,
    SuspendedEstablishmentItem item,
  ) {
    return ModerationCatalogCard(
      name: item.name,
      date: item.suspendedAt ?? item.updatedAt,
      subtitle: _typeAndCity(item),
      thumbnailUrl: item.thumbnailUrl,
      categories: item.categories,
      cuisines: item.cuisines,
      isSelected: provider.selectedId == item.id,
      onTap: () =>
          context.read<SuspendedProvider>().selectEstablishment(item.id),
      // Нижняя строка — причина приостановки. Точка статуса здесь была бы
      // пустой работой: на этом экране все записи в одном статусе, и
      // повторять его на каждой карточке нечего.
      //
      // Кадр 13 при сборке этой строки прочитать не удалось (часть макета
      // 13–18 в проекте Design, локальной копии нет). Оформление взято по
      // канону приостановки — disclaimer-пара, та же, что кадр 13 задаёт
      // для блока причины в панели. Сверить при разборе кадра 13.
      footer: _SuspendReason(reason: item.suspendReason),
    );
  }

  static String? _typeAndCity(SuspendedEstablishmentItem item) {
    final parts = <String>[
      if (item.categories.isNotEmpty) item.categories.first.toLowerCase(),
      if (item.city != null) item.city!,
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

class _SuspendReason extends StatelessWidget {
  final String? reason;

  const _SuspendReason({required this.reason});

  @override
  Widget build(BuildContext context) {
    final text = reason?.trim();
    final hasReason = text != null && text.isNotEmpty;

    return Row(
      children: [
        Icon(
          Icons.pause_circle_outline,
          size: 12,
          color: hasReason ? AppTheme.disclaimerText : AppTheme.textGrey,
        ),
        const SizedBox(width: 5),
        Expanded(
          child: Text(
            hasReason ? text : 'причина не указана',
            style: TextStyle(
              fontSize: 12,
              color: hasReason ? AppTheme.disclaimerText : AppTheme.textGrey,
              fontStyle: hasReason ? FontStyle.normal : FontStyle.italic,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _DetailPanel extends StatelessWidget {
  const _DetailPanel();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<SuspendedProvider>();
    // Счётчики очередей берём ДО асинхронного действия: обращаться к
    // context после await нельзя.
    final badges = context.read<BadgesProvider>();

    return ModerationDetailPanel(
      mode: DetailPanelMode.suspended,
      detail: provider.selectedDetail,
      isLoadingDetail: provider.isLoadingDetail,
      detailError: provider.detailError,
      selectedId: provider.selectedId,
      onUnsuspend: () => provider
          .unsuspendEstablishment()
          .then((ok) => ok ? badges.load() : null),
    );
  }
}
