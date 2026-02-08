import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_field_review.dart';

/// Right panel: tabbed detail view for reviewing a single establishment.
///
/// Four tabs: Данные, О заведении, Медиа, Адрес.
/// Approve/Reject buttons at the bottom.
class ModerationDetailPanel extends StatefulWidget {
  const ModerationDetailPanel({super.key});

  @override
  State<ModerationDetailPanel> createState() => _ModerationDetailPanelState();
}

class _ModerationDetailPanelState extends State<ModerationDetailPanel>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ModerationProvider>();

    if (provider.selectedId == null) {
      return const Center(
        child: Text(
          'Выберите заведение для просмотра',
          style: TextStyle(fontSize: 16, color: Colors.grey),
        ),
      );
    }

    if (provider.isLoadingDetail) {
      return const Center(child: CircularProgressIndicator());
    }

    if (provider.detailError != null) {
      return Center(
        child: Text(
          provider.detailError!,
          style: const TextStyle(color: Colors.red),
        ),
      );
    }

    final detail = provider.selectedDetail;
    if (detail == null) return const SizedBox.shrink();

    return Column(
      children: [
        // Tab bar
        TabBar(
          controller: _tabController,
          labelColor: const Color(0xFFF06B32),
          unselectedLabelColor: Colors.black,
          labelStyle: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w500,
          ),
          unselectedLabelStyle: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w400,
          ),
          indicatorColor: const Color(0xFFF06B32),
          tabs: const [
            Tab(text: 'Данные'),
            Tab(text: 'О заведении'),
            Tab(text: 'Медиа'),
            Tab(text: 'Адрес'),
          ],
        ),
        const Divider(height: 1, color: Color(0xFFD2D2D2)),

        // Tab content
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _DataTab(detail: detail),
              _AboutTab(detail: detail),
              _MediaTab(detail: detail),
              _AddressTab(detail: detail),
            ],
          ),
        ),

        // Action buttons
        _ActionBar(provider: provider),
      ],
    );
  }
}

// =============================================================================
// Tab 1: Данные
// =============================================================================

class _DataTab extends StatelessWidget {
  final EstablishmentDetail detail;
  const _DataTab({required this.detail});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ModerationFieldReview(
          fieldName: 'legal_name',
          label: 'Полное название заведения',
          isRequired: true,
          child: _FieldValue(detail.legalName ?? detail.name),
        ),
        ModerationFieldReview(
          fieldName: 'unp',
          label: 'УНП',
          isRequired: true,
          child: _FieldValue(detail.unp),
        ),
        ModerationFieldReview(
          fieldName: 'registration_doc',
          label: 'Регистрация',
          isRequired: true,
          child: detail.registrationDocUrl != null &&
                  detail.registrationDocUrl!.isNotEmpty
              ? _FileLink(detail.registrationDocUrl!)
              : const _FieldValue(null),
        ),
        ModerationFieldReview(
          fieldName: 'contact_person',
          label: 'Номер контактного лица',
          isRequired: true,
          child: _FieldValue(detail.contactPerson ?? detail.phone),
        ),
        ModerationFieldReview(
          fieldName: 'contact_email',
          label: 'E-mail',
          isRequired: true,
          child: _FieldValue(detail.contactEmail ?? detail.email),
        ),
      ],
    );
  }
}

// =============================================================================
// Tab 2: О заведении
// =============================================================================

