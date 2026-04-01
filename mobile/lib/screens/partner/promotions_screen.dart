import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/promotion.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/create_promotion_screen.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Partner promotion management screen
/// Shows active (with N/3 counter) and expired promotions
class PromotionsScreen extends StatefulWidget {
  final String establishmentId;
  final String establishmentName;

  const PromotionsScreen({
    super.key,
    required this.establishmentId,
    required this.establishmentName,
  });

  @override
  State<PromotionsScreen> createState() => _PromotionsScreenState();
}

class _PromotionsScreenState extends State<PromotionsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<PromotionProvider>().fetchPromotions(widget.establishmentId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: AppBar(
        title: const Text('Акции'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0,
        actions: [
          TextButton.icon(
            onPressed: _navigateToCreate,
            icon: const Icon(Icons.add, size: 20),
            label: const Text('Создать'),
            style: TextButton.styleFrom(foregroundColor: AppTheme.primaryOrange),
          ),
        ],
      ),
      body: Consumer<PromotionProvider>(
        builder: (context, provider, _) {
          if (provider.isLoading && provider.promotions.isEmpty) {
            return const Center(child: CircularProgressIndicator());
          }

          if (provider.error != null && provider.promotions.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(provider.error!, style: const TextStyle(color: Colors.red)),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => provider.fetchPromotions(widget.establishmentId),
                    child: const Text('Повторить'),
                  ),
                ],
              ),
            );
          }

          final active = provider.activePromotions;
          final expired = provider.expiredPromotions;

          if (active.isEmpty && expired.isEmpty) {
            return _buildEmptyState();
          }

          return RefreshIndicator(
            onRefresh: () => provider.fetchPromotions(widget.establishmentId),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Active section
                _buildSectionHeader('Активные (${active.length}/3)'),
                const SizedBox(height: 8),
                if (active.isEmpty)
                  _buildEmptyCard('Нет активных акций')
                else
                  ...active.map((p) => _buildPromotionCard(p, isActive: true)),

                const SizedBox(height: 24),

                // Expired section
                if (expired.isNotEmpty) ...[
                  _buildSectionHeader('Завершённые'),
                  const SizedBox(height: 8),
                  ...expired.map((p) => _buildPromotionCard(p, isActive: false)),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: Colors.black87,
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.local_offer_outlined, size: 64, color: Colors.grey[400]),
          const SizedBox(height: 16),
          Text(
            'Нет акций',
            style: TextStyle(fontSize: 18, color: Colors.grey[600]),
          ),
          const SizedBox(height: 8),
          Text(
            'Создайте первую акцию для\n${widget.establishmentName}',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, color: Colors.grey[500]),
          ),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: _navigateToCreate,
            icon: const Icon(Icons.add),
            label: const Text('Создать акцию'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primaryOrange,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyCard(String text) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Center(
        child: Text(text, style: TextStyle(color: Colors.grey[500])),
      ),
    );
  }

  Widget _buildPromotionCard(Promotion promotion, {required bool isActive}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: isActive
            ? Border.all(color: AppTheme.primaryOrange.withValues(alpha: 0.3))
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title + status
          Row(
            children: [
              Expanded(
                child: Text(
                  promotion.title,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: isActive ? Colors.black87 : Colors.grey[500],
                  ),
                ),
              ),
              if (!isActive)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.grey[200],
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    'Завершена',
                    style: TextStyle(fontSize: 11, color: Colors.grey[600]),
                  ),
                ),
            ],
          ),

          // Description
          if (promotion.description != null && promotion.description!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              promotion.description!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 14, color: Colors.grey[600]),
            ),
          ],

          // Valid until
          if (promotion.validUntil != null) ...[
            const SizedBox(height: 8),
            Text(
              'до ${promotion.validUntil!.day.toString().padLeft(2, '0')}.${promotion.validUntil!.month.toString().padLeft(2, '0')}.${promotion.validUntil!.year}',
              style: TextStyle(fontSize: 12, color: Colors.grey[500]),
            ),
          ],

          // Actions for active promotions
          if (isActive) ...[
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => _navigateToEdit(promotion),
                  child: const Text('Изменить'),
                  style: TextButton.styleFrom(foregroundColor: AppTheme.primaryOrange),
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: () => _confirmDeactivate(promotion),
                  child: const Text('Завершить'),
                  style: TextButton.styleFrom(foregroundColor: Colors.grey),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  void _navigateToCreate() async {
    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (context) => CreatePromotionScreen(
          establishmentId: widget.establishmentId,
        ),
      ),
    );
    if (result == true && mounted) {
      context.read<PromotionProvider>().fetchPromotions(widget.establishmentId);
    }
  }

  void _navigateToEdit(Promotion promotion) async {
    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (context) => CreatePromotionScreen(
          establishmentId: widget.establishmentId,
          existingPromotion: promotion,
        ),
      ),
    );
    if (result == true && mounted) {
      context.read<PromotionProvider>().fetchPromotions(widget.establishmentId);
    }
  }

  void _confirmDeactivate(Promotion promotion) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Завершить акцию?'),
        content: Text('Акция "${promotion.title}" будет деактивирована.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await context.read<PromotionProvider>().deactivatePromotion(
                    promotionId: promotion.id,
                    establishmentId: widget.establishmentId,
                  );
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Завершить'),
          ),
        ],
      ),
    );
  }
}
