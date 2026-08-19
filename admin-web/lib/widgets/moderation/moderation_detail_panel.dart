import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/utils/open_url.dart';
import 'package:restaurant_guide_admin_web/widgets/media/media_viewer.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_field_review.dart';

/// Display mode for the detail panel
enum DetailPanelMode {
  /// Full moderation review with per-field approve/reject/comment (Segment B)
  moderation,

  /// Read-only view — no action buttons on fields or at bottom
  readonly,

  /// Read-only + unsuspend action available
  suspended,
}

/// Right panel: tabbed detail view for reviewing a single establishment.
///
/// Four tabs: Данные, О заведении, Медиа, Адрес.
///
/// Supports three modes:
/// - [DetailPanelMode.moderation]: Approve/reject buttons (original Segment B)
/// - [DetailPanelMode.readonly]: Display only (approved / rejected screens)
/// - [DetailPanelMode.suspended]: Display + unsuspend action
///
/// When [detail], [selectedId], etc. are provided, uses them directly.
/// When null, falls back to reading [ModerationProvider] (backward compatible).
class ModerationDetailPanel extends StatefulWidget {
  final DetailPanelMode mode;

  // Optional external data (when null, reads from ModerationProvider)
  final EstablishmentDetail? detail;
  final bool? isLoadingDetail;
  final String? detailError;
  final String? selectedId;

  // Optional actions
  final ValueChanged<String>? onSuspend;
  final VoidCallback? onUnsuspend;
  final ValueChanged<String>? onClaim;

  // Rejection notes for per-field display (from audit log)
  final Map<String, dynamic>? rejectionNotes;

  const ModerationDetailPanel({
    super.key,
    this.mode = DetailPanelMode.moderation,
    this.detail,
    this.isLoadingDetail,
    this.detailError,
    this.selectedId,
    this.onSuspend,
    this.onUnsuspend,
    this.onClaim,
    this.rejectionNotes,
  });

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
    // Resolve data: external params or ModerationProvider
    final String? selectedId;
    final bool isLoadingDetail;
    final String? detailError;
    final EstablishmentDetail? detail;
    final bool isReadOnly = widget.mode != DetailPanelMode.moderation;

    if (widget.detail != null ||
        widget.selectedId != null ||
        widget.isLoadingDetail != null) {
      // External data mode
      selectedId = widget.selectedId;
      isLoadingDetail = widget.isLoadingDetail ?? false;
      detailError = widget.detailError;
      detail = widget.detail;
    } else {
      // Provider mode (backward compatible with Segment B)
      final provider = context.watch<ModerationProvider>();
      selectedId = provider.selectedId;
      isLoadingDetail = provider.isLoadingDetail;
      detailError = provider.detailError;
      detail = provider.selectedDetail;
    }

    if (selectedId == null) {
      return const Center(
        child: Text(
          'Выберите заведение для просмотра',
          style: TextStyle(fontSize: 16, color: Colors.grey),
        ),
      );
    }

    if (isLoadingDetail) {
      return const Center(child: CircularProgressIndicator());
    }

    if (detailError != null) {
      return Center(
        child: Text(
          detailError,
          style: const TextStyle(color: Colors.red),
        ),
      );
    }

    if (detail == null) return const SizedBox.shrink();

