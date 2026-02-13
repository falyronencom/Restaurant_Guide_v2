import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';

/// Reviews Management screen — "Управление отзывами"
/// List + detail panel layout for admin review moderation.
class ReviewsManagementScreen extends StatefulWidget {
  const ReviewsManagementScreen({super.key});

  @override
  State<ReviewsManagementScreen> createState() =>
      _ReviewsManagementScreenState();
}

class _ReviewsManagementScreenState extends State<ReviewsManagementScreen> {
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AdminReviewsProvider>().loadReviews();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // Left panel: list
        SizedBox(
          width: 400,
          child: Column(
            children: [
              _SearchHeader(
                controller: _searchController,
                onSearch: (query) {
                  context.read<AdminReviewsProvider>().search(query);
                },
                onClear: () {
                  _searchController.clear();
                  context.read<AdminReviewsProvider>().clearSearch();
                },
              ),
              const _FilterBar(),
              const Divider(height: 1),
              const Expanded(child: _ReviewList()),
            ],
          ),
        ),
        const VerticalDivider(width: 1, thickness: 1),
        // Right panel: detail
        const Expanded(child: _DetailPanel()),
      ],
    );
  }
}

// =============================================================================
// Search Header
// =============================================================================

class _SearchHeader extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onSearch;
  final VoidCallback onClear;

  const _SearchHeader({
    required this.controller,
    required this.onSearch,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: TextField(
        controller: controller,
        decoration: InputDecoration(
          hintText: 'Поиск по тексту отзыва...',
          prefixIcon: const Icon(Icons.search, size: 20),
          suffixIcon: controller.text.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear, size: 18),
                  onPressed: onClear,
                )
              : null,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          isDense: true,
        ),
        onSubmitted: onSearch,
        onChanged: (value) {
          if (value.isEmpty) onClear();
        },
      ),
    );
  }
}

// =============================================================================
// Filter Bar
// =============================================================================

class _FilterBar extends StatelessWidget {
  const _FilterBar();

  @override
  Widget build(BuildContext context) {
    return Consumer<AdminReviewsProvider>(
      builder: (context, provider, _) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: Row(
            children: [
              // Status filter
              Expanded(
                child: _FilterDropdown<String>(
                  value: provider.statusFilter,
                  hint: 'Статус',
                  items: const [
                    DropdownMenuItem(value: null, child: Text('Все')),
                    DropdownMenuItem(
                        value: 'visible', child: Text('Активные')),
                    DropdownMenuItem(value: 'hidden', child: Text('Скрытые')),
                    DropdownMenuItem(
                        value: 'deleted', child: Text('Удалённые')),
                  ],
                  onChanged: (v) => provider.setStatusFilter(v),
                ),
              ),
              const SizedBox(width: 8),
              // Rating filter
              Expanded(
                child: _FilterDropdown<int>(
                  value: provider.ratingFilter,
                  hint: 'Рейтинг',
                  items: const [
                    DropdownMenuItem(value: null, child: Text('Все')),
                    DropdownMenuItem(value: 1, child: Text('1')),
                    DropdownMenuItem(value: 2, child: Text('2')),
                    DropdownMenuItem(value: 3, child: Text('3')),
                    DropdownMenuItem(value: 4, child: Text('4')),
                    DropdownMenuItem(value: 5, child: Text('5')),
                  ],
                  onChanged: (v) => provider.setRatingFilter(v),
                ),
              ),
              const SizedBox(width: 8),
              // Sort
              Expanded(
                child: _FilterDropdown<String>(
                  value: provider.sort,
                  hint: 'Сортировка',
                  items: const [
                    DropdownMenuItem(
                        value: 'newest', child: Text('Новые')),
                    DropdownMenuItem(
                        value: 'oldest', child: Text('Старые')),
                    DropdownMenuItem(
                        value: 'rating_high', child: Text('Рейтинг ↓')),
                    DropdownMenuItem(
                        value: 'rating_low', child: Text('Рейтинг ↑')),
                  ],
                  onChanged: (v) {
                    if (v != null) provider.setSort(v);
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _FilterDropdown<T> extends StatelessWidget {
  final T? value;
  final String hint;
  final List<DropdownMenuItem<T>> items;
  final ValueChanged<T?> onChanged;

  const _FilterDropdown({
    required this.value,
    required this.hint,
    required this.items,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: InputDecoration(
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        isDense: true,
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          hint: Text(hint, style: const TextStyle(fontSize: 13)),
          isExpanded: true,
          isDense: true,
          style: const TextStyle(fontSize: 13, color: Colors.black87),
          items: items,
          onChanged: onChanged,
        ),
      ),
    );
  }
}

// =============================================================================
// Review List
// =============================================================================

class _ReviewList extends StatelessWidget {
  const _ReviewList();

  @override
  Widget build(BuildContext context) {
    return Consumer<AdminReviewsProvider>(
      builder: (context, provider, _) {
        if (provider.isLoadingList && provider.reviews.isEmpty) {
          return const Center(child: CircularProgressIndicator());
        }

        if (provider.listError != null && provider.reviews.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.error_outline, size: 48, color: Colors.grey[400]),
                const SizedBox(height: 12),
                Text(provider.listError!,
                    style: TextStyle(color: Colors.grey[600])),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: () => provider.loadReviews(),
                  child: const Text('Повторить'),
                ),
              ],
            ),
          );
        }

        if (provider.reviews.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.rate_review_outlined,
                    size: 48, color: Colors.grey[400]),
                const SizedBox(height: 12),
                Text('Отзывы не найдены',
                    style: TextStyle(color: Colors.grey[600], fontSize: 16)),
              ],
            ),
          );
        }

        return Column(
          children: [
            Expanded(
              child: ListView.separated(
                itemCount: provider.reviews.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final review = provider.reviews[index];
                  final isSelected = provider.selectedId == review.id;
                  return _ReviewCard(
                    review: review,
                    isSelected: isSelected,
                    onTap: () => provider.selectReview(review.id),
                  );
                },
              ),
            ),
            if (provider.totalPages > 1)
              _buildPagination(context, provider),
          ],
        );
      },
    );
  }

  Widget _buildPagination(BuildContext context, AdminReviewsProvider provider) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: Colors.grey[200]!)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left, size: 20),
            onPressed: provider.currentPage > 1
                ? () => provider.loadReviews(page: provider.currentPage - 1)
                : null,
            iconSize: 20,
          ),
          Text(
            '${provider.currentPage} / ${provider.totalPages}',
            style: const TextStyle(fontSize: 13),
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right, size: 20),
            onPressed: provider.currentPage < provider.totalPages
                ? () => provider.loadReviews(page: provider.currentPage + 1)
                : null,
            iconSize: 20,
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Review Card
// =============================================================================

