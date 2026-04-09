import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';

/// Preview panel showing top-3 smart search results on the home screen.
/// Appears below the search bar after AI intent parsing completes.
class SmartSearchPreview extends StatelessWidget {
  final VoidCallback onShowAll;
  final ValueChanged<String> onEstablishmentTap;

  const SmartSearchPreview({
    super.key,
    required this.onShowAll,
    required this.onEstablishmentTap,
  });

  @override
  Widget build(BuildContext context) {
    return Consumer<SmartSearchProvider>(
      builder: (context, provider, _) {
        if (provider.state == SmartSearchState.loading) {
          return _buildLoading(provider.lastQuery);
        }

        if (provider.state == SmartSearchState.error) {
          return _buildError(provider.errorMessage ?? 'Ошибка поиска');
        }

        if (provider.state != SmartSearchState.results) {
          return const SizedBox.shrink();
        }

        if (provider.smartResults.isEmpty) {
          return _buildEmpty();
        }

        return _buildResults(context, provider);
      },
    );
  }

  Widget _buildLoading(String query) {
    final loadingText = query.isNotEmpty ? 'Ищем «$query»...' : 'Ищем...';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _panelDecoration(),
      child: Row(
        children: [
          const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppTheme.primaryOrange,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              loadingText,
              style: const TextStyle(
                fontSize: 14,
                color: AppTheme.textGrey,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildError(String message) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _panelDecoration(),
      child: Text(
        message,
        style: const TextStyle(fontSize: 14, color: AppTheme.textGrey),
      ),
    );
  }

  Widget _buildEmpty() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _panelDecoration(),
      child: const Text(
        'Ничего не найдено. Попробуйте другой запрос.',
        style: TextStyle(fontSize: 14, color: AppTheme.textGrey),
      ),
    );
  }

  Widget _buildResults(BuildContext context, SmartSearchProvider provider) {
    return Container(
      decoration: _panelDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Intent header
          if (provider.parsedIntent != null &&
              !provider.isFallback)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Text(
                provider.parsedIntent!.toDisplayString(),
                style: const TextStyle(
                  fontSize: 13,
                  color: AppTheme.textGrey,
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),

          // Result cards
          ...provider.smartResults.map(
            (e) => _ResultCard(
              establishment: e,
              onTap: () => onEstablishmentTap(e.id),
            ),
          ),

          // "Show all" button
          if (provider.totalResults > provider.smartResults.length)
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: onShowAll,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: const BoxDecoration(
                  border: Border(
                    top: BorderSide(color: AppTheme.strokeGrey, width: 0.5),
                  ),
                ),
                child: Text(
                  'Показать все (${provider.totalResults})',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.primaryOrange,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  BoxDecoration _panelDecoration() {
    return BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.1),
          blurRadius: 8,
          offset: const Offset(0, 2),
        ),
      ],
    );
  }
}

/// Compact card for a single establishment in the preview
class _ResultCard extends StatelessWidget {
  final Establishment establishment;
  final VoidCallback onTap;

  const _ResultCard({required this.establishment, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    establishment.name,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _subtitle(),
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppTheme.textGrey,
                    ),
                  ),
                ],
              ),
            ),
            // Promo badge
            if (establishment.hasPromotion)
              Container(
                margin: const EdgeInsets.only(left: 8),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.primaryOrange,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Text(
                  'АКЦИЯ',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            const SizedBox(width: 4),
            const Icon(
              Icons.chevron_right,
              size: 20,
              color: AppTheme.textGrey,
            ),
          ],
        ),
      ),
    );
  }

  String _subtitle() {
    // With distance → show distance, without → show rating
    if (establishment.distance != null && establishment.distance! > 0) {
      final km = establishment.distance!;
      final distStr = km < 1
          ? '${(km * 1000).round()} м'
          : '${km.toStringAsFixed(1)} км';
      return '${establishment.category} \u00b7 $distStr';
    }

    if (establishment.rating != null) {
      return '${establishment.category} \u00b7 ${establishment.rating!.toStringAsFixed(1)}\u2605';
    }

    return establishment.category;
  }
}