    return Column(
      children: [
        // Header actions (suspend / unsuspend)
        if (widget.onSuspend != null || widget.onUnsuspend != null || widget.onClaim != null)
          _HeaderActionBar(
            onSuspend: widget.onSuspend,
            onUnsuspend: widget.onUnsuspend,
            onClaim: widget.onClaim,
            establishmentName: detail.name,
          ),

        // Rejection notes summary (for rejected screen)
        if (widget.rejectionNotes != null &&
            widget.rejectionNotes!.isNotEmpty)
          _RejectionNotesHeader(notes: widget.rejectionNotes!),

        // Вкладки. Стили не задаются на месте: активная 15/600 тёмно-оранжевым
        // с подчёркиванием 2px и нижняя граница полосы приходят из
        // tabBarTheme канона. Раньше здесь стоял кегль 18 и чёрный цвет
        // неактивной — они перекрывали тему.
        TabBar(
          controller: _tabController,
          tabAlignment: TabAlignment.start,
          isScrollable: true,
          tabs: const [
            Tab(text: 'Данные'),
            Tab(text: 'О заведении'),
            Tab(text: 'Медиа'),
            Tab(text: 'Адрес'),
          ],
        ),

        // Tab content
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _DataTab(
                detail: detail,
                isReadOnly: isReadOnly,
                rejectionNotes: widget.rejectionNotes,
              ),
              _AboutTab(
                detail: detail,
                isReadOnly: isReadOnly,
                rejectionNotes: widget.rejectionNotes,
              ),
              _MediaTab(
                detail: detail,
                isReadOnly: isReadOnly,
                rejectionNotes: widget.rejectionNotes,
              ),
              _AddressTab(
                detail: detail,
                isReadOnly: isReadOnly,
                rejectionNotes: widget.rejectionNotes,
                onUpdateCoordinates: (lat, lon) {
                  context.read<ModerationProvider>().updateCoordinates(lat, lon);
                },
              ),
            ],
          ),
        ),

        // Action buttons (only in moderation mode)
        if (widget.mode == DetailPanelMode.moderation)
          _ActionBar(provider: context.watch<ModerationProvider>()),
      ],
    );
  }
}

// =============================================================================
// Header Action Bar (Suspend / Unsuspend)
// =============================================================================

class _HeaderActionBar extends StatelessWidget {
  final ValueChanged<String>? onSuspend;
  final VoidCallback? onUnsuspend;
  final ValueChanged<String>? onClaim;
  final String establishmentName;

  const _HeaderActionBar({
    this.onSuspend,
    this.onUnsuspend,
    this.onClaim,
    required this.establishmentName,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0xFFD2D2D2))),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              establishmentName,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (onSuspend != null)
            OutlinedButton.icon(
              onPressed: () => _confirmSuspend(context),
              icon: const Icon(Icons.pause_circle_outline, size: 18),
              label: const Text('Приостановить'),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFFF9500),
                side: const BorderSide(color: Color(0xFFFF9500)),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
              ),
            ),
          if (onUnsuspend != null)
            FilledButton.icon(
              onPressed: () => _confirmUnsuspend(context),
              icon: const Icon(Icons.play_circle_outline, size: 18),
              label: const Text('Возобновить'),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF3FD00D),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
              ),
            ),
          if (onClaim != null) ...[
            if (onSuspend != null || onUnsuspend != null)
              const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: () => _showClaimDialog(context),
              icon: const Icon(Icons.person_add_outlined, size: 18),
              label: const Text('Назначить партнёра'),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFF06B32),
                side: const BorderSide(color: Color(0xFFF06B32)),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  void _confirmSuspend(BuildContext context) {
    final reasonController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Приостановить заведение?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Заведение будет скрыто из поиска и каталога.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Причина приостановки...',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              final reason = reasonController.text.trim();
              if (reason.isEmpty) return;
              Navigator.pop(ctx);
              onSuspend?.call(reason);
            },
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFFF9500),
            ),
            child: const Text('Приостановить'),
          ),
        ],
      ),
    );
  }

  void _confirmUnsuspend(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Возобновить заведение?'),
        content: const Text(
          'Заведение снова появится в поиске и каталоге.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              onUnsuspend?.call();
            },
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF3FD00D),
            ),
            child: const Text('Возобновить'),
          ),
        ],
      ),
    );
  }

  void _showClaimDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => _ClaimUserSearchDialog(
        establishmentName: establishmentName,
        onUserSelected: (userId) {
          Navigator.pop(ctx);
          onClaim?.call(userId);
        },
      ),
    );
  }
}

// =============================================================================
// Claim User Search Dialog
// =============================================================================

class _ClaimUserSearchDialog extends StatefulWidget {
  final String establishmentName;
  final ValueChanged<String> onUserSelected;

  const _ClaimUserSearchDialog({
    required this.establishmentName,
    required this.onUserSelected,
  });

  @override
  State<_ClaimUserSearchDialog> createState() => _ClaimUserSearchDialogState();
}