class _AboutTab extends StatelessWidget {
  final EstablishmentDetail detail;
  const _AboutTab({required this.detail});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Moderable fields
        ModerationFieldReview(
          fieldName: 'description',
          label: 'Описание',
          isRequired: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FieldValue(detail.description),
              if (detail.description != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    '${detail.description!.length}/450',
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFFABABAB),
                    ),
                  ),
                ),
            ],
          ),
        ),
        ModerationFieldReview(
          fieldName: 'name',
          label: 'Название',
          isRequired: true,
          child: _FieldValue(detail.name),
        ),
        ModerationFieldReview(
          fieldName: 'customer_phone',
          label: 'Номер для связи с клиентом',
          isRequired: true,
          child: _FieldValue(detail.phone),
        ),
        ModerationFieldReview(
          fieldName: 'website',
          label: 'Ссылка на соц. сеть/сайт',
          child: _FieldValue(detail.website),
        ),
        ModerationFieldReview(
          fieldName: 'working_hours',
          label: 'Время работы',
          isRequired: true,
          child: _WorkingHoursDisplay(detail.workingHours),
        ),
        ModerationFieldReview(
          fieldName: 'price_range',
          label: 'Средний чек',
          isRequired: true,
          child: _FieldValue(detail.priceRange),
        ),

        // Informational fields (no approve/reject buttons)
        const SizedBox(height: 16),
        const Divider(),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text(
            'Информационные поля',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w500,
              color: Color(0xFFABABAB),
            ),
          ),
        ),
        _InfoField(
          label: 'Время дополнительного меню',
          child: _WorkingHoursDisplay(detail.specialHours),
        ),
        _InfoField(
          label: 'Атрибуты заведения',
          child: _AttributesDisplay(detail.attributes),
        ),
      ],
    );
  }
}

// =============================================================================
// Tab 3: Медиа
// =============================================================================

class _MediaTab extends StatelessWidget {
  final EstablishmentDetail detail;
  const _MediaTab({required this.detail});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ModerationFieldReview(
          fieldName: 'photos',
          label: 'Фото',
          isRequired: true,
          child: detail.interiorPhotos.isNotEmpty
              ? _PhotoGrid(photos: detail.interiorPhotos)
              : const Text(
                  'Фотографии не загружены',
                  style: TextStyle(color: Color(0xFFABABAB)),
                ),
        ),
        ModerationFieldReview(
          fieldName: 'menu',
          label: 'Меню',
          isRequired: true,
          child: detail.menuMedia.isNotEmpty
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: detail.menuMedia
                      .map((m) => _FileLink(m.url))
                      .toList(),
                )
              : const Text(
                  'Меню не загружено',
                  style: TextStyle(color: Color(0xFFABABAB)),
                ),
        ),
      ],
    );
  }
}

// =============================================================================
// Tab 4: Адрес
// =============================================================================

class _AddressTab extends StatelessWidget {
  final EstablishmentDetail detail;
  const _AddressTab({required this.detail});

  @override
  Widget build(BuildContext context) {
    final addressParts = [
      if (detail.city != null) detail.city!,
      if (detail.address != null) detail.address!,
    ];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ModerationFieldReview(
          fieldName: 'address',
          label: 'Адрес',
          isRequired: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FieldValue(addressParts.isNotEmpty
                  ? addressParts.join(', ')
                  : null),
              if (detail.latitude != null && detail.longitude != null) ...[
                const SizedBox(height: 12),
                // Map placeholder
                Container(
                  height: 200,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF5F5F5),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFD2D2D2)),
                  ),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.map_outlined,
                          size: 40,
                          color: Color(0xFFABABAB),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '${detail.latitude!.toStringAsFixed(6)}, '
                          '${detail.longitude!.toStringAsFixed(6)}',
                          style: const TextStyle(
                            fontSize: 14,
                            color: Color(0xFFABABAB),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

// =============================================================================
// Action Bar (Approve / Reject buttons)
// =============================================================================

class _ActionBar extends StatelessWidget {
  final ModerationProvider provider;
  const _ActionBar({required this.provider});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Color(0xFFD2D2D2))),
      ),
      child: Row(
        children: [
          if (provider.submitError != null)
            Expanded(
              child: Text(
                provider.submitError!,
                style: const TextStyle(color: Colors.red, fontSize: 13),
              ),
            ),
          if (provider.submitError == null) const Spacer(),
          OutlinedButton(
            onPressed: provider.isSubmitting
                ? null
                : () => _confirmReject(context),
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFFFF3B30),
              side: const BorderSide(color: Color(0xFFFF3B30)),
              padding:
                  const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            ),
            child: const Text('Отклонить', style: TextStyle(fontSize: 16)),
          ),
          const SizedBox(width: 12),
          FilledButton(
            onPressed: provider.isSubmitting
                ? null
                : () => _confirmApprove(context),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF3FD00D),
              padding:
                  const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            ),
            child: provider.isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text(
                    'Одобрить заведение',
                    style: TextStyle(fontSize: 16),
                  ),
          ),
        ],
      ),
    );
  }

  void _confirmApprove(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Одобрить заведение?'),
        content: const Text(
          'Заведение будет опубликовано и станет видимым в поиске.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              provider.approveEstablishment();
            },
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF3FD00D),
            ),
            child: const Text('Одобрить'),
          ),
        ],
      ),
    );
  }

  void _confirmReject(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Отклонить заведение?'),
        content: const Text(
          'Заведение вернётся в черновик. Партнёр сможет исправить и отправить повторно.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              provider.rejectEstablishment();
            },
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFFF3B30),
            ),
            child: const Text('Отклонить'),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Shared helper widgets
