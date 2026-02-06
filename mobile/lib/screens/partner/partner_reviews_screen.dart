import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/models/review.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';

/// Partner Reviews Screen - view and filter establishment reviews
/// Figma design: Profile/Admin (Отзывы) frame
/// Phase 5.2b - Partner Dashboard
class PartnerReviewsScreen extends StatefulWidget {
  final String establishmentId;

  const PartnerReviewsScreen({
    super.key,
    required this.establishmentId,
  });

  @override
  State<PartnerReviewsScreen> createState() => _PartnerReviewsScreenState();
}

class _PartnerReviewsScreenState extends State<PartnerReviewsScreen> {
  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = Color(0xFFDB4F13);
  static const Color _greyText = Color(0xFFABABAB);
  static const Color _greyStroke = Color(0xFFD2D2D2);
  static const Color _greenRating = Color(0xFF34C759);

  // Date filter
  DateTime _dateFrom = DateTime.now().subtract(const Duration(days: 30));
  DateTime _dateTo = DateTime.now();

  // Sort option
  String _sortOption = 'По дате (новые)';
  final List<String> _sortOptions = [
    'По дате (новые)',
    'По дате (старые)',
    'По рейтингу (высокий)',
    'По рейтингу (низкий)',
  ];

  // Sort option → backend param mapping
  static const Map<String, String> _sortMapping = {
    'По дате (новые)': 'newest',
    'По дате (старые)': 'newest', // load newest, reverse client-side
    'По рейтингу (высокий)': 'highest',
    'По рейтингу (низкий)': 'lowest',
  };

  // Reviews data
  final ReviewsService _reviewsService = ReviewsService();
  List<Review> _reviews = [];
  List<Review> _filteredReviews = [];
  bool _isLoading = true;
  bool _isLoadingMore = false;
  String? _error;

  // Pagination
  int _currentPage = 1;
  bool _hasMore = true;
  static const int _perPage = 10;