class _ClaimUserSearchDialogState extends State<_ClaimUserSearchDialog> {
  final _searchController = TextEditingController();
  final _service = ModerationService();
  List<UserSearchResult> _results = [];
  bool _isLoading = false;
  String? _error;
  String? _selectedUserId;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _search(String query) async {
    if (query.trim().length < 2) {
      setState(() {
        _results = [];
        _error = null;
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final results = await _service.searchUsers(query);
      setState(() {
        _results = results;
        _isLoading = false;
        _selectedUserId = null;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _error = 'Ошибка поиска';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Назначить партнёра'),
      content: SizedBox(
        width: 420,
        height: 400,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Заведение «${widget.establishmentName}» будет передано выбранному пользователю.',
              style: const TextStyle(fontSize: 13, color: Colors.grey),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _searchController,
              decoration: const InputDecoration(
                hintText: 'Поиск по email или имени...',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
              ),
              onChanged: _search,
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _buildResultsList(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: _selectedUserId != null
              ? () => widget.onUserSelected(_selectedUserId!)
              : null,
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFF06B32),
          ),
          child: const Text('Назначить'),
        ),
      ],
    );
  }

  Widget _buildResultsList() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Text(_error!, style: const TextStyle(color: Colors.red)),
      );
    }

    if (_searchController.text.trim().length < 2) {
      return const Center(
        child: Text(
          'Введите минимум 2 символа для поиска',
          style: TextStyle(color: Colors.grey),
        ),
      );
    }

    if (_results.isEmpty) {
      return const Center(
        child: Text(
          'Пользователи не найдены',
          style: TextStyle(color: Colors.grey),
        ),
      );
    }

    return ListView.builder(
      itemCount: _results.length,
      itemBuilder: (context, index) {
        final user = _results[index];
        final isSelected = _selectedUserId == user.id;

        return ListTile(
          selected: isSelected,
          selectedTileColor: const Color(0xFFF06B32).withValues(alpha: 0.1),
          leading: CircleAvatar(
            backgroundColor: user.role == 'partner'
                ? const Color(0xFFF06B32)
                : Colors.grey.shade400,
            child: Text(
              user.name.isNotEmpty ? user.name[0].toUpperCase() : '?',
              style: const TextStyle(color: Colors.white),
            ),
          ),
          title: Text(user.name),
          subtitle: Text('${user.email} · ${user.role}'),
          onTap: () => setState(() => _selectedUserId = user.id),
        );
      },
    );
  }
}

// =============================================================================
// Rejection Notes Header
// =============================================================================

class _RejectionNotesHeader extends StatelessWidget {
  final Map<String, dynamic> notes;
  const _RejectionNotesHeader({required this.notes});

  @override
  Widget build(BuildContext context) {
    final nonEmptyNotes = notes.entries
        .where((e) => e.value != null && e.value.toString().isNotEmpty)
        .toList();

    if (nonEmptyNotes.isEmpty) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: const BoxDecoration(
        color: Color(0x0DFF3B30), // subtle red background
        border: Border(bottom: BorderSide(color: Color(0x33FF3B30))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.warning_amber_rounded,
                  size: 20, color: Color(0xFFFF3B30)),
              SizedBox(width: 8),
              Text(
                'Причины отказа',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFFFF3B30),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ...nonEmptyNotes.map((entry) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('• ',
                        style: TextStyle(
                            color: Color(0xFFFF3B30), fontSize: 14)),
                    Expanded(
                      child: Text(
                        '${_fieldLabel(entry.key)}: ${entry.value}',
                        style: const TextStyle(fontSize: 14),
                      ),
                    ),
                  ],
                ),
              )),
        ],
      ),
    );
  }

  /// Map field keys to Russian labels
  String _fieldLabel(String key) {
    const labels = {
      'legal_name': 'Полное название',
      'unp': 'УНП',
      'registration_doc': 'Регистрация',
      'contact_person': 'Контактное лицо',
      'contact_email': 'E-mail',
      'description': 'Описание',
      'name': 'Название',
      'customer_phone': 'Номер для связи',
      'website': 'Сайт',
      'working_hours': 'Время работы',
      'price_range': 'Средний чек',
      'photos': 'Фото',
      'menu': 'Меню',
      'address': 'Адрес',
    };
    return labels[key] ?? key;
  }
}

// =============================================================================
// Tab 1: Данные
// =============================================================================

class _DataTab extends StatelessWidget {
  final EstablishmentDetail detail;
  final bool isReadOnly;
  final Map<String, dynamic>? rejectionNotes;

