import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';

/// Partner view of parsed menu items for a single establishment.
/// Component 8, Segment C, Block 1.
///
/// Mounted via EditEstablishmentScreen → "Меню" row.
class PartnerMenuScreen extends StatefulWidget {
  final String establishmentId;

  const PartnerMenuScreen({super.key, required this.establishmentId});

  @override
  State<PartnerMenuScreen> createState() => _PartnerMenuScreenState();
}

class _PartnerMenuScreenState extends State<PartnerMenuScreen> {
  static const Color _bg = AppTheme.backgroundWarm;
  static const Color _primary = AppTheme.primaryOrangeDark;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context
          .read<PartnerMenuProvider>()
          .loadForEstablishment(widget.establishmentId);
    });
  }

  @override
  void dispose() {
    // Stop polling when leaving the screen; next visit re-starts via initState.
    context.read<PartnerMenuProvider>().stopPolling();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _bg,
        elevation: 0,
        foregroundColor: AppTheme.textPrimary,
        title: const Text(
          'Меню',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w500),
        ),
      ),
      body: Consumer<PartnerMenuProvider>(
        builder: (context, provider, _) {
          if (provider.isLoading && provider.items.isEmpty) {
            return const Center(
              child: CircularProgressIndicator(color: _primary),
            );
          }

          if (provider.error != null && provider.items.isEmpty) {
            return _buildErrorState(provider);
          }

          if (provider.items.isEmpty) {
            return _buildEmptyState();
          }

          return _buildList(provider);
        },
      ),
      bottomNavigationBar: _buildRetryBar(),
    );
  }

  // ============================================================================
  // States
  // ============================================================================

  Widget _buildErrorState(PartnerMenuProvider provider) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline,
                size: 64, color: AppTheme.textGrey.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            Text(
              provider.error ?? 'Ошибка загрузки',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => provider.fetchMenuItems(),
              style: ElevatedButton.styleFrom(
                backgroundColor: _primary,
                foregroundColor: AppTheme.textOnPrimary,
              ),
              child: const Text('Повторить'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.menu_book_outlined,
                size: 72, color: AppTheme.textGrey.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            const Text(
              'Распарсенных позиций пока нет',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w500,
                color: AppTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Если вы загрузили PDF меню в разделе «Медиа», '
              'распознавание выполняется автоматически в течение '
              'нескольких минут. Если PDF ещё не загружен — загрузите '
              'его в разделе «Медиа».',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: AppTheme.textGrey),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildList(PartnerMenuProvider provider) {
    final groups = provider.itemsByCategory;
    final categoryKeys = groups.keys.toList();

    return RefreshIndicator(
      color: _primary,
      onRefresh: () => provider.fetchMenuItems(),
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        itemCount: categoryKeys.length,
        itemBuilder: (context, idx) {
          final key = categoryKeys[idx];
          final categoryLabel = key.isEmpty ? 'Без категории' : key;
          final items = groups[key]!;

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
                child: Text(
                  categoryLabel,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textPrimary,
                  ),
                ),
              ),
              ...items.map((item) => _MenuItemCard(
                    item: item,
                    onTap: () => _openEditor(item),
                  )),
            ],
          );
        },
      ),
    );
  }

  // ============================================================================
  // Edit flow
  // ============================================================================

  Future<void> _openEditor(PartnerMenuItem item) async {
    final result = await showModalBottomSheet<_EditResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: _bg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _EditItemSheet(item: item),
    );

    if (result == null || !mounted) return;

    final provider = context.read<PartnerMenuProvider>();
    final messenger = ScaffoldMessenger.of(context);

    final ok = await provider.updateItem(
      item.id,
      itemName: result.itemName,
      priceByn: result.priceByn,
      categoryRaw: result.categoryRaw,
    );

    if (!mounted) return;

    if (!ok) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(provider.error ?? 'Не удалось сохранить изменения'),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ),
      );
      provider.clearError();
    } else {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Изменения сохранены'),
          backgroundColor: AppTheme.statusGreen,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  // ============================================================================
  // Retry OCR
  // ============================================================================

  Widget _buildRetryBar() {
    return Consumer<PartnerMenuProvider>(
      builder: (context, provider, _) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () => _handleRetry(provider),
                icon: const Icon(Icons.refresh, size: 20),
                label: const Text('Перезапустить распознавание'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: _primary,
                  side: BorderSide(color: _primary.withValues(alpha: 0.4)),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _handleRetry(PartnerMenuProvider provider) async {
    final messenger = ScaffoldMessenger.of(context);

    final result = await provider.retryOcr();
    if (!mounted) return;

    if (result.success) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            result.enqueuedJobs > 0
                ? 'Распознавание запущено (${result.enqueuedJobs} из ${result.totalPdfs})'
                : 'Распознавание уже выполняется',
          ),
          backgroundColor: AppTheme.statusGreen,
          behavior: SnackBarBehavior.floating,
        ),
      );
      // Refresh items shortly — OCR results may appear before next poll tick.
      Future.delayed(const Duration(seconds: 5), () {
        if (!mounted) return;
        context.read<PartnerMenuProvider>().fetchMenuItems(silent: true);
      });
    } else if (result.errorCode == 'RATE_LIMITED') {
      final waitText = _formatRetryAfter(result.retryAfterSeconds ?? 0);
      messenger.showSnackBar(
        SnackBar(
          content: Text('${result.errorMessage}. Повторите $waitText.'),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 5),
        ),
      );
    } else if (result.errorCode == 'NO_PDF_MENUS') {
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
              'Сначала загрузите PDF меню в разделе «Медиа»'),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ),
      );
    } else {
      messenger.showSnackBar(
        SnackBar(
          content: Text(result.errorMessage ?? 'Не удалось запустить распознавание'),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  static String _formatRetryAfter(int seconds) {
    if (seconds <= 0) return 'через некоторое время';
    if (seconds < 60) return 'через $seconds сек';
    final minutes = (seconds / 60).ceil();
    if (minutes < 60) return 'через $minutes мин';
    final hours = (minutes / 60).ceil();
    return 'через $hours ч';
  }
}

// ============================================================================
// Card widget
// ============================================================================

class _MenuItemCard extends StatefulWidget {
  final PartnerMenuItem item;
  final VoidCallback onTap;

  const _MenuItemCard({required this.item, required this.onTap});

  @override
  State<_MenuItemCard> createState() => _MenuItemCardState();
}

class _MenuItemCardState extends State<_MenuItemCard> {
  bool _flagExpanded = false;

  static const Color _warnYellow = Color(0xFFFFB800);

  @override
  Widget build(BuildContext context) {
    final item = widget.item;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        border: Border.all(color: AppTheme.strokeGrey.withValues(alpha: 0.5)),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: widget.onTap,
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.itemName,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w500,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                        if (item.priceByn != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            '${item.priceByn!.toStringAsFixed(2)} BYN',
                            style: const TextStyle(
                              fontSize: 14,
                              color: AppTheme.textGrey,
                            ),
                          ),
                        ],
                        if (item.hasSanityFlag) ...[
                          const SizedBox(height: 8),
                          GestureDetector(
                            onTap: () =>
                                setState(() => _flagExpanded = !_flagExpanded),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: _warnYellow.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                    color: _warnYellow.withValues(alpha: 0.5)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.warning_amber_rounded,
                                      size: 14, color: _warnYellow),
                                  const SizedBox(width: 4),
                                  const Text(
                                    'Требует внимания',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: _warnYellow,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                  const SizedBox(width: 2),
                                  Icon(
                                    _flagExpanded
                                        ? Icons.expand_less
                                        : Icons.expand_more,
                                    size: 16,
                                    color: _warnYellow,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const Icon(Icons.edit_outlined,
                      size: 20, color: AppTheme.textGrey),
                ],
              ),
            ),
          ),
          if (_flagExpanded && item.hasSanityFlag)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: _warnYellow.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _formatSanityFlag(item.sanityFlag!),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textPrimary,
                    height: 1.4,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  static String _formatSanityFlag(Map<String, dynamic> flag) {
    // Show key:value pairs; human-readable labels for known keys.
    const labels = {
      'price_below_threshold': 'Цена ниже порога',
      'price_above_threshold': 'Цена выше порога',
      'suspicious_name': 'Подозрительное название',
      'low_confidence': 'Низкая уверенность распознавания',
    };
    return flag.entries
        .map((e) => '• ${labels[e.key] ?? e.key}: ${e.value}')
        .join('\n');
  }
}

// ============================================================================
// Edit sheet
// ============================================================================

class _EditResult {
  final String? itemName;
  final double? priceByn;
  final String? categoryRaw;
  _EditResult({this.itemName, this.priceByn, this.categoryRaw});
}

class _EditItemSheet extends StatefulWidget {
  final PartnerMenuItem item;

  const _EditItemSheet({required this.item});

  @override
  State<_EditItemSheet> createState() => _EditItemSheetState();
}

class _EditItemSheetState extends State<_EditItemSheet> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _priceCtrl;
  late final TextEditingController _categoryCtrl;
  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.item.itemName);
    _priceCtrl = TextEditingController(
      text: widget.item.priceByn != null
          ? widget.item.priceByn!.toStringAsFixed(2)
          : '',
    );
    _categoryCtrl = TextEditingController(text: widget.item.categoryRaw ?? '');
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _priceCtrl.dispose();
    _categoryCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final name = _nameCtrl.text.trim();
    final priceText = _priceCtrl.text.trim().replaceAll(',', '.');
    final category = _categoryCtrl.text.trim();

    // Only send fields that changed
    final originalName = widget.item.itemName;
    final originalPrice = widget.item.priceByn;
    final originalCategory = widget.item.categoryRaw ?? '';

    final parsedPrice = priceText.isEmpty ? null : double.tryParse(priceText);

    final result = _EditResult(
      itemName: name != originalName ? name : null,
      priceByn: (parsedPrice != originalPrice) ? parsedPrice : null,
      categoryRaw: category != originalCategory ? category : null,
    );

    if (result.itemName == null &&
        result.priceByn == null &&
        result.categoryRaw == null) {
      Navigator.pop(context);
      return;
    }

    Navigator.pop(context, result);
  }

  @override
  Widget build(BuildContext context) {
    final viewInsets = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, viewInsets + 16),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Редактировать позицию',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: AppTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _nameCtrl,
              decoration: const InputDecoration(
                labelText: 'Название',
                border: OutlineInputBorder(),
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Укажите название' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _priceCtrl,
              decoration: const InputDecoration(
                labelText: 'Цена (BYN)',
                border: OutlineInputBorder(),
                hintText: 'например 6.50',
              ),
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              ],
              validator: (v) {
                if (v == null || v.trim().isEmpty) return null;
                final parsed = double.tryParse(v.trim().replaceAll(',', '.'));
                if (parsed == null || parsed < 0) {
                  return 'Введите корректную цену';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _categoryCtrl,
              decoration: const InputDecoration(
                labelText: 'Категория',
                border: OutlineInputBorder(),
                hintText: 'например Кофе, Десерты',
              ),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Отмена'),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _submit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryOrangeDark,
                    foregroundColor: AppTheme.textOnPrimary,
                  ),
                  child: const Text('Сохранить'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