class _ReviewCard extends StatelessWidget {
  final AdminReviewItem review;
  final bool isSelected;
  final VoidCallback onTap;

  const _ReviewCard({
    required this.review,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isSelected
          ? const Color(0xFFDB4F13).withValues(alpha: 0.08)
          : Colors.white,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top row: author + status badge
              Row(
                children: [
                  Expanded(
                    child: Text(
                      review.authorName ?? review.authorEmail ?? 'Аноним',
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 14),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  _StatusBadge(review: review),
                ],
              ),
              const SizedBox(height: 4),
              // Establishment name + city
              Text(
                [
                  review.establishmentName,
                  review.establishmentCity,
                ]
                    .where((s) => s != null && s.isNotEmpty)
                    .join(', '),
                style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 6),
              // Rating stars
              Row(
                children: [
                  for (int i = 1; i <= 5; i++)
                    Icon(
                      i <= review.rating ? Icons.star : Icons.star_border,
                      size: 16,
                      color: i <= review.rating
                          ? const Color(0xFFF06B32)
                          : Colors.grey[400],
                    ),
                  const SizedBox(width: 8),
                  Text(
                    DateFormat('dd.MM.yyyy').format(review.createdAt.toLocal()),
                    style: TextStyle(fontSize: 11, color: Colors.grey[500]),
                  ),
                ],
              ),
              if (review.content != null && review.content!.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  review.content!.length > 100
                      ? '${review.content!.substring(0, 100)}...'
                      : review.content!,
                  style: TextStyle(fontSize: 13, color: Colors.grey[700]),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final AdminReviewItem review;

  const _StatusBadge({required this.review});

  @override
  Widget build(BuildContext context) {
    final (label, bgColor, textColor) = _getStatusStyle();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: textColor,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  (String, Color, Color) _getStatusStyle() {
    if (review.isDeleted) {
      return ('Удалён', const Color(0xFFFFEBEE), const Color(0xFFD32F2F));
    }
    if (!review.isVisible) {
      return ('Скрыт', const Color(0xFFFFF8E1), const Color(0xFFF57F17));
    }
    return ('Активен', const Color(0xFFE8F5E9), const Color(0xFF2E7D32));
  }
}

// =============================================================================
// Detail Panel
// =============================================================================

class _DetailPanel extends StatelessWidget {
  const _DetailPanel();

  @override
  Widget build(BuildContext context) {
    return Consumer<AdminReviewsProvider>(
      builder: (context, provider, _) {
        final review = provider.selectedReview;

        if (review == null) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.rate_review_outlined,
                    size: 48, color: Colors.grey[300]),
                const SizedBox(height: 12),
                Text(
                  'Выберите отзыв для просмотра',
                  style: TextStyle(color: Colors.grey[500], fontSize: 15),
                ),
              ],
            ),
          );
        }

        return SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header with status
              Row(
                children: [
                  Text(
                    'Детали отзыва',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const Spacer(),
                  _StatusBadge(review: review),
                ],
              ),
              const SizedBox(height: 20),

              // Rating
              Row(
                children: [
                  for (int i = 1; i <= 5; i++)
                    Icon(
                      i <= review.rating ? Icons.star : Icons.star_border,
                      size: 24,
                      color: i <= review.rating
                          ? const Color(0xFFF06B32)
                          : Colors.grey[400],
                    ),
                  const SizedBox(width: 8),
                  Text(
                    '${review.rating}/5',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Review text
              _DetailSection(
                title: 'Текст отзыва',
                child: Text(
                  review.content ?? 'Нет текста',
                  style: const TextStyle(fontSize: 15, height: 1.5),
                ),
              ),

              // Author info
              _DetailSection(
                title: 'Автор',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (review.authorName != null)
                      Text(review.authorName!,
                          style: const TextStyle(
                              fontWeight: FontWeight.w500, fontSize: 14)),
                    if (review.authorEmail != null)
                      Text(review.authorEmail!,
                          style: TextStyle(
                              color: Colors.grey[600], fontSize: 13)),
                  ],
                ),
              ),

              // Establishment info
              _DetailSection(
                title: 'Заведение',
                child: Text(
                  [review.establishmentName, review.establishmentCity]
                      .where((s) => s != null && s.isNotEmpty)
                      .join(', '),
                  style: const TextStyle(fontSize: 14),
                ),
              ),

              // Dates
              _DetailSection(
                title: 'Дата создания',
                child: Text(
                  DateFormat('dd.MM.yyyy HH:mm')
                      .format(review.createdAt.toLocal()),
                  style: const TextStyle(fontSize: 14),
                ),
              ),

              // Flags
              if (review.isEdited)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Row(
                    children: [
                      Icon(Icons.edit, size: 16, color: Colors.grey[500]),
                      const SizedBox(width: 6),
                      Text('Отзыв был отредактирован',
                          style: TextStyle(
                              color: Colors.grey[500], fontSize: 13)),
                    ],
                  ),
                ),

              // Partner response
              if (review.hasPartnerResponse &&
                  review.partnerResponse != null) ...[
                _DetailSection(
                  title: 'Ответ партнёра',
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.blue[50],
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      review.partnerResponse!,
                      style: const TextStyle(fontSize: 14, height: 1.4),
                    ),
                  ),
                ),
              ],

              const SizedBox(height: 24),
              const Divider(),
              const SizedBox(height: 16),

              // Action buttons
              if (!review.isDeleted) _buildActions(context, provider, review),

              // Error message
              if (provider.submitError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    provider.submitError!,
                    style: const TextStyle(color: Colors.red, fontSize: 13),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildActions(
    BuildContext context,
    AdminReviewsProvider provider,
    AdminReviewItem review,
  ) {
    return Row(
      children: [
        // Toggle visibility
        OutlinedButton.icon(
          onPressed: provider.isSubmitting
              ? null
              : () => provider.toggleVisibility(),
          icon: Icon(
            review.isVisible ? Icons.visibility_off : Icons.visibility,
            size: 18,
          ),
          label: Text(review.isVisible ? 'Скрыть' : 'Показать'),
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFFF57F17),
            side: const BorderSide(color: Color(0xFFF57F17)),
          ),
        ),
        const SizedBox(width: 12),
        // Delete
        OutlinedButton.icon(
          onPressed: provider.isSubmitting
              ? null
              : () => _showDeleteDialog(context, provider),
          icon: const Icon(Icons.delete_outline, size: 18),
          label: const Text('Удалить'),
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.red,
            side: const BorderSide(color: Colors.red),
          ),
        ),
        if (provider.isSubmitting) ...[
          const SizedBox(width: 12),
          const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ],
      ],
    );
  }

  void _showDeleteDialog(
      BuildContext context, AdminReviewsProvider provider) {
    final reasonController = TextEditingController();

    showDialog(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить отзыв?'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Отзыв будет удалён, рейтинг заведения пересчитан. '
                'Это действие нельзя отменить.',
              ),
              const SizedBox(height: 16),
              TextField(
                controller: reasonController,
                decoration: InputDecoration(
                  labelText: 'Причина удаления (необязательно)',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                maxLines: 2,
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                provider.deleteReview(reasonController.text.isNotEmpty
                    ? reasonController.text
                    : null);
              },
              style: FilledButton.styleFrom(
                backgroundColor: Colors.red,
              ),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
  }
}

// =============================================================================
// Detail Section helper
// =============================================================================

class _DetailSection extends StatelessWidget {
  final String title;
  final Widget child;

  const _DetailSection({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              fontWeight: FontWeight.w600,
              fontSize: 12,
              color: Colors.grey[500],
              letterSpacing: 0.3,
            ),
          ),
          const SizedBox(height: 6),
          child,
        ],
      ),
    );
  }
}