  const _DataTab({
    required this.detail,
    this.isReadOnly = false,
    this.rejectionNotes,
  });

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      children: [
        ModerationFieldReview(
          fieldName: 'legal_name',
          label: 'Полное название заведения',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('legal_name'),
          child: _FieldValue(detail.legalName ?? detail.name),
        ),
        ModerationFieldReview(
          fieldName: 'unp',
          label: 'УНП',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('unp'),
          child: _FieldValue(detail.unp),
        ),
        ModerationFieldReview(
          fieldName: 'registration_doc',
          label: 'Регистрация',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('registration_doc'),
          child: detail.registrationDocUrl != null &&
                  detail.registrationDocUrl!.isNotEmpty
              ? _FileLink(detail.registrationDocUrl!)
              : const _FieldValue(null),
        ),
        ModerationFieldReview(
          fieldName: 'contact_person',
          label: 'Номер контактного лица',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('contact_person'),
          child: _FieldValue(detail.contactPerson ?? detail.phone),
        ),
        ModerationFieldReview(
          fieldName: 'contact_email',
          label: 'E-mail',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('contact_email'),
          child: _FieldValue(detail.contactEmail ?? detail.email),
        ),
      ],
    );
  }

  String? _note(String key) => rejectionNotes?[key]?.toString();
}

// =============================================================================
// Tab 2: О заведении
// =============================================================================

class _AboutTab extends StatelessWidget {
  final EstablishmentDetail detail;
  final bool isReadOnly;
  final Map<String, dynamic>? rejectionNotes;

  const _AboutTab({
    required this.detail,
    this.isReadOnly = false,
    this.rejectionNotes,
  });

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
          isReadOnly: isReadOnly,
          readOnlyComment: _note('description'),
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
          isReadOnly: isReadOnly,
          readOnlyComment: _note('name'),
          child: _FieldValue(detail.name),
        ),
        ModerationFieldReview(
          fieldName: 'customer_phone',
          label: 'Номер для связи с клиентом',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('customer_phone'),
          child: _FieldValue(detail.phone),
        ),
        ModerationFieldReview(
          fieldName: 'website',
          label: 'Ссылка на соц. сеть/сайт',
          isReadOnly: isReadOnly,
          readOnlyComment: _note('website'),
          child: _FieldValue(detail.website),
        ),
        ModerationFieldReview(
          fieldName: 'working_hours',
          label: 'Время работы',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('working_hours'),
          child: _WorkingHoursDisplay(detail.workingHours),
        ),
        ModerationFieldReview(
          fieldName: 'price_range',
          label: 'Средний чек',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('price_range'),
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

  String? _note(String key) => rejectionNotes?[key]?.toString();
}

// =============================================================================
// Tab 3: Медиа
// =============================================================================

class _MediaTab extends StatelessWidget {
  final EstablishmentDetail detail;
  final bool isReadOnly;
  final Map<String, dynamic>? rejectionNotes;

  const _MediaTab({
    required this.detail,
    this.isReadOnly = false,
    this.rejectionNotes,
  });

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      children: [
        ModerationFieldReview(
          fieldName: 'photos',
          label: 'Фото',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('photos'),
          child: detail.interiorPhotos.isNotEmpty
              ? _PhotoGrid(photos: detail.interiorPhotos, title: 'Фото')
              : const Text(
                  'Фотографии не загружены',
                  style: TextStyle(color: Color(0xFFABABAB)),
                ),
        ),
        ModerationFieldReview(
          fieldName: 'menu',
          label: 'Меню',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('menu'),
          child: detail.menuMedia.isNotEmpty
              ? _PhotoGrid(photos: detail.menuMedia, title: 'Меню')
              : const Text(
                  'Меню не загружено',
                  style: TextStyle(color: Color(0xFFABABAB)),
                ),
        ),
      ],
    );
  }

  String? _note(String key) => rejectionNotes?[key]?.toString();
}

// =============================================================================
// Tab 4: Адрес
// =============================================================================

class _AddressTab extends StatelessWidget {
  final EstablishmentDetail detail;
  final bool isReadOnly;
  final Map<String, dynamic>? rejectionNotes;
  final void Function(double latitude, double longitude)? onUpdateCoordinates;