// =============================================================================

/// Displays a single field value in a bordered container (matching Figma input style)
class _FieldValue extends StatelessWidget {
  final String? value;
  const _FieldValue(this.value);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFD2D2D2), width: 1.13),
        borderRadius: BorderRadius.circular(11),
      ),
      child: Text(
        value ?? '—',
        style: TextStyle(
          fontSize: 15,
          color: value != null ? Colors.black : const Color(0xFFABABAB),
        ),
      ),
    );
  }
}

/// Displays a file link / PDF reference
class _FileLink extends StatelessWidget {
  final String url;
  const _FileLink(this.url);

  @override
  Widget build(BuildContext context) {
    final fileName = Uri.tryParse(url)?.pathSegments.lastOrNull ?? url;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFD2D2D2)),
        borderRadius: BorderRadius.circular(11),
      ),
      child: Text(
        fileName,
        style: const TextStyle(fontSize: 15),
        textAlign: TextAlign.center,
      ),
    );
  }
}

/// Displays working hours from JSONB
class _WorkingHoursDisplay extends StatelessWidget {
  final Map<String, dynamic>? hours;
  const _WorkingHoursDisplay(this.hours);

  @override
  Widget build(BuildContext context) {
    if (hours == null || hours!.isEmpty) {
      return const _FieldValue(null);
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFD2D2D2), width: 1.13),
        borderRadius: BorderRadius.circular(11),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: hours!.entries.map((entry) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Text(
              '${entry.key}: ${entry.value}',
              style: const TextStyle(fontSize: 14),
            ),
          );
        }).toList(),
      ),
    );
  }
}

/// Displays attributes as tags/chips
class _AttributesDisplay extends StatelessWidget {
  final Map<String, dynamic>? attributes;
  const _AttributesDisplay(this.attributes);

  @override
  Widget build(BuildContext context) {
    if (attributes == null || attributes!.isEmpty) {
      return const _FieldValue(null);
    }

    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: attributes!.entries.map((entry) {
        final isActive = entry.value == true;
        return Chip(
          label: Text(
            entry.key,
            style: TextStyle(
              fontSize: 13,
              color: isActive ? Colors.black : const Color(0xFFABABAB),
            ),
          ),
          backgroundColor: isActive
              ? const Color(0x1A3FD00D)
              : const Color(0xFFF5F5F5),
          side: BorderSide.none,
          visualDensity: VisualDensity.compact,
        );
      }).toList(),
    );
  }
}

/// Photo grid for the Media tab
class _PhotoGrid extends StatelessWidget {
  final List<MediaItem> photos;
  const _PhotoGrid({required this.photos});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: photos.map((photo) {
        return ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: 120,
            height: 90,
            child: Image.network(
              photo.thumbnailUrl ?? photo.url,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Container(
                color: const Color(0xFFF5F5F5),
                child: const Icon(Icons.broken_image,
                    color: Color(0xFFD2D2D2)),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

/// Informational field (no approve/reject buttons)
class _InfoField extends StatelessWidget {
  final String label;
  final Widget child;
  const _InfoField({required this.label, required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w500,
              color: Color(0xFFABABAB),
            ),
          ),
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }
}