  // Scroll controller for pagination
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _loadReviews();
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
            _scrollController.position.maxScrollExtent - 200 &&
        !_isLoadingMore &&
        _hasMore) {
      _loadMoreReviews();
    }
  }

  /// Map UI sort option to backend sort param
  String get _backendSort => _sortMapping[_sortOption] ?? 'newest';

  /// Load first page of reviews from API
  Future<void> _loadReviews() async {
    setState(() {
      _isLoading = true;
      _error = null;
      _currentPage = 1;
      _hasMore = true;
    });

    try {
      final result = await _reviewsService.getReviewsForEstablishment(
        widget.establishmentId,
        page: 1,
        perPage: _perPage,
        sort: _backendSort,
      );

      final reviews = result.data;

      // Client-side reverse for "oldest first" (backend only supports 'newest')
      if (_sortOption == 'По дате (старые)') {
        reviews.sort((a, b) => a.createdAt.compareTo(b.createdAt));
      }

      setState(() {
        _reviews = reviews;
        _hasMore = result.meta.page < result.meta.totalPages;
        _isLoading = false;
      });

      _applyDateFilter();
    } catch (e) {
      setState(() {
        _error = 'Не удалось загрузить отзывы';
        _isLoading = false;
      });
    }
  }

  /// Load next page of reviews
  Future<void> _loadMoreReviews() async {
    if (_isLoadingMore || !_hasMore) return;

    setState(() => _isLoadingMore = true);

    try {
      final result = await _reviewsService.getReviewsForEstablishment(
        widget.establishmentId,
        page: _currentPage + 1,
        perPage: _perPage,
        sort: _backendSort,
      );

      setState(() {
        _currentPage++;
        _reviews.addAll(result.data);
        _hasMore = result.meta.page < result.meta.totalPages;
        _isLoadingMore = false;
      });

      _applyDateFilter();
    } catch (e) {
      setState(() => _isLoadingMore = false);
    }
  }

  /// Apply client-side date filter to loaded reviews
  void _applyDateFilter() {
    final from = DateTime(_dateFrom.year, _dateFrom.month, _dateFrom.day);
    final to = DateTime(_dateTo.year, _dateTo.month, _dateTo.day, 23, 59, 59);

    setState(() {
      _filteredReviews = _reviews.where((r) {
        return !r.createdAt.isBefore(from) && !r.createdAt.isAfter(to);
      }).toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            _buildHeader(context),

            // Date filter
            _buildDateFilter(),

            const SizedBox(height: 8),

            // Sort button
            _buildSortButton(),

            const SizedBox(height: 16),

            // Reviews list
            Expanded(
              child: _isLoading
                  ? const Center(
                      child: CircularProgressIndicator(color: _primaryOrange),
                    )
                  : _error != null
                      ? _buildErrorState()
                      : _filteredReviews.isEmpty
                          ? _buildEmptyState()
                          : _buildReviewsList(),
            ),
          ],
        ),
      ),
    );
  }

  /// Build header with back button and title
  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: const Icon(
              Icons.chevron_left,
              size: 28,
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 8),
          const Text(
            'Отзывы',
            style: TextStyle(
              fontFamily: 'Unbounded',
              fontSize: 25,
              fontWeight: FontWeight.w400,
              color: _primaryOrange,
            ),
          ),
        ],
      ),
    );
  }

  /// Build date filter row
  Widget _buildDateFilter() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          // From date
          const Text(
            'от',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 15,
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 8),
          _buildDateButton(_dateFrom, true),

          const SizedBox(width: 16),

          // To date
          const Text(
            'до',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 15,
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 8),
          _buildDateButton(_dateTo, false),
        ],
      ),
    );
  }

  /// Build date picker button
  Widget _buildDateButton(DateTime date, bool isFrom) {
    return GestureDetector(
      onTap: () => _showDatePicker(isFrom),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          border: Border.all(color: _greyStroke),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _formatDate(date),
              style: const TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 15,
                color: Colors.black,
              ),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.calendar_today_outlined,
              size: 20,
              color: Colors.black54,
            ),
          ],
        ),
      ),
    );
  }

  /// Show date picker
  Future<void> _showDatePicker(bool isFrom) async {
    final initialDate = isFrom ? _dateFrom : _dateTo;
    final firstDate = DateTime(2020);
    final lastDate = DateTime.now();

    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: firstDate,
      lastDate: lastDate,
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: _primaryOrange,
              onPrimary: _backgroundColor,
              surface: _backgroundColor,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() {
        if (isFrom) {
          _dateFrom = picked;
        } else {
          _dateTo = picked;
        }
      });
      _applyDateFilter();
    }
  }

  /// Format date as DD.MM.YYYY
  String _formatDate(DateTime date) {
    return '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';
  }

  /// Build sort button
  Widget _buildSortButton() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Align(
        alignment: Alignment.centerRight,
        child: GestureDetector(
          onTap: _showSortOptions,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Transform.rotate(
                angle: 1.5708, // 90 degrees
                child: const Icon(
                  Icons.swap_horiz,
                  size: 22,
                  color: Colors.black,
                ),
              ),
              const SizedBox(width: 4),
              const Text(
                'Сортировка',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 14,
                  color: Colors.black,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Show sort options bottom sheet
  void _showSortOptions() {
    showModalBottomSheet(
      context: context,
      backgroundColor: _backgroundColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 16),
            const Text(
              'Сортировка',
              style: TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 18,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 16),
            ..._sortOptions.map((option) => ListTile(
                  title: Text(
                    option,
                    style: TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 16,
                      color:
                          option == _sortOption ? _primaryOrange : Colors.black,
                    ),
                  ),
                  trailing: option == _sortOption
                      ? const Icon(Icons.check, color: _primaryOrange)
                      : null,
                  onTap: () {
                    Navigator.pop(context);
                    if (option != _sortOption) {
                      setState(() => _sortOption = option);
                      _loadReviews(); // Reload with new sort
                    }
                  },
                )),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  /// Build error state
  Widget _buildErrorState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.error_outline,
            size: 64,
            color: _greyText.withValues(alpha: 0.5),
          ),
          const SizedBox(height: 16),
          Text(
            _error!,
            style: const TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 16,
              color: _greyText,
            ),
          ),
          const SizedBox(height: 16),
          GestureDetector(
            onTap: _loadReviews,
            child: const Text(
              'Повторить',
              style: TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 16,
                color: _primaryOrange,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Build empty state
  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.rate_review_outlined,
            size: 64,
            color: _greyText.withValues(alpha: 0.5),
          ),
          const SizedBox(height: 16),
          const Text(
            'Нет отзывов за выбранный период',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 16,
              color: _greyText,
            ),
          ),
        ],
      ),
    );
  }

  /// Build reviews list
  Widget _buildReviewsList() {
    return RefreshIndicator(
      onRefresh: _loadReviews,
      color: _primaryOrange,
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _filteredReviews.length + (_isLoadingMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == _filteredReviews.length) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(
                child: CircularProgressIndicator(color: _primaryOrange),
              ),
            );
          }
          return Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: _buildReviewCard(_filteredReviews[index]),
          );
        },
      ),
    );
  }

  /// Build review card
  Widget _buildReviewCard(Review review) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: _greyStroke, width: 1.13),
        borderRadius: BorderRadius.circular(11),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row with avatar, name, and rating
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Avatar
              _buildAvatar(review),
              const SizedBox(width: 12),

              // Name
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 8),
                    Text(
                      review.userName,
                      style: const TextStyle(
                        fontFamily: 'Avenir Next',
                        fontSize: 18,
                        fontWeight: FontWeight.w500,
                        color: Colors.black,
                      ),
                    ),
                  ],
                ),
              ),

              // Rating badge
              Container(
                width: 31,
                height: 31,
                decoration: BoxDecoration(
                  color: _greenRating,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Center(
                  child: Text(
                    review.rating.toStringAsFixed(1).replaceAll('.', ','),
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 16,
                      color: _backgroundColor,
                    ),
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 8),

          // Date
          Text(
            '– ${_formatRelativeDate(review.createdAt)}',
            style: const TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 13,
              color: Colors.black,
            ),
          ),

          const SizedBox(height: 8),

          // Review text
          if (review.text != null && review.text!.isNotEmpty)
            Text(
              review.text!,
              style: const TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 15,
                color: Colors.black,
                height: 1.5,
              ),
            ),

          const SizedBox(height: 12),

          // Partner response section
          if (review.partnerResponse != null &&
              review.partnerResponse!.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _primaryOrange.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(8),
                border:
                    Border.all(color: _primaryOrange.withValues(alpha: 0.2)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.reply,
                        size: 16,
                        color: _primaryOrange,
                      ),
                      const SizedBox(width: 6),
                      const Text(
                        'Ответ заведения',
                        style: TextStyle(
                          fontFamily: 'Avenir Next',
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: _primaryOrange,
                        ),
                      ),
                      const Spacer(),
                      if (review.partnerResponseAt != null)
                        Text(
                          _formatRelativeDate(review.partnerResponseAt!),
                          style: const TextStyle(
                            fontFamily: 'Avenir Next',
                            fontSize: 11,
                            color: _greyText,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    review.partnerResponse!,
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 14,
                      color: Colors.black87,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],

          // Reply button
          Align(
            alignment: Alignment.centerRight,
            child: GestureDetector(
              onTap: () => _showResponseDialog(review),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  border: Border.all(color: _primaryOrange),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  review.partnerResponse != null ? 'Редактировать' : 'Ответить',
                  style: const TextStyle(
                    fontFamily: 'Avenir Next',
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: _primaryOrange,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Build avatar widget - network image or fallback to initial letter
  Widget _buildAvatar(Review review) {
    if (review.userAvatar != null && review.userAvatar!.isNotEmpty) {
      return CircleAvatar(
        radius: 30,
        backgroundImage: NetworkImage(review.userAvatar!),
        onBackgroundImageError: (_, __) {},
        child: null,
      );
    }

    // Fallback: first letter of name with color derived from name
    final colorIndex = review.userName.hashCode % _avatarColors.length;
    return CircleAvatar(
      radius: 30,
      backgroundColor: _avatarColors[colorIndex.abs()],
      child: Text(
        review.userName.isNotEmpty ? review.userName[0].toUpperCase() : '?',
        style: const TextStyle(
          fontFamily: 'Avenir Next',
          fontSize: 20,
          fontWeight: FontWeight.w500,
          color: Colors.white,
        ),
      ),
    );
  }

  // Avatar fallback colors
  static const List<Color> _avatarColors = [
    Color(0xFFE57373),
    Color(0xFF64B5F6),
    Color(0xFF81C784),
    Color(0xFFFFB74D),
    Color(0xFFBA68C8),
    Color(0xFF4DB6AC),
    Color(0xFFF06292),
    Color(0xFF7986CB),
  ];

  /// Show dialog for partner to respond to a review
  void _showResponseDialog(Review review) {
    final controller =
        TextEditingController(text: review.partnerResponse ?? '');
    final formKey = GlobalKey<FormState>();
    bool isSubmitting = false;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: _backgroundColor,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: Text(
            review.partnerResponse != null
                ? 'Редактировать ответ'
                : 'Ответить на отзыв',
            style: const TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Отзыв от ${review.userName}:',
                  style: const TextStyle(
                    fontFamily: 'Avenir Next',
                    fontSize: 13,
                    color: _greyText,
                  ),
                ),
                const SizedBox(height: 4),
                if (review.text != null && review.text!.isNotEmpty)
                  Text(
                    review.text!.length > 100
                        ? '${review.text!.substring(0, 100)}...'
                        : review.text!,
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 14,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: controller,
                  maxLines: 4,
                  maxLength: 1000,
                  decoration: InputDecoration(
                    hintText: 'Введите ваш ответ...',
                    hintStyle: const TextStyle(
                      fontFamily: 'Avenir Next',
                      color: _greyText,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(color: _greyStroke),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(color: _primaryOrange),
                    ),
                    contentPadding: const EdgeInsets.all(12),
                  ),
                  style: const TextStyle(
                    fontFamily: 'Avenir Next',
                    fontSize: 14,
                  ),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Введите текст ответа';
                    }
                    if (value.trim().length < 10) {
                      return 'Минимум 10 символов';
                    }
                    return null;
                  },
                ),
              ],
            ),
          ),
          actions: [
            // Delete button (only if response exists)
            if (review.partnerResponse != null)
              TextButton(
                onPressed: isSubmitting
                    ? null
                    : () async {
                        setDialogState(() => isSubmitting = true);
                        final success = await _reviewsService
                            .deletePartnerResponse(review.id);
                        if (success && mounted) {
                          Navigator.pop(context);
                          _loadReviews();
                          ScaffoldMessenger.of(this.context).showSnackBar(
                            const SnackBar(
                              content: Text('Ответ удалён'),
                              backgroundColor: _greenRating,
                            ),
                          );
                        } else {
                          setDialogState(() => isSubmitting = false);
                          if (mounted) {
                            ScaffoldMessenger.of(this.context).showSnackBar(
                              const SnackBar(
                                content: Text('Не удалось удалить ответ'),
                                backgroundColor: Colors.red,
                              ),
                            );
                          }
                        }
                      },
                child: Text(
                  'Удалить',
                  style: TextStyle(
                    fontFamily: 'Avenir Next',
                    color: isSubmitting ? _greyText : Colors.red,
                  ),
                ),
              ),
            // Cancel button
            TextButton(
              onPressed: isSubmitting ? null : () => Navigator.pop(context),
              child: Text(
                'Отмена',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  color: isSubmitting ? _greyText : Colors.black54,
                ),
              ),
            ),
            // Submit button
            TextButton(
              onPressed: isSubmitting
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;

                      setDialogState(() => isSubmitting = true);

                      try {
                        final result = await _reviewsService.addPartnerResponse(
                          reviewId: review.id,
                          response: controller.text.trim(),
                        );

                        if (result != null && mounted) {
                          Navigator.pop(context);
                          _loadReviews();
                          ScaffoldMessenger.of(this.context).showSnackBar(
                            SnackBar(
                              content: Text(
                                review.partnerResponse != null
                                    ? 'Ответ обновлён'
                                    : 'Ответ отправлен',
                              ),
                              backgroundColor: _greenRating,
                            ),
                          );
                        } else {
                          setDialogState(() => isSubmitting = false);
                        }
                      } catch (e) {
                        setDialogState(() => isSubmitting = false);
                        if (mounted) {
                          ScaffoldMessenger.of(this.context).showSnackBar(
                            const SnackBar(
                              content: Text('Не удалось отправить ответ'),
                              backgroundColor: Colors.red,
                            ),
                          );
                        }
                      }
                    },
              child: isSubmitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: _primaryOrange,
                      ),
                    )
                  : const Text(
                      'Отправить',
                      style: TextStyle(
                        fontFamily: 'Avenir Next',
                        fontWeight: FontWeight.w600,
                        color: _primaryOrange,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  /// Format date as relative time
  String _formatRelativeDate(DateTime date) {
    final local = date.toLocal();
    final now = DateTime.now();
    final difference = now.difference(local);

    final hours = local.hour.toString().padLeft(2, '0');
    final minutes = local.minute.toString().padLeft(2, '0');
    final time = '$hours:$minutes';

    if (difference.inDays < 1) {
      return '$time, сегодня';
    } else if (difference.inDays < 2) {
      return '$time, вчера';
    } else if (difference.inDays < 7) {
      return '$time, ${difference.inDays} дней назад';
    } else {
      return '$time, ${_formatDate(date)}';
    }
  }
}