  const _AddressTab({
    required this.detail,
    this.isReadOnly = false,
    this.rejectionNotes,
    this.onUpdateCoordinates,
  });

  @override
  Widget build(BuildContext context) {
    final addressParts = [
      if (detail.city != null) detail.city!,
      if (detail.address != null) detail.address!,
    ];

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      children: [
        ModerationFieldReview(
          fieldName: 'address',
          label: 'Адрес',
          isRequired: true,
          isReadOnly: isReadOnly,
          readOnlyComment: _note('address'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _FieldValue(addressParts.isNotEmpty
                  ? addressParts.join(', ')
                  : null),
              if (detail.latitude != null && detail.longitude != null) ...[
                const SizedBox(height: 12),
                _MapPreview(
                  latitude: detail.latitude!,
                  longitude: detail.longitude!,
                  onUpdateCoordinates: onUpdateCoordinates,
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  String? _note(String key) => rejectionNotes?[key]?.toString();
}

// =============================================================================
// Map Preview — coordinates + "Open in Yandex Maps" button
// =============================================================================

class _MapPreview extends StatelessWidget {
  final double latitude;
  final double longitude;
  final void Function(double latitude, double longitude)? onUpdateCoordinates;

  const _MapPreview({
    required this.latitude,
    required this.longitude,
    this.onUpdateCoordinates,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFF5F5F5),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFD2D2D2)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Coordinates
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.location_on,
                size: 20,
                color: Color(0xFFDB4F13),
              ),
              const SizedBox(width: 8),
              Text(
                '${latitude.toStringAsFixed(6)}, ${longitude.toStringAsFixed(6)}',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: Color(0xFF333333),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Open in Yandex Maps button
          SizedBox(
            height: 40,
            child: OutlinedButton.icon(
              onPressed: _openInYandexMaps,
              icon: const Icon(Icons.open_in_new, size: 16),
              label: const Text('Открыть в Яндекс Картах'),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFDB4F13),
                side: const BorderSide(color: Color(0xFFDB4F13)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ),
          // Correct coordinates button
          if (onUpdateCoordinates != null) ...[
            const SizedBox(height: 8),
            SizedBox(
              height: 40,
              child: ElevatedButton.icon(
                onPressed: () => _showCoordinateDialog(context),
                icon: const Icon(Icons.edit_location_alt, size: 16),
                label: const Text('Исправить координаты'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFDB4F13),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  void _openInYandexMaps() {
    final url = 'https://yandex.ru/maps/?pt=$longitude,$latitude&z=16&l=map';
    openInNewTab(url);
  }

  void _showCoordinateDialog(BuildContext context) {
    final latController = TextEditingController(text: latitude.toStringAsFixed(6));
    final lonController = TextEditingController(text: longitude.toStringAsFixed(6));

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Исправить координаты'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: latController,
              decoration: const InputDecoration(
                labelText: 'Широта (latitude)',
                hintText: '53.900000',
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: lonController,
              decoration: const InputDecoration(
                labelText: 'Долгота (longitude)',
                hintText: '27.550000',
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          ElevatedButton(
            onPressed: () {
              final lat = double.tryParse(latController.text);
              final lon = double.tryParse(lonController.text);
              if (lat != null && lon != null) {
                Navigator.pop(ctx);
                onUpdateCoordinates?.call(lat, lon);
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFDB4F13),
              foregroundColor: Colors.white,
            ),
            child: const Text('Сохранить'),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Action Bar (Approve / Reject buttons) — moderation mode only
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
    // Провайдер берём ДО показа диалога: после await обращаться к
    // context нельзя, а счётчики очередей обновить надо.
    final badges = context.read<BadgesProvider>();

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
              provider.approveEstablishment().then((ok) {
                // Очередь стала короче — бейдж в рейле обязан это
                // показать сразу, иначе действие выглядит несработавшим.
                if (ok) badges.load();
              });
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
    // Провайдер берём ДО показа диалога: после await обращаться к
    // context нельзя, а счётчики очередей обновить надо.
    final badges = context.read<BadgesProvider>();

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
              provider.rejectEstablishment().then((ok) {
                // Очередь стала короче — бейдж в рейле обязан это
                // показать сразу, иначе действие выглядит несработавшим.
                if (ok) badges.load();
              });
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
    final empty = value == null || value!.isEmpty;

    // Ни рамки, ни подложки: рамка означает поле ввода, а это значение для
    // чтения. Пустое называется словом, а не прочерком.
    return Text(
      empty ? 'не указан' : value!,
      style: empty ? AppTheme.canonFieldValueEmpty : AppTheme.canonFieldValue,
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

    return InkWell(
      onTap: () => openInNewTab(url),
      borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 8,
        children: [
          const Icon(Icons.description, size: 17, color: AppTheme.primaryOrange),
          Flexible(
            child: Text(
              fileName,
              style: AppTheme.canonFieldValue,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// Displays working hours in a readable table: day name → time range or "Закрыто"
class _WorkingHoursDisplay extends StatelessWidget {
  final Map<String, dynamic>? hours;
  const _WorkingHoursDisplay(this.hours);

  static const _dayOrder = [
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday',
  ];

  static const _dayNames = {
    'monday': 'Понедельник',
    'tuesday': 'Вторник',
    'wednesday': 'Среда',
    'thursday': 'Четверг',
    'friday': 'Пятница',
    'saturday': 'Суббота',
    'sunday': 'Воскресенье',
  };

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
        children: _dayOrder.map((dayKey) {
          final dayData = hours![dayKey];
          final dayName = _dayNames[dayKey] ?? dayKey;
          final isOpen = dayData is Map && dayData['is_open'] == true;
          final open = dayData is Map ? dayData['open'] as String? : null;
          final close = dayData is Map ? dayData['close'] as String? : null;

          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              children: [
                SizedBox(
                  width: 120,
                  child: Text(
                    dayName,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: isOpen
                          ? Colors.black
                          : const Color(0xFFABABAB),
                    ),
                  ),
                ),
                Expanded(
                  child: Text(
                    isOpen && open != null && close != null
                        ? '$open – $close'
                        : 'Закрыто',
                    style: TextStyle(
                      fontSize: 14,
                      color: isOpen
                          ? Colors.black
                          : const Color(0xFFABABAB),
                    ),
                  ),
                ),
              ],
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

/// Сетка медиа во вкладке «Медиа».
///
/// Каждая плитка открывает полноэкранный просмотр с увеличением. Без него
/// модерация медиа не работает: на 120×90 снимок не разглядеть, а меню —
/// это текст, который на таком размере просто не читается.
class _PhotoGrid extends StatelessWidget {
  final List<MediaItem> photos;

  /// Что за набор — «Фото» или «Меню». Показывается в шапке просмотрщика.
  final String title;

  const _PhotoGrid({required this.photos, required this.title});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (var i = 0; i < photos.length; i++)
          _PhotoTile(
            item: photos[i],
            onOpen: () => showMediaViewer(
              context,
              items: photos,
              title: title,
              initialIndex: i,
            ),
          ),
      ],
    );
  }
}

/// Плитка с подсказкой при наведении — иначе о возможности увеличить никто
/// не догадается: раньше её просто не было.
class _PhotoTile extends StatefulWidget {
  final MediaItem item;
  final VoidCallback onOpen;

  const _PhotoTile({required this.item, required this.onOpen});

  @override
  State<_PhotoTile> createState() => _PhotoTileState();
}

class _PhotoTileState extends State<_PhotoTile> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final item = widget.item;

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: widget.onOpen,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          child: SizedBox(
            width: 120,
            height: 90,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.network(
                  item.thumbnailUrl ?? item.previewUrl ?? item.url,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const ColoredBox(
                    color: AppTheme.gray100,
                    child: Icon(Icons.broken_image,
                        color: AppTheme.strokeGrey),
                  ),
                ),
                if (item.isPdf)
                  Positioned(
                    left: 6,
                    top: 6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: AppTheme.disclaimerBg,
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusXSmall),
                      ),
                      child: const Text(
                        'PDF',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.disclaimerText,
                        ),
                      ),
                    ),
                  ),
                if (_hovered)
                  ColoredBox(
                    color: Colors.black.withValues(alpha: 0.35),
                    child: const Center(
                      child: Icon(Icons.zoom_in, color: Colors.white, size: 28),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
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
